//! One exclusion, shared by every walk the agent can see.
//!
//! `list_tree`, `search` and the symbol index used to walk the project three
//! separate ways. Two of them stopped at `max_depth(8)` and the third went to
//! 12, so in any monorepo `find_symbol` named a file that `search` then swore
//! did not exist and the agent spent hops arguing with itself about which of
//! its own tools was lying. There is one walker now, and all three call sites
//! see exactly the same set of paths.
//!
//! ## Why the depth cap could not just be deleted
//!
//! It was a cost control, and the wrong one: it cut off deep *source* while
//! still walking, reading and returning every file under `coverage/`, `out/`
//! and `.terraform/`. Deleting it on its own would have made the first search
//! in a repo with a fat build directory slower rather than faster. Ignoring the
//! generated directories is the control that actually fits the cost, which is
//! why the two changes land together and in that order.
//!
//! ## Two tiers, because one hardcoded list is wrong in both directions
//!
//! The old list was thirteen literal names. It walked `coverage/`, `out/`,
//! `obj/`, `bin/`, `.turbo/` and `storybook-static/` because they were not on
//! it, and it hid `dist/` and `build/` from the projects that deliberately
//! check them in because they were. No list of names can be right for every
//! project, because *the project already says*: its `.gitignore` is a written
//! statement of what in this tree is generated.
//!
//! So:
//!
//! * A project **with** an ignore file — its own, or its repository's — is
//!   believed. Only
//!   [`ALWAYS_SKIP`] is applied on top — dependency and cache trees that are
//!   never anybody's source, and whose size makes walking them a mistake even
//!   when a `.gitignore` forgets to mention them.
//! * A project **without** one gets the conventions instead: [`ALSO_SKIP`]
//!   and every hidden directory. That is the case the floor exists for, and
//!   the case where `.terraform/` and `.turbo/` are caught by a rule rather
//!   than by a name on a list.
//!
//! Hidden *files* are never skipped by this. `.htaccess`, `.env.example`,
//! `.eslintrc.json` and `.gitignore` itself are things people open the agent to
//! ask about, and `.env` is already ignored by every project that has one.
//!
//! ## Why the result carries a count
//!
//! The `ignore` crate also honours `~/.config/git/ignore`, so a rule the user
//! wrote years ago for their own machine can remove a file from every listing
//! the agent gets, in a project that says nothing about it. That is the worst
//! kind of defect: the agent reports the file does not exist and is not wrong
//! about anything it can see. [`Walked::skipped`] is how many paths were left
//! out, so the omission is a number on screen rather than a mystery.

use ignore::{WalkBuilder, WalkState};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize};
use std::sync::{Arc, Mutex};

/// Skipped in every project, whatever its ignore file says.
///
/// Every name here is a dependency tree or a build cache: machine-written, and
/// large enough that walking one is the difference between a search that
/// answers and a search that is abandoned. A `.gitignore` that forgets
/// `node_modules` is a mistake in the repository, not an instruction.
pub const ALWAYS_SKIP: &[&str] = &[
    ".git", "node_modules", "target", ".next", ".venv", "__pycache__",
    ".cache", "vendor", "Pods", ".gradle", ".idea",
];

/// Skipped only when the project has no ignore file of its own.
///
/// Every one of these means build output in most projects and source in a few.
/// With a `.gitignore` present the project has already answered; without one
/// these are the conventional guess, which is what the floor is for.
///
/// `.terraform` and `.turbo` are not here because they do not need to be: the
/// same no-ignore-file case skips hidden directories wholesale. These are the
/// generated trees whose names happen not to start with a dot.
///
/// `bin` is deliberately absent. It is `obj`'s partner in a .NET build and it
/// is also where a very large number of repositories keep their shell scripts,
/// and this list is applied precisely to the projects that have not said which
/// kind they are. A guess that hides source is worse than one that walks a
/// small directory.
pub const ALSO_SKIP: &[&str] = &[
    "dist", "build", "out", "obj", "coverage", "storybook-static",
];

/// A ceiling on what one walk will hold in memory. Reaching it sets
/// [`Walked::truncated`]; it is not a limit anybody should hit, and a repo that
/// does has bigger problems than a truncated listing.
pub const MAX_WALK: usize = 200_000;

/// One entry the walk kept.
pub struct Found {
    /// Path relative to the walk root, in the platform's own separators.
    pub rel: String,
    pub path: PathBuf,
    pub is_dir: bool,
    /// A *regular* file — not a symlink to one. Links are listed but never
    /// opened: a link inside the workspace can point at `~/.ssh/id_rsa`, and
    /// reading through it would put a file from outside the open folder into
    /// the model's context. Containment is the one rule this walk must not
    /// weaken while making the tree bigger.
    pub is_file: bool,
    pub size: u64,
    /// Seconds since the epoch, or 0 when the filesystem will not say.
    pub mtime: u64,
    /// 1 for a child of the root. The root itself is never returned.
    pub depth: usize,
}

pub struct Walked {
    /// Shallowest first, then alphabetical — a total order, so two walks of an
    /// unchanged tree return the same list. The parallel walker finishes its
    /// directories in whatever order the threads get to them, and a caller that
    /// truncates would otherwise return a different arbitrary slice each time.
    pub found: Vec<Found>,
    /// How many paths the exclusion left out, counted where each was rejected:
    /// an ignored directory is one skipped path, not the forty thousand files
    /// inside it. 0 when `truncated` is set, because the number would then be
    /// measuring the ceiling rather than the ignore rules.
    pub skipped: usize,
    /// The walk stopped at [`MAX_WALK`] rather than reaching the end.
    pub truncated: bool,
}

/// Has this project stated what in it is generated?
///
/// Ancestors count, because the walk reads their ignore files too: opening
/// `app/` inside a repository whose `.gitignore` lives at the top is the
/// ordinary way to work in a monorepo, and answering "no" there would apply the
/// conventional guesses to a project that has already been explicit.
///
/// The search stops at the repository root, where git's would. Above it a
/// `.gitignore` is somebody else's file that happens to be on the path.
///
/// Deliberately not `.git/info/exclude`: `git init` writes one into every
/// repository, so testing for it would answer "yes" for a repo that has said
/// nothing at all — and the floor exists for exactly that repo.
fn states_its_own_rules(root: &Path) -> bool {
    for dir in root.ancestors() {
        if dir.join(".gitignore").exists() || dir.join(".ignore").exists() {
            return true;
        }
        if dir.join(".git").exists() {
            return false;
        }
    }
    false
}

fn mtime_secs(md: &std::fs::Metadata) -> u64 {
    md.modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Walk `root` once, applying the shared exclusion.
///
/// `limit` caps what is collected; pass [`MAX_WALK`] unless a test wants the
/// truncation path. `count_skipped` costs one extra `read_dir` per surviving
/// directory, so the index — which runs on every `search` and every
/// `find_symbol` to check whether it is stale — asks for it to be left off.
pub fn walk(root: &Path, limit: usize, count_skipped: bool) -> Walked {
    // Read once, outside the predicate: the predicate runs per entry and on
    // several threads, and this answer cannot change during a walk.
    let conventions = !states_its_own_rules(root);

    let mut builder = WalkBuilder::new(root);
    builder
        // Hidden entries are handled by the predicate below, not here: the
        // crate's rule removes `.github/workflows` and `.vylo/mcp.json` along
        // with `.terraform`, and those are files people open the agent to ask
        // about.
        .hidden(false)
        .ignore(true)
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true)
        .parents(true)
        // Without this, a `.gitignore` in a folder that is not a git
        // repository is read and then thrown away — which is every project a
        // user has downloaded rather than cloned.
        .require_git(false)
        // A symlink into a parent directory is a walk that never ends, and a
        // symlink out of the workspace is a containment problem. Neither is
        // worth following to list a tree.
        .follow_links(false)
        .max_depth(None)
        .threads(0)
        .filter_entry(move |e| {
            if e.depth() == 0 {
                return true; // the root itself, whatever it is called
            }
            // Names only ever describe directories here. A *file* called
            // `build` or `vendor` is somebody's source and is none of our
            // business.
            if !e.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                return true;
            }
            let Some(name) = e.file_name().to_str() else { return true };
            if ALWAYS_SKIP.contains(&name) {
                return false;
            }
            if !conventions {
                return true; // the project's own rules have already had their say
            }
            !(ALSO_SKIP.contains(&name) || name.starts_with('.'))
        });

    let found: Arc<Mutex<Vec<Found>>> = Arc::new(Mutex::new(Vec::new()));
    let seen = Arc::new(AtomicUsize::new(0));
    let hit_ceiling = Arc::new(AtomicBool::new(false));

    builder.build_parallel().run(|| {
        let found = Arc::clone(&found);
        let seen = Arc::clone(&seen);
        let hit_ceiling = Arc::clone(&hit_ceiling);
        let root = root.to_path_buf();
        Box::new(move |entry| {
            // Errors are unreadable directories and broken symlinks. A listing
            // that fails because one folder is not readable would be worse than
            // one that is missing it.
            let Ok(e) = entry else { return WalkState::Continue };
            if e.depth() == 0 {
                return WalkState::Continue;
            }
            if seen.fetch_add(1, std::sync::atomic::Ordering::Relaxed) >= limit {
                hit_ceiling.store(true, std::sync::atomic::Ordering::Relaxed);
                return WalkState::Quit;
            }
            let Ok(rel) = e.path().strip_prefix(&root) else { return WalkState::Continue };
            let md = e.metadata().ok();
            let item = Found {
                rel: rel.to_string_lossy().to_string(),
                path: e.path().to_path_buf(),
                is_dir: e.file_type().map(|t| t.is_dir()).unwrap_or(false),
                is_file: e.file_type().map(|t| t.is_file()).unwrap_or(false),
                size: md.as_ref().map(|m| m.len()).unwrap_or(0),
                mtime: md.as_ref().map(mtime_secs).unwrap_or(0),
                depth: e.depth(),
            };
            if let Ok(mut v) = found.lock() {
                v.push(item);
            }
            WalkState::Continue
        })
    });

    let truncated = hit_ceiling.load(std::sync::atomic::Ordering::Relaxed);
    let mut found = found
        .lock()
        .map(|mut v| std::mem::take(&mut *v))
        .unwrap_or_default();
    found.sort_by(|a, b| a.depth.cmp(&b.depth).then_with(|| a.rel.cmp(&b.rel)));

    let skipped = if count_skipped && !truncated {
        count_excluded(root, &found)
    } else {
        0
    };
    Walked { found, skipped, truncated }
}

/// How many entries the exclusion removed.
///
/// The walker never says what it dropped, so this asks the directories it *did*
/// visit what else was in them. That reads each surviving directory a second
/// time and never descends into an excluded one, which is what keeps the answer
/// cheap: an ignored `node_modules` costs one `read_dir` entry to count, not a
/// walk of its contents.
fn count_excluded(root: &Path, found: &[Found]) -> usize {
    let kept: HashSet<&Path> = found.iter().map(|f| f.path.as_path()).collect();
    let mut n = 0usize;
    for dir in std::iter::once(root).chain(found.iter().filter(|f| f.is_dir).map(|f| f.path.as_path())) {
        let Ok(listing) = std::fs::read_dir(dir) else { continue };
        for child in listing.flatten() {
            if !kept.contains(child.path().as_path()) {
                n += 1;
            }
        }
    }
    n
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    /// Tests share one process, so a pid does not separate their directories —
    /// the prefix does. Two of these writing to one path deleted each other's
    /// files once already.
    fn tmp(prefix: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("vylo_walk_{prefix}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir.canonicalize().unwrap()
    }

    fn rels(w: &Walked) -> Vec<String> {
        w.found.iter().map(|f| f.rel.replace('\\', "/")).collect()
    }

    /// The defect this item exists for: the old walk stopped at 8 while the
    /// index went to 12, so a monorepo had files one tool could name and the
    /// other denied.
    #[test]
    fn a_file_deeper_than_the_old_cap_is_found() {
        let root = tmp("depth");
        let deep = root.join("a/b/c/d/e/f/g/h/i/j");
        fs::create_dir_all(&deep).unwrap();
        fs::write(deep.join("buried.rs"), "pub fn buried() {}\n").unwrap();

        let w = walk(&root, MAX_WALK, true);
        let paths = rels(&w);
        assert!(
            paths.contains(&"a/b/c/d/e/f/g/h/i/j/buried.rs".to_string()),
            "depth 11 must be reachable now: {paths:?}",
        );
    }

    /// The project's own statement of what is generated is believed.
    #[test]
    fn a_directory_named_in_gitignore_is_not_walked() {
        let root = tmp("ignored");
        fs::write(root.join(".gitignore"), "generated/\ncoverage/\n").unwrap();
        for d in ["generated", "coverage", "src"] {
            fs::create_dir_all(root.join(d)).unwrap();
            fs::write(root.join(d).join("f.ts"), "export const x = 1;\n").unwrap();
        }

        let paths = rels(&walk(&root, MAX_WALK, true));
        assert!(paths.contains(&"src/f.ts".to_string()), "{paths:?}");
        assert!(!paths.iter().any(|p| p.starts_with("generated")), "{paths:?}");
        assert!(!paths.iter().any(|p| p.starts_with("coverage")), "{paths:?}");
    }

    /// The floor. Without it the first project with no `.gitignore` would walk
    /// a hundred thousand files to answer one question.
    #[test]
    fn a_project_with_no_ignore_file_still_skips_node_modules() {
        let root = tmp("floor");
        // An empty `.git` and no `.gitignore`: a real repository that has said
        // nothing. It also stops `states_its_own_rules` walking out of the temp
        // directory, so this test cannot be decided by a file on the machine
        // running it — the sort of thing that only fails on somebody else's CI.
        fs::create_dir_all(root.join(".git")).unwrap();
        for d in [
            "node_modules/left-pad", "dist", ".terraform", "coverage", "out",
            "storybook-static", "src",
        ] {
            fs::create_dir_all(root.join(d)).unwrap();
            fs::write(root.join(d).join("f.js"), "module.exports = 1;\n").unwrap();
        }

        let paths = rels(&walk(&root, MAX_WALK, true));
        assert!(paths.contains(&"src/f.js".to_string()), "{paths:?}");
        for junk in [
            "node_modules", "dist", ".terraform", "coverage", "out", "storybook-static",
        ] {
            assert!(
                !paths.iter().any(|p| p.starts_with(junk)),
                "{junk} should be skipped with no ignore file to say otherwise: {paths:?}",
            );
        }
    }

    /// The floor is a guess, so it has to stop where guessing gets expensive.
    /// `obj/` is a .NET build directory and nothing else; `bin/` is its partner
    /// in that build and is also where thousands of repositories keep the
    /// scripts somebody opens the agent to ask about. Hiding source is the
    /// worse error of the two, and this is the project that has not said.
    #[test]
    fn a_bin_directory_survives_the_floor_and_an_obj_directory_does_not() {
        let root = tmp("binobj");
        fs::create_dir_all(root.join(".git")).unwrap();
        for d in ["bin", "obj"] {
            fs::create_dir_all(root.join(d)).unwrap();
            fs::write(root.join(d).join("thing.sh"), "#!/bin/sh\necho hi\n").unwrap();
        }

        let paths = rels(&walk(&root, MAX_WALK, false));
        assert!(paths.contains(&"bin/thing.sh".to_string()), "{paths:?}");
        assert!(!paths.iter().any(|p| p.starts_with("obj")), "{paths:?}");
    }

    /// The other half of that rule, and the reason it is a rule rather than a
    /// longer list: a project that checks `dist/` in and keeps a `.gitignore`
    /// has already said it wants it.
    #[test]
    fn a_project_that_keeps_dist_and_says_so_gets_it_back() {
        let root = tmp("keepsdist");
        fs::write(root.join(".gitignore"), "*.log\n").unwrap();
        for d in ["dist", ".github/workflows", "node_modules/left-pad"] {
            fs::create_dir_all(root.join(d)).unwrap();
            fs::write(root.join(d).join("f.yml"), "on: push\n").unwrap();
        }
        fs::write(root.join(".htaccess"), "RewriteEngine On\n").unwrap();

        let paths = rels(&walk(&root, MAX_WALK, true));
        assert!(paths.contains(&"dist/f.yml".to_string()), "{paths:?}");
        assert!(
            paths.contains(&".github/workflows/f.yml".to_string()),
            "a hidden directory the project did not ignore is somebody's CI: {paths:?}",
        );
        assert!(paths.contains(&".htaccess".to_string()), "hidden files are files: {paths:?}");
        assert!(
            !paths.iter().any(|p| p.starts_with("node_modules")),
            "the floor still applies: {paths:?}",
        );
    }

    /// Opening one package of a monorepo is opening a project that has already
    /// said what is generated — the statement is just a directory or two up,
    /// which is also where the walk reads it from.
    #[test]
    fn a_subdirectory_of_a_repository_inherits_its_answer() {
        let repo = tmp("monorepo");
        fs::create_dir_all(repo.join(".git")).unwrap();
        fs::write(repo.join(".gitignore"), "*.log\n").unwrap();
        let pkg = repo.join("pkg");
        fs::create_dir_all(pkg.join("dist")).unwrap();
        fs::write(pkg.join("dist/keep.js"), "export const k = 1;\n").unwrap();
        fs::write(pkg.join("noisy.log"), "noise\n").unwrap();

        let paths = rels(&walk(&pkg, MAX_WALK, false));
        assert!(
            paths.contains(&"dist/keep.js".to_string()),
            "the repository keeps dist and never said otherwise: {paths:?}",
        );
        assert!(
            !paths.contains(&"noisy.log".to_string()),
            "and what it did say still applies two directories down: {paths:?}",
        );
    }

    /// The count is what makes a rule in `~/.config/git/ignore` visible instead
    /// of mysterious, so it is reported and it counts each rejection once —
    /// an ignored directory is one skipped path, not its contents.
    #[test]
    fn the_number_of_skipped_paths_is_reported() {
        let root = tmp("counted");
        fs::write(root.join(".gitignore"), "generated/\nsecret.txt\n").unwrap();
        fs::create_dir_all(root.join("generated/deep/deeper")).unwrap();
        for n in 0..5 {
            fs::write(root.join("generated").join(format!("{n}.js")), "x\n").unwrap();
        }
        fs::write(root.join("secret.txt"), "shh\n").unwrap();
        fs::write(root.join("kept.ts"), "export const x = 1;\n").unwrap();

        let w = walk(&root, MAX_WALK, true);
        // `generated/` and `secret.txt`. Not the eight things inside
        // `generated/`, which were never looked at.
        assert_eq!(w.skipped, 2, "kept: {:?}", rels(&w));
        assert!(!w.truncated);

        // Nothing excluded, nothing reported — the number has to be able to be
        // zero or it says nothing when it is two.
        let clean = tmp("counted_clean");
        std::fs::write(clean.join("a.ts"), "export const a = 1;\n").unwrap();
        assert_eq!(walk(&clean, MAX_WALK, true).skipped, 0);
    }

    /// The ceiling exists so one pathological repo cannot take the process
    /// down with it, and it has to say when it bit — a truncated listing that
    /// looks complete is the mysterious omission again.
    #[test]
    fn the_ceiling_reports_itself_rather_than_lying() {
        let root = tmp("ceiling");
        for n in 0..30 {
            fs::write(root.join(format!("f{n}.ts")), "export const x = 1;\n").unwrap();
        }
        let w = walk(&root, 10, true);
        assert!(w.truncated, "the ceiling must be reported");
        assert!(w.found.len() <= 10, "collected {}", w.found.len());
        assert_eq!(w.skipped, 0, "a count taken against a truncated walk would measure the ceiling");
    }

    /// The tree may name a symlink; nothing may read through one. A link
    /// inside the workspace resolves wherever it likes, and `search` opens
    /// every file it is given.
    #[cfg(unix)]
    #[test]
    fn a_symlink_is_listed_but_is_not_a_file_to_read() {
        let root = tmp("symlink");
        let outside = tmp("symlink_target");
        fs::write(outside.join("secret.txt"), "a private key\n").unwrap();
        std::os::unix::fs::symlink(outside.join("secret.txt"), root.join("link.txt")).unwrap();
        fs::write(root.join("real.txt"), "ordinary\n").unwrap();

        let w = walk(&root, MAX_WALK, false);
        let link = w.found.iter().find(|f| f.rel == "link.txt").expect("listed");
        assert!(!link.is_file, "a symlink must not be opened by search or the index");
        assert!(!link.is_dir);
        let real = w.found.iter().find(|f| f.rel == "real.txt").unwrap();
        assert!(real.is_file);

        let _ = fs::remove_dir_all(&outside);
    }

    /// Two walks of an unchanged tree must return the same list. Threads finish
    /// directories in whatever order they get to them, so without the sort a
    /// caller that truncates returns a different arbitrary slice each time.
    #[test]
    fn the_order_is_shallowest_first_and_repeatable() {
        let root = tmp("order");
        fs::create_dir_all(root.join("z/y")).unwrap();
        fs::write(root.join("z/y/deep.ts"), "export const d = 1;\n").unwrap();
        fs::write(root.join("z/mid.ts"), "export const m = 1;\n").unwrap();
        fs::write(root.join("a.ts"), "export const a = 1;\n").unwrap();

        let first = rels(&walk(&root, MAX_WALK, false));
        assert_eq!(first, rels(&walk(&root, MAX_WALK, false)));
        assert_eq!(first[0], "a.ts", "{first:?}");
        assert_eq!(
            first.last().map(String::as_str),
            Some("z/y/deep.ts"),
            "the deepest path comes last: {first:?}",
        );
    }
}
