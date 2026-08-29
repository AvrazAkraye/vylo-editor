//! Take a screenshot into the message.
//!
//! A screenshot dragged or pasted in was already understood. Making one meant
//! leaving the app, which is the half people actually reach for — the reason to
//! send a picture is almost always that the thing to talk about is on screen
//! right now.
//!
//! ## Why nothing here takes an argument
//!
//! This is a process started without the approval dialog, so it earns that by
//! having nothing to approve. The program and every flag are `&'static str`
//! written in `plan_for` below; the one value that varies is a destination path
//! this module generates for itself. No caller supplies a command, an argument
//! or a path, which is what makes it safe for the frontend to `invoke` this
//! from a button with no gate in front of it — and it is why `Mode` is a
//! two-variant enum rather than a string: an unrecognised mode fails to
//! deserialize at the IPC boundary instead of being carried on into an argv.
//!
//! It is also not in the tool schema in `src/agent.ts`, like `apply_write` and
//! the pty commands. Nothing above needs to be true for that to hold, but it is
//! why the two facts are worth stating together: a human presses a button, and
//! the model cannot press it.
//!
//! ## Why the capture is interactive
//!
//! `screencapture -i` hands the screen to the user and waits while they drag a
//! rectangle. What is captured is therefore chosen by a person, frame by frame:
//! the app never needs the screen-recording entitlement, and it can never take
//! a picture nobody asked for. A non-interactive `screencapture` of the whole
//! display would need that permission and would be a different feature.
//!
//! ## Windows
//!
//! The Snipping Tool has no "write it to this file" mode — `ms-screenclip:`
//! opens the snip UI and puts the result on the **clipboard**. So Windows
//! returns `Clipboard` and the composer says to paste, rather than growing a
//! second delivery path: pasting an image into the composer already works and
//! is already tested, and a feature that reuses a proven route beats one that
//! invents a parallel one.

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};

/// The same ceiling `read_image` enforces: the API rejects images above ~5 MB,
/// and refusing here beats a rejection arriving after the whole request.
const MAX_BYTES: u64 = 5 * 1024 * 1024;

/// Which capture the button asked for.
///
/// A closed set rather than a string, so the values that reach `plan_for` are
/// exactly the two written here — anything else is a deserialization error at
/// the boundary and never becomes an argument.
#[derive(Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    Region,
    Window,
}

/// What came back.
///
/// Cancelled is a separate outcome rather than an error because pressing Escape
/// is a decision, and reporting "screenshot failed" for a deliberate change of
/// mind is noise in the transcript.
///
/// There is no `name` here on purpose: the name is user-visible text in the
/// attachment chip, so it belongs on the side of the app that has `t()`.
#[derive(Serialize, Debug, PartialEq)]
#[serde(tag = "status", rename_all = "lowercase")]
pub enum Shot {
    Captured { media_type: String, data: String, bytes: u64 },
    Cancelled,
    /// The snip UI is open; what it captures will arrive on the clipboard.
    Clipboard,
}

/// What this platform can do.
///
/// Decided from an OS *name* rather than `cfg!`, so all three branches stay
/// reachable from a test on any one machine — the Windows and unsupported paths
/// would otherwise only ever be exercised by shipping them.
enum Plan {
    /// Run this program with these flags and a destination path appended.
    File(&'static str, &'static [&'static str]),
    /// Run this program with these flags; the result lands on the clipboard.
    Clipboard(&'static str, &'static [&'static str]),
    /// Nothing here can do it.
    None,
}

fn plan_for(os: &str, mode: Mode) -> Plan {
    match os {
        "macos" => {
            let args: &'static [&'static str] = match mode {
                Mode::Region => &["-i"],
                // `-o` drops the window's drop shadow, which is transparent
                // padding: it makes the PNG substantially bigger and shows
                // nothing that is on screen.
                Mode::Window => &["-iW", "-o"],
            };
            // Absolute, not a PATH lookup. The app inherits the user's
            // environment, so a `screencapture` earlier in their PATH would be
            // a program of somebody else's choosing running with no approval.
            Plan::File("/usr/sbin/screencapture", args)
        }
        // `start` reads a leading quoted argument as the new window's title, so
        // the empty string is what stops it swallowing the URI.
        "windows" => Plan::Clipboard("cmd", &["/C", "start", "", "ms-screenclip:"]),
        _ => Plan::None,
    }
}

/// Take a shot, or explain why not.
pub fn capture(mode: Mode) -> Result<Shot, String> {
    capture_with(plan_for(std::env::consts::OS, mode), spawn)
}

/// The part worth testing: everything except actually starting the tool.
fn capture_with<R>(plan: Plan, run: R) -> Result<Shot, String>
where
    R: FnOnce(&str, &[String]) -> Result<(), String>,
{
    match plan {
        Plan::None => {
            Err("taking a screenshot from inside the app works on macOS and Windows only".into())
        }
        Plan::Clipboard(program, args) => {
            run(program, &owned(args))?;
            Ok(Shot::Clipboard)
        }
        Plan::File(program, args) => {
            // Constructed before the run and dropped after it, whichever way it
            // ends. See `Temp`.
            let dest = Temp::new();
            let mut argv = owned(args);
            argv.push(dest.path.to_string_lossy().into_owned());
            run(program, &argv)?;
            read_back(&dest.path)
        }
    }
}

fn owned(args: &[&str]) -> Vec<String> {
    args.iter().map(|s| (*s).to_string()).collect()
}

/// Start the tool and wait for the person to finish with it.
///
/// The exit status is deliberately discarded. `screencapture` exits 1 when the
/// user presses Escape and — on older releases — 0 having written nothing, so
/// what is on disk answers "did they take one?" better than the code does. The
/// only thing that is genuinely a failure here is the program not starting.
fn spawn(program: &str, args: &[String]) -> Result<(), String> {
    Command::new(program)
        .args(args)
        .status()
        .map(|_| ())
        .map_err(|e| match e.kind() {
            // Said without the OS's own wording: "No such file or directory"
            // reads, in the transcript, as though a file of the user's had gone
            // missing.
            std::io::ErrorKind::NotFound => format!("{program} is not on this system"),
            _ => format!("could not start {program}: {e}"),
        })
}

fn read_back(path: &Path) -> Result<Shot, String> {
    // No file, or an empty one, means the crosshair was dismissed.
    let Ok(md) = fs::metadata(path) else {
        return Ok(Shot::Cancelled);
    };
    if md.len() == 0 {
        return Ok(Shot::Cancelled);
    }
    if md.len() > MAX_BYTES {
        return Err(format!(
            "the capture is {:.1} MB, over the 5 MB image limit — capture a smaller area",
            md.len() as f64 / 1_048_576.0
        ));
    }

    let bytes = fs::read(path).map_err(|e| format!("could not read the capture back: {e}"))?;
    // Sniffed rather than assumed, for the same reason `read_image` sniffs: a
    // file that is not what it claims fails upstream with an opaque "could not
    // process image", which is a miserable thing to debug from the UI.
    if !bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
        return Err("the screenshot tool did not produce a PNG".into());
    }

    Ok(Shot::Captured {
        media_type: "image/png".into(),
        data: BASE64.encode(&bytes),
        bytes: md.len(),
    })
}

/// A destination that removes itself.
///
/// Every way out of a capture has to take the file with it — the success, the
/// cancel, and the failure half way through — and a `Drop` guard is the only
/// version of that with no path around it. The file is a picture of whatever
/// was on the user's screen, so leaving one in the temp directory is the
/// outcome most worth engineering against.
struct Temp {
    path: PathBuf,
}

impl Temp {
    fn new() -> Temp {
        // Two captures a nanosecond apart, or in two windows of the same
        // process, must not be handed the same file: the second would read back
        // the first one's picture.
        static SEQ: AtomicU64 = AtomicU64::new(0);
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let n = SEQ.fetch_add(1, Ordering::Relaxed);
        let name = format!("vylo-shot-{}-{}-{}.png", std::process::id(), nanos, n);
        Temp { path: std::env::temp_dir().join(name) }
    }
}

impl Drop for Temp {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::rc::Rc;

    /// A PNG as far as anything here is concerned: the signature plus a little
    /// body, so the size assertions have something to measure.
    fn png() -> Vec<u8> {
        let mut v = vec![0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];
        v.extend_from_slice(b"IHDR-and-the-rest-of-a-picture");
        v
    }

    type Seen = Rc<RefCell<Vec<String>>>;

    /// A stand-in for the OS tool. Records the whole command line it was given,
    /// and writes `produces` at the destination if there is one.
    fn tool(seen: Seen, produces: Option<Vec<u8>>) -> impl FnOnce(&str, &[String]) -> Result<(), String> {
        move |program, args| {
            let mut line = vec![program.to_string()];
            line.extend(args.iter().cloned());
            *seen.borrow_mut() = line;
            if let Some(bytes) = produces {
                fs::write(args.last().expect("a destination"), bytes).unwrap();
            }
            Ok(())
        }
    }

    fn dest_of(seen: &Seen) -> PathBuf {
        PathBuf::from(seen.borrow().last().expect("the tool was run").clone())
    }

    #[test]
    fn region_and_window_are_two_fixed_argument_lists() {
        for (mode, expected) in [
            (Mode::Region, vec!["/usr/sbin/screencapture", "-i"]),
            (Mode::Window, vec!["/usr/sbin/screencapture", "-iW", "-o"]),
        ] {
            let seen: Seen = Rc::new(RefCell::new(Vec::new()));
            capture_with(plan_for("macos", mode), tool(seen.clone(), None)).unwrap();
            let line = seen.borrow().clone();
            assert_eq!(
                line[..line.len() - 1].to_vec(),
                expected,
                "{mode:?} should be exactly these arguments"
            );
        }
    }

    /// The one value that varies is a path this module wrote, and it is last.
    /// If anything a caller supplied could reach the command line, it would
    /// have to show up here.
    #[test]
    fn every_argument_but_the_destination_is_a_flag_this_module_wrote() {
        for mode in [Mode::Region, Mode::Window] {
            let seen: Seen = Rc::new(RefCell::new(Vec::new()));
            capture_with(plan_for("macos", mode), tool(seen.clone(), None)).unwrap();
            let line = seen.borrow().clone();
            let dest = line.last().unwrap();
            assert!(dest.ends_with(".png"), "the destination is a png path, got {dest}");
            assert!(
                Path::new(dest).starts_with(std::env::temp_dir()),
                "the destination is in the temp directory, got {dest}"
            );
            for arg in &line[1..line.len() - 1] {
                assert!(arg.starts_with('-'), "{arg} is not a flag");
            }
        }
    }

    #[test]
    fn two_captures_never_share_a_destination() {
        let a: Seen = Rc::new(RefCell::new(Vec::new()));
        let b: Seen = Rc::new(RefCell::new(Vec::new()));
        capture_with(plan_for("macos", Mode::Region), tool(a.clone(), None)).unwrap();
        capture_with(plan_for("macos", Mode::Region), tool(b.clone(), None)).unwrap();
        assert_ne!(dest_of(&a), dest_of(&b));
    }

    #[test]
    fn windows_hands_the_capture_to_the_snipping_tool() {
        let seen: Seen = Rc::new(RefCell::new(Vec::new()));
        let out = capture_with(plan_for("windows", Mode::Region), tool(seen.clone(), None)).unwrap();
        assert_eq!(out, Shot::Clipboard, "the shot arrives by paste, not by file");
        assert_eq!(
            seen.borrow().clone(),
            vec!["cmd", "/C", "start", "", "ms-screenclip:"],
            "no destination is appended — there is no file to read back"
        );
    }

    #[test]
    fn an_unsupported_platform_says_so_and_starts_nothing() {
        let err = capture_with(plan_for("linux", Mode::Region), |_, _| {
            panic!("nothing should be started on a platform with no plan")
        })
        .unwrap_err();
        assert!(err.contains("macOS and Windows"), "got {err}");
    }

    #[test]
    fn pressing_escape_reads_as_a_cancel_rather_than_a_failure() {
        let seen: Seen = Rc::new(RefCell::new(Vec::new()));
        // The tool ran and wrote nothing, which is what a dismissed crosshair
        // leaves behind.
        let out = capture_with(plan_for("macos", Mode::Region), tool(seen.clone(), None)).unwrap();
        assert_eq!(out, Shot::Cancelled);
    }

    /// Some releases write the file and then leave it empty on a cancel, which
    /// is indistinguishable from a capture as far as `exists()` is concerned.
    #[test]
    fn an_empty_file_is_a_cancel_too() {
        let seen: Seen = Rc::new(RefCell::new(Vec::new()));
        let out = capture_with(plan_for("macos", Mode::Region), tool(seen.clone(), Some(Vec::new()))).unwrap();
        assert_eq!(out, Shot::Cancelled);
    }

    #[test]
    fn a_capture_comes_back_as_base64_and_leaves_nothing_behind() {
        let seen: Seen = Rc::new(RefCell::new(Vec::new()));
        let bytes = png();
        let out = capture_with(plan_for("macos", Mode::Region), tool(seen.clone(), Some(bytes.clone()))).unwrap();
        match out {
            Shot::Captured { media_type, data, bytes: n } => {
                assert_eq!(media_type, "image/png");
                assert_eq!(n, bytes.len() as u64);
                assert_eq!(BASE64.decode(data).unwrap(), bytes, "the bytes survive the round trip");
            }
            other => panic!("expected a capture, got {other:?}"),
        }
        assert!(!dest_of(&seen).exists(), "the temp file is gone once it has been read");
    }

    #[test]
    fn the_temp_file_is_removed_when_the_capture_fails() {
        let seen: Seen = Rc::new(RefCell::new(Vec::new()));
        let s = seen.clone();
        let err = capture_with(plan_for("macos", Mode::Region), move |program, args| {
            let mut line = vec![program.to_string()];
            line.extend(args.iter().cloned());
            *s.borrow_mut() = line;
            // A picture was taken and then something went wrong afterwards --
            // the case where a file is most likely to be orphaned.
            fs::write(args.last().unwrap(), png()).unwrap();
            Err("the tool fell over".into())
        })
        .unwrap_err();
        assert_eq!(err, "the tool fell over");
        assert!(!dest_of(&seen).exists(), "a picture of the screen must not be left in /tmp");
    }

    #[test]
    fn an_oversized_capture_is_refused_before_it_reaches_the_model() {
        let seen: Seen = Rc::new(RefCell::new(Vec::new()));
        let mut big = png();
        big.resize(MAX_BYTES as usize + 1, 0);
        let err = capture_with(plan_for("macos", Mode::Region), tool(seen.clone(), Some(big))).unwrap_err();
        assert!(err.contains("5 MB image limit"), "got {err}");
        assert!(!dest_of(&seen).exists(), "the refused capture is cleaned up too");
    }

    #[test]
    fn something_that_is_not_a_png_is_refused_here_rather_than_upstream() {
        let seen: Seen = Rc::new(RefCell::new(Vec::new()));
        let err = capture_with(
            plan_for("macos", Mode::Region),
            tool(seen.clone(), Some(b"<html>not a picture".to_vec())),
        )
        .unwrap_err();
        assert!(err.contains("did not produce a PNG"), "got {err}");
    }

    /// The mode arrives from the frontend as JSON, and the point of the enum is
    /// that a third value cannot get through.
    #[test]
    fn a_mode_that_is_not_one_of_the_two_does_not_deserialize() {
        assert_eq!(serde_json::from_str::<Mode>("\"region\"").unwrap(), Mode::Region);
        assert_eq!(serde_json::from_str::<Mode>("\"window\"").unwrap(), Mode::Window);
        assert!(serde_json::from_str::<Mode>("\"-i /etc/passwd\"").is_err());
        assert!(serde_json::from_str::<Mode>("\"screen\"").is_err());
    }
}
