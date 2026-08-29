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
    Exit,
}

struct Session {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
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

#[tauri::command]
pub fn pty_open(
    state: tauri::State<'_, Terminals>,
    cwd: Option<String>,
    cols: u16,
    rows: u16,
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
    let mut cmd = CommandBuilder::new_default_prog();
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
        let _ = child.wait();
        let _ = exit_channel.send(PtyEvent::Exit);
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
            },
        );
    Ok(id)
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
