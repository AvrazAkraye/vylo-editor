//! Noticing that the folder changed.
//!
//! Vylo ships its own terminal, so the disk moves underneath this app several
//! times an hour: `git checkout`, `git pull`, `npm install`, a build. None of
//! it was visible. The sidebar went on listing files that had been deleted, the
//! status bar kept a branch that had been switched away from, and an open tab
//! kept showing a version that was overwritten ten minutes ago. Reopening the
//! folder was the only cure.
//!
//! The safety half of this problem was already built and is not touched here:
//! `apply_write` takes `expect_sha256` and refuses to write over a file that
//! moved, the review pane re-bases the diff when it does, and `index.rs`
//! recomputes its file stamps on every query. What was missing is the *push* —
//! something that says so without being asked. This is that, and nothing else:
//! it reports paths, and every decision about what to do with them is in
//! `src/watch.ts`, where it can be argued with in a test.
//!
//! ## Containment, which is the same rule as everywhere else
//!
//! The root is `canonicalize`d exactly as [`crate::resolve`] does, the watch is
//! registered against that path, and every event is `strip_prefix`ed by it —
//! an event whose path does not start with the canonical root is dropped rather
//! than reported. So a symlink pointing out of the open folder cannot become a
//! watch on somebody's home directory, and cannot smuggle a path from outside
//! the workspace into the file tree.
//!
//! ## Why the filter is not optional
//!
//! One `npm install` writes hundreds of thousands of files. One `cargo build`
//! writes a `target/` directory larger than the source. Both are inside the
//! watched tree, and both are things people run in this app's own terminal, so
//! without an exclusion the first one turns the window into a slideshow.
//! [`keep`] drops:
//!
//! * everything in [`walk::ALWAYS_SKIP`] — the dependency and cache trees the
//!   agent's own walks already refuse to look at, so reporting them would
//!   redraw a tree that cannot show them;
//! * everything the project's own `.gitignore`, `.ignore` or
//!   `.git/info/exclude` calls generated, which is where `dist/`, `target/` and
//!   `*.log` are named by the people who know;
//! * `.git`, with two deliberate exceptions.
//!
//! ### The two files inside `.git`
//!
//! `HEAD` and `index` are let through. Everything else in there is dropped,
//! because a single `git status` rewrites several files in `.git` and a fetch
//! writes thousands of loose objects. But a `git commit` typed into the
//! terminal changes *nothing* in the working tree — the modified count on the
//! status bar simply becomes wrong, with no event to say so — and a branch
//! switch to a branch with identical content is the same. Those two files are
//! how both announce themselves. `src/watch.ts` treats them as git news and
//! never as a file or a tree change.
//!
//! ## Why it is debounced here rather than in the frontend
//!
//! A save is several events, a `git checkout` is thousands, and the backends
//! disagree about how many. Debouncing at the source means the IPC carries one
//! message per burst instead of one per inode, and it is also the only place
//! that can cheaply answer the question the frontend actually needs answered —
//! *is the path there now* — because by the end of a burst the answer has
//! stopped changing.

use crate::walk;
use ignore::gitignore::{Gitignore, GitignoreBuilder};
use notify::{RecursiveMode, Watcher};
use serde::Serialize;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// How long the burst must be silent before it is reported.
///
/// Long enough that one editor's save — write a temp file, rename it over the
/// target, touch the directory — arrives as one batch, and short enough that a
/// human who typed `git checkout` in the terminal sees the tree redraw as they
/// look back up at it.
const QUIET: Duration = Duration::from_millis(250);

/// A ceiling on how long one batch may keep collecting.
///
/// Without it a build that writes a file every 200ms holds the batch open for
/// as long as it runs, and the app hears nothing until it finishes — which is
/// exactly the long operation somebody wants to watch progress.
const WINDOW: Duration = Duration::from_secs(2);

/// The most paths one batch will name.
///
/// Beyond this the list stops being useful: the frontend reloads every open tab
/// and re-bases every proposal anyway, so two thousand paths would be a
/// megabyte of JSON assembled, sent and thrown away. Past the cap the batch
/// says only that it happened.
pub const MAX_PATHS: usize = 2_000;

/// Whether the path is there now.
///
/// Deliberately not `notify`'s own kinds. Create, Modify and Remove are not
/// comparable across backends — FSEvents coalesces a burst into one flag,
/// ReadDirectoryChangesW splits a rename into two events, and an editor saving
/// through a temp file produces a different sequence on each platform. What is
/// reliably true at the end of a batch is whether the file exists, and that is
/// also the only distinction anything downstream acts on.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Changed,
    Removed,
}

#[derive(Clone, Debug, Serialize)]
pub struct Change {
    /// Relative to the workspace root, in the platform's own separators —
    /// the same spelling `walk::Found::rel` uses, so the frontend can compare
    /// them against the tree it already has.
    pub path: String,
    pub kind: Kind,
}

#[derive(Clone, Debug, Serialize)]
pub struct Batch {
    pub changes: Vec<Change>,
    /// The batch overflowed, or the backend said it had lost events. Nothing
    /// may be concluded from a path's *absence* from `changes`; the frontend
    /// treats it as "the world moved and I cannot say where".
    pub truncated: bool,
}

/// The project's own statement of what in it is generated.
///
/// Only the root's files, not the per-directory stack `ignore` builds for a
/// walk. A watcher that is wrong here costs a redundant refresh, where a walk
/// that is wrong hides a file from the agent, so this is the cheap version of
/// the same question on purpose. It is rebuilt when `.gitignore` itself
/// changes, which is the one edit that would otherwise need the folder
/// reopening to take effect.
fn ignores(root: &Path) -> Gitignore {
    let mut b = GitignoreBuilder::new(root);
    // Each `add` answers with an error rather than returning one, and the error
    // is almost always "there is no such file" — which is the ordinary case.
    let _ = b.add(root.join(".gitignore"));
    let _ = b.add(root.join(".ignore"));
    let _ = b.add(root.join(".git").join("info").join("exclude"));
    b.build().unwrap_or_else(|_| Gitignore::empty())
}

/// Exactly the files inside `.git` that are worth hearing about. See the header.
const GIT_NEWS: &[&str] = &["HEAD", "index"];

/// The workspace-relative path this event is about, or `None` when it is one
/// nothing should hear about.
///
/// `root` must already be canonical: the `strip_prefix` below is the whole of
/// the containment check, and against an uncanonicalized root it would compare
/// a resolved path with an unresolved prefix and drop everything.
pub fn keep(root: &Path, path: &Path, ig: &Gitignore) -> Option<String> {
    // Not under the open folder. The watch is registered on the canonical root
    // so this should not happen — but "should not happen" is not containment,
    // and a path from outside the workspace must never reach the frontend.
    let rel = path.strip_prefix(root).ok()?;
    if rel.as_os_str().is_empty() {
        return None; // the root directory itself
    }

    let parts: Vec<String> = rel
        .components()
        .map(|c| c.as_os_str().to_string_lossy().to_string())
        .collect();

    if parts[0] == ".git" {
        // Two files, at the top of `.git` and nowhere else. `refs/heads/HEAD`
        // is not this file and a repository that has one is not asking us to
        // redraw the branch.
        let is_news = parts.len() == 2 && GIT_NEWS.contains(&parts[1].as_str());
        return is_news.then(|| rel.to_string_lossy().to_string());
    }

    // A *directory* called `vendor` or `target` anywhere in the path. Matched
    // on every component rather than the first, because the storm is
    // `packages/web/node_modules`, not just the one at the top.
    //
    // The last component is deliberately included: a file whose own name is on
    // the list is vanishingly rare, and a *directory* being created is reported
    // as its own path, which is the event that matters.
    if parts.iter().any(|p| walk::ALWAYS_SKIP.contains(&p.as_str())) {
        return None;
    }

    // `is_dir` is false for anything that has just been deleted, which is
    // correct as far as it can be: the parent walk inside
    // `matched_path_or_any_parents` tests every ancestor as a directory
    // anyway, so `dist/` still catches `dist/app.js` after `dist/app.js` is
    // gone.
    if ig
        .matched_path_or_any_parents(rel, path.is_dir())
        .is_ignore()
    {
        return None;
    }

    Some(rel.to_string_lossy().to_string())
}

/// One running watch. Dropping it stops both the OS watch and the thread.
pub struct Live {
    stop: Arc<AtomicBool>,
    /// Held only to keep the watch open. Dropping it closes the channel the
    /// pump thread is blocked on, which is how that thread learns to exit.
    _watcher: notify::RecommendedWatcher,
}

impl Drop for Live {
    fn drop(&mut self) {
        // Set before the watcher is dropped, so a batch already collected when
        // the folder was closed is not delivered against the new one.
        self.stop.store(true, Ordering::Relaxed);
    }
}

/// The one watch the window has, if any.
///
/// One at a time on purpose: there is one open folder, and a second watch left
/// running against the previous one would report paths that no longer mean
/// anything to the tree on screen.
#[derive(Default)]
pub struct Watching(Mutex<Option<Live>>);

impl Watching {
    fn set(&self, live: Option<Live>) {
        if let Ok(mut g) = self.0.lock() {
            *g = live;
        }
    }
}

/// Start watching `root`, calling `emit` once per debounced batch.
///
/// A plain function rather than only a command, because a `#[tauri::command]`
/// taking `State` cannot be called from a unit test — the same split as
/// `search` / `search_in`.
pub fn start_at<F>(root: &str, emit: F) -> Result<Live, String>
where
    F: Fn(Batch) + Send + 'static,
{
    let root = Path::new(root)
        .canonicalize()
        .map_err(|e| format!("workspace root is unreadable: {e}"))?;
    if !root.is_dir() {
        return Err("the workspace root is not a folder".into());
    }

    let (tx, rx) = mpsc::channel::<notify::Result<notify::Event>>();
    let mut watcher = notify::recommended_watcher(move |res| {
        // The receiver is gone when the folder has been closed; there is
        // nothing to report to and nothing to do about it.
        let _ = tx.send(res);
    })
    .map_err(|e| format!("could not watch this folder: {e}"))?;

    watcher
        .watch(&root, RecursiveMode::Recursive)
        .map_err(|e| format!("could not watch this folder: {e}"))?;

    let stop = Arc::new(AtomicBool::new(false));
    let flag = Arc::clone(&stop);
    std::thread::spawn(move || pump(rx, root, flag, emit));

    Ok(Live { stop, _watcher: watcher })
}

/// Collect a burst, filter it, and report it once.
fn pump<F>(
    rx: mpsc::Receiver<notify::Result<notify::Event>>,
    root: PathBuf,
    stop: Arc<AtomicBool>,
    emit: F,
) where
    F: Fn(Batch) + Send + 'static,
{
    let mut ig = ignores(&root);

    loop {
        // Blocks until the disk does something. `Err` here is the watcher
        // having been dropped, which is the folder being closed.
        let Ok(first) = rx.recv() else { return };
        if stop.load(Ordering::Relaxed) {
            return;
        }

        let mut seen: HashSet<String> = HashSet::new();
        let mut truncated = false;
        let mut reread_ignores = false;
        absorb(first, &root, &ig, &mut seen, &mut truncated, &mut reread_ignores);

        let started = Instant::now();
        let mut closed = false;
        loop {
            let left = WINDOW.saturating_sub(started.elapsed());
            if left.is_zero() {
                break;
            }
            match rx.recv_timeout(QUIET.min(left)) {
                Ok(ev) => absorb(ev, &root, &ig, &mut seen, &mut truncated, &mut reread_ignores),
                // Quiet for long enough, or the ceiling. Either way, report.
                Err(RecvTimeoutError::Timeout) => break,
                // The folder was closed mid-burst. Report nothing: the window
                // it would arrive at is looking at something else now.
                Err(RecvTimeoutError::Disconnected) => {
                    closed = true;
                    break;
                }
            }
        }
        if closed || stop.load(Ordering::Relaxed) {
            return;
        }

        // Read once here rather than per event: a `.gitignore` that grew a line
        // during this burst should govern the *next* one, and rebuilding it
        // mid-batch would filter the first half of a burst by one set of rules
        // and the second half by another.
        if reread_ignores {
            ig = ignores(&root);
        }

        if truncated {
            // The list is not sent. Past the cap the frontend reloads every
            // open tab and re-bases every proposal regardless of what is in it,
            // so assembling two thousand paths would be work done to be
            // discarded — and a sample is worse than nothing, because absence
            // from it would look like news.
            emit(Batch { changes: Vec::new(), truncated: true });
            continue;
        }
        if seen.is_empty() {
            continue; // the whole burst was `node_modules`, or `.git` internals
        }

        // Sorted so a batch is the same message however the backend's threads
        // happened to order it. One `exists` per unique path, at the end of the
        // burst, where the answer has stopped changing.
        let mut rels: Vec<String> = seen.into_iter().collect();
        rels.sort();
        let changes = rels
            .into_iter()
            .map(|rel| {
                let kind = if root.join(&rel).exists() { Kind::Changed } else { Kind::Removed };
                Change { path: rel, kind }
            })
            .collect();
        emit(Batch { changes, truncated: false });
    }
}

/// Fold one event into the batch being collected.
fn absorb(
    ev: notify::Result<notify::Event>,
    root: &Path,
    ig: &Gitignore,
    seen: &mut HashSet<String>,
    truncated: &mut bool,
    reread_ignores: &mut bool,
) {
    // A backend error is a watch that failed, not a file that changed. It is
    // deliberately *not* treated as a rescan: an error that repeats would then
    // reload every open tab several times a second, which is worse than the
    // stale tree this whole module exists to fix.
    let Ok(ev) = ev else { return };

    // The platform admitting it dropped events. Both FSEvents and
    // ReadDirectoryChangesW have a queue that can overflow, and the flag is the
    // only warning there is that what follows is incomplete.
    if ev.need_rescan() {
        *truncated = true;
        return;
    }

    for p in ev.paths {
        let Some(rel) = keep(root, &p, ig) else { continue };
        if rel == ".gitignore" || rel == ".ignore" {
            *reread_ignores = true;
        }
        if seen.contains(&rel) {
            continue;
        }
        if seen.len() >= MAX_PATHS {
            // Keep draining: the channel has to be read or the backend's own
            // queue backs up behind us and overflows for real.
            *truncated = true;
            continue;
        }
        seen.insert(rel);
    }
}

/// Watch the open folder, replacing whatever was being watched before.
///
/// **Absent from the tool schema**, like `apply_write` and the `pty_*`
/// commands, and named in `test/modes.test.mjs` beside them. There is nothing
/// here for the model to ask for: it is the window saying which folder it is
/// looking at, and a tool that could register a watch would be a tool that
/// could name a path.
#[tauri::command]
pub fn watch_start(
    state: tauri::State<'_, Watching>,
    root: String,
    on_event: tauri::ipc::Channel<Batch>,
) -> Result<(), String> {
    // Stop the old one *before* the new one starts, so two watches never both
    // hold the same tree open while a folder is being swapped.
    state.set(None);
    let live = start_at(&root, move |b| {
        // The window is gone, or the channel was closed with it.
        let _ = on_event.send(b);
    })?;
    state.set(Some(live));
    Ok(())
}

/// Stop watching. Absent from the tool schema for the same reason.
#[tauri::command]
pub fn watch_stop(state: tauri::State<'_, Watching>) {
    state.set(None);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::mpsc::channel;

    /// Each test gets its own tree. The *prefix* is what separates them —
    /// `std::process::id()` does not, because Rust tests share one process.
    fn tmp(prefix: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("vylo_watch_{prefix}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        // Canonical, because that is what `start_at` watches and what `keep`
        // strips: on macOS `/var` is a symlink to `/private/var`, so an
        // uncanonicalized temp path would fail every `strip_prefix` here.
        dir.canonicalize().unwrap()
    }

    fn empty() -> Gitignore {
        Gitignore::empty()
    }

    #[test]
    fn keeps_an_ordinary_source_file() {
        let root = Path::new("/w");
        assert_eq!(
            keep(root, &root.join("src").join("app.ts"), &empty()),
            Some(format!("src{}app.ts", std::path::MAIN_SEPARATOR)),
        );
    }

    #[test]
    fn refuses_a_path_outside_the_open_folder() {
        // The containment check. A watch registered on a symlinked directory
        // would deliver the link's target, and a path from outside the
        // workspace must never reach the frontend.
        let root = Path::new("/w");
        assert_eq!(keep(root, Path::new("/etc/passwd"), &empty()), None);
        assert_eq!(keep(root, Path::new("/w2/src/app.ts"), &empty()), None);
    }

    #[test]
    fn refuses_the_root_itself() {
        let root = Path::new("/w");
        assert_eq!(keep(root, root, &empty()), None);
    }

    #[test]
    fn drops_git_internals_but_keeps_head_and_index() {
        let root = Path::new("/w");
        for news in ["HEAD", "index"] {
            assert!(
                keep(root, &root.join(".git").join(news), &empty()).is_some(),
                "{news} is how a commit in the terminal announces itself"
            );
        }
        for noise in ["config", "COMMIT_EDITMSG", "ORIG_HEAD"] {
            assert_eq!(keep(root, &root.join(".git").join(noise), &empty()), None, "{noise}");
        }
        assert_eq!(
            keep(root, &root.join(".git").join("objects").join("ab").join("cd"), &empty()),
            None,
        );
        // Not the two names anywhere else inside .git.
        assert_eq!(
            keep(root, &root.join(".git").join("refs").join("HEAD"), &empty()),
            None,
        );
    }

    #[test]
    fn a_file_merely_starting_with_dot_git_is_ordinary() {
        // `.gitignore` and `.gitattributes` are files people open the agent to
        // ask about, and a prefix test rather than a component test would hide
        // both.
        let root = Path::new("/w");
        assert!(keep(root, &root.join(".gitignore"), &empty()).is_some());
        assert!(keep(root, &root.join(".gitattributes"), &empty()).is_some());
    }

    #[test]
    fn drops_the_dependency_trees_at_any_depth() {
        let root = Path::new("/w");
        assert_eq!(keep(root, &root.join("node_modules").join("x").join("i.js"), &empty()), None);
        assert_eq!(
            keep(root, &root.join("packages").join("web").join("node_modules").join("i.js"), &empty()),
            None,
            "the storm is the nested one, not just the one at the top",
        );
        assert_eq!(keep(root, &root.join("target").join("debug").join("x"), &empty()), None);
        assert_eq!(keep(root, &root.join("node_modules"), &empty()), None);
    }

    #[test]
    fn honours_the_projects_own_ignore_file() {
        let root = tmp("ignorefile");
        fs::write(root.join(".gitignore"), "dist/\n*.log\n!keep.log\n").unwrap();
        let ig = ignores(&root);

        assert_eq!(keep(&root, &root.join("dist").join("app.js"), &ig), None);
        assert_eq!(keep(&root, &root.join("build.log"), &ig), None);
        assert!(keep(&root, &root.join("src").join("app.ts"), &ig).is_some());
        // A negated pattern is the project saying "not that one", and a watcher
        // that ignored the exception would be stricter than git.
        assert!(keep(&root, &root.join("keep.log"), &ig).is_some());

        let _ = fs::remove_dir_all(&root);
    }

    /// The end-to-end path: a real write produces a real batch.
    ///
    /// Written to survive a loaded machine. The file is rewritten every 200ms
    /// until something arrives or the deadline passes, so a backend that took
    /// its time starting the stream costs a second rather than a red test.
    #[test]
    fn reports_a_file_written_underneath_it() {
        let root = tmp("live");
        let (tx, rx) = channel::<Batch>();
        let live = start_at(&root.to_string_lossy(), move |b| {
            let _ = tx.send(b);
        })
        .expect("should start");

        let deadline = Instant::now() + Duration::from_secs(15);
        let mut got: Option<Batch> = None;
        while Instant::now() < deadline && got.is_none() {
            fs::write(root.join("hello.ts"), format!("// {:?}\n", Instant::now())).unwrap();
            if let Ok(b) = rx.recv_timeout(Duration::from_millis(400)) {
                got = Some(b);
            }
        }

        let b = got.expect("a write inside the watched folder should be reported");
        assert!(
            b.truncated || b.changes.iter().any(|c| c.path == "hello.ts"),
            "batch was {:?}",
            b.changes,
        );

        drop(live);
        let _ = fs::remove_dir_all(&root);
    }

    /// The whole reason the filter exists: `npm install` must not be an event
    /// storm, and here it must not be an event at all.
    #[test]
    fn says_nothing_about_a_dependency_tree() {
        let root = tmp("quiet");
        fs::create_dir_all(root.join("node_modules").join("left-pad")).unwrap();
        let (tx, rx) = channel::<Batch>();
        let live = start_at(&root.to_string_lossy(), move |b| {
            let _ = tx.send(b);
        })
        .expect("should start");

        // Give the backend time to be listening before the writes it must
        // ignore, then time for a batch to have been reported if one were
        // going to be.
        std::thread::sleep(Duration::from_millis(300));
        for i in 0..50 {
            fs::write(root.join("node_modules").join("left-pad").join(format!("{i}.js")), "x").unwrap();
        }
        let heard = rx.recv_timeout(Duration::from_secs(2));
        assert!(heard.is_err(), "reported {:?}", heard.map(|b| b.changes));

        drop(live);
        let _ = fs::remove_dir_all(&root);
    }

    /// A folder that has been closed must stop reporting, or the second folder
    /// somebody opens gets the first one's paths.
    #[test]
    fn stops_when_it_is_dropped() {
        let root = tmp("stop");
        let (tx, rx) = channel::<Batch>();
        let live = start_at(&root.to_string_lossy(), move |b| {
            let _ = tx.send(b);
        })
        .expect("should start");

        std::thread::sleep(Duration::from_millis(300));
        drop(live);
        std::thread::sleep(Duration::from_millis(100));

        for i in 0..20 {
            fs::write(root.join(format!("after{i}.ts")), "x").unwrap();
        }
        let heard = rx.recv_timeout(Duration::from_secs(2));
        assert!(heard.is_err(), "reported after being dropped: {:?}", heard.map(|b| b.changes));

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn refuses_a_root_that_is_not_a_folder() {
        let root = tmp("notafolder");
        let file = root.join("a.txt");
        fs::write(&file, "x").unwrap();
        assert!(start_at(&file.to_string_lossy(), |_| {}).is_err());
        assert!(start_at(&root.join("nope").to_string_lossy(), |_| {}).is_err());
        let _ = fs::remove_dir_all(&root);
    }
}
