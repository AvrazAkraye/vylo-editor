//! Writing a video the Video module rendered to the place the person chose.
//!
//! ## Why this is not in the tool schema
//!
//! `export_write_video` writes to an absolute path, the save panel's, the way
//! `export_write_docx` and `save_pdf` do, and for their reason that is not a
//! hole: it is **absent from the tool schema** (`test/modes.test.mjs` names it
//! in ABSENT, `test/e2e.test.mjs` checks it never reaches the wire), so no tool
//! call reaches it however the model is prompted.
//!
//! ## Why the bytes are a raw IPC body
//!
//! A film is tens or hundreds of megabytes, where a Word document is a few
//! hundred kilobytes. Base64 in a JSON string, which is what `export_write_docx`
//! takes, would make it a third larger and parse it as text on the way. Tauri
//! v2 carries a `Uint8Array` passed as `invoke`'s whole argument as the request
//! body, which arrives here untouched as `InvokeBody::Raw`; the path travels in
//! an `x-path` request header, `encodeURIComponent`-encoded because a header is
//! ASCII and the person's folder and title may well be Arabic or Kurdish.

use std::fs;
use std::path::{Path, PathBuf};

use tauri::ipc::{InvokeBody, Request};

/// The largest video `export_write_video` will write. A three-minute 1080p film
/// at the renderer's highest bitrate preset is well under half of this, so one
/// gibibyte never stops a real export; it is a ceiling on what a runaway
/// renderer can put on somebody's disk.
pub const MAX_VIDEO_BYTES: usize = 1024 * 1024 * 1024;

/// The request header that carries the destination path.
const PATH_HEADER: &str = "x-path";

/// Write an MP4 the user has just chosen to save, from the Video module.
///
/// `export_write_docx` with a film instead of a document, and the same argument
/// for why an uncontained absolute path is not a hole: it is **absent from the
/// tool schema** (`test/modes.test.mjs` names it), so no tool call reaches it
/// however the model is prompted. The path comes from the OS save panel, and
/// the bytes from `videoexport.ts`, which renders them in the page with
/// Remotion's web renderer from exactly the storyboard the person pressing
/// Export has been previewing and editing. The model wrote some of that
/// storyboard's words — as plain fields, never code, drawn by the app's own
/// components — and a person watched it and asked for it to be saved; the
/// model never chooses where, or whether.
///
/// Its refusals follow from what the request and the file are supposed to be,
/// and each is cheaper than the write it prevents:
///
/// - a missing `x-path` header, or one that is not percent-encoded UTF-8 — a
///   caller other than `writeVideoFile`, or a bug in it;
/// - a path that is not absolute, or holds a control character: the save panel
///   returns neither;
/// - a name that does not end in `.mp4`, so a bug upstream cannot put a film
///   where a `.zshrc` or a `.docx` was;
/// - a directory, for `export_write`'s reason;
/// - a folder that does not exist. It creates no directories, for
///   `apply_write`'s reason: the save panel only offers places that exist;
/// - a body that is not raw bytes — JSON means the caller did not send what
///   this command is for;
/// - more than `MAX_VIDEO_BYTES`;
/// - bytes whose [4..8] is not `ftyp`, the box every MP4 opens with — anything
///   else is not a video, whatever the name says.
///
/// Async so a large write happens off the main thread and the window keeps
/// drawing while it lands.
#[tauri::command]
pub async fn export_write_video(request: Request<'_>) -> Result<(), String> {
    let path = request.headers().get(PATH_HEADER).map(|v| v.as_bytes());
    write_video(path, request.body(), MAX_VIDEO_BYTES)
}

/// `export_write_video` without the IPC request, and with its ceiling as an
/// argument, so the tests can build its inputs and pin the size check with a
/// few bytes rather than a gibibyte of them.
pub fn write_video(path_header: Option<&[u8]>, body: &InvokeBody, max: usize) -> Result<(), String> {
    let path = decode_path(path_header)?;
    let p = check_mp4_path(&path)?;
    let bytes = match body {
        InvokeBody::Raw(b) => b,
        InvokeBody::Json(_) => return Err(format!("{path}: the video did not arrive as bytes")),
    };
    if bytes.len() > max {
        return Err(format!("{path}: the video is larger than {} MB", max / (1024 * 1024)));
    }
    if bytes.get(4..8) != Some(b"ftyp".as_slice()) {
        return Err(format!("{path}: is not an MP4 video"));
    }
    fs::write(&p, bytes).map_err(|e| format!("{path}: {e}"))
}

/// The `x-path` header, percent-decoded. `encodeURIComponent` leaves only
/// unreserved ASCII and `%XX` escapes of UTF-8, so anything else — a bad
/// escape, a stray byte, a sequence that is not UTF-8 — is refused rather than
/// guessed at.
fn decode_path(header: Option<&[u8]>) -> Result<String, String> {
    let raw = header.ok_or_else(|| "no place to save the video was given".to_string())?;
    let bad = || "the place to save the video did not arrive intact".to_string();
    let hex = |b: u8| -> Option<u8> {
        match b {
            b'0'..=b'9' => Some(b - b'0'),
            b'a'..=b'f' => Some(b - b'a' + 10),
            b'A'..=b'F' => Some(b - b'A' + 10),
            _ => None,
        }
    };
    let mut out = Vec::with_capacity(raw.len());
    let mut i = 0;
    while i < raw.len() {
        let b = raw[i];
        if b == b'%' {
            let hi = raw.get(i + 1).copied().and_then(hex).ok_or_else(bad)?;
            let lo = raw.get(i + 2).copied().and_then(hex).ok_or_else(bad)?;
            out.push(hi << 4 | lo);
            i += 3;
        } else if b.is_ascii_graphic() {
            out.push(b);
            i += 1;
        } else {
            return Err(bad());
        }
    }
    let path = String::from_utf8(out).map_err(|_| bad())?;
    if path.is_empty() {
        return Err("no place to save the video was given".into());
    }
    Ok(path)
}

/// A path from the save panel, checked: absolute, named `.mp4`, not a folder,
/// in a folder that exists — `pdf::check_pdf_path` for a film.
fn check_mp4_path(path: &str) -> Result<PathBuf, String> {
    let p = PathBuf::from(path);
    if path.chars().any(|c| c.is_control()) || !p.is_absolute() {
        return Err(format!("{path}: is not a place to save to"));
    }
    let mp4 = p.extension().and_then(|e| e.to_str()).is_some_and(|e| e.eq_ignore_ascii_case("mp4"));
    if !mp4 {
        return Err(format!("{path}: is not a .mp4 file"));
    }
    if p.is_dir() {
        return Err(format!("{path}: is a directory"));
    }
    if !p.parent().is_some_and(Path::is_dir) {
        return Err(format!("{path}: its folder does not exist"));
    }
    Ok(p)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// What `encodeURIComponent` does, for building headers the way the page does.
    fn encode(s: &str) -> Vec<u8> {
        let mut out = Vec::new();
        for &b in s.as_bytes() {
            if b.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&b) {
                out.push(b);
            } else {
                out.extend(format!("%{b:02X}").bytes());
            }
        }
        out
    }

    /// The bytes on disk are the bytes sent, whatever script the name is in;
    /// each refusal fires and leaves nothing behind — a missing or mangled
    /// header, a relative path, a wrong name, a directory, a missing folder, a
    /// JSON body, bytes that are not an MP4, and too many of them.
    ///
    /// Its own temp-dir prefix: tests share a process, and two writing to one
    /// directory delete each other's files.
    #[test]
    fn export_write_video_writes_an_mp4_and_refuses_what_is_not_one() {
        let dir = std::env::temp_dir().join(format!("vylo_exportvideo_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let at = |name: &str| dir.join(name).to_string_lossy().to_string();

        // Not a real film, but what the guard looks at: a box size, `ftyp`,
        // then bytes that are not text, so a lossy round trip would show.
        let mut film = b"\x00\x00\x00\x20ftypisom".to_vec();
        film.extend((0u8..=255).cycle().take(4096));
        let raw = InvokeBody::Raw(film.clone());
        let write = |path: &str, body: &InvokeBody| write_video(Some(&encode(path)), body, MAX_VIDEO_BYTES);

        write(&at("promo.mp4"), &raw).expect("should write");
        assert_eq!(fs::read(dir.join("promo.mp4")).unwrap(), film, "the bytes on disk are the bytes sent");

        // The extension is a name, and a name's case is the person's.
        write(&at("Clip.MP4"), &raw).expect("upper case is still .mp4");
        assert_eq!(fs::read(dir.join("Clip.MP4")).unwrap(), film);

        // Arabic and Kurdish titles are what `videoFileName` keeps, so a name
        // in either script must survive the header's encoding and reach the disk.
        for name in ["عيادة الأسنان.mp4", "ڕێکلامی کلینیک.mp4", "ڤیدیۆیا نوو.mp4", "a b+c&d%20.mp4"] {
            write(&at(name), &raw).unwrap_or_else(|e| panic!("{name}: {e}"));
            assert_eq!(fs::read(dir.join(name)).unwrap(), film, "{name}");
        }

        // A second save to the same place replaces the first: the save panel
        // has already asked the person whether to.
        let other = InvokeBody::Raw(b"\x00\x00\x00\x08ftypsecond".to_vec());
        write(&at("promo.mp4"), &other).expect("should overwrite");
        assert_eq!(fs::read(dir.join("promo.mp4")).unwrap(), b"\x00\x00\x00\x08ftypsecond");

        // What is refused leaves no file. Checked by listing the folder, so a
        // refusal that wrote first and complained after would show here.
        let before: std::collections::BTreeSet<_> =
            fs::read_dir(&dir).unwrap().flatten().map(|e| e.file_name()).collect();
        let refused = |header: Option<&[u8]>, body: &InvokeBody, why: &str| {
            let err = write_video(header, body, MAX_VIDEO_BYTES)
                .expect_err(&format!("{:?} should be refused", header.map(String::from_utf8_lossy)));
            assert!(err.contains(why), "expected {why:?}, got {err:?}");
        };

        // The header.
        refused(None, &raw, "no place");
        refused(Some(b""), &raw, "no place");
        let plain = at("plain.mp4");
        refused(Some(format!("{plain}%").as_bytes()), &raw, "did not arrive intact");
        refused(Some(format!("{plain}%4").as_bytes()), &raw, "did not arrive intact");
        refused(Some(format!("{plain}%zz").as_bytes()), &raw, "did not arrive intact");
        // Not UTF-8 once decoded.
        refused(Some(format!("{}%FF.mp4", at("x")).as_bytes()), &raw, "did not arrive intact");
        // A header must be ASCII; raw non-ASCII bytes are not what the page sends.
        refused(Some(at("خام.mp4").as_bytes()), &raw, "did not arrive intact");
        refused(Some(format!("{} .mp4", at("x")).as_bytes()), &raw, "did not arrive intact");

        // The path.
        refused(Some(&encode("promo.mp4")), &raw, "is not a place to save to");
        refused(Some(&encode("../promo.mp4")), &raw, "is not a place to save to");
        refused(Some(&encode(&format!("{}\n.mp4", at("x")))), &raw, "is not a place to save to");
        for name in [".zshrc", "profile.zsh", "notes.txt", "promo", "promo.mp4.txt", "promo.mov", "promo.m4v", "thesis.docx", "mp4", ".mp4"] {
            refused(Some(&encode(&at(name))), &raw, "is not a .mp4 file");
        }
        refused(Some(&encode(&dir.to_string_lossy())), &raw, "is not a .mp4 file");
        // A directory whose name ends in .mp4 is still a directory.
        fs::create_dir_all(dir.join("folder.mp4")).unwrap();
        refused(Some(&encode(&at("folder.mp4"))), &raw, "is a directory");
        // No directories are made: the save panel only offers places that exist.
        let missing = dir.join("no such folder").join("promo.mp4");
        refused(Some(&encode(&missing.to_string_lossy())), &raw, "its folder does not exist");
        assert!(!dir.join("no such folder").exists(), "the parent was not created");

        // The body.
        refused(Some(&encode(&at("json.mp4"))), &InvokeBody::Json(serde_json::json!({ "data": "AAAA" })), "did not arrive as bytes");
        for (name, bytes) in [
            ("empty.mp4", b"".as_slice()),
            ("short.mp4", b"\x00\x00\x00\x08ftp".as_slice()),
            ("zip.mp4", b"PK\x03\x04zip-ftyp".as_slice()),
            ("webm.mp4", b"\x1a\x45\xdf\xa3webm".as_slice()),
            ("text.mp4", b"#!/bin/sh\nrm -rf ~\n".as_slice()),
            ("shifted.mp4", b"\x00\x00\x00\x00\x08ftypisom".as_slice()),
        ] {
            refused(Some(&encode(&at(name))), &InvokeBody::Raw(bytes.to_vec()), "is not an MP4 video");
        }

        // The ceiling, with a small one. Exactly at it is written; over it is
        // refused, and refused before the bytes are looked at.
        let cap = b"\x00\x00\x00\x08ftyp12".to_vec();
        write_video(Some(&encode(&at("cap.mp4"))), &InvokeBody::Raw(cap.clone()), cap.len()).expect("exactly the ceiling is allowed");
        assert_eq!(fs::read(dir.join("cap.mp4")).unwrap(), cap);
        let _ = fs::remove_file(dir.join("cap.mp4"));
        let err = write_video(Some(&encode(&at("big.mp4"))), &InvokeBody::Raw(cap.clone()), cap.len() - 1)
            .expect_err("one byte over the ceiling");
        assert!(err.contains("larger than"), "{err}");
        let err = write_video(Some(&encode(&at("bigjunk.mp4"))), &InvokeBody::Raw(vec![0; 64]), 10)
            .expect_err("too big and not an MP4");
        assert!(err.contains("larger than"), "the size is checked first: {err}");

        let after: std::collections::BTreeSet<_> =
            fs::read_dir(&dir).unwrap().flatten().map(|e| e.file_name()).collect();
        let mut expected = before.clone();
        expected.insert("folder.mp4".into());
        assert_eq!(after, expected, "a refusal wrote nothing");

        let _ = fs::remove_dir_all(&dir);
    }

    /// The header decoder is the one piece written by hand; pin it against
    /// what `encodeURIComponent` produces for every script the app speaks.
    #[test]
    fn the_path_header_round_trips_what_encode_uri_component_sends() {
        for s in ["/Users/a/Movies/promo.mp4", "/Users/a/فيديو/عيادة.mp4", "/Users/a/ڤیدیۆ/ڕێکلام ٣٠ چرکە.mp4", "C:\\Users\\a\\x y.mp4", "/tmp/100% (final)!.mp4"] {
            assert_eq!(decode_path(Some(&encode(s))).unwrap(), s);
        }
        // Lower-case escapes are what some encoders emit; they mean the same.
        assert_eq!(decode_path(Some(b"/a/%d8%b9.mp4")).unwrap(), "/a/ع.mp4");
    }
}
