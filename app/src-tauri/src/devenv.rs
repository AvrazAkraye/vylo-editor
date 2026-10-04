//! What it takes to "run the app for me": the PATH a terminal would have, and a way to open the address it prints.
//!
//! ## The PATH a command needs
//!
//! A program started from the Dock or Finder gets the system's bare environment: `PATH` is
//! `/usr/bin:/bin:/usr/sbin:/sbin`. Homebrew, nvm, pyenv, cargo and everything else a developer installed are
//! added by the shell's own startup files (`.zprofile`, `.zshrc`), which a GUI app never runs. The terminal pane
//! is a real login shell and sees them; `run_command` used `sh -c` with the bare environment, so the agent was
//! told `npm: command not found` and spent several approval dialogs (each a command the person had to read)
//! hunting for where Node lives.
//!
//! The fix is the one editors use: ask the person's own shell, once, what its `PATH` is — `$SHELL -ilc` prints
//! it between two markers so whatever the startup files say on the way cannot be mistaken for it — and give
//! that to `run_command`. Only `PATH` is taken, nothing else of the environment, and what runs is still the
//! exact string the person approved: this changes where `npm` is found, not what is run. Unix only; Windows
//! processes inherit the user's PATH already.
//!
//! The lookup runs the person's startup files, as every terminal they open does. It has a deadline (a rc file
//! that waits for a keypress must not hang the app), is started in the background when the app starts so the
//! first command does not wait for it, and when it fails the fallback is the inherited `PATH` plus the places
//! Homebrew installs to.
//!
//! ## Opening what the app printed
//!
//! `open_url` opens https links only, and stays that way. A dev server prints `http://localhost:5173/`, which is
//! not an https link and is not on the internet, so it has its own narrow command: `open_local` opens an
//! address on **this machine** (`localhost`, `127.0.0.1`, `[::1]`, `*.localhost`, with an optional port) and
//! nothing else, in Chrome when asked and when it is installed, otherwise in the default browser.

use std::sync::OnceLock;

const MARK: &str = "__VYLO_PATH__";

/// The text between the first two markers, if there is exactly a usable value there.
///
/// A startup file may print anything (a banner, a "last login", an update notice); the markers are how the
/// value is told from it. An empty value, one with a control character, or one that is absurdly long is no PATH.
pub(crate) fn parse_marked(out: &str, mark: &str) -> Option<String> {
    let start = out.find(mark)? + mark.len();
    let rest = &out[start..];
    let end = rest.find(mark)?;
    let value = &rest[..end];
    if value.is_empty() || value.len() > 16_384 || value.chars().any(|c| c.is_control()) {
        return None;
    }
    Some(value.to_string())
}

/// The login shell's entries first, then any inherited entry it did not have, each once.
///
/// Homebrew's two locations are added at the end when neither list names them, because a person whose shell
/// failed to answer is still more likely to have `brew` than not and an extra directory on PATH costs nothing.
pub(crate) fn merged_path(login: &str, inherited: &str) -> String {
    let mut seen: Vec<&str> = Vec::new();
    for part in login.split(':').chain(inherited.split(':')) {
        if !part.is_empty() && !seen.contains(&part) {
            seen.push(part);
        }
    }
    for extra in ["/opt/homebrew/bin", "/usr/local/bin"] {
        if !seen.contains(&extra) {
            seen.push(extra);
        }
    }
    seen.join(":")
}

#[cfg(unix)]
fn resolve_login_path() -> Option<String> {
    use std::io::Read;
    use std::process::{Command, Stdio};
    use std::time::{Duration, Instant};

    let shell = std::env::var("SHELL")
        .ok()
        .filter(|s| std::path::Path::new(s).is_absolute())
        .unwrap_or_else(|| "/bin/zsh".to_string());
    let script = format!("printf '{MARK}%s{MARK}' \"$PATH\"");
    let mut child = Command::new(&shell)
        .args(["-ilc", &script])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let mut pipe = child.stdout.take()?;
    // Read on a thread so the deadline below is real even if the shell never writes or never exits.
    let (tx, rx) = std::sync::mpsc::channel::<Vec<u8>>();
    std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = pipe.read_to_end(&mut buf);
        let _ = tx.send(buf);
    });
    let started = Instant::now();
    let out = loop {
        match rx.recv_timeout(Duration::from_millis(100)) {
            Ok(buf) => break Some(buf),
            Err(_) if started.elapsed() > Duration::from_secs(6) => break None,
            Err(_) => {}
        }
    };
    if out.is_none() {
        let _ = child.kill();
    }
    let _ = child.wait();
    parse_marked(&String::from_utf8_lossy(&out?), MARK)
}

#[cfg(not(unix))]
fn resolve_login_path() -> Option<String> {
    None
}

static COMMAND_PATH: OnceLock<String> = OnceLock::new();

/// The `PATH` for `run_command`: the person's login shell's, merged with the inherited one. Worked out once.
pub(crate) fn command_path() -> &'static str {
    COMMAND_PATH.get_or_init(|| {
        let inherited = std::env::var("PATH").unwrap_or_default();
        match resolve_login_path() {
            Some(login) => merged_path(&login, &inherited),
            None => merged_path("", &inherited),
        }
    })
}

/// Start the lookup in the background at launch, so the first command does not wait for the shell.
pub(crate) fn warm() {
    #[cfg(unix)]
    std::thread::spawn(|| {
        let _ = command_path();
    });
}

// ── opening a local address ───────────────────────────────────────────────

/// The address as it will be opened, or why it is refused.
///
/// Accepted: `http` or `https`; a host of `localhost`, `127.0.0.1`, `[::1]`, `0.0.0.0` (rewritten to
/// `localhost`, which is what a person means by it and what a browser opens) or `*.localhost`; an optional
/// port; an optional path. Refused: any other host (`localhost.evil.dev` is not the loopback), credentials,
/// any other scheme, a control character, and the characters `cmd.exe` would read as something else.
pub(crate) fn local_target(url: &str) -> Result<String, String> {
    if url.len() > 2048 || url.chars().any(|c| c.is_control() || c.is_whitespace()) {
        return Err("that address is not an address".into());
    }
    let rest = url
        .strip_prefix("http://")
        .or_else(|| url.strip_prefix("https://"))
        .ok_or_else(|| "only http and https addresses on this machine can be opened".to_string())?;
    let scheme = &url[..url.len() - rest.len()];
    let end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
    let (authority, tail) = rest.split_at(end);
    if authority.contains('@') {
        return Err("an address with a sign-in in it is not opened".into());
    }
    // host[:port], where the host may be a bracketed IPv6 address
    let (host, port) = if let Some(inner) = authority.strip_prefix('[') {
        let close = inner.find(']').ok_or_else(|| "that address is not an address".to_string())?;
        let after = &inner[close + 1..];
        (format!("[{}]", &inner[..close]), after.strip_prefix(':').map(str::to_string).or(if after.is_empty() { None } else { Some("!".into()) }))
    } else {
        match authority.rsplit_once(':') {
            Some((h, p)) => (h.to_string(), Some(p.to_string())),
            None => (authority.to_string(), None),
        }
    };
    let host_lc = host.to_ascii_lowercase();
    let loopback = matches!(host_lc.as_str(), "localhost" | "127.0.0.1" | "[::1]" | "0.0.0.0")
        || (host_lc.ends_with(".localhost")
            && host_lc.len() > ".localhost".len()
            && host_lc[..host_lc.len() - ".localhost".len()]
                .split('.')
                .all(|l| !l.is_empty() && l.len() <= 63 && !l.starts_with('-') && !l.ends_with('-') && l.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')));
    if !loopback {
        return Err("only addresses on this machine can be opened here".into());
    }
    if let Some(p) = &port {
        let ok = !p.is_empty() && p.len() <= 5 && p.bytes().all(|b| b.is_ascii_digit()) && p.parse::<u32>().map_or(false, |n| (1..=65_535).contains(&n));
        if !ok {
            return Err("that port is not a port".into());
        }
    }
    // `&` ends a command in cmd.exe, and the others are its own escapes; a dev server's printed address has none.
    if tail.chars().any(|c| matches!(c, '&' | '^' | '|' | '<' | '>' | '"' | '`' | '\\' | '%')) {
        return Err("that address has characters that cannot be opened safely".into());
    }
    let shown_host = if host_lc == "0.0.0.0" { "localhost".to_string() } else { host };
    let port_part = port.map(|p| format!(":{p}")).unwrap_or_default();
    Ok(format!("{scheme}{shown_host}{port_part}{tail}"))
}

/// Open an address on this machine in a browser: `"chrome"` for Google Chrome when it is installed, anything
/// else (and Chrome when it is not there) for the default browser. Returns which one opened it.
#[tauri::command]
pub fn open_local(url: String, browser: String) -> Result<String, String> {
    use std::process::Command;
    let target = local_target(&url)?;

    #[cfg(target_os = "macos")]
    {
        if browser == "chrome" {
            let ok = Command::new("open")
                .args(["-a", "Google Chrome"])
                .arg(&target)
                .status()
                .map(|s| s.success())
                .unwrap_or(false);
            if ok {
                return Ok("chrome".into());
            }
        }
        Command::new("open").arg(&target).spawn().map_err(|e| format!("could not open that address: {e}"))?;
        return Ok("default".into());
    }

    #[cfg(target_os = "windows")]
    {
        if browser == "chrome" {
            let ok = Command::new("cmd")
                .args(["/C", "start", "", "chrome"])
                .arg(&target)
                .status()
                .map(|s| s.success())
                .unwrap_or(false);
            if ok {
                return Ok("chrome".into());
            }
        }
        Command::new("cmd")
            .args(["/C", "start", ""])
            .arg(&target)
            .spawn()
            .map_err(|e| format!("could not open that address: {e}"))?;
        return Ok("default".into());
    }

    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    {
        if browser == "chrome" {
            for name in ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"] {
                if Command::new(name).arg(&target).spawn().is_ok() {
                    return Ok("chrome".into());
                }
            }
        }
        Command::new("xdg-open").arg(&target).spawn().map_err(|e| format!("could not open that address: {e}"))?;
        Ok("default".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_path_is_read_between_the_markers_whatever_the_startup_files_print() {
        let out = format!("Last login: Sun Oct 4\nWelcome!\n{MARK}/Users/me/.nvm/bin:/opt/homebrew/bin:/usr/bin{MARK}\nbye");
        assert_eq!(parse_marked(&out, MARK).as_deref(), Some("/Users/me/.nvm/bin:/opt/homebrew/bin:/usr/bin"));
        assert_eq!(parse_marked("no markers here", MARK), None);
        assert_eq!(parse_marked(&format!("{MARK}{MARK}"), MARK), None, "an empty value is no PATH");
        assert_eq!(parse_marked(&format!("{MARK}/a\n/b{MARK}"), MARK), None, "a newline is no PATH");
        assert_eq!(parse_marked(&format!("{MARK}/a"), MARK), None, "an unterminated value is no PATH");
        assert_eq!(parse_marked(&format!("{MARK}{}{MARK}", "a".repeat(20_000)), MARK), None);
    }

    #[test]
    fn the_login_shells_entries_come_first_and_each_directory_once() {
        let m = merged_path("/Users/me/.nvm/bin:/usr/bin", "/usr/bin:/bin:/usr/sbin");
        let parts: Vec<&str> = m.split(':').collect();
        assert_eq!(parts[0], "/Users/me/.nvm/bin");
        assert_eq!(parts.iter().filter(|p| **p == "/usr/bin").count(), 1);
        assert!(parts.contains(&"/bin") && parts.contains(&"/usr/sbin"));
        assert!(parts.contains(&"/opt/homebrew/bin") && parts.contains(&"/usr/local/bin"), "the usual places are added when absent");
        // The answer of a shell that failed is still a usable PATH.
        assert!(merged_path("", "/usr/bin:/bin").starts_with("/usr/bin:/bin"));
        assert!(!merged_path(":::", "").contains("::"));
    }

    #[test]
    fn only_addresses_on_this_machine_are_opened() {
        for good in [
            "http://localhost:5173/",
            "http://localhost:8081",
            "https://localhost:3000/a/b?x=1#top",
            "http://127.0.0.1:4173",
            "http://[::1]:8080/",
            "http://app.localhost:3000/",
            "http://LOCALHOST:3000/",
        ] {
            assert!(local_target(good).is_ok(), "must open {good}");
        }
        assert_eq!(local_target("http://0.0.0.0:3000/").unwrap(), "http://localhost:3000/");
        for bad in [
            "https://example.com",
            "http://localhost.evil.dev:3000/",
            "http://evil.dev/localhost",
            "http://user:pw@localhost:3000/",
            "http://localhost@evil.dev/",
            "http://localhost:99999/",
            "http://localhost:/",
            "http://localhost:abc/",
            "http://[::1]x/",
            "file:///etc/passwd",
            "javascript:alert(1)",
            "ftp://localhost/",
            "localhost:3000",
            "",
            "http://localhost:3000/\u{0}",
            "http://localhost:3000/a b",
            "http://localhost:3000/?a=1&b=2",
            "http://localhost:3000/a\"b",
            "http://.localhost/",
            "http://-.localhost/",
        ] {
            assert!(local_target(bad).is_err(), "must refuse {bad:?}");
        }
        assert!(local_target(&format!("http://localhost/{}", "a".repeat(3000))).is_err());
    }

    #[test]
    fn open_local_refuses_before_it_opens_anything() {
        assert!(open_local("https://example.com".into(), "chrome".into()).is_err());
        assert!(open_local("http://localhost.evil.dev/".into(), "default".into()).is_err());
    }
}
