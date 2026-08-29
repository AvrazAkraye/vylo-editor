//! Checkpoints — putting the files back, and putting them back again.
//!
//! A checkpoint is taken the moment approved changes are written, and records
//! what each file looked like *before* that write and what it looked like
//! *after*. Undoing one walks forward from it to the present, taking the
//! earliest recorded version of every file touched since, and writes those
//! back. Redoing walks the same list the other way, one checkpoint at a time.
//!
//! ## Undo is not a one-way door
//!
//! An undone checkpoint is **marked**, never deleted. The undone records are
//! the redo stack, and they always form a suffix of the sequence: undo marks a
//! suffix, redo unmarks its lowest, and saving a new checkpoint discards them
//! all. That last rule is a text editor's, and it is here for the same reason —
//! after a new write, the undone checkpoints belong to a conversation that no
//! longer exists, so redoing one would write files that nothing on screen
//! accounts for.
//!
//! ## The conversation travels with the files
//!
//! Undo cuts the transcript back as well, so redo has to put it back. A redo
//! that restored only the files would leave the transcript denying the write
//! ever happened — and with no line to carry the undo button, that redo would
//! itself be the one-way step this exists to remove. So the UI hands over the
//! conversation as it stood when the undo was asked for and gets it back
//! verbatim; nothing here looks inside it.
//!
//! **One copy per undo, not one per checkpoint.** Undoing back over twenty
//! writes hands over that one transcript and twenty *cut points* into it. The
//! twenty prefixes it used to hand over shared nothing, and a transcript holds
//! every `tool_result` — the whole text of every file the agent read — so a
//! long refactoring session went through one IPC call as tens of megabytes and
//! landed on the disk as twenty independent copies. A cut point is opaque here
//! in exactly the way the transcript is: the UI writes it, the UI reads it back.
//!
//! ## What the store looks like on disk
//!
//! ```text
//! <seq>.json         a checkpoint: every file it touched, before and after
//! <seq>.undone.json  the same checkpoint, undone — the name is the whole mark
//! <seq>.cut.json     where its transcript ends inside the conversation below
//! <seq>.tail.json    the conversation one undo cut away, kept once per undo
//! ```
//!
//! The two facts saving needs — the highest number in use, and which records
//! are undone — are both in the *names*, so filing a checkpoint and pruning the
//! store read the directory and never a record. A record carries the whole
//! contents of every file it touched; parsing sixty of them to choose the next
//! number would put tens of megabytes of work behind the approval click, which
//! is the most latency-sensitive interaction in the app. Undo, redo and the
//! list do read records, because the contents are what they are for.
//!
//! A record is written once and never rewritten. Everything that changes about
//! it afterwards is its name and a small file beside it.
//!
//! ## Two things this must get right
//!
//! **A file that did not exist has to be deleted, not emptied.** A new file's
//! "before" is an empty string, and writing that back would leave a zero-byte
//! file where there had been nothing — which looks like a restore that worked
//! and is not one. Every snapshot records whether the file existed.
//!
//! **Restoring is destructive and does not pretend otherwise.** It overwrites
//! whatever is there now, including edits made by hand since — in both
//! directions. That is what "put it back to then" means, so the confirmation
//! names every file rather than the guard being a hash check that would make
//! restore fail exactly when it is most wanted.
//!
//! Snapshots live in the app data directory, never in the repository. Putting
//! them in the project would mean the undo history for a change showing up as
//! another change.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

/// How much of one chat's undo history is kept.
///
/// A value rather than two constants so the tests can prove eviction without
/// writing thirty-two megabytes to do it, the way `history.rs` does — a cap
/// that can only be exercised at its real size is a cap nobody exercises.
#[derive(Clone, Copy)]
struct Caps {
    /// Checkpoints per chat. Older ones are dropped as new ones arrive.
    count: usize,
    /// And what they may take between them, whatever the count says.
    bytes: u64,
}

impl Default for Caps {
    fn default() -> Self {
        // Sixty is kept because losing an undo is worse than the disk. The byte
        // cap is the one that actually binds: a record now holds both sides of
        // every file it touched, so sixty of a multi-file refactor is hundreds
        // of megabytes with nothing but a count to stop it. 32 MB per chat
        // matches `history.rs`, which bounds the same kind of store.
        Caps { count: 60, bytes: 32 * 1024 * 1024 }
    }
}

/// Chat directories untouched for this long are removed on the next save.
const STALE_DAYS: u64 = 30;

#[derive(Clone, Serialize, Deserialize)]
pub struct Snapshot {
    pub path: String,
    pub content: String,
    /// False when the change created the file, so restoring deletes it.
    pub existed: bool,
    /// What the approved write produced. `None` on checkpoints written before
    /// redo existed: those still undo, and simply cannot be put back — which is
    /// why redo is decided per checkpoint rather than assumed.
    #[serde(default)]
    pub after: Option<String>,
}

/// What is kept for one checkpoint an undo is stepping back over.
///
/// Opaque JSON on purpose. The shape belongs to the transcript, and keeping it
/// out of Rust means the two sides agree on nothing beyond "it comes back the
/// way it went in".
#[derive(Deserialize)]
pub struct Tail {
    pub seq: u64,
    /// Where this checkpoint's transcript ends inside the conversation below.
    pub ends: serde_json::Value,
    /// The conversation itself, sent **once** for the whole undo.
    ///
    /// It arrives on the newest checkpoint being undone because that one's
    /// transcript *is* the whole conversation; every older one ends part way
    /// through the same text. Sending each of them its own prefix is what this
    /// replaces — the prefixes shared nothing, and a transcript holds every
    /// `tool_result`, so undoing twenty writes in a refactoring session sent
    /// tens of megabytes through one IPC call and wrote every byte of it again
    /// per checkpoint.
    #[serde(default)]
    pub conversation: Option<serde_json::Value>,
}

/// `<seq>.cut.json`: which conversation this checkpoint indexes into, and where.
#[derive(Serialize, Deserialize)]
struct CutFile {
    /// The checkpoint whose `<seq>.tail.json` holds the conversation — the
    /// newest of the batch undone together, which is also the last of them to
    /// be redone, so the copy outlives everything that reads it.
    tail_at: u64,
    ends: serde_json::Value,
}

/// One checkpoint's contents. Its number and whether it has been undone are in
/// its name, and deliberately nowhere else: two places to read a fact is two
/// places for it to disagree.
#[derive(Serialize, Deserialize)]
struct Record {
    at: u64,
    files: Vec<Snapshot>,
}

#[derive(Serialize)]
pub struct Meta {
    pub seq: u64,
    pub at: u64,
    pub paths: Vec<String>,
    pub undone: bool,
    /// False on a checkpoint from before redo existed. The UI offers no control
    /// at all rather than one that fails when it is pressed.
    pub redoable: bool,
}

/// What a redo put back, so the UI can restore the transcript alongside it.
#[derive(Serialize)]
pub struct Redone {
    pub seq: u64,
    pub paths: Vec<String>,
    pub conversation: serde_json::Value,
    /// Where this checkpoint's transcript ends inside `conversation`. Handed
    /// over the way it arrived — the slicing is the UI's, because the shape is.
    pub ends: serde_json::Value,
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

/// What one name in a chat directory says it is.
#[derive(Clone, Copy, PartialEq)]
enum Kind {
    Applied,
    Undone,
    Cut,
    Tail,
}

impl Kind {
    fn is_record(self) -> bool {
        self == Kind::Applied || self == Kind::Undone
    }
}

/// One file in the store, entirely as its name describes it.
struct Filed {
    seq: u64,
    kind: Kind,
    path: PathBuf,
    bytes: u64,
}

/// `<seq>` and what the rest of the name makes it. Anything else in the
/// directory belongs to somebody else and is left alone rather than guessed at.
fn classify(name: &str) -> Option<(u64, Kind)> {
    let (num, rest) = name.split_once('.')?;
    let kind = match rest {
        "json" => Kind::Applied,
        "undone.json" => Kind::Undone,
        "cut.json" => Kind::Cut,
        "tail.json" => Kind::Tail,
        _ => return None,
    };
    Some((num.parse().ok()?, kind))
}

/// Everything filed for one chat, oldest first.
///
/// Names and sizes only. Saving and pruning need nothing more, and that is the
/// point of the naming scheme.
fn filed(dir: &Path) -> Vec<Filed> {
    let Ok(entries) = fs::read_dir(dir) else { return Vec::new() };
    let mut out: Vec<Filed> = entries
        .flatten()
        .filter_map(|e| {
            let (seq, kind) = classify(e.file_name().to_str()?)?;
            let md = e.metadata().ok()?;
            if !md.is_file() {
                return None;
            }
            Some(Filed { seq, kind, path: e.path(), bytes: md.len() })
        })
        .collect();
    // Sorted by `seq` rather than by name: `10.json` sorts before `2.json`, and
    // every walk here depends on the order being the order the writes happened
    // in.
    out.sort_by_key(|f| f.seq);
    out
}

/// The contents of every readable checkpoint among `entries`, oldest first, as
/// `(seq, undone, record)`.
///
/// Undo needs the `before` of every file, redo the `after`, and the list the
/// paths, so all three read records. Nothing else does.
fn read_records(entries: &[Filed]) -> Vec<(u64, bool, Record)> {
    entries
        .iter()
        .filter(|f| f.kind.is_record())
        .filter_map(|f| {
            let text = fs::read_to_string(&f.path).ok()?;
            let rec = serde_json::from_str::<Record>(&text).ok()?;
            Some((f.seq, f.kind == Kind::Undone, rec))
        })
        .collect()
}

fn record_path(dir: &Path, seq: u64, undone: bool) -> PathBuf {
    dir.join(if undone { format!("{seq}.undone.json") } else { format!("{seq}.json") })
}

fn cut_path(dir: &Path, seq: u64) -> PathBuf {
    dir.join(format!("{seq}.cut.json"))
}

fn tail_path(dir: &Path, seq: u64) -> PathBuf {
    dir.join(format!("{seq}.tail.json"))
}

fn read_cut(dir: &Path, seq: u64) -> Option<CutFile> {
    let text = fs::read_to_string(cut_path(dir, seq)).ok()?;
    serde_json::from_str(&text).ok()
}

/// Whether redo has everything it needs: the contents to write back, and the
/// conversation that explains them.
///
/// Both, not either. Files without the transcript would put the work back with
/// nothing on screen saying so, and no line to carry the undo button — so the
/// redo would be one-way, which is the bug being fixed.
fn redoable(dir: &Path, entries: &[Filed], seq: u64, undone: bool, rec: &Record) -> bool {
    undone
        && !rec.files.is_empty()
        && rec.files.iter().all(|f| f.after.is_some())
        && read_cut(dir, seq)
            .map(|c| entries.iter().any(|f| f.kind == Kind::Tail && f.seq == c.tail_at))
            .unwrap_or(false)
}

fn write_record(dir: &Path, seq: u64, rec: &Record) -> Result<(), String> {
    let json = serde_json::to_string(rec).map_err(|e| e.to_string())?;
    fs::write(record_path(dir, seq, false), json)
        .map_err(|e| format!("could not write the checkpoint: {e}"))
}

/// Record a write, and answer with the sequence number it was filed under.
///
/// The number is chosen here rather than by the caller because a counter held
/// in the UI starts again at one when the app restarts: it would file a new
/// checkpoint on top of an old one, leaving an undo button that puts back
/// somebody else's contents.
pub fn save_at(base: &Path, chat: &str, files: Vec<Snapshot>) -> Result<u64, String> {
    save_with(base, chat, files, Caps::default())
}

fn save_with(base: &Path, chat: &str, files: Vec<Snapshot>, caps: Caps) -> Result<u64, String> {
    let dir = chat_dir(base, chat)?;
    fs::create_dir_all(&dir).map_err(|e| format!("could not create the checkpoint store: {e}"))?;

    // A new write is a new branch, so the redo stack goes — exactly as a text
    // editor drops its own the moment you type. Those checkpoints belong to the
    // conversation undo cut away, and redoing into it would reapply a change
    // from a turn that is no longer there. The conversations and cut points go
    // with them: with the stack gone there is nothing else they can belong to.
    //
    // The number still steps past them. A discarded checkpoint's number is not
    // handed to its replacement, so the sequence stays a plain clock for the
    // chat and a stored one always means what it meant when it was written.
    let mut seq = 1;
    for f in filed(&dir) {
        seq = seq.max(f.seq + 1);
        if f.kind != Kind::Applied {
            let _ = fs::remove_file(&f.path);
        }
    }

    write_record(&dir, seq, &Record { at: now(), files })?;
    prune(base, &dir, caps);
    Ok(seq)
}

/// Newest first, so the UI does not have to sort.
pub fn list_at(base: &Path, chat: &str) -> Result<Vec<Meta>, String> {
    let dir = chat_dir(base, chat)?;
    let entries = filed(&dir);
    let mut out: Vec<Meta> = read_records(&entries)
        .into_iter()
        .map(|(seq, undone, r)| Meta {
            seq,
            at: r.at,
            undone,
            redoable: redoable(&dir, &entries, seq, undone, &r),
            paths: r.files.into_iter().map(|f| f.path).collect(),
        })
        .collect();
    out.sort_by(|a, b| b.seq.cmp(&a.seq));
    Ok(out)
}

/// Every file touched at or after `seq`, in the state it was in before `seq`.
///
/// Walking oldest-first and keeping the first version seen is what makes this
/// correct across several checkpoints: the earliest record of a file is the one
/// furthest back, and later records describe states we are undoing.
///
/// Undone records are skipped. They describe a state that has already been put
/// back, so the file they name is sitting at it already.
fn rewind_set(entries: &[Filed], seq: u64) -> Vec<Snapshot> {
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for (s, undone, rec) in read_records(entries) {
        if undone || s < seq {
            continue;
        }
        for f in rec.files {
            if seen.insert(f.path.clone()) {
                out.push(f);
            }
        }
    }
    out
}

/// Put the workspace back to how it was before `seq`, and keep the conversation
/// the undo is cutting away so redo can put that back too.
pub fn undo_at(
    base: &Path,
    chat: &str,
    seq: u64,
    tails: Vec<Tail>,
    resolve: impl Fn(&str) -> Result<PathBuf, String>,
) -> Result<Vec<String>, String> {
    let dir = chat_dir(base, chat)?;
    let entries = filed(&dir);
    let mut done = Vec::new();
    for f in rewind_set(&entries, seq) {
        let target = resolve(&f.path)?;
        if f.existed {
            if let Some(parent) = target.parent() {
                let _ = fs::create_dir_all(parent);
            }
            fs::write(&target, &f.content).map_err(|e| format!("{}: {e}", f.path))?;
        } else if target.exists() {
            fs::remove_file(&target).map_err(|e| format!("{}: {e}", f.path))?;
        }
        done.push(f.path);
    }

    // Marked only once every file is back. Moving the checkpoints first and
    // then failing a write would leave a change that is neither undone on disk
    // nor offered for undo again.
    let undoing: Vec<u64> = entries
        .iter()
        .filter(|f| f.kind == Kind::Applied && f.seq >= seq)
        .map(|f| f.seq)
        .collect();

    // One copy of the conversation for the whole batch, filed under the newest
    // checkpoint in it — the last one redo will reach, so the copy outlives
    // every cut point that indexes into it.
    //
    // Best effort, deliberately: the undo itself has already happened, and
    // failing it because the transcript could not be kept would put the files
    // back and then report a failure. A cut with no conversation beside it is
    // simply not redoable, which `redoable` already says.
    if let (Some(&head), Some(whole)) =
        (undoing.last(), tails.iter().rev().find_map(|t| t.conversation.as_ref()))
    {
        if let Ok(json) = serde_json::to_string(whole) {
            let _ = fs::write(tail_path(&dir, head), json);
        }
        for t in tails.iter().filter(|t| undoing.contains(&t.seq)) {
            let file = CutFile { tail_at: head, ends: t.ends.clone() };
            if let Ok(json) = serde_json::to_string(&file) {
                let _ = fs::write(cut_path(&dir, t.seq), json);
            }
        }
    }

    // The mark is the rename, and nothing else about the record changes — which
    // is what keeps undoing twenty checkpoints from rewriting twenty copies of
    // the file contents they already hold.
    for s in undoing {
        fs::rename(record_path(&dir, s, false), record_path(&dir, s, true))
            .map_err(|e| format!("could not mark the checkpoint undone: {e}"))?;
    }

    done.sort();
    Ok(done)
}

/// Step one checkpoint forward: put back the oldest undone write, files and
/// conversation together.
///
/// One at a time, even though undo can drop several at once. Every checkpoint
/// is a state that genuinely existed, so stepping forward through them lands
/// only on states the project was really in — and stopping halfway is a
/// decision someone might want.
pub fn redo_at(
    base: &Path,
    chat: &str,
    resolve: impl Fn(&str) -> Result<PathBuf, String>,
) -> Result<Redone, String> {
    let dir = chat_dir(base, chat)?;
    let entries = filed(&dir);
    let (seq, undone, rec) = read_records(&entries)
        .into_iter()
        .find(|(_, undone, _)| *undone)
        .ok_or_else(|| "there is no undone change to redo".to_string())?;

    // One message for every way a checkpoint can be short of what redo needs,
    // because they are the same fact to the person reading it: this one cannot
    // be put back. `redoable` decides, here and in the list, so the button and
    // the command can never disagree about which checkpoints are offered.
    let short =
        "this change was recorded before redo existed, so there is not enough kept to put it back";
    if !redoable(&dir, &entries, seq, undone, &rec) {
        return Err(short.into());
    }
    // Read a second time rather than passed out of `redoable`: it is a few
    // dozen bytes, and one place deciding is worth more than one less read.
    let cut = read_cut(&dir, seq).ok_or_else(|| short.to_string())?;
    let conversation: serde_json::Value = fs::read_to_string(tail_path(&dir, cut.tail_at))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .ok_or_else(|| short.to_string())?;

    let mut paths = Vec::new();
    for f in &rec.files {
        // `redoable` proved every file has one; skipping is only so a corrupt
        // record cannot panic the app.
        let Some(after) = f.after.as_ref() else { continue };
        let target = resolve(&f.path)?;
        if let Some(parent) = target.parent() {
            let _ = fs::create_dir_all(parent);
        }
        fs::write(&target, after).map_err(|e| format!("{}: {e}", f.path))?;
        paths.push(f.path.clone());
    }

    // The record returns to exactly the shape a fresh checkpoint has and can be
    // undone again, so the cut point goes with the mark.
    fs::rename(record_path(&dir, seq, true), record_path(&dir, seq, false))
        .map_err(|e| format!("could not mark the checkpoint applied: {e}"))?;
    let _ = fs::remove_file(cut_path(&dir, seq));
    if !indexes_into(&dir, cut.tail_at) {
        let _ = fs::remove_file(tail_path(&dir, cut.tail_at));
    }

    paths.sort();
    Ok(Redone { seq, paths, conversation, ends: cut.ends })
}

/// Whether any checkpoint still needs the conversation kept under `tail_at`.
fn indexes_into(dir: &Path, tail_at: u64) -> bool {
    filed(dir)
        .into_iter()
        .filter(|f| f.kind == Kind::Cut)
        .any(|f| {
            fs::read_to_string(&f.path)
                .ok()
                .and_then(|s| serde_json::from_str::<CutFile>(&s).ok())
                .map(|c| c.tail_at == tail_at)
                .unwrap_or(false)
        })
}

/// Keep the store from growing without bound: both caps within this chat, and
/// chat directories nobody has touched in a month.
fn prune(base: &Path, dir: &Path, caps: Caps) {
    let entries = filed(dir);
    let mut total: u64 = entries.iter().map(|f| f.bytes).sum();
    let mut count = entries.iter().filter(|f| f.kind.is_record()).count();

    // Oldest first, and a checkpoint goes whole — the conversation and cut
    // point filed under its number are no use once its contents are gone.
    for seq in entries.iter().filter(|f| f.kind.is_record()).map(|f| f.seq) {
        if count <= caps.count && total <= caps.bytes {
            break;
        }
        // The newest is never the one to go. It is the undo for the write that
        // was just approved, and one write large enough to fill the budget on
        // its own would otherwise leave the line reporting it with a button
        // that restores nothing.
        if count == 1 {
            break;
        }
        for f in entries.iter().filter(|f| f.seq == seq) {
            if fs::remove_file(&f.path).is_ok() {
                total -= f.bytes;
            }
        }
        count -= 1;
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

    /// One file changing from `was` to `now`, which is what most of these need.
    fn edit(path: &str, was: &str, now: &str) -> Vec<Snapshot> {
        vec![Snapshot {
            path: path.into(),
            content: was.into(),
            existed: true,
            after: Some(now.into()),
        }]
    }

    /// A stand-in for the transcript and one cut into it per checkpoint, laid
    /// out the way the UI sends them: the conversation once, on the newest.
    /// Its shape is the UI's business; all this module promises is to give back
    /// whatever it was given.
    fn tail(seqs: &[u64], note: &str) -> Vec<Tail> {
        seqs.iter()
            .enumerate()
            .map(|(i, s)| Tail {
                seq: *s,
                ends: serde_json::json!({ "upto": s }),
                conversation: (i + 1 == seqs.len())
                    .then(|| serde_json::json!({ "lines": [note] })),
            })
            .collect()
    }

    /// An undo that kept nothing, which is what a checkpoint from before redo
    /// existed gets.
    fn nothing_kept() -> Vec<Tail> {
        Vec::new()
    }

    fn store(base: &Path) -> PathBuf {
        base.join("checkpoints").join("c1")
    }

    /// Files of one kind in a chat directory, which is how the naming scheme is
    /// checked from outside.
    fn count_of(dir: &Path, suffix: &str) -> usize {
        fs::read_dir(dir)
            .map(|es| {
                es.flatten()
                    .filter(|e| e.file_name().to_string_lossy().ends_with(suffix))
                    .count()
            })
            .unwrap_or(0)
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
        save_at(&base, "c1", edit("a.txt", "v1\n", "v2\n")).unwrap();
        fs::write(root.join("a.txt"), "v2\n").unwrap();
        // Turn 2 changed it again, v2 to v3.
        save_at(&base, "c1", edit("a.txt", "v2\n", "v3\n")).unwrap();
        fs::write(root.join("a.txt"), "v3\n").unwrap();

        // Going back to before turn 1 must reach v1, not v2.
        let done = undo_at(&base, "c1", 1, nothing_kept(), resolver(root.clone())).unwrap();
        assert_eq!(done, vec!["a.txt".to_string()]);
        assert_eq!(fs::read_to_string(root.join("a.txt")).unwrap(), "v1\n");

        let _ = fs::remove_dir_all(&base);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn restoring_deletes_a_file_the_change_created() {
        let base = tmp("new");
        let root = tmp("new_root");
        save_at(&base, "c1", vec![Snapshot {
            path: "made.txt".into(),
            content: String::new(),
            existed: false,
            after: Some("written by the agent\n".into()),
        }]).unwrap();
        fs::write(root.join("made.txt"), "written by the agent\n").unwrap();

        undo_at(&base, "c1", 1, nothing_kept(), resolver(root.clone())).unwrap();
        assert!(
            !root.join("made.txt").exists(),
            "a file that did not exist must be removed, not left empty",
        );

        let _ = fs::remove_dir_all(&base);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn redoing_recreates_a_file_the_undo_deleted() {
        let base = tmp("recreate");
        let root = tmp("recreate_root");
        save_at(&base, "c1", vec![Snapshot {
            path: "deep/made.txt".into(),
            content: String::new(),
            existed: false,
            after: Some("written by the agent\n".into()),
        }]).unwrap();
        fs::create_dir_all(root.join("deep")).unwrap();
        fs::write(root.join("deep/made.txt"), "written by the agent\n").unwrap();

        undo_at(&base, "c1", 1, tail(&[1], "wrote it"), resolver(root.clone())).unwrap();
        let back = redo_at(&base, "c1", resolver(root.clone())).unwrap();
        assert_eq!(back.paths, vec!["deep/made.txt".to_string()]);
        assert_eq!(
            fs::read_to_string(root.join("deep/made.txt")).unwrap(),
            "written by the agent\n",
        );

        let _ = fs::remove_dir_all(&base);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn an_undone_checkpoint_is_kept_as_the_redo_stack_rather_than_deleted() {
        let base = tmp("keep");
        let root = tmp("keep_root");
        fs::write(root.join("a.txt"), "v1\n").unwrap();
        for (was, now) in [("v1\n", "v2\n"), ("v2\n", "v3\n"), ("v3\n", "v4\n")] {
            save_at(&base, "c1", edit("a.txt", was, now)).unwrap();
        }
        assert_eq!(list_at(&base, "c1").unwrap().len(), 3);

        undo_at(&base, "c1", 2, tail(&[2, 3], "two"), resolver(root.clone())).unwrap();
        let left = list_at(&base, "c1").unwrap();
        assert_eq!(left.len(), 3, "nothing is thrown away by an undo");
        assert_eq!(
            left.iter().filter(|m| m.undone).map(|m| m.seq).collect::<Vec<_>>(),
            vec![3, 2],
            "the undone checkpoints are the ones from the undo point on",
        );
        assert!(left.iter().all(|m| m.redoable == m.undone), "and every one of them can be put back");

        // The undone records must not confuse a second undo: going back further
        // has to reach v1, not a state one of them describes.
        undo_at(&base, "c1", 1, tail(&[1], "one"), resolver(root.clone())).unwrap();
        assert_eq!(fs::read_to_string(root.join("a.txt")).unwrap(), "v1\n");

        let _ = fs::remove_dir_all(&base);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn undo_and_redo_step_over_the_same_list_in_both_directions() {
        let base = tmp("both");
        let root = tmp("both_root");
        fs::write(root.join("a.txt"), "v1\n").unwrap();
        for (was, now) in [("v1\n", "v2\n"), ("v2\n", "v3\n"), ("v3\n", "v4\n")] {
            save_at(&base, "c1", edit("a.txt", was, now)).unwrap();
            fs::write(root.join("a.txt"), now).unwrap();
        }

        // Back over all three at once, the way the button on an old line does.
        undo_at(&base, "c1", 1, tail(&[1, 2, 3], "all three"), resolver(root.clone())).unwrap();
        assert_eq!(fs::read_to_string(root.join("a.txt")).unwrap(), "v1\n");

        // Forward one at a time, landing on each state that really existed.
        for (seq, expect) in [(1u64, "v2\n"), (2, "v3\n"), (3, "v4\n")] {
            let back = redo_at(&base, "c1", resolver(root.clone())).unwrap();
            assert_eq!(back.seq, seq, "redo takes the oldest undone checkpoint");
            assert_eq!(fs::read_to_string(root.join("a.txt")).unwrap(), expect);
            assert_eq!(back.conversation["lines"][0], "all three", "with the conversation");
            assert_eq!(back.ends["upto"], seq, "cut where that checkpoint's transcript ended");
        }
        assert!(redo_at(&base, "c1", resolver(root.clone())).is_err(), "and then there is no more");

        // A redone checkpoint is an ordinary one again, so the walk repeats.
        undo_at(&base, "c1", 3, tail(&[3], "three"), resolver(root.clone())).unwrap();
        assert_eq!(fs::read_to_string(root.join("a.txt")).unwrap(), "v3\n");

        let _ = fs::remove_dir_all(&base);
        let _ = fs::remove_dir_all(&root);
    }

    /// The whole reason the transcript is handed over once with cut points
    /// rather than as one prefix per checkpoint: a conversation holds every
    /// file the agent read, so twenty prefixes of it is tens of megabytes
    /// written twenty times over.
    #[test]
    fn one_conversation_is_kept_however_many_checkpoints_an_undo_covers() {
        let base = tmp("once");
        let root = tmp("once_root");
        fs::write(root.join("a.txt"), "v1\n").unwrap();
        for (was, now) in [("v1\n", "v2\n"), ("v2\n", "v3\n"), ("v3\n", "v4\n")] {
            save_at(&base, "c1", edit("a.txt", was, now)).unwrap();
            fs::write(root.join("a.txt"), now).unwrap();
        }

        undo_at(&base, "c1", 1, tail(&[1, 2, 3], "one copy"), resolver(root.clone())).unwrap();
        let dir = store(&base);
        assert_eq!(count_of(&dir, ".tail.json"), 1, "one transcript for the whole undo");
        assert_eq!(count_of(&dir, ".cut.json"), 3, "and one cut point per checkpoint");

        // A second undo is a second batch with its own transcript, because by
        // then the conversation on screen is a shorter one.
        redo_at(&base, "c1", resolver(root.clone())).unwrap();
        undo_at(&base, "c1", 1, tail(&[1], "shorter"), resolver(root.clone())).unwrap();
        assert_eq!(count_of(&dir, ".tail.json"), 2);
        assert_eq!(
            redo_at(&base, "c1", resolver(root.clone())).unwrap().conversation["lines"][0],
            "shorter",
            "each checkpoint reads the conversation its own undo kept",
        );

        let _ = fs::remove_dir_all(&base);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn the_conversation_goes_when_the_last_checkpoint_indexing_into_it_is_redone() {
        let base = tmp("tidy");
        let root = tmp("tidy_root");
        fs::write(root.join("a.txt"), "v1\n").unwrap();
        for (was, now) in [("v1\n", "v2\n"), ("v2\n", "v3\n")] {
            save_at(&base, "c1", edit("a.txt", was, now)).unwrap();
            fs::write(root.join("a.txt"), now).unwrap();
        }
        undo_at(&base, "c1", 1, tail(&[1, 2], "both"), resolver(root.clone())).unwrap();

        let dir = store(&base);
        redo_at(&base, "c1", resolver(root.clone())).unwrap();
        assert_eq!(count_of(&dir, ".tail.json"), 1, "the second checkpoint still needs it");
        redo_at(&base, "c1", resolver(root.clone())).unwrap();
        assert_eq!(count_of(&dir, ".tail.json"), 0, "and nothing does now");
        assert_eq!(count_of(&dir, ".cut.json"), 0);

        let _ = fs::remove_dir_all(&base);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn approving_a_new_write_throws_the_redo_stack_away() {
        let base = tmp("branch");
        let root = tmp("branch_root");
        fs::write(root.join("a.txt"), "v1\n").unwrap();
        save_at(&base, "c1", edit("a.txt", "v1\n", "v2\n")).unwrap();
        save_at(&base, "c1", edit("a.txt", "v2\n", "v3\n")).unwrap();
        fs::write(root.join("a.txt"), "v3\n").unwrap();

        // Undo twice, redo once: 1 is applied again, 2 is still on the stack.
        undo_at(&base, "c1", 2, tail(&[2], "two"), resolver(root.clone())).unwrap();
        undo_at(&base, "c1", 1, tail(&[1], "one"), resolver(root.clone())).unwrap();
        redo_at(&base, "c1", resolver(root.clone())).unwrap();
        assert_eq!(
            list_at(&base, "c1").unwrap().iter().filter(|m| m.undone).count(),
            1,
        );

        // Now a new approved write. Checkpoint 2 belongs to a conversation that
        // is gone, so redoing it would reapply a change nothing on screen
        // explains.
        let seq = save_at(&base, "c1", edit("a.txt", "v2\n", "other\n")).unwrap();
        let left = list_at(&base, "c1").unwrap();
        assert_eq!(left.iter().filter(|m| m.undone).count(), 0, "the stack is empty");
        assert_eq!(left.len(), 2, "and only the applied checkpoints remain");
        assert!(seq > 2, "a discarded number is never reused: {seq}");
        assert!(redo_at(&base, "c1", resolver(root.clone())).is_err());

        let dir = store(&base);
        assert_eq!(count_of(&dir, ".tail.json"), 0, "the conversations go with them");
        assert_eq!(count_of(&dir, ".cut.json"), 0);

        let _ = fs::remove_dir_all(&base);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_checkpoint_from_before_redo_existed_still_restores_and_offers_no_redo() {
        let base = tmp("legacy");
        let root = tmp("legacy_root");
        let dir = base.join("checkpoints").join("c1");
        fs::create_dir_all(&dir).unwrap();
        // Written by 0.13.0: no `after`, no `undone`, no `tail`.
        fs::write(
            dir.join("1.json"),
            r#"{"seq":1,"at":1,"files":[{"path":"a.txt","content":"v1\n","existed":true}]}"#,
        )
        .unwrap();
        fs::write(root.join("a.txt"), "v2\n").unwrap();

        assert!(!list_at(&base, "c1").unwrap()[0].redoable);
        undo_at(&base, "c1", 1, tail(&[1], "one"), resolver(root.clone())).unwrap();
        assert_eq!(fs::read_to_string(root.join("a.txt")).unwrap(), "v1\n", "it still undoes");

        let listed = list_at(&base, "c1").unwrap();
        assert!(listed[0].undone);
        assert!(!listed[0].redoable, "but the control is absent rather than failing");
        assert!(redo_at(&base, "c1", resolver(root.clone())).is_err());

        let _ = fs::remove_dir_all(&base);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn an_undo_that_kept_no_conversation_cannot_be_redone() {
        let base = tmp("notail");
        let root = tmp("notail_root");
        fs::write(root.join("a.txt"), "v2\n").unwrap();
        save_at(&base, "c1", edit("a.txt", "v1\n", "v2\n")).unwrap();

        undo_at(&base, "c1", 1, nothing_kept(), resolver(root.clone())).unwrap();
        assert!(
            !list_at(&base, "c1").unwrap()[0].redoable,
            "files without the transcript would come back with nothing on screen saying so",
        );
        assert!(redo_at(&base, "c1", resolver(root.clone())).is_err());

        let _ = fs::remove_dir_all(&base);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_sequence_number_is_never_reused_after_a_restart() {
        let base = tmp("seq");
        for expect in 1..=3u64 {
            assert_eq!(save_at(&base, "c1", edit("a.txt", "x", "y")).unwrap(), expect);
        }
        // The UI's counter restarts with the app; the store's does not, so the
        // next checkpoint cannot land on top of an existing one.
        assert_eq!(save_at(&base, "c1", edit("a.txt", "x", "y")).unwrap(), 4);
        assert_eq!(list_at(&base, "c1").unwrap().len(), 4);
        let _ = fs::remove_dir_all(&base);
    }

    /// Filing a checkpoint is the approval click, so it reads names and never
    /// contents. A record it cannot parse is therefore still counted, which is
    /// the observable difference — and the safe one, since reusing its number
    /// would leave two checkpoints claiming to be the same write.
    #[test]
    fn a_new_checkpoint_takes_its_number_from_the_names_and_not_the_contents() {
        let base = tmp("names");
        let dir = base.join("checkpoints").join("c1");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("5.json"), "{ this is not a checkpoint").unwrap();

        assert_eq!(save_at(&base, "c1", edit("a.txt", "x", "y")).unwrap(), 6);
        let listed = list_at(&base, "c1").unwrap();
        assert_eq!(listed.len(), 1, "the unreadable one is skipped rather than shown");
        assert_eq!(listed[0].seq, 6);
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn the_store_is_capped_per_chat() {
        let base = tmp("cap");
        let caps = Caps::default();
        for _ in 1..=(caps.count + 10) {
            save_at(&base, "c1", edit("a.txt", "x", "y")).unwrap();
        }
        let kept = list_at(&base, "c1").unwrap();
        assert_eq!(kept.len(), caps.count);
        assert_eq!(kept[0].seq, caps.count as u64 + 10, "the newest is kept");
        let _ = fs::remove_dir_all(&base);
    }

    /// The count cap is not enough on its own: a checkpoint holds both sides of
    /// every file it touched, so sixty of them is bounded only by how large the
    /// files were.
    #[test]
    fn the_store_is_capped_by_bytes_as_well_as_by_count() {
        let base = tmp("bytes");
        let caps = Caps { count: 100, bytes: 4_000 };
        let text = "x".repeat(500);
        for _ in 0..10 {
            save_with(&base, "c1", edit("a.txt", &text, &text), caps).unwrap();
        }

        let kept = list_at(&base, "c1").unwrap();
        assert!(kept.len() < 10, "the count cap alone would have kept all ten");
        assert_eq!(kept[0].seq, 10, "and the newest survives");
        let total: u64 = filed(&store(&base)).iter().map(|f| f.bytes).sum();
        assert!(total <= caps.bytes, "{total} bytes is over the budget");
        let _ = fs::remove_dir_all(&base);
    }

    /// One write can be larger than the whole budget, and the checkpoint for it
    /// is the one the line on screen offers to undo. Evicting it would leave a
    /// button that restores nothing.
    #[test]
    fn the_checkpoint_for_the_write_just_approved_is_never_the_one_evicted() {
        let base = tmp("newest");
        let caps = Caps { count: 100, bytes: 1 };
        save_with(&base, "c1", edit("a.txt", "one", "two"), caps).unwrap();
        save_with(&base, "c1", edit("a.txt", "two", "three"), caps).unwrap();

        let kept = list_at(&base, "c1").unwrap();
        assert_eq!(kept.len(), 1);
        assert_eq!(kept[0].seq, 2);
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn listing_an_unknown_chat_is_empty_rather_than_an_error() {
        let base = tmp("none");
        assert!(list_at(&base, "nothing").unwrap().is_empty());
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn redoing_with_nothing_undone_says_so_rather_than_writing_anything() {
        let base = tmp("empty");
        let root = tmp("empty_root");
        save_at(&base, "c1", edit("a.txt", "v1\n", "v2\n")).unwrap();
        fs::write(root.join("a.txt"), "edited by hand\n").unwrap();

        assert!(redo_at(&base, "c1", resolver(root.clone())).is_err());
        assert_eq!(
            fs::read_to_string(root.join("a.txt")).unwrap(),
            "edited by hand\n",
            "a redo with nothing to do must not overwrite the working copy",
        );

        let _ = fs::remove_dir_all(&base);
        let _ = fs::remove_dir_all(&root);
    }
}
