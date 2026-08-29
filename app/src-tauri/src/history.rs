//! Local file history — every version this app writes, kept outside the project.
//!
//! Checkpoints (E3) cover what the *agent* wrote, and drafts (G4) cover buffers
//! that were never saved at all. Neither covers the ordinary way work is lost:
//! a person saves over their own file and wants what was there back an hour
//! later. Nothing in the app kept that version, and unless the folder happened
//! to be a clean git tree, nothing on the machine did either.
//!
//! So every write the app makes records what the file held **before** it. The
//! new contents need no copy — they are the file.
//!
//! ## Why the version list lives in the filenames
//!
//! A version is stored verbatim under a name carrying its sequence number, the
//! time it was taken and the hash of its contents. Listing a file's history,
//! deciding whether a save changed anything, and enforcing the size cap then
//! all read directory entries and never a file. A source file can be two
//! megabytes; a store built to be *browsed* cannot read all of them to draw a
//! list.
//!
//! ## Why the store is hashed rather than mirrored
//!
//! The same reason as `drafts.rs`: a workspace path can contain `..`, a colon,
//! a newline or an emoji. Hashing collides with nothing and escapes nowhere,
//! and the real path is written beside the versions so the store is still
//! readable to a person who goes looking for it with a file browser.
//!
//! Never inside the project. History of a change showing up as another change
//! is the same absurdity checkpoints avoid.

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

/// How long a version is kept, and how much of them one folder may hold.
///
/// A value rather than two constants so the tests can prove eviction without
/// writing thirty-two megabytes to do it. A cap that can only be exercised at
/// its real size is a cap nobody exercises.
#[derive(Clone, Copy)]
struct Caps {
    /// Total bytes of history one folder may hold. Oldest versions go first.
    bytes: u64,
    /// Seconds after which a version goes, however much room is left.
    age: u64,
}

impl Default for Caps {
    fn default() -> Self {
        // 32 MB is on the order of a thousand saves of a large source file, and
        // a month is longer than anyone has wanted a version back. Per folder,
        // not global: opening a second project should not quietly cost you the
        // history of the first.
        Caps { bytes: 32 * 1024 * 1024, age: 30 * 24 * 60 * 60 }
    }
}

/// A single version this large is not recorded at all.
///
/// Above every write the app can actually make — the editor refuses to save a
/// file over 2 MB, and the agent cannot read one over 512 KB in order to change
/// it — so nothing anybody would want back is skipped. It is here so that one
/// pathological write cannot evict a folder's whole history to make room for
/// itself.
const MAX_VERSION_BYTES: usize = 4 * 1024 * 1024;

/// One version, as the UI needs to list it. The contents are fetched only when
/// a version is actually looked at.
#[derive(Serialize)]
pub struct Version {
    pub seq: u64,
    /// Unix seconds, the way drafts and checkpoints record time.
    pub at: u64,
    pub bytes: u64,
}

fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// A stable, filesystem-safe name for a string, and the content hash the
/// duplicate check compares.
///
/// Deliberately not shared with `drafts.rs`, which has the same six lines:
/// the output of this is a directory name, so it is an on-disk format rather
/// than a utility. Exporting one function for both stores would mean a change
/// to either silently moving the other's files out from under it.
fn digest(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update(bytes);
    h.finalize().iter().take(16).map(|b| format!("{b:02x}")).collect()
}

fn folder_dir(base: &Path, root: &str) -> PathBuf {
    base.join("history").join(digest(root.as_bytes()))
}

fn file_dir(base: &Path, root: &str, path: &str) -> PathBuf {
    folder_dir(base, root).join(digest(path.as_bytes()))
}

/// One stored version, entirely as its name describes it.
struct Stored {
    seq: u64,
    at: u64,
    sha: String,
    bytes: u64,
    file: PathBuf,
}

/// `<seq>-<at>-<sha>`. Anything else in the directory — `path.txt`, something
/// another program left — is not a version, and is ignored rather than guessed
/// at.
fn parse(name: &str) -> Option<(u64, u64, String)> {
    let mut parts = name.split('-');
    let seq = parts.next()?.parse().ok()?;
    let at = parts.next()?.parse().ok()?;
    let sha = parts.next()?.to_string();
    if parts.next().is_some() || sha.len() != 32 || !sha.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    Some((seq, at, sha))
}

/// Every version of one file, oldest first.
///
/// Ordered by the parsed number, not the name. The padding is there so a
/// directory listing reads in order for a person opening the store by hand;
/// nothing here is allowed to depend on it.
fn stored(dir: &Path) -> Vec<Stored> {
    let Ok(entries) = fs::read_dir(dir) else { return Vec::new() };
    let mut out: Vec<Stored> = entries
        .flatten()
        .filter_map(|e| {
            let (seq, at, sha) = parse(e.file_name().to_str()?)?;
            let md = e.metadata().ok()?;
            if !md.is_file() {
                return None;
            }
            Some(Stored { seq, at, sha, bytes: md.len(), file: e.path() })
        })
        .collect();
    out.sort_by_key(|s| s.seq);
    out
}

/// Record what `path` held before it is overwritten.
///
/// The *previous* contents, never the new ones: what is being written is about
/// to be the file, and it is the version it replaces that is about to exist
/// nowhere.
pub fn record_at(base: &Path, root: &str, path: &str, text: &str) -> Result<(), String> {
    record_with(base, root, path, text, Caps::default())
}

fn record_with(base: &Path, root: &str, path: &str, text: &str, caps: Caps) -> Result<(), String> {
    if text.len() > MAX_VERSION_BYTES {
        return Ok(());
    }
    let dir = file_dir(base, root, path);
    let sha = digest(text.as_bytes());
    let existing = stored(&dir);

    // A save that changed nothing is not a version. Saving is a reflex — ⌘S
    // after reading a file, ⌘S twice out of habit — and a list where nine
    // entries in ten are identical is one nobody can find anything in.
    if existing.last().map(|s| s.sha == sha).unwrap_or(false) {
        return Ok(());
    }

    fs::create_dir_all(&dir).map_err(|e| format!("could not keep a version: {e}"))?;

    // What this directory is, for whoever finds it. Its name is a hash, so
    // without this the store is unreadable to anything but the app.
    let label = dir.join("path.txt");
    if !label.exists() {
        let _ = fs::write(label, path);
    }

    // Numbering steps past what eviction removed rather than filling the gap,
    // so a version the panel is holding still means what it meant when it was
    // listed. (It starts again at 1 only once a file has no versions left at
    // all, which is also the point at which there is nothing to confuse it
    // with.)
    let seq = existing.last().map(|s| s.seq + 1).unwrap_or(1);
    fs::write(dir.join(format!("{seq:06}-{}-{sha}", now())), text)
        .map_err(|e| format!("could not keep a version: {e}"))?;

    // See `sweep`. Written before pruning, because pruning reads it.
    let _ = fs::write(folder_dir(base, root).join("seen"), now().to_string());

    prune(base, root, caps);
    Ok(())
}

/// Every kept version of one file, newest first — the order they are offered in.
pub fn list_at(base: &Path, root: &str, path: &str) -> Vec<Version> {
    let mut out: Vec<Version> = stored(&file_dir(base, root, path))
        .into_iter()
        .map(|s| Version { seq: s.seq, at: s.at, bytes: s.bytes })
        .collect();
    out.reverse();
    out
}

/// One version's contents, for showing it before anything is written back.
pub fn read_at(base: &Path, root: &str, path: &str, seq: u64) -> Result<String, String> {
    let s = stored(&file_dir(base, root, path))
        .into_iter()
        .find(|s| s.seq == seq)
        .ok_or_else(|| format!("{path}: that version is no longer kept"))?;
    fs::read_to_string(&s.file).map_err(|e| format!("{path}: {e}"))
}

/// Put one version back, and answer with what was written.
///
/// `resolve` is the workspace containment check. These paths came out of our
/// own store, but they are still paths being written to somebody's disk, and a
/// store on disk is a thing that can be edited by hand.
pub fn restore_at(
    base: &Path,
    root: &str,
    path: &str,
    seq: u64,
    resolve: impl Fn(&str) -> Result<PathBuf, String>,
) -> Result<String, String> {
    let text = read_at(base, root, path, seq)?;
    let target = resolve(path)?;

    // Restoring is a write like any other, so what it writes over becomes a
    // version too. Without this, putting a file back would itself be the
    // one-way door the whole feature exists to remove, and it costs one entry.
    //
    // A file that is no longer there is written rather than refused: `resolve`
    // has proved the path is inside the folder, and putting it back is what was
    // asked for.
    if let Ok(current) = fs::read_to_string(&target) {
        let _ = record_at(base, root, path, &current);
    }
    fs::write(&target, &text).map_err(|e| format!("{path}: {e}"))?;
    Ok(text)
}

/// Forget every kept version of one file.
///
/// The half the clipboard history has and this did not. A store that keeps a
/// copy of everything the app writes will sooner or later hold a `.env`, a
/// `secrets.json`, or a key somebody pasted into a config file and then
/// deleted — and deleting it from the project does not delete it from here. The
/// size and age caps are real, but a cap is not the same thing as being able to
/// say *not that one*, and until this existed nothing in the app could.
///
/// A file with no history is already forgotten, so that is a success and not an
/// error: this is reachable from a button, and telling somebody their secret
/// could not be forgotten because there was nothing there reads as a failure.
pub fn forget_at(base: &Path, root: &str, path: &str) -> Result<(), String> {
    let dir = file_dir(base, root, path);
    if !dir.exists() {
        return Ok(());
    }
    fs::remove_dir_all(&dir).map_err(|e| format!("{path}: {e}"))
}

/// Forget the history of every file in one folder.
///
/// The `seen` mark goes with it, which is correct: the folder is back to how it
/// was before this app ever wrote in it, and the next write records the mark
/// again.
pub fn forget_all_at(base: &Path, root: &str) -> Result<(), String> {
    let dir = folder_dir(base, root);
    if !dir.exists() {
        return Ok(());
    }
    fs::remove_dir_all(&dir).map_err(|e| format!("could not forget this folder's history: {e}"))
}

/// Enforce both caps: size within this folder, age everywhere.
fn prune(base: &Path, root: &str, caps: Caps) {
    let dir = folder_dir(base, root);
    let cutoff = now().saturating_sub(caps.age);

    let mut all: Vec<Stored> = Vec::new();
    let mut dirs: Vec<PathBuf> = Vec::new();
    if let Ok(entries) = fs::read_dir(&dir) {
        for e in entries.flatten() {
            if e.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                all.extend(stored(&e.path()));
                dirs.push(e.path());
            }
        }
    }

    // Oldest first, which is the order both caps evict in. The loop can stop at
    // the first version that is neither too old nor needed for room, because
    // everything after it is newer and the total only shrinks.
    all.sort_by_key(|s| (s.at, s.seq));
    let mut total: u64 = all.iter().map(|s| s.bytes).sum();
    for s in &all {
        if s.at >= cutoff && total <= caps.bytes {
            break;
        }
        if fs::remove_file(&s.file).is_ok() {
            total -= s.bytes;
        }
    }

    // A directory holding no versions is noise in a store meant to be opened
    // and read: `path.txt` on its own says nothing.
    for d in dirs {
        if stored(&d).is_empty() {
            let _ = fs::remove_dir_all(d);
        }
    }

    sweep(base, cutoff);
}

/// Folders nobody has opened since the cutoff lose their history entirely.
///
/// The mark is a file holding a timestamp rather than the directory's own
/// mtime: a directory's mtime moves when *its* entries change, and every
/// version lands one level further down, so the folder of a project somebody
/// has been saving in all day looks untouched.
///
/// A folder with no mark at all is a directory half-created by a crash. Reading
/// that as "never used" clears it, rather than leaving behind the one thing
/// nothing will ever tidy up.
fn sweep(base: &Path, cutoff: u64) {
    let Ok(entries) = fs::read_dir(base.join("history")) else { return };
    for e in entries.flatten() {
        if !e.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let seen: u64 = fs::read_to_string(e.path().join("seen"))
            .ok()
            .and_then(|s| s.trim().parse().ok())
            .unwrap_or(0);
        if seen < cutoff {
            let _ = fs::remove_dir_all(e.path());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Rust tests share one process, so the pid does not separate their
    /// directories — the name does.
    fn tmp(name: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("vylo_hist_{}_{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&p);
        fs::create_dir_all(&p).unwrap();
        p
    }

    fn seqs(base: &Path, root: &str, path: &str) -> Vec<u64> {
        list_at(base, root, path).into_iter().map(|v| v.seq).collect()
    }

    /// Move every stored version of one file back in time, by renaming it. The
    /// timestamp lives in the filename and that is the only place the age cap
    /// reads it from, so this is the honest way to make a version old — the
    /// alternative is waiting a month.
    fn backdate(base: &Path, root: &str, path: &str, secs: u64) {
        let dir = file_dir(base, root, path);
        for s in stored(&dir) {
            let name = format!("{:06}-{}-{}", s.seq, s.at - secs, s.sha);
            fs::rename(&s.file, dir.join(name)).unwrap();
        }
    }

    #[test]
    fn a_version_comes_back_exactly_as_it_went_in() {
        let base = tmp("round");
        record_at(&base, "/work/proj", "src/a.ts", "first\n").unwrap();
        record_at(&base, "/work/proj", "src/a.ts", "second\n").unwrap();

        let versions = list_at(&base, "/work/proj", "src/a.ts");
        assert_eq!(versions.len(), 2);
        assert_eq!(versions[0].seq, 2, "newest is offered first");
        assert!(versions[0].at > 0, "a version knows when it was taken");
        assert_eq!(versions[1].bytes, "first\n".len() as u64);

        assert_eq!(read_at(&base, "/work/proj", "src/a.ts", 1).unwrap(), "first\n");
        assert_eq!(read_at(&base, "/work/proj", "src/a.ts", 2).unwrap(), "second\n");
        let _ = fs::remove_dir_all(&base);
    }

    /// Saving without changing anything is the commonest thing a person does in
    /// an editor, and every one of those would otherwise be an entry in the
    /// list they are trying to read.
    #[test]
    fn saving_the_same_contents_again_is_not_a_new_version() {
        let base = tmp("same");
        record_at(&base, "/w", "a.ts", "one\n").unwrap();
        record_at(&base, "/w", "a.ts", "one\n").unwrap();
        assert_eq!(seqs(&base, "/w", "a.ts"), vec![1]);

        // Only the *last* version is compared: coming back to what a file said
        // two edits ago is a change like any other, and hiding it would leave
        // the two states indistinguishable in the list.
        record_at(&base, "/w", "a.ts", "two\n").unwrap();
        record_at(&base, "/w", "a.ts", "one\n").unwrap();
        assert_eq!(seqs(&base, "/w", "a.ts"), vec![3, 2, 1]);
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn the_size_cap_drops_the_oldest_versions_first() {
        let base = tmp("cap");
        let caps = Caps { bytes: 100, age: 60 * 60 };
        // Four distinct versions of forty bytes each; the folder holds two.
        for i in 0..4 {
            let text = format!("{i}").repeat(40);
            record_with(&base, "/w", "a.ts", &text, caps).unwrap();
        }

        assert_eq!(seqs(&base, "/w", "a.ts"), vec![4, 3], "the two newest survive");
        assert_eq!(read_at(&base, "/w", "a.ts", 3).unwrap(), "2".repeat(40));
        assert!(read_at(&base, "/w", "a.ts", 1).is_err(), "an evicted version is gone, not empty");

        // The numbers step past what was evicted rather than being reused, so a
        // version the UI listed can never come to mean a different one.
        record_with(&base, "/w", "a.ts", "later", caps).unwrap();
        assert_eq!(seqs(&base, "/w", "a.ts")[0], 5);
        let _ = fs::remove_dir_all(&base);
    }

    /// The size cap is a whole folder's budget, so a file nobody has touched in
    /// weeks gives up its versions to one being worked on.
    #[test]
    fn the_size_cap_is_shared_across_the_files_in_a_folder() {
        let base = tmp("shared");
        let caps = Caps { bytes: 100, age: 60 * 60 };
        record_with(&base, "/w", "old.ts", &"o".repeat(60), caps).unwrap();
        // Both would otherwise be stamped the same second, and "oldest" would
        // come down to whatever order the directory happened to be read in.
        backdate(&base, "/w", "old.ts", 10);
        record_with(&base, "/w", "new.ts", &"n".repeat(60), caps).unwrap();

        assert!(seqs(&base, "/w", "old.ts").is_empty(), "the older file gave way");
        assert_eq!(seqs(&base, "/w", "new.ts"), vec![1]);
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn versions_expire_by_age_however_much_room_is_left() {
        let base = tmp("age");
        let caps = Caps { bytes: 32 * 1024 * 1024, age: 60 * 60 };
        record_at(&base, "/w", "a.ts", "ancient\n").unwrap();
        record_at(&base, "/w", "a.ts", "old\n").unwrap();
        backdate(&base, "/w", "a.ts", 2 * 60 * 60);
        record_with(&base, "/w", "a.ts", "recent\n", caps).unwrap();

        assert_eq!(seqs(&base, "/w", "a.ts"), vec![3], "only what is inside the window");
        let _ = fs::remove_dir_all(&base);
    }

    /// Two projects can hold files with the same relative path. Neither may see
    /// or overwrite the other's history.
    #[test]
    fn two_files_with_the_same_name_in_different_folders_stay_apart() {
        let base = tmp("folders");
        record_at(&base, "/work/one", "src/a.ts", "from one\n").unwrap();
        record_at(&base, "/work/two", "src/a.ts", "from two\n").unwrap();
        record_at(&base, "/work/one", "src/a.ts", "one again\n").unwrap();

        assert_eq!(seqs(&base, "/work/one", "src/a.ts"), vec![2, 1]);
        assert_eq!(seqs(&base, "/work/two", "src/a.ts"), vec![1]);
        assert_eq!(read_at(&base, "/work/two", "src/a.ts", 1).unwrap(), "from two\n");
        let _ = fs::remove_dir_all(&base);
    }

    /// A path is whatever the filesystem allowed, and the store has to cope
    /// without colliding and without climbing out of itself.
    #[test]
    fn an_awkward_path_is_stored_like_any_other() {
        let base = tmp("odd");
        let odd = ["../../etc/passwd", "src/a b:c.ts", "emoji/🙂.ts", "line\nbreak.ts"];
        for (i, p) in odd.iter().enumerate() {
            record_at(&base, "/w", p, &format!("contents {i}")).unwrap();
        }
        for (i, p) in odd.iter().enumerate() {
            assert_eq!(read_at(&base, "/w", p, 1).unwrap(), format!("contents {i}"));
        }

        // Everything landed inside the folder's directory, `..` included, one
        // directory per path and none of them shared.
        let dirs = fs::read_dir(folder_dir(&base, "/w"))
            .unwrap()
            .flatten()
            .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
            .count();
        assert_eq!(dirs, odd.len(), "no two paths collided");
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn a_file_with_no_history_lists_nothing_rather_than_failing() {
        let base = tmp("none");
        assert!(list_at(&base, "/never/opened", "a.ts").is_empty());
        assert!(read_at(&base, "/never/opened", "a.ts", 1).is_err());

        record_at(&base, "/w", "a.ts", "only this one\n").unwrap();
        assert!(list_at(&base, "/w", "b.ts").is_empty(), "a sibling has its own history, not this");
        let _ = fs::remove_dir_all(&base);
    }

    /// Restoring is the destructive half, so it has to leave a way back — which
    /// is the same way back as everything else: what it wrote over is a version.
    #[test]
    fn restoring_keeps_what_it_wrote_over() {
        let base = tmp("restore");
        let work = tmp("restore_root");
        let root = work.to_string_lossy().to_string();
        fs::write(work.join("a.ts"), "current\n").unwrap();
        let resolve = |rel: &str| -> Result<PathBuf, String> { Ok(work.join(rel)) };

        record_at(&base, &root, "a.ts", "wanted\n").unwrap();
        let back = restore_at(&base, &root, "a.ts", 1, resolve).unwrap();

        assert_eq!(back, "wanted\n");
        assert_eq!(fs::read_to_string(work.join("a.ts")).unwrap(), "wanted\n");
        assert_eq!(
            read_at(&base, &root, "a.ts", 2).unwrap(),
            "current\n",
            "what the restore replaced is itself restorable",
        );
        let _ = fs::remove_dir_all(&base);
        let _ = fs::remove_dir_all(&work);
    }

    /// Containment is the caller's, and a store that has been edited by hand
    /// must not be able to talk it into writing anywhere.
    #[test]
    fn a_restore_that_fails_containment_writes_nothing() {
        let base = tmp("contain");
        record_at(&base, "/w", "../escape.ts", "no\n").unwrap();
        let err = restore_at(&base, "/w", "../escape.ts", 1, |rel| {
            Err(format!("{rel}: refused -- resolves outside the open folder"))
        })
        .expect_err("the resolver's refusal is final");
        assert!(err.contains("refused"), "{err}");
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn a_folder_nobody_has_opened_in_a_month_is_forgotten() {
        let base = tmp("sweep");
        let caps = Caps { bytes: 32 * 1024 * 1024, age: 60 * 60 };
        record_at(&base, "/work/abandoned", "a.ts", "left behind\n").unwrap();
        fs::write(folder_dir(&base, "/work/abandoned").join("seen"), "1").unwrap();

        record_with(&base, "/work/current", "b.ts", "still here\n", caps).unwrap();

        assert!(list_at(&base, "/work/abandoned", "a.ts").is_empty());
        assert!(!folder_dir(&base, "/work/abandoned").exists());
        assert_eq!(seqs(&base, "/work/current", "b.ts"), vec![1], "the folder in use is untouched");
        let _ = fs::remove_dir_all(&base);
    }

    /// The store is meant to be openable by a person who wants a file back and
    /// cannot start the app, so every directory in it says what it holds.
    #[test]
    fn the_store_says_which_file_each_directory_belongs_to() {
        let base = tmp("label");
        record_at(&base, "/w", "src/deep/thing.ts", "x\n").unwrap();
        let label = file_dir(&base, "/w", "src/deep/thing.ts").join("path.txt");
        assert_eq!(fs::read_to_string(label).unwrap(), "src/deep/thing.ts");
        let _ = fs::remove_dir_all(&base);
    }

    /// Forgetting is per file because that is how a person thinks about it:
    /// the `.env` goes, the work does not.
    #[test]
    fn forgetting_one_file_leaves_the_rest_of_the_folder_alone() {
        let base = tmp("forget");
        record_at(&base, "/w", ".env", "SECRET=hunter2\n").unwrap();
        record_at(&base, "/w", "src/a.ts", "work\n").unwrap();

        forget_at(&base, "/w", ".env").unwrap();
        assert!(seqs(&base, "/w", ".env").is_empty());
        assert!(read_at(&base, "/w", ".env", 1).is_err(), "gone, not merely unlisted");
        assert!(!file_dir(&base, "/w", ".env").exists(), "and its directory with it");
        assert_eq!(seqs(&base, "/w", "src/a.ts"), vec![1], "the file beside it is untouched");

        // Numbering starts again at one, which is only safe because there is
        // nothing left for a stale sequence number to be confused with.
        record_at(&base, "/w", ".env", "SECRET=changed\n").unwrap();
        assert_eq!(seqs(&base, "/w", ".env"), vec![1]);
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn forgetting_a_folder_takes_every_file_in_it_and_no_others() {
        let base = tmp("forget_all");
        record_at(&base, "/work/one", "a.ts", "one\n").unwrap();
        record_at(&base, "/work/one", "b.ts", "two\n").unwrap();
        record_at(&base, "/work/two", "a.ts", "elsewhere\n").unwrap();

        forget_all_at(&base, "/work/one").unwrap();
        assert!(!folder_dir(&base, "/work/one").exists());
        assert!(seqs(&base, "/work/one", "a.ts").is_empty());
        assert!(seqs(&base, "/work/one", "b.ts").is_empty());
        assert_eq!(seqs(&base, "/work/two", "a.ts"), vec![1], "another project keeps its own");
        let _ = fs::remove_dir_all(&base);
    }

    /// Reachable from a button, so "there was nothing to forget" is the answer
    /// the person wanted rather than a failure to report.
    #[test]
    fn forgetting_a_history_that_is_not_there_is_not_an_error() {
        let base = tmp("forget_none");
        assert!(forget_at(&base, "/never/opened", "a.ts").is_ok());
        assert!(forget_all_at(&base, "/never/opened").is_ok());
        let _ = fs::remove_dir_all(&base);
    }

    /// A name that is not `<seq>-<at>-<sha>` is not a version. `path.txt` sits
    /// in the same directory, and reading it as one would offer the user their
    /// own filename as a file to restore.
    #[test]
    fn only_properly_named_files_count_as_versions() {
        assert!(parse("path.txt").is_none());
        assert!(parse("000001-1756512345-0123456789abcdef0123456789abcdef").is_some());
        assert!(parse("000001-1756512345-short").is_none(), "a truncated hash is not a version");
        assert!(parse("000001-1756512345-0123456789abcdef0123456789abcdef-x").is_none());
        assert!(parse("first-1756512345-0123456789abcdef0123456789abcdef").is_none());
    }
}
