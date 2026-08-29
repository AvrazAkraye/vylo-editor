//! Checkpoints — putting the files back the way they were.
//!
//! A checkpoint is taken the moment approved changes are written, and records
//! what each file looked like *before* that write. Restoring one walks forward
//! from it to the present, taking the earliest recorded version of every file
//! touched since, and writes those back.
//!
//! ## Two things this must get right
//!
//! **A file that did not exist has to be deleted, not emptied.** A new file's
//! "before" is an empty string, and writing that back would leave a zero-byte
//! file where there had been nothing — which looks like a restore that worked
//! and is not one. Every snapshot records whether the file existed.
//!
//! **Restoring is destructive and does not pretend otherwise.** It overwrites
//! whatever is there now, including edits made by hand since. That is what
//! "put it back to then" means, so the confirmation names every file rather
//! than the guard being a hash check that would make restore fail exactly when
//! it is most wanted.
//!
//! Snapshots live in the app data directory, never in the repository. Putting
//! them in the project would mean the undo history for a change showing up as
//! another change.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

/// Checkpoints kept per chat. Older ones are dropped as new ones arrive.
const KEEP_PER_CHAT: usize = 60;
/// Chat directories untouched for this long are removed on the next save.
const STALE_DAYS: u64 = 30;

#[derive(Clone, Serialize, Deserialize)]
pub struct Snapshot {
    pub path: String,
    pub content: String,
    /// False when the change created the file, so restoring deletes it.
    pub existed: bool,
}

#[derive(Serialize, Deserialize)]
struct Record {
    seq: u64,
    at: u64,
    files: Vec<Snapshot>,
}

#[derive(Serialize)]
pub struct Meta {
    pub seq: u64,
    pub at: u64,
    pub paths: Vec<String>,
}

fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// A chat id becomes a directory name, so it may not be able to say `../`.
fn safe_chat(chat: &str) -> Result<&str, String> {
    if chat.is_empty()
        || chat.len() > 64
        || !chat.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        return Err("invalid chat id".into());
    }
    Ok(chat)
}

fn chat_dir(base: &Path, chat: &str) -> Result<PathBuf, String> {
    Ok(base.join("checkpoints").join(safe_chat(chat)?))
}

pub fn save_at(base: &Path, chat: &str, seq: u64, files: Vec<Snapshot>) -> Result<(), String> {
    let dir = chat_dir(base, chat)?;
    fs::create_dir_all(&dir).map_err(|e| format!("could not create the checkpoint store: {e}"))?;
    let rec = Record { seq, at: now(), files };
    let json = serde_json::to_string(&rec).map_err(|e| e.to_string())?;
    fs::write(dir.join(format!("{seq}.json")), json)
        .map_err(|e| format!("could not write the checkpoint: {e}"))?;
    prune(base, &dir);
    Ok(())
}

/// Newest first, so the UI does not have to sort.
pub fn list_at(base: &Path, chat: &str) -> Result<Vec<Meta>, String> {
    let dir = chat_dir(base, chat)?;
    let mut out = Vec::new();
    let Ok(entries) = fs::read_dir(&dir) else { return Ok(out) };
    for e in entries.flatten() {
        let Ok(text) = fs::read_to_string(e.path()) else { continue };
        let Ok(rec) = serde_json::from_str::<Record>(&text) else { continue };
        out.push(Meta {
            seq: rec.seq,
            at: rec.at,
            paths: rec.files.into_iter().map(|f| f.path).collect(),
        });
    }
    out.sort_by(|a, b| b.seq.cmp(&a.seq));
    Ok(out)
}

/// Every file touched at or after `seq`, in the state it was in before `seq`.
///
/// Walking oldest-first and keeping the first version seen is what makes this
/// correct across several checkpoints: the earliest record of a file is the one
/// furthest back, and later records describe states we are undoing.
fn rewind_set(base: &Path, chat: &str, seq: u64) -> Result<Vec<Snapshot>, String> {
    let dir = chat_dir(base, chat)?;
    let mut records: Vec<Record> = Vec::new();
    let Ok(entries) = fs::read_dir(&dir) else { return Ok(Vec::new()) };
    for e in entries.flatten() {
        let Ok(text) = fs::read_to_string(e.path()) else { continue };
        let Ok(rec) = serde_json::from_str::<Record>(&text) else { continue };
        if rec.seq >= seq {
            records.push(rec);
        }
    }
    records.sort_by_key(|r| r.seq);

    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for rec in records {
        for f in rec.files {
            if seen.insert(f.path.clone()) {
                out.push(f);
            }
        }
    }
    Ok(out)
}

pub fn restore_at(
    base: &Path,
    chat: &str,
    seq: u64,
    resolve: impl Fn(&str) -> Result<PathBuf, String>,
) -> Result<Vec<String>, String> {
    let files = rewind_set(base, chat, seq)?;
    let mut done = Vec::new();
    for f in &files {
        let target = resolve(&f.path)?;
        if f.existed {
            if let Some(parent) = target.parent() {
                let _ = fs::create_dir_all(parent);
            }
            fs::write(&target, &f.content).map_err(|e| format!("{}: {e}", f.path))?;
        } else if target.exists() {
            fs::remove_file(&target).map_err(|e| format!("{}: {e}", f.path))?;
        }
        done.push(f.path.clone());
    }
    // Everything from `seq` onward has been undone, so those records describe
    // states that no longer exist and would corrupt a later restore.
    let dir = chat_dir(base, chat)?;
    if let Ok(entries) = fs::read_dir(&dir) {
        for e in entries.flatten() {
            if let Ok(text) = fs::read_to_string(e.path()) {
                if let Ok(rec) = serde_json::from_str::<Record>(&text) {
                    if rec.seq >= seq {
                        let _ = fs::remove_file(e.path());
                    }
                }
            }
        }
    }
    done.sort();
    Ok(done)
}

/// Keep the store from growing without bound: a cap per chat, and chat
/// directories nobody has touched in a month.
fn prune(base: &Path, dir: &Path) {
    if let Ok(entries) = fs::read_dir(dir) {
        let mut files: Vec<(u64, PathBuf)> = entries
            .flatten()
            .filter_map(|e| {
                let p = e.path();
                let n: u64 = p.file_stem()?.to_str()?.parse().ok()?;
                Some((n, p))
            })
            .collect();
        if files.len() > KEEP_PER_CHAT {
            files.sort_by_key(|(n, _)| *n);
            for (_, p) in files.iter().take(files.len() - KEEP_PER_CHAT) {
                let _ = fs::remove_file(p);
            }
        }
    }

    let root = base.join("checkpoints");
    let cutoff = std::time::Duration::from_secs(STALE_DAYS * 24 * 60 * 60);
    if let Ok(entries) = fs::read_dir(&root) {
        for e in entries.flatten() {
            if e.path() == dir {
                continue;
            }
            let stale = e
                .metadata()
                .and_then(|m| m.modified())
                .map(|t| t.elapsed().map(|d| d > cutoff).unwrap_or(false))
                .unwrap_or(false);
            if stale {
                let _ = fs::remove_dir_all(e.path());
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("vylo_cp_{}_{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&p);
        fs::create_dir_all(&p).unwrap();
        p
    }

    /// Restore writes into the workspace, so it goes through the same
    /// containment as every other write rather than trusting a stored path.
    fn resolver(root: PathBuf) -> impl Fn(&str) -> Result<PathBuf, String> {
        move |rel: &str| {
            if rel.contains("..") {
                return Err("escapes the workspace".into());
            }
            Ok(root.join(rel))
        }
    }

    #[test]
    fn a_chat_id_cannot_climb_out_of_the_store() {
        assert!(safe_chat("../../etc").is_err());
        assert!(safe_chat("a/b").is_err());
        assert!(safe_chat("").is_err());
        assert!(safe_chat("c_1788-ab").is_ok());
    }

    #[test]
    fn restoring_puts_back_the_oldest_version_across_several_checkpoints() {
        let base = tmp("multi");
        let root = tmp("multi_root");
        fs::write(root.join("a.txt"), "v1\n").unwrap();

        // Turn 1 changed a.txt from v1 to v2.
        save_at(&base, "c1", 1, vec![Snapshot { path: "a.txt".into(), content: "v1\n".into(), existed: true }]).unwrap();
        fs::write(root.join("a.txt"), "v2\n").unwrap();
        // Turn 2 changed it again, v2 to v3.
        save_at(&base, "c1", 2, vec![Snapshot { path: "a.txt".into(), content: "v2\n".into(), existed: true }]).unwrap();
        fs::write(root.join("a.txt"), "v3\n").unwrap();

        // Going back to before turn 1 must reach v1, not v2.
        let done = restore_at(&base, "c1", 1, resolver(root.clone())).unwrap();
        assert_eq!(done, vec!["a.txt".to_string()]);
        assert_eq!(fs::read_to_string(root.join("a.txt")).unwrap(), "v1\n");

        let _ = fs::remove_dir_all(&base);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn restoring_deletes_a_file_the_change_created() {
        let base = tmp("new");
        let root = tmp("new_root");
        save_at(&base, "c1", 1, vec![Snapshot { path: "made.txt".into(), content: String::new(), existed: false }]).unwrap();
        fs::write(root.join("made.txt"), "written by the agent\n").unwrap();

        restore_at(&base, "c1", 1, resolver(root.clone())).unwrap();
        assert!(
            !root.join("made.txt").exists(),
            "a file that did not exist must be removed, not left empty",
        );

        let _ = fs::remove_dir_all(&base);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_restored_checkpoint_and_everything_after_it_is_forgotten() {
        let base = tmp("forget");
        let root = tmp("forget_root");
        fs::write(root.join("a.txt"), "v1\n").unwrap();
        for (seq, was) in [(1u64, "v1\n"), (2, "v2\n"), (3, "v3\n")] {
            save_at(&base, "c1", seq, vec![Snapshot { path: "a.txt".into(), content: was.into(), existed: true }]).unwrap();
        }
        assert_eq!(list_at(&base, "c1").unwrap().len(), 3);

        restore_at(&base, "c1", 2, resolver(root.clone())).unwrap();
        let left = list_at(&base, "c1").unwrap();
        assert_eq!(left.len(), 1, "only the checkpoint before the restore survives");
        assert_eq!(left[0].seq, 1);

        let _ = fs::remove_dir_all(&base);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn the_store_is_capped_per_chat() {
        let base = tmp("cap");
        for seq in 1..=(KEEP_PER_CHAT as u64 + 10) {
            save_at(&base, "c1", seq, vec![Snapshot { path: "a.txt".into(), content: "x".into(), existed: true }]).unwrap();
        }
        let kept = list_at(&base, "c1").unwrap();
        assert_eq!(kept.len(), KEEP_PER_CHAT);
        assert_eq!(kept[0].seq, KEEP_PER_CHAT as u64 + 10, "the newest is kept");
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn listing_an_unknown_chat_is_empty_rather_than_an_error() {
        let base = tmp("none");
        assert!(list_at(&base, "nothing").unwrap().is_empty());
        let _ = fs::remove_dir_all(&base);
    }
}
