//! Unsaved buffers, kept outside the process that holds them.
//!
//! F3 asks before a clean quit. A crash, a kernel panic or a force-quit asks
//! nobody, and everything not yet saved is gone. So a dirty buffer is written
//! to the app data directory as it changes, and offered back on the next launch.
//!
//! ## Why the file on disk is not touched
//!
//! The obvious shortcut is to autosave into the project. That turns "I was
//! trying something" into a change to the repository, which the agent then
//! reads as the truth and git reports as work. A draft is a copy held
//! elsewhere; the project only changes when a person saves.
//!
//! ## The sha is the honest part
//!
//! Each draft records the hash of what the editor had loaded when the edit
//! began. On the next launch that is compared with what is on disk now, so a
//! draft made against a file that has since changed can be *offered with that
//! said*, rather than silently reviving edits to a version that no longer
//! exists.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

/// Drafts untouched for this long are swept on the next save. Long enough to
/// survive a holiday, short enough that the directory does not grow for ever.
const STALE_DAYS: u64 = 30;

#[derive(Serialize, Deserialize)]
struct Record {
    path: String,
    text: String,
    /// sha-256 of the file as the editor loaded it.
    base: String,
    at: u64,
}

#[derive(Serialize)]
pub struct DraftInfo {
    pub path: String,
    pub base: String,
    pub at: u64,
    pub bytes: u64,
}

fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// A stable, filesystem-safe name for a string.
///
/// Hashed rather than sanitised: a workspace path can contain anything, two
/// different paths must never collide, and a sanitised name would do both
/// badly. The real path is stored inside the file.
fn key(s: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update(s.as_bytes());
    h.finalize().iter().take(16).map(|b| format!("{b:02x}")).collect()
}

fn dir_for(base: &Path, root: &str) -> PathBuf {
    base.join("drafts").join(key(root))
}

pub fn save_at(base: &Path, root: &str, path: &str, text: &str, sha: &str) -> Result<(), String> {
    let dir = dir_for(base, root);
    fs::create_dir_all(&dir).map_err(|e| format!("could not keep a draft: {e}"))?;
    let rec = Record { path: path.into(), text: text.into(), base: sha.into(), at: now() };
    let json = serde_json::to_string(&rec).map_err(|e| e.to_string())?;
    fs::write(dir.join(format!("{}.json", key(path))), json)
        .map_err(|e| format!("could not keep a draft: {e}"))?;
    sweep(base);
    Ok(())
}

pub fn list_at(base: &Path, root: &str) -> Vec<DraftInfo> {
    let mut out = Vec::new();
    let Ok(entries) = fs::read_dir(dir_for(base, root)) else { return out };
    for e in entries.flatten() {
        let Ok(text) = fs::read_to_string(e.path()) else { continue };
        let Ok(rec) = serde_json::from_str::<Record>(&text) else { continue };
        out.push(DraftInfo {
            bytes: rec.text.len() as u64,
            path: rec.path,
            base: rec.base,
            at: rec.at,
        });
    }
    out.sort_by(|a, b| a.path.cmp(&b.path));
    out
}

pub fn read_at(base: &Path, root: &str, path: &str) -> Option<String> {
    let file = dir_for(base, root).join(format!("{}.json", key(path)));
    let text = fs::read_to_string(file).ok()?;
    serde_json::from_str::<Record>(&text).ok().map(|r| r.text)
}

pub fn clear_at(base: &Path, root: &str, path: &str) {
    let _ = fs::remove_file(dir_for(base, root).join(format!("{}.json", key(path))));
}

pub fn clear_all_at(base: &Path, root: &str) {
    let _ = fs::remove_dir_all(dir_for(base, root));
}

/// Drop draft directories nobody has touched in a month.
fn sweep(base: &Path) {
    let root = base.join("drafts");
    let cutoff = std::time::Duration::from_secs(STALE_DAYS * 24 * 60 * 60);
    let Ok(entries) = fs::read_dir(&root) else { return };
    for e in entries.flatten() {
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

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("vylo_draft_{}_{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&p);
        fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn a_draft_survives_and_comes_back() {
        let base = tmp("round");
        save_at(&base, "/work/proj", "src/a.ts", "half a thought", "sha-abc").unwrap();
        let listed = list_at(&base, "/work/proj");
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].path, "src/a.ts");
        assert_eq!(listed[0].base, "sha-abc", "the version it was edited against is kept");
        assert!(listed[0].at > 0);
        assert_eq!(read_at(&base, "/work/proj", "src/a.ts").as_deref(), Some("half a thought"));
        let _ = fs::remove_dir_all(&base);
    }

    /// Two projects can hold files with the same relative path, and two files
    /// in one project obviously differ. Neither may overwrite the other.
    #[test]
    fn drafts_are_separated_by_project_and_by_path() {
        let base = tmp("sep");
        save_at(&base, "/work/one", "src/a.ts", "from one", "s").unwrap();
        save_at(&base, "/work/two", "src/a.ts", "from two", "s").unwrap();
        save_at(&base, "/work/one", "src/b.ts", "b of one", "s").unwrap();

        assert_eq!(read_at(&base, "/work/one", "src/a.ts").as_deref(), Some("from one"));
        assert_eq!(read_at(&base, "/work/two", "src/a.ts").as_deref(), Some("from two"));
        assert_eq!(list_at(&base, "/work/one").len(), 2);
        assert_eq!(list_at(&base, "/work/two").len(), 1);
        let _ = fs::remove_dir_all(&base);
    }

    /// A path can contain anything a filesystem allows, and the key has to cope
    /// without colliding or escaping the store.
    #[test]
    fn awkward_paths_do_not_collide_or_escape() {
        let base = tmp("odd");
        let odd = ["../../etc/passwd", "a b/c:d.ts", "emoji/🙂.ts", "very/deeply/nested/x.ts"];
        for (i, p) in odd.iter().enumerate() {
            save_at(&base, "/w", p, &format!("content {i}"), "s").unwrap();
        }
        assert_eq!(list_at(&base, "/w").len(), odd.len(), "no two collided");
        for (i, p) in odd.iter().enumerate() {
            assert_eq!(read_at(&base, "/w", p).as_deref(), Some(format!("content {i}").as_str()));
        }
        // Everything landed inside the store, `..` included.
        let files: Vec<_> = fs::read_dir(base.join("drafts").join(key("/w"))).unwrap().flatten().collect();
        assert_eq!(files.len(), odd.len());
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn saving_a_file_forgets_its_draft() {
        let base = tmp("clear");
        save_at(&base, "/w", "a.ts", "x", "s").unwrap();
        save_at(&base, "/w", "b.ts", "y", "s").unwrap();
        clear_at(&base, "/w", "a.ts");
        let left = list_at(&base, "/w");
        assert_eq!(left.len(), 1);
        assert_eq!(left[0].path, "b.ts");

        clear_all_at(&base, "/w");
        assert!(list_at(&base, "/w").is_empty());
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn a_project_with_no_drafts_is_empty_rather_than_an_error() {
        let base = tmp("none");
        assert!(list_at(&base, "/never/opened").is_empty());
        assert!(read_at(&base, "/never/opened", "a.ts").is_none());
        let _ = fs::remove_dir_all(&base);
    }
}
