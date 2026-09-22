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
    /// The last foreground process looked up, and what it turned out to be.
    ///
    /// Asking the terminal which process group is in front of it is a single
    /// cheap syscall and can be done on every poll. Turning that pid into a
    /// *name* is not: on macOS it means a `sysctl` into a buffer the size of
    /// `ARG_MAX`. A pid's name never changes, so it is looked up once per
    /// program run rather than once per poll.
    fg: Option<(u32, String)>,
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
                fg: None,
            },
        );
    Ok(id)
}

/// What is running in this terminal right now, by name.
///
/// The terminal's *foreground process group* — which is the shell itself when
/// it is sitting at its prompt, and the program when one is running. It is the
/// same question every terminal emulator asks in order to title its tabs, and
/// it is asked of the operating system rather than of the shell, so nothing
/// has to be configured and no escape sequence has to arrive. `pty_cwd` above
/// makes the same argument at more length.
///
/// Empty for everything that can ordinarily go wrong, and on Windows, which
/// has no foreground process group to ask about.
#[tauri::command]
pub fn pty_running(state: tauri::State<'_, Terminals>, id: u32) -> String {
    let mut map = match state.map.lock() {
        Ok(m) => m,
        Err(_) => return String::new(),
    };
    let session = match map.get_mut(&id) {
        Some(s) => s,
        None => return String::new(),
    };
    let pid = match fg_pid(session) {
        Some(p) => p,
        None => return String::new(),
    };
    if let Some((was, name)) = &session.fg {
        if *was == pid {
            return name.clone();
        }
    }
    let name = name_of(pid).unwrap_or_default();
    session.fg = Some((pid, name.clone()));
    name
}

/// The pid of whatever process group the terminal has in front of it.
#[cfg(unix)]
fn fg_pid(session: &Session) -> Option<u32> {
    match session.master.process_group_leader() {
        Some(p) if p > 0 => Some(p as u32),
        _ => None,
    }
}

/// Not supported here: Windows consoles have no foreground process group.
#[cfg(not(unix))]
fn fg_pid(_session: &Session) -> Option<u32> {
    None
}

/// The program out of an `argv[0]`.
///
/// Two conventions get in the way of "take the last path segment":
///
///   `-zsh`               a login shell. The leading hyphen is how a shell is
///                        told it is one, and it is not part of the name.
///   `claude bg-pty-host` a whole phrase, which some programs put in `argv[0]`
///                        to label themselves in `ps`. Claude's background
///                        helpers do exactly this.
///
/// The segment is taken *before* the first word, not after: a path can contain
/// a space (`/Applications/My App/bin/tool`) and splitting first would answer
/// `/Applications/My`.
fn leaf(argv0: &str) -> String {
    let base = argv0.rsplit(['/', '\\']).next().unwrap_or(argv0);
    let word = base.split_whitespace().next().unwrap_or("");
    word.strip_prefix('-').unwrap_or(word).to_string()
}

/// `argv[0]` out of a `KERN_PROCARGS2` buffer.
///
/// The layout, which is stable and is the reason this is worth doing at all:
///
/// ```text
///   [0..4]   argc, a native-endian int
///   [4..]    the executable path, NUL-terminated
///            then NUL padding, to align what follows
///            then argv[0], NUL-terminated
/// ```
///
/// The executable path sitting right there is the tempting answer and is the
/// wrong one. It is the *resolved* path, and Claude Code installs itself as
/// `~/.local/bin/claude` symlinked to `~/.local/share/claude/versions/2.1.280`
/// — so the resolved path's last segment is `2.1.280`, and a row that should
/// read "claude" reads as a version number. `p_comm`, which `proc_name`
/// returns, has the same problem for the same reason. `argv[0]` is what the
/// shell actually ran, which is what somebody typed, which is the answer.
///
/// Separate from the syscall so it can be tested: the parsing is the part
/// with edges, and the `sysctl` around it is three lines.
#[cfg(target_os = "macos")]
fn argv0_from(buf: &[u8]) -> Option<String> {
    if buf.len() < 4 {
        return None;
    }
    // Zero means there are no arguments, and the bytes after the path are the
    // environment rather than an `argv[0]` to read.
    let argc = i32::from_ne_bytes([buf[0], buf[1], buf[2], buf[3]]);
    if argc <= 0 {
        return None;
    }
    let rest = &buf[4..];
    let path_end = rest.iter().position(|&b| b == 0)?;
    let mut at = path_end;
    while at < rest.len() && rest[at] == 0 {
        at += 1;
    }
    if at >= rest.len() {
        return None;
    }
    let end = rest[at..]
        .iter()
        .position(|&b| b == 0)
        .map(|n| at + n)
        .unwrap_or(rest.len());
    let out = String::from_utf8_lossy(&rest[at..end]).into_owned();
    if out.is_empty() { None } else { Some(out) }
}

/// What a process is called, by pid.
#[cfg(target_os = "macos")]
fn name_of(pid: u32) -> Option<String> {
    if let Some(argv0) = argv0_of(pid) {
        let name = leaf(&argv0);
        if !name.is_empty() {
            return Some(name);
        }
    }
    // The resolved path, which is second choice for the reason `argv0_from`
    // gives — but a real answer for everything that is not installed behind a
    // versioned symlink.
    let mut buf = vec![0u8; 4 * 1024];
    // SAFETY: the buffer is `buf.len()` bytes and that is what is passed as
    // the size. The call writes at most that many and returns how many.
    let n = unsafe {
        libc::proc_pidpath(
            pid as libc::c_int,
            buf.as_mut_ptr() as *mut libc::c_void,
            buf.len() as u32,
        )
    };
    if n <= 0 {
        return None;
    }
    let path = String::from_utf8_lossy(&buf[..n as usize]).into_owned();
    let name = leaf(&path);
    if name.is_empty() { None } else { Some(name) }
}

/// The raw `KERN_PROCARGS2` bytes for a process.
#[cfg(target_os = "macos")]
fn argv0_of(pid: u32) -> Option<String> {
    use std::sync::OnceLock;
    // Asked once. It is a constant of the running kernel, and the buffer has
    // to be this big or the call refuses rather than truncating.
    static ARGMAX: OnceLock<usize> = OnceLock::new();
    let max = *ARGMAX.get_or_init(|| {
        const KERN_ARGMAX: libc::c_int = 8;
        let mut mib = [libc::CTL_KERN, KERN_ARGMAX];
        let mut out: libc::c_int = 0;
        let mut len = std::mem::size_of::<libc::c_int>() as libc::size_t;
        // SAFETY: `mib` is the two-element name this sysctl takes, and `out`
        // and `len` describe one `c_int`, which is what it writes.
        let r = unsafe {
            libc::sysctl(
                mib.as_mut_ptr(),
                2,
                &mut out as *mut _ as *mut libc::c_void,
                &mut len,
                std::ptr::null_mut(),
                0,
            )
        };
        if r == 0 && out > 0 { out as usize } else { 256 * 1024 }
    });

    const KERN_PROCARGS2: libc::c_int = 49;
    let mut mib = [libc::CTL_KERN, KERN_PROCARGS2, pid as libc::c_int];
    let mut buf = vec![0u8; max];
    let mut len = buf.len() as libc::size_t;
    // SAFETY: `mib` is the three-element name this sysctl takes, and `buf`
    // and `len` describe the same allocation.
    let r = unsafe {
        libc::sysctl(
            mib.as_mut_ptr(),
            3,
            buf.as_mut_ptr() as *mut libc::c_void,
            &mut len,
            std::ptr::null_mut(),
            0,
        )
    };
    if r != 0 {
        return None;
    }
    buf.truncate(len);
    argv0_from(&buf)
}

/// What a process is called, by pid.
#[cfg(target_os = "linux")]
fn name_of(pid: u32) -> Option<String> {
    if let Ok(raw) = std::fs::read(format!("/proc/{pid}/cmdline")) {
        let end = raw.iter().position(|&b| b == 0).unwrap_or(raw.len());
        let name = leaf(&String::from_utf8_lossy(&raw[..end]));
        if !name.is_empty() {
            return Some(name);
        }
    }
    let comm = std::fs::read_to_string(format!("/proc/{pid}/comm")).ok()?;
    let name = leaf(comm.trim());
    if name.is_empty() { None } else { Some(name) }
}

/// Not supported here.
#[cfg(not(any(target_os = "macos", target_os = "linux")))]
fn name_of(_pid: u32) -> Option<String> {
    None
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
///
/// `dirs_only` is for the handful of commands that cannot take a file at all —
/// `cd`, `pushd`, `rmdir`. Offering `cd README.md` is not a near miss that
/// saves typing; it is a completion list putting an error under the cursor,
/// and the caller decides because the caller is the one reading the line.
#[tauri::command]
pub fn complete_path(
    cwd: String,
    fragment: String,
    limit: Option<usize>,
    dirs_only: Option<bool>,
) -> Vec<String> {
    let dirs_only = dirs_only.unwrap_or(false);
    let cap = limit.unwrap_or(50).clamp(1, 200);
    // A backslash is a shell escape on Unix (`My\ Documents`) and a path
    // separator on Windows (`C:\Users`). Stripping it on Windows turned
    // `C:\Users\me` into `C:Usersme`, which is no path at all — the one Rust
    // test that CI runs on Windows and nowhere else caught it.
    #[cfg(not(windows))]
    let frag = fragment.replace('\\', "");
    #[cfg(windows)]
    let frag = fragment.replace('\\', "/");

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
    } else if dir_part.starts_with('/') || std::path::Path::new(dir_part).is_absolute() {
        // `C:/…` is absolute on Windows without a leading slash.
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
        // A symlink reports as a symlink rather than as what it points at, and
        // a link to a directory is a directory as far as `cd` is concerned —
        // so the metadata call that follows the link decides, and only when it
        // has to, because it is a second syscall per entry.
        let usable = !dirs_only
            || is_dir
            || std::fs::metadata(entry.path()).map(|m| m.is_dir()).unwrap_or(false);
        if !usable {
            continue;
        }
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

/// Lines that look like they carry a credential typed inline.
///
/// A coarse filter and described as one: it is pattern matching over other
/// people's command lines, so it will miss things. What it cannot do is make
/// anything worse — a line it misses is offered exactly as the shell's own
/// Up arrow would offer it, and a line it catches is one fewer password on
/// screen for somebody who only typed four letters. That asymmetry is the
/// whole argument for having it.
fn looks_secret(line: &str) -> bool {
    let low = line.to_lowercase();
    const MARKERS: [&str; 12] = [
        "password=", "passwd=", "secret=", "token=", "api_key=", "apikey=",
        "access_key", "authorization:", "bearer ", "private_key", "--password",
        "sk-",
    ];
    if MARKERS.iter().any(|m| low.contains(m)) {
        return true;
    }
    // `mysql -pHunter2`: the password is attached, because that is the only
    // way that flag takes one. A bare `-p` is a flag — `ls -p`, `docker run -p
    // 8080:80` — and is left alone.
    let words: Vec<&str> = low.split_whitespace().collect();
    if words.iter().any(|w| w.starts_with("-p") && w.len() > 2 && !w.starts_with("-p-")) {
        return true;
    }
    // `curl -u alice:s3cret`, attached or not. A following word with a colon
    // in it is a user:password pair unless it is plainly a URL.
    words.windows(2).any(|pair| {
        let (flag, next) = (pair[0], pair[1]);
        (flag == "-u" || flag == "--user") && next.contains(':') && !next.contains("//")
    }) || words.iter().any(|w| w.starts_with("-u") && w.len() > 2 && w.contains(':'))
}

/// One history file's lines, whatever format it is in.
fn parse_history(name: &str, text: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    if name.contains("fish") {
        // `- cmd: git status`, one entry per record, `when:` lines ignored.
        for line in text.lines() {
            if let Some(rest) = line.strip_prefix("- cmd: ") {
                out.push(rest.to_string());
            }
        }
        return out;
    }
    // zsh and bash. zsh's extended format prefixes `: <started>:<elapsed>;`,
    // and both continue a line that ends in a backslash — a multi-line command
    // is one command, and half of one is not worth offering back.
    let mut pending = String::new();
    for raw in text.lines() {
        // A bash file with HISTTIMEFORMAT set carries `#1699999999` lines.
        if pending.is_empty() && raw.starts_with('#') {
            continue;
        }
        let mut line = raw;
        if pending.is_empty() {
            if let Some(rest) = line.strip_prefix(": ") {
                if let Some(at) = rest.find(';') {
                    line = &rest[at + 1..];
                }
            }
        }
        if let Some(head) = line.strip_suffix('\\') {
            pending.push_str(head);
            pending.push('\n');
            continue;
        }
        if pending.is_empty() {
            out.push(line.to_string());
        } else {
            pending.push_str(line);
            out.push(std::mem::take(&mut pending));
        }
    }
    if !pending.is_empty() {
        out.push(pending);
    }
    out
}

/// Where this person's shell keeps its history.
fn history_files() -> Vec<std::path::PathBuf> {
    let mut out: Vec<std::path::PathBuf> = Vec::new();
    // `HISTFILE` is a shell variable rather than an exported one, so it is
    // usually absent here — but when somebody has exported it, they have said
    // exactly where to look and that beats guessing.
    if let Some(f) = std::env::var_os("HISTFILE") {
        out.push(std::path::PathBuf::from(f));
    }
    let home = match dirs_home() {
        Some(h) => h,
        None => return out,
    };
    if let Some(z) = std::env::var_os("ZDOTDIR") {
        out.push(std::path::PathBuf::from(z).join(".zsh_history"));
    }
    out.push(home.join(".zsh_history"));
    out.push(home.join(".bash_history"));
    out.push(home.join(".local/share/fish/fish_history"));
    out
}

/// Lines this person has already run, from their shell's own history file.
///
/// ## Why read it at all
///
/// The completion list is only as good as what it knows you have run, and
/// until this it knew only what you had typed into *this* pane since it
/// opened. So a terminal opened a minute ago could not finish
/// `claude --dang` into the line you have run fifty times, which is precisely
/// the line worth finishing — the useful suggestion was always one session too
/// late.
///
/// ## What this does and does not do
///
/// It **reads**. `~/.zsh_history` belongs to the shell, which rewrites it on
/// exit, and an app editing it would be an app corrupting somebody's history
/// to save them four keystrokes. Nothing here writes, and nothing here leaves
/// the machine: the lines go into a list on screen, in the window of the
/// person whose history it is.
///
/// Lines that look like they carry a credential are dropped — see
/// `looks_secret`, and note what it claims, which is not much.
#[tauri::command]
pub fn shell_history(limit: Option<usize>) -> Vec<String> {
    let cap = limit.unwrap_or(500).clamp(1, 5000);
    let mut lines: Vec<String> = Vec::new();
    for file in history_files() {
        let name = file.to_string_lossy().to_string();
        // Bytes, then lossy: zsh metafies anything non-ASCII, so a history
        // with one accented path in it is not valid UTF-8 and `read_to_string`
        // would throw the whole file away over a character nobody typed.
        let bytes = match std::fs::read(&file) {
            Ok(b) => b,
            Err(_) => continue,
        };
        lines.extend(parse_history(&name, &String::from_utf8_lossy(&bytes)));
        // The first file that had anything in it is this person's shell.
        if !lines.is_empty() {
            break;
        }
    }

    trim_history(&lines, cap)
}

/// The usable tail of a history file: newest last, each line once.
///
/// Walked backwards and reversed at the end rather than filtered forwards,
/// and that is the whole point of the function: the cap has to keep the
/// *newest* lines, and a forward pass that stops at the cap keeps the oldest —
/// a history of what somebody was doing when they set the machine up.
fn trim_history(lines: &[String], cap: usize) -> Vec<String> {
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut out: Vec<String> = Vec::new();
    for line in lines.iter().rev() {
        let one = line.trim();
        // A thousand characters is a pasted file, not a command anybody wants
        // offered back a letter at a time.
        if one.is_empty() || one.len() > 1000 || looks_secret(one) {
            continue;
        }
        if seen.insert(one.to_string()) {
            out.push(one.to_string());
        }
        if out.len() >= cap {
            break;
        }
    }
    out.reverse();
    out
}

#[cfg(test)]
mod tests {
    /// What `argv[0]` reduces to, which is the row's whole answer to "what is
    /// running in there".
    ///
    /// The version-number case is the one worth a test: Claude Code installs
    /// as `~/.local/bin/claude` symlinked to `.../versions/2.1.280`, so
    /// anything that reads the *resolved* path — `proc_pidpath`, `p_comm`,
    /// `proc_name` — answers `2.1.280`. This machine was checked before the
    /// code was written and `ps -o ucomm=` says exactly that.
    #[test]
    fn leaf_takes_the_program_out_of_argv0() {
        assert_eq!(super::leaf("/Users/x/.local/bin/claude"), "claude");
        assert_eq!(super::leaf("claude"), "claude");
        // A login shell is told it is one by a hyphen on argv[0]. It is not
        // part of the name, and a rail full of `-zsh` would be a rail full of
        // a convention nobody outside a shell has heard of.
        assert_eq!(super::leaf("-zsh"), "zsh");
        assert_eq!(super::leaf("/bin/-bash"), "bash");
        // Some programs put a whole phrase in argv[0] to label themselves in
        // `ps`; Claude's background helpers arrive as exactly this.
        assert_eq!(super::leaf("claude bg-pty-host"), "claude");
        // The segment is taken before the first word and not after, because a
        // path can contain a space and splitting first answers
        // `/Applications/My`.
        assert_eq!(super::leaf("/Applications/My App/bin/tool"), "tool");
        assert_eq!(super::leaf("C:\\tools\\node.exe"), "node.exe");
        assert_eq!(super::leaf(""), "");
        assert_eq!(super::leaf("   "), "");
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn argv0_is_read_out_of_a_procargs2_buffer() {
        // argc, then the resolved executable path, then NUL padding, then
        // argv[0]. The padding is the part that makes this worth parsing
        // rather than splitting.
        fn buf(argc: i32, path: &str, pad: usize, args: &[&str]) -> Vec<u8> {
            let mut v = argc.to_ne_bytes().to_vec();
            v.extend_from_slice(path.as_bytes());
            v.push(0);
            v.extend(std::iter::repeat(0u8).take(pad));
            for a in args {
                v.extend_from_slice(a.as_bytes());
                v.push(0);
            }
            v
        }
        let real = buf(
            1,
            "/Users/x/.local/share/claude/versions/2.1.280",
            7,
            &["/Users/x/.local/bin/claude"],
        );
        assert_eq!(
            super::argv0_from(&real).as_deref(),
            Some("/Users/x/.local/bin/claude")
        );
        // And the whole point: the path sitting in front of it is the wrong
        // answer, which is why it is stepped over rather than read.
        assert_eq!(super::leaf(&super::argv0_from(&real).unwrap()), "claude");

        assert_eq!(
            super::argv0_from(&buf(2, "/bin/zsh", 0, &["-zsh", "-i"])).as_deref(),
            Some("-zsh")
        );
        // No arguments means the bytes after the path are the environment.
        assert!(super::argv0_from(&buf(0, "/bin/zsh", 3, &["PATH=/usr/bin"])).is_none());
        assert!(super::argv0_from(&[]).is_none());
        assert!(super::argv0_from(&[1, 0, 0]).is_none());
        // A path with nothing after it at all.
        assert!(super::argv0_from(&buf(1, "/bin/zsh", 0, &[])).is_none());
    }

    /// The shell's own history, in the three formats it comes in.
    ///
    /// Parsed rather than read line for line, because zsh's extended format
    /// puts a timestamp in front of every command and bash puts one on its own
    /// line — offering `: 1699999999:0;git status` back to somebody would be
    /// the completer suggesting a string no shell has ever accepted.
    #[test]
    fn shell_history_is_parsed_per_format() {
        // zsh, extended, with a continued line and a plain one mixed in.
        let zsh = ": 1699999990:0;git status\n\
                   : 1699999991:0;claude --dangerously-skip-permissions\n\
                   plain-line\n\
                   : 1699999992:0;for f in *; do\\\n\
                   echo $f; done\n";
        let got = super::parse_history("/home/me/.zsh_history", zsh);
        assert!(got.contains(&"git status".to_string()), "{got:?}");
        assert!(
            got.contains(&"claude --dangerously-skip-permissions".to_string()),
            "the line this whole feature is for: {got:?}"
        );
        assert!(got.contains(&"plain-line".to_string()), "old-format lines too: {got:?}");
        assert!(
            got.iter().any(|x| x.contains("for f in *") && x.contains("echo $f")),
            "a continued line is one command: {got:?}"
        );
        assert!(!got.iter().any(|x| x.starts_with(": 1699")), "no timestamps: {got:?}");

        // bash, with HISTTIMEFORMAT set, which writes its own comment lines.
        let bash = "#1699999990\nls -la\n#1699999991\nnpm test\n";
        let got = super::parse_history("/home/me/.bash_history", bash);
        assert_eq!(got, vec!["ls -la".to_string(), "npm test".to_string()], "{got:?}");

        // fish keeps a record per command and a `when:` beside it.
        let fish = "- cmd: git push\n  when: 1699999990\n- cmd: cargo test\n  when: 1699999991\n";
        let got = super::parse_history("/home/me/.local/share/fish/fish_history", fish);
        assert_eq!(got, vec!["git push".to_string(), "cargo test".to_string()], "{got:?}");
    }

    /// Newest last, each line once, and the cap keeps the newest.
    #[test]
    fn history_is_trimmed_newest_last() {
        let lines: Vec<String> = ["old", "git status", "npm test", "git status", "  ", "cargo test"]
            .iter().map(|x| x.to_string()).collect();
        let got = super::trim_history(&lines, 100);
        assert_eq!(
            got,
            vec!["old".to_string(), "npm test".to_string(),
                 "git status".to_string(), "cargo test".to_string()],
            "a repeat moves to where it was last run, and blanks are not history: {got:?}"
        );

        // The cap keeps the newest. A forward pass would have kept `a`.
        let many: Vec<String> = (0..50).map(|i| format!("cmd{i}")).collect();
        let got = super::trim_history(&many, 3);
        assert_eq!(got, vec!["cmd47".to_string(), "cmd48".to_string(), "cmd49".to_string()], "{got:?}");

        // And the filter applies before the cap, or three secrets would be a
        // completion list with nothing in it.
        let mixed: Vec<String> = ["ls", "export TOKEN=abc", "npm test", "PASSWORD=x id"]
            .iter().map(|x| x.to_string()).collect();
        let got = super::trim_history(&mixed, 100);
        assert_eq!(got, vec!["ls".to_string(), "npm test".to_string()], "{got:?}");
    }

    /// What is dropped before anything reaches the screen.
    ///
    /// The filter claims very little — see `looks_secret` — but what it claims
    /// it has to do, because these are the shapes that actually turn up in a
    /// history file and each one is a password rendered under somebody's
    /// cursor for four keystrokes of typing.
    #[test]
    fn credential_shaped_history_is_left_out() {
        for line in [
            "export API_KEY=sk-abcdef",
            "PASSWORD=hunter2 ./deploy.sh",
            "mysql -u root -pHunter2",
            "curl -H 'Authorization: Bearer abc123' https://x",
            "curl -u alice:s3cret https://x",
            "aws --secret=abc123 s3 ls",
        ] {
            assert!(super::looks_secret(line), "should be dropped: {line}");
        }
        for line in [
            "git commit -m 'fix the token parser'",
            "npm test",
            "claude --dangerously-skip-permissions",
            "ls -p",
            "docker run -p 8080:80 nginx",
            "grep -u",
        ] {
            assert!(!super::looks_secret(line), "should be kept: {line}");
        }
    }

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

        let all = super::complete_path(cwd.clone(), String::new(), None, None);
        assert!(all.contains(&"App.js".to_string()), "{all:?}");
        // A directory is marked, which is both the hint and the next character.
        assert!(all.contains(&"src/".to_string()), "{all:?}");
        // Otherwise every list starts with .DS_Store and .git.
        assert!(!all.iter().any(|x| x.starts_with('.')), "no dot files unasked: {all:?}");

        // Typing the dot asks for them.
        let dots = super::complete_path(cwd.clone(), ".".into(), None, None);
        assert!(dots.contains(&".hidden".to_string()), "{dots:?}");

        // `cd README.md` is not a near miss worth completing — it is an error
        // the shell will refuse, so the list must not put it under the cursor.
        let only_dirs = super::complete_path(cwd.clone(), String::new(), None, Some(true));
        assert!(only_dirs.contains(&"src/".to_string()), "{only_dirs:?}");
        assert!(
            !only_dirs.iter().any(|x| !x.ends_with('/')),
            "cd offers directories and nothing else: {only_dirs:?}"
        );
        // And the same prefix rules still apply inside that narrowing.
        let nested = super::complete_path(cwd.clone(), "sr".into(), None, Some(true));
        assert_eq!(nested, vec!["src/".to_string()], "{nested:?}");
        // A prefix that only matches files comes back empty rather than
        // falling back to offering them anyway.
        assert!(
            super::complete_path(cwd.clone(), "App".into(), None, Some(true)).is_empty(),
            "no files when only directories will do"
        );

        // Case-insensitive, as a shell's completion is on a Mac.
        let apps = super::complete_path(cwd.clone(), "app".into(), None, None);
        assert!(apps.contains(&"App.js".to_string()) && apps.contains(&"app.json".to_string()), "{apps:?}");

        // A fragment with a directory in it keeps the directory, so choosing it
        // replaces the whole fragment and the path stays whole.
        let inner = super::complete_path(cwd.clone(), "src/ma".into(), None, None);
        assert_eq!(inner, vec!["src/main.rs".to_string()], "{inner:?}");

        // A directory that is not there is an empty list, not an error.
        assert!(super::complete_path(cwd.clone(), "nope/x".into(), None, None).is_empty());
        assert!(super::complete_path("/nowhere/at/all".into(), String::new(), None, None).is_empty());

        // The cap is honoured.
        assert!(super::complete_path(cwd.clone(), String::new(), Some(2), None).len() <= 2);

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
        let got = super::complete_path("/completely/elsewhere".into(), frag, None, None);
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
