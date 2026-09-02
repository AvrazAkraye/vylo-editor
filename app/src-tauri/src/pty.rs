//! The integrated terminal.
//!
//! A real pseudo-terminal, not a command runner: `vim`, `top`, `git log`'s
//! pager and anything that asks a question all need a tty on the other end,
//! and a pipe-based runner cannot give them one.
//!
//! ## Why this does not break the rule the app rests on
//!
//! Everywhere else in Vylo Editor the model cannot write or execute — it
//! proposes, and a human approves the exact string. That rule exists because
//! the *model* is the untrusted author. Here the human is the author: they are
//! typing into a shell on their own machine, which they could open in any
//! terminal emulator on the system. Asking them to approve their own keystrokes
//! would be theatre, exactly as it would be in the memory editor.
//!
//! What keeps the rule intact is that **none of these commands are in the tool
//! schema**, so no amount of prompting reaches them, and nothing carries text
//! from the model into a terminal. The bridge runs one way only: a human can
//! send terminal output *to* the chat, by pressing a button.

use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;
use tauri::ipc::Channel;

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum PtyEvent {
    Data { data: String },
    /// `code` is None only when waiting on the child itself failed.
    Exit { code: Option<u32> },
}

struct Session {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
    /// The shell's own process. `None` where the platform did not say.
    pid: Option<u32>,
}

#[derive(Default)]
pub struct Terminals {
    next: AtomicU32,
    map: Mutex<HashMap<u32, Session>>,
}

impl Terminals {
    /// Called when the window goes away. Dropping the master alone sends SIGHUP
    /// on Unix, but a process that ignores it — or anything on Windows, where
    /// there is no such signal — would outlive the app that started it.
    pub fn kill_all(&self) {
        if let Ok(mut map) = self.map.lock() {
            for (_, mut s) in map.drain() {
                let _ = s.killer.kill();
            }
        }
    }
}

/// Take everything that is valid UTF-8, leaving a truncated trailing character
/// in the buffer for the next read.
///
/// Reads land mid-character often enough to matter — box drawing in a test
/// runner, an emoji in a build log — and decoding each chunk lossily would put
/// a replacement character on screen every time one did.
fn take_utf8(buf: &mut Vec<u8>) -> String {
    let mut out = String::new();
    loop {
        match std::str::from_utf8(buf) {
            Ok(s) => {
                out.push_str(s);
                buf.clear();
                return out;
            }
            Err(e) => {
                let good = e.valid_up_to();
                out.push_str(std::str::from_utf8(&buf[..good]).expect("valid_up_to is valid"));
                match e.error_len() {
                    // Genuinely invalid bytes. Step over them, or they sit at
                    // the head of the buffer forever and the terminal stops.
                    Some(bad) => {
                        out.push('\u{FFFD}');
                        buf.drain(..good + bad);
                    }
                    // A truncated character: keep it and wait for the rest. No
                    // valid sequence is longer than four bytes, so a longer
                    // tail than that is not going to complete.
                    None => {
                        buf.drain(..good);
                        if buf.len() > 4 {
                            out.push('\u{FFFD}');
                            buf.clear();
                        }
                        return out;
                    }
                }
            }
        }
    }
}

/// Open a pty. With no `command` it runs an interactive shell; with one it runs
/// that instead.
///
/// Running an approved command *as the child* rather than typing it into a shell
/// avoids all the usual fragility: no prompt in the output, no echo of the
/// command itself, and no sentinel needed to detect completion — the child
/// exiting is the signal, and `child.wait()` already reports it with a code.
#[tauri::command]
pub fn pty_open(
    state: tauri::State<'_, Terminals>,
    cwd: Option<String>,
    cols: u16,
    rows: u16,
    command: Option<String>,
    on_event: Channel<PtyEvent>,
) -> Result<u32, String> {
    let pair = native_pty_system()
        .openpty(PtySize {
            rows: rows.max(1),
            cols: cols.max(1),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("could not open a terminal: {e}"))?;

    // The default program is the user's login shell on macOS (argv0 prefixed
    // with `-`) and ComSpec on Windows. The login shell is the point on macOS:
    // an app launched from Finder inherits launchd's environment, so without it
    // the PATH set in .zprofile — homebrew, nvm, pyenv — is simply absent, and
    // `node` is not found in a terminal that works fine outside the app.
    let mut cmd = match command.as_deref().map(str::trim).filter(|c| !c.is_empty()) {
        Some(line) => {
            // Through a shell deliberately: pipes and redirects are most of why
            // anyone wants to run a command, and the exact string was shown to a
            // human and approved before it got here.
            #[cfg(windows)]
            {
                let mut c = CommandBuilder::new("cmd.exe");
                c.args(["/C", line]);
                c
            }
            #[cfg(not(windows))]
            {
                let mut c = CommandBuilder::new("/bin/sh");
                c.args(["-c", line]);
                c
            }
        }
        None => CommandBuilder::new_default_prog(),
    };
    if let Some(dir) = cwd
        .as_deref()
        .map(std::path::Path::new)
        .and_then(|p| p.canonicalize().ok())
        .filter(|p| p.is_dir())
    {
        cmd.cwd(dir);
    }
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("VYLO_EDITOR", "1");
    // Same launchd problem: without a locale, anything that prints UTF-8 falls
    // back to ASCII and draws boxes as question marks.
    if std::env::var_os("LANG").is_none() {
        cmd.env("LANG", "en_US.UTF-8");
    }

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("could not start a shell: {e}"))?;
    // The slave handle must go, or the master never sees EOF when the shell
    // exits and the reader thread blocks for the life of the app.
    drop(pair.slave);

    // Taken before the child is moved into the waiting thread. It is the
    // shell's own process, which is what makes reading its working directory
    // meaningful: `cd` changes the shell's cwd and nothing else's.
    let pid = child.process_id();
    let killer = child.clone_killer();
    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("could not read from the terminal: {e}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("could not write to the terminal: {e}"))?;

    let id = state.next.fetch_add(1, Ordering::Relaxed) + 1;

    let exit_channel = on_event.clone();
    std::thread::spawn(move || {
        let mut reader = reader;
        let mut carry: Vec<u8> = Vec::new();
        let mut chunk = [0u8; 8192];
        loop {
            match reader.read(&mut chunk) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    carry.extend_from_slice(&chunk[..n]);
                    let text = take_utf8(&mut carry);
                    // A send error means the window is gone; stop reading
                    // rather than spinning against a dead channel.
                    if !text.is_empty() && on_event.send(PtyEvent::Data { data: text }).is_err() {
                        return;
                    }
                }
            }
        }
    });

    // The shell exiting is what closes the tab, and waiting on the child is the
    // only portable way to learn it happened.
    //
    // Reader EOF is NOT that signal. A Unix pty reports EOF on the master when
    // the slave closes, but ConPTY keeps the pseudoconsole open and the read
    // simply blocks for ever -- so on Windows a shell you typed `exit` into
    // would sit there looking alive. Windows CI found this by hanging on the
    // test that read to EOF; the blocked reader unwinds when `pty_close` drops
    // the master, which is what the tab closing does.
    std::thread::spawn(move || {
        let mut child = child;
        let code = child.wait().ok().map(|s| s.exit_code());
        let _ = exit_channel.send(PtyEvent::Exit { code });
    });

    state
        .map
        .lock()
        .map_err(|_| "terminal state is unusable".to_string())?
        .insert(
            id,
            Session {
                master: pair.master,
                writer,
                killer,
                pid,
            },
        );
    Ok(id)
}

/// Where the shell in this terminal currently is.
///
/// ## Why not ask the shell
///
/// The usual answer is OSC 7 — an escape sequence a shell emits when its
/// directory changes. It is the right mechanism and it is not available: macOS
/// only wires it up for Terminal.app, and a shell that has not been configured
/// for it says nothing at all. Waiting for a sequence that will never arrive
/// would mean the path is simply blank for most people.
///
/// So this asks the operating system about the process instead. The shell is
/// the pty's direct child, and `cd` changes that process's working directory —
/// so its cwd *is* the answer, with no cooperation from the shell needed and
/// nothing to configure.
///
/// Empty rather than an error for everything that can ordinarily go wrong: a
/// terminal that has closed, a platform with no answer, a process that has
/// exited between the ask and the read. The strip above the prompt falls back
/// to the folder, which is where the shell started.
#[tauri::command]
pub fn pty_cwd(state: tauri::State<'_, Terminals>, id: u32) -> String {
    let pid = match state.map.lock() {
        Ok(map) => match map.get(&id).and_then(|s| s.pid) {
            Some(p) => p,
            None => return String::new(),
        },
        Err(_) => return String::new(),
    };
    cwd_of(pid).unwrap_or_default()
}

/// The working directory of a process, by pid.
#[cfg(target_os = "macos")]
fn cwd_of(pid: u32) -> Option<String> {
    // `proc_pidinfo` with `PROC_PIDVNODEPATHINFO` fills a struct whose first
    // member is the current directory's path. The struct is large and its
    // layout is stable, but rather than mirror it field by field — which would
    // be a second definition to keep in step with a header nobody here
    // controls — this asks for the bytes and reads the one offset that matters.
    //
    // `vnode_info_path` begins with `vnode_info` (152 bytes) followed by
    // `vip_path`, a `char[MAXPATHLEN]`. `pvi_cdir` is the first of the two
    // `vnode_info_path` members, so the path starts at 152.
    const PROC_PIDVNODEPATHINFO: libc::c_int = 9;
    const VNODE_INFO_SIZE: usize = 152;
    const MAXPATHLEN: usize = 1024;
    // Two `vnode_info_path`, for the current and root directories.
    const BUF: usize = (VNODE_INFO_SIZE + MAXPATHLEN) * 2;

    let mut buf = vec![0u8; BUF];
    // SAFETY: `buf` is BUF bytes and that is what is passed as the size. The
    // call writes at most that many and returns how many it wrote.
    let n = unsafe {
        libc::proc_pidinfo(
            pid as libc::c_int,
            PROC_PIDVNODEPATHINFO,
            0,
            buf.as_mut_ptr() as *mut libc::c_void,
            BUF as libc::c_int,
        )
    };
    if n <= VNODE_INFO_SIZE as libc::c_int {
        return None;
    }
    let start = VNODE_INFO_SIZE;
    let end = buf[start..].iter().position(|&b| b == 0).map(|i| start + i)?;
    let path = String::from_utf8_lossy(&buf[start..end]).into_owned();
    if path.is_empty() { None } else { Some(path) }
}

/// The working directory of a process, by pid.
#[cfg(target_os = "linux")]
fn cwd_of(pid: u32) -> Option<String> {
    std::fs::read_link(format!("/proc/{pid}/cwd"))
        .ok()
        .map(|p| p.to_string_lossy().into_owned())
}

/// Not supported here.
///
/// Windows has no cheap equivalent: a process's current directory lives in its
/// own address space, and reading it means `NtQueryInformationProcess` and a
/// cross-architecture struct walk. The strip shows the folder instead, which is
/// where the shell started and is right until somebody types `cd`. Saying so is
/// better than reading a wrong path confidently.
#[cfg(all(not(target_os = "macos"), not(target_os = "linux")))]
fn cwd_of(_pid: u32) -> Option<String> {
    None
}

/// Every program that could be run, by name.
///
/// The names on `PATH`, deduplicated and sorted, and nothing else — no sizes,
/// no paths, no contents. It is the same list the shell's own Tab completion
/// builds, and it is worked out once: `PATH` does not change while the app is
/// running, and walking a dozen directories on every keystroke would be felt.
///
/// Directories that cannot be read are skipped rather than reported. A `PATH`
/// with a stale entry in it is completely ordinary and not a thing to put an
/// error on screen about.
#[tauri::command]
pub fn shell_commands() -> Vec<String> {
    static ONCE: std::sync::OnceLock<Vec<String>> = std::sync::OnceLock::new();
    ONCE.get_or_init(|| {
        let mut out: Vec<String> = Vec::new();
        let path = match std::env::var_os("PATH") {
            Some(p) => p,
            None => return out,
        };
        for dir in std::env::split_paths(&path) {
            let entries = match std::fs::read_dir(&dir) {
                Ok(e) => e,
                Err(_) => continue,
            };
            for entry in entries.flatten() {
                // A directory on PATH is not a program, and a name that is not
                // valid UTF-8 is not one anybody is going to type.
                if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                    continue;
                }
                if let Some(name) = entry.file_name().to_str() {
                    if !name.is_empty() {
                        out.push(name.to_string());
                    }
                }
            }
        }
        out.sort_unstable();
        out.dedup();
        out
    })
    .clone()
}

/// Names in the directory a half-typed path points at.
///
/// **Names only.** Nothing here opens a file or reports its size; it is the
/// same information the shell's Tab already gives, driven by the same
/// keystrokes, and it is what a completion list needs and no more.
///
/// The fragment is a path as typed, so it may be `src/Ap`, `../`, `~/Doc` or
/// `/usr/bi`. It is split at the last separator: everything before names the
/// directory to look in, everything after is the prefix to match. A relative
/// directory resolves against the terminal's own working directory rather than
/// the project, because that is where the shell actually is.
///
/// Directories come back with a trailing slash, which is both the hint that it
/// is one and the character somebody would type next.
#[tauri::command]
pub fn complete_path(cwd: String, fragment: String, limit: Option<usize>) -> Vec<String> {
    let cap = limit.unwrap_or(50).clamp(1, 200);
    let frag = fragment.replace('\\', "");

    let (dir_part, prefix) = match frag.rfind('/') {
        Some(at) => (&frag[..=at], &frag[at + 1..]),
        None => ("", frag.as_str()),
    };

    let mut dir = std::path::PathBuf::new();
    if let Some(rest) = dir_part.strip_prefix("~/") {
        match dirs_home() {
            Some(h) => { dir.push(h); dir.push(rest); }
            None => return Vec::new(),
        }
    } else if dir_part == "~" || dir_part == "~/" {
        match dirs_home() {
            Some(h) => dir.push(h),
            None => return Vec::new(),
        }
    } else if dir_part.starts_with('/') {
        dir.push(dir_part);
    } else {
        dir.push(&cwd);
        if !dir_part.is_empty() {
            dir.push(dir_part);
        }
    }

    let entries = match std::fs::read_dir(&dir) {
        Ok(e) => e,
        Err(_) => return Vec::new(),
    };
    let low = prefix.to_lowercase();
    let mut out: Vec<String> = Vec::new();
    for entry in entries.flatten() {
        let name = match entry.file_name().to_str() {
            Some(n) => n.to_string(),
            None => continue,
        };
        // A dot file is offered only once somebody has typed the dot, which is
        // what every shell does and is why a completion list is not mostly
        // `.DS_Store` and `.git`.
        if name.starts_with('.') && !prefix.starts_with('.') {
            continue;
        }
        if !prefix.is_empty() && !name.to_lowercase().starts_with(&low) {
            continue;
        }
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        // Rebuilt with the directory part, so choosing it replaces the whole
        // fragment and the path stays whole.
        out.push(format!("{dir_part}{name}{}", if is_dir { "/" } else { "" }));
        if out.len() >= cap * 2 {
            break;
        }
    }
    out.sort_unstable();
    out.truncate(cap);
    out
}

/// The home directory, without a dependency for one environment variable.
fn dirs_home() -> Option<std::path::PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(std::path::PathBuf::from)
}

#[tauri::command]
pub fn pty_write(state: tauri::State<'_, Terminals>, id: u32, data: String) -> Result<(), String> {
    let mut map = state
        .map
        .lock()
        .map_err(|_| "terminal state is unusable".to_string())?;
    let s = map
        .get_mut(&id)
        .ok_or_else(|| "that terminal has closed".to_string())?;
    s.writer
        .write_all(data.as_bytes())
        .and_then(|_| s.writer.flush())
        .map_err(|e| format!("could not write to the terminal: {e}"))
}

#[tauri::command]
pub fn pty_resize(
    state: tauri::State<'_, Terminals>,
    id: u32,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let map = state
        .map
        .lock()
        .map_err(|_| "terminal state is unusable".to_string())?;
    // A resize on a terminal that has already exited is not an error worth
    // showing anyone — the pane is about to disappear.
    let Some(s) = map.get(&id) else { return Ok(()) };
    s.master
        .resize(PtySize {
            rows: rows.max(1),
            cols: cols.max(1),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("could not resize the terminal: {e}"))
}

#[tauri::command]
pub fn pty_close(state: tauri::State<'_, Terminals>, id: u32) -> Result<(), String> {
    let session = state
        .map
        .lock()
        .map_err(|_| "terminal state is unusable".to_string())?
        .remove(&id);
    if let Some(mut s) = session {
        let _ = s.killer.kill();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    /// Names only, from the directory the fragment points at. The cases that
    /// matter are the ones a shell gets right and a naive split does not.
    #[test]
    fn completing_a_path_offers_the_right_names() {
        let tmp = std::env::temp_dir().join(format!("vylo_comp_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(tmp.join("src")).unwrap();
        std::fs::write(tmp.join("App.js"), "x").unwrap();
        std::fs::write(tmp.join("app.json"), "x").unwrap();
        std::fs::write(tmp.join("index.html"), "x").unwrap();
        std::fs::write(tmp.join(".hidden"), "x").unwrap();
        std::fs::write(tmp.join("src/main.rs"), "x").unwrap();
        let cwd = tmp.to_string_lossy().to_string();

        let all = super::complete_path(cwd.clone(), String::new(), None);
        assert!(all.contains(&"App.js".to_string()), "{all:?}");
        // A directory is marked, which is both the hint and the next character.
        assert!(all.contains(&"src/".to_string()), "{all:?}");
        // Otherwise every list starts with .DS_Store and .git.
        assert!(!all.iter().any(|x| x.starts_with('.')), "no dot files unasked: {all:?}");

        // Typing the dot asks for them.
        let dots = super::complete_path(cwd.clone(), ".".into(), None);
        assert!(dots.contains(&".hidden".to_string()), "{dots:?}");

        // Case-insensitive, as a shell's completion is on a Mac.
        let apps = super::complete_path(cwd.clone(), "app".into(), None);
        assert!(apps.contains(&"App.js".to_string()) && apps.contains(&"app.json".to_string()), "{apps:?}");

        // A fragment with a directory in it keeps the directory, so choosing it
        // replaces the whole fragment and the path stays whole.
        let inner = super::complete_path(cwd.clone(), "src/ma".into(), None);
        assert_eq!(inner, vec!["src/main.rs".to_string()], "{inner:?}");

        // A directory that is not there is an empty list, not an error.
        assert!(super::complete_path(cwd.clone(), "nope/x".into(), None).is_empty());
        assert!(super::complete_path("/nowhere/at/all".into(), String::new(), None).is_empty());

        // The cap is honoured.
        assert!(super::complete_path(cwd.clone(), String::new(), Some(2)).len() <= 2);

        let _ = std::fs::remove_dir_all(&tmp);
    }

    /// An absolute fragment ignores the working directory entirely.
    #[test]
    fn an_absolute_path_is_not_resolved_against_the_terminal() {
        let tmp = std::env::temp_dir().join(format!("vylo_abs_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).unwrap();
        std::fs::write(tmp.join("marker.txt"), "x").unwrap();

        let frag = format!("{}/mark", tmp.to_string_lossy());
        let got = super::complete_path("/completely/elsewhere".into(), frag, None);
        assert_eq!(got.len(), 1, "{got:?}");
        assert!(got[0].ends_with("marker.txt"), "{got:?}");

        let _ = std::fs::remove_dir_all(&tmp);
    }

    /// The list is the shell's own: whatever is on PATH, by name.
    #[test]
    fn the_programs_on_path_are_listed_by_name() {
        let names = super::shell_commands();
        assert!(!names.is_empty(), "PATH produced nothing");
        // Sorted and deduplicated, so ranking them is not also sorting them.
        assert!(names.windows(2).all(|w| w[0] < w[1]), "sorted and unique");
        // Names, not paths. A path here would be typed into somebody's shell.
        assert!(!names.iter().any(|n| n.contains('/')), "names only");
        // Cached: the second call is the same list.
        assert_eq!(names, super::shell_commands());
    }

    /// The offsets this reads are from a header nobody here controls, so the
    /// one thing worth pinning is that it answers correctly for a process
    /// whose directory is already known: this one.
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    #[test]
    fn the_working_directory_of_this_process_is_the_one_it_is_in() {
        let me = std::process::id();
        let got = super::cwd_of(me).expect("this process has a working directory");
        let want = std::env::current_dir().unwrap().canonicalize().unwrap();
        let got_real = std::path::Path::new(&got)
            .canonicalize()
            .unwrap_or_else(|_| std::path::PathBuf::from(&got));
        assert_eq!(got_real, want, "read {got:?}");
        assert!(got.starts_with('/'), "an absolute path, not a fragment: {got:?}");
    }

    /// A pid nothing is running under must be nothing, not a stale buffer read
    /// as a path.
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    #[test]
    fn a_pid_that_is_not_running_has_no_working_directory() {
        // Nothing legitimately runs here: 0 is the kernel and this is far past
        // any real pid on a fresh boot.
        assert!(super::cwd_of(0).is_none());
        assert!(super::cwd_of(4_000_000_000).is_none());
    }

    use super::take_utf8;
    use portable_pty::{native_pty_system, CommandBuilder, PtySize};
    use std::io::Read;

    /// The plumbing, end to end: open a pty, run something in it, read what it
    /// printed back through the same assembly path the UI uses.
    ///
    /// It runs a fixed command rather than the login shell on purpose. The real
    /// terminal uses the user's shell so their PATH is right, but a test that
    /// did the same would depend on whatever is in their rc file and would fail
    /// on somebody's machine for a reason that has nothing to do with this code.
    ///
    /// It also waits for the *string* rather than for EOF, and never joins the
    /// reader. The first version read to EOF and wedged Windows CI for hours:
    /// ConPTY does not close the master when the child exits, so the read
    /// blocks for ever. Same lesson as `run_command`'s pipe draining — never
    /// wait on a handle a dead process can hold open.
    ///
    /// And it answers the cursor-position query. ConPTY opens by asking the
    /// terminal where the cursor is and will not run anything until something
    /// replies; xterm.js does that for us in the app, so a headless test has to
    /// do it by hand. Without it Windows CI saw the escape sequences and
    /// nothing else.
    #[test]
    fn a_command_run_in_a_pty_comes_back_through_the_reader() {
        let pair = native_pty_system()
            .openpty(PtySize { rows: 24, cols: 80, pixel_width: 0, pixel_height: 0 })
            .expect("openpty");

        #[cfg(windows)]
        let mut cmd = {
            let mut c = CommandBuilder::new("cmd.exe");
            c.args(["/C", "echo vylo-pty-ok"]);
            c
        };
        #[cfg(not(windows))]
        let mut cmd = {
            let mut c = CommandBuilder::new("/bin/sh");
            c.args(["-c", "printf 'vylo-pty-ok\\n'"]);
            c
        };
        cmd.env("TERM", "xterm-256color");

        let mut child = pair.slave.spawn_command(cmd).expect("spawn");
        drop(pair.slave);
        let mut reader = pair.master.try_clone_reader().expect("reader");

        let mut writer = pair.master.take_writer().expect("writer");
        let seen = std::sync::Arc::new(std::sync::Mutex::new(String::new()));
        let sink = std::sync::Arc::clone(&seen);
        std::thread::spawn(move || {
            use std::io::Write as _;
            let mut carry = Vec::new();
            let mut chunk = [0u8; 1024];
            let mut answered = false;
            while let Ok(n) = reader.read(&mut chunk) {
                if n == 0 {
                    break;
                }
                carry.extend_from_slice(&chunk[..n]);
                let text = take_utf8(&mut carry);
                if let Ok(mut g) = sink.lock() {
                    g.push_str(&text);
                }
                // Device Status Report: "where is the cursor?". Answer "row 1,
                // column 1" so ConPTY stops waiting and lets the shell run.
                if !answered && text.contains("\u{1b}[6n") {
                    answered = true;
                    let _ = writer.write_all(b"\x1b[1;1R");
                    let _ = writer.flush();
                }
            }
        });

        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(20);
        let mut found = false;
        while std::time::Instant::now() < deadline {
            if seen.lock().map(|g| g.contains("vylo-pty-ok")).unwrap_or(false) {
                found = true;
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }

        let _ = child.kill();
        let _ = child.wait();
        drop(pair.master);   // unblocks the reader on ConPTY

        assert!(
            found,
            "pty produced: {:?}",
            seen.lock().map(|g| g.clone()),
        );
    }

    #[test]
    fn holds_back_a_character_split_across_reads() {
        // "é" is two bytes; arrive with the first byte at the end of a chunk.
        let mut buf = b"ab\xc3".to_vec();
        assert_eq!(take_utf8(&mut buf), "ab");
        assert_eq!(buf, b"\xc3");
        buf.extend_from_slice(b"\xa9cd");
        assert_eq!(take_utf8(&mut buf), "\u{e9}cd");
        assert!(buf.is_empty());
    }

    #[test]
    fn steps_over_bytes_that_can_never_be_valid() {
        // A lone 0xFF would otherwise sit at the head of the buffer forever and
        // stall every later read.
        let mut buf = b"a\xffb".to_vec();
        assert_eq!(take_utf8(&mut buf), "a\u{fffd}b");
        assert!(buf.is_empty());
    }
}
