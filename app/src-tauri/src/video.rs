//! Writing what the Video module made to the place the person chose, and
//! opening it afterwards.
//!
//! ## What is written
//!
//! Six kinds of file, each told by its extension and each checked against
//! what that kind of file is before a byte lands:
//!
//! | extension | what the Video panel saves           | the bytes must be                      | at most  |
//! |-----------|--------------------------------------|----------------------------------------|----------|
//! | `.mp4`    | the film, H.264                      | an MP4: `ftyp` at offset 4             | 1 GiB    |
//! | `.webm`   | the film, VP8 or VP9                 | a WebM: the EBML magic `1A 45 DF A3`   | 1 GiB    |
//! | `.png`    | a poster — one frame, for thumbnails | a PNG: its eight-byte signature        | 64 MiB   |
//! | `.gif`    | a looping animation                  | a GIF: `GIF89a`, or the older `GIF87a` | 64 MiB   |
//! | `.srt`    | subtitles, from the scenes' words    | UTF-8 text with no control characters  | 5 MiB    |
//! | `.json`   | the storyboard, as a backup          | UTF-8 text that parses as JSON         | 5 MiB    |
//!
//! The Motion panel saves through the same command, and only three of these:
//! an MP4, a GIF and a PNG.
//!
//! Every other name is refused, so a bug upstream cannot put a film where a
//! `.zshrc`, a `.docx` or an `.app` was.
//!
//! ## Why these are not in the tool schema
//!
//! `export_write_video` writes to an absolute path — the save panel's, or the
//! Downloads folder's — the way `export_write_docx` and `save_pdf` do, and for
//! their reason that is not a hole: it is **absent from the tool schema**
//! (`test/modes.test.mjs` names it in ABSENT, `test/e2e.test.mjs` checks it
//! never reaches the wire), so no tool call reaches it however the model is
//! prompted. `open_exported` is absent for the same reason, and can only open
//! a file this command wrote in this session.
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

use std::fs::{self, OpenOptions};
use std::io::{self, ErrorKind, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;

use tauri::ipc::{InvokeBody, Request};

/// The largest film `export_write_video` will write. A three-minute 4K film at
/// the renderer's highest bitrate preset is well under half of this, so one
/// gibibyte never stops a real export; it is a ceiling on what a runaway
/// renderer can put on somebody's disk.
pub const MAX_VIDEO_BYTES: usize = 1024 * 1024 * 1024;

/// The largest poster. A 4K frame as PNG is at most its raw pixels, 3840 ×
/// 2160 × 4 bytes ≈ 32 MiB, plus a few bytes a row; twice that is room to spare.
pub const MAX_IMAGE_BYTES: usize = 64 * 1024 * 1024;

/// The largest subtitle file or storyboard. Three minutes of subtitles are a
/// few kilobytes; a storyboard without its pictures, a few dozen.
pub const MAX_TEXT_BYTES: usize = 5 * 1024 * 1024;

/// The request header that carries the destination path.
const PATH_HEADER: &str = "x-path";

/// The request header that asks for a new file rather than a replaced one.
const UNIQUE_HEADER: &str = "x-unique";

/// The most `Title (n).mp4` a unique write tries before it gives up.
const MAX_NUMBERED: u32 = 999;

/// The most temporary names a replacing write tries before it gives up. Each
/// name is new to this run of the app, so a second try is needed only when a
/// file of that name was left by an earlier run that died mid-write, or put
/// there by something else.
const MAX_TEMPORARY: u32 = 100;

/// The `n` in `.vylo-saving-<pid>-<n>.tmp`: two saves into one folder at the
/// same moment never reach for the same name.
static SAVING: AtomicU32 = AtomicU32::new(0);

/// What a file the Video panel saves is, from its extension.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Mp4,
    Webm,
    Png,
    Gif,
    Srt,
    Json,
}

impl Kind {
    /// The kind a name promises, or `None` for a name the panel never saves.
    pub fn of(path: &Path) -> Option<Kind> {
        let ext = path.extension()?.to_str()?.to_ascii_lowercase();
        // A name that is only an extension — `.mp4` — has no stem, and is a
        // hidden file named "mp4" rather than a film.
        path.file_stem()?;
        Some(match ext.as_str() {
            "mp4" => Kind::Mp4,
            "webm" => Kind::Webm,
            "png" => Kind::Png,
            "gif" => Kind::Gif,
            "srt" => Kind::Srt,
            "json" => Kind::Json,
            _ => return None,
        })
    }

    /// The most bytes a file of this kind may have.
    pub fn cap(self) -> usize {
        match self {
            Kind::Mp4 | Kind::Webm => MAX_VIDEO_BYTES,
            // Motion keeps a GIF under 25 MB, and saves one still over only at
            // the bottom of its ladder (240 px, 6 frames a second, 64 colours,
            // at most 15 s): far below a poster's ceiling, which it shares.
            Kind::Png | Kind::Gif => MAX_IMAGE_BYTES,
            Kind::Srt | Kind::Json => MAX_TEXT_BYTES,
        }
    }

    /// Whether `bytes` are what a file of this kind is. `Err` says what they
    /// are not, in the words the refusal will use.
    pub fn check(self, bytes: &[u8]) -> Result<(), &'static str> {
        match self {
            Kind::Mp4 => (bytes.get(4..8) == Some(b"ftyp".as_slice())).then_some(()).ok_or("is not an MP4 video"),
            Kind::Webm => bytes.starts_with(&[0x1A, 0x45, 0xDF, 0xA3]).then_some(()).ok_or("is not a WebM video"),
            Kind::Png => bytes.starts_with(b"\x89PNG\r\n\x1a\n").then_some(()).ok_or("is not a PNG image"),
            // Motion's writer (`motiongif.ts`) writes only 89a; 87a, the
            // version before it, is the same kind of file and as harmless.
            Kind::Gif => (bytes.starts_with(b"GIF89a") || bytes.starts_with(b"GIF87a")).then_some(()).ok_or("is not a GIF image"),
            Kind::Srt => {
                let text = std::str::from_utf8(bytes).map_err(|_| "is not UTF-8 text")?;
                // A byte-order mark is what some players want at the start; a
                // tab, a line feed and a carriage return are what a subtitle
                // file is made of. Anything else below a space is not text.
                let body = text.strip_prefix('\u{feff}').unwrap_or(text);
                if body.chars().any(|c| c.is_control() && !matches!(c, '\n' | '\r' | '\t')) {
                    return Err("is not plain text");
                }
                Ok(())
            }
            Kind::Json => {
                let text = std::str::from_utf8(bytes).map_err(|_| "is not UTF-8 text")?;
                serde_json::from_str::<serde_json::Value>(text).map(|_| ()).map_err(|_| "is not JSON")
            }
        }
    }

    /// Whether the person can be offered **Open** for this kind: the five a
    /// player or a viewer shows. The storyboard is a backup, not a document.
    fn openable(self) -> bool {
        !matches!(self, Kind::Json)
    }
}

/// Every file `export_write_video` has written in this run of the app, newest
/// last, so `open_exported` can refuse everything else. A bounded list: the
/// oldest is forgotten first, and forgetting one only means **Open** says no.
static WRITTEN: Mutex<Written> = Mutex::new(Written::new());
const REMEMBERED: usize = 256;

/// The list behind `WRITTEN`, on its own so its bound can be tested without
/// racing the other tests' writes.
struct Written(Vec<PathBuf>);

impl Written {
    const fn new() -> Self {
        Written(Vec::new())
    }

    fn add(&mut self, p: &Path) {
        self.0.retain(|x| x != p);
        self.0.push(p.to_path_buf());
        if self.0.len() > REMEMBERED {
            let extra = self.0.len() - REMEMBERED;
            self.0.drain(..extra);
        }
    }

    fn has(&self, p: &Path) -> bool {
        self.0.iter().any(|x| x == p)
    }
}

fn remember(p: &Path) {
    WRITTEN.lock().unwrap_or_else(|e| e.into_inner()).add(p);
}

fn was_written(p: &Path) -> bool {
    WRITTEN.lock().unwrap_or_else(|e| e.into_inner()).has(p)
}

/// Write a file the Video panel has just made, where the person asked for it.
/// Returns the path written, which is the one asked for unless `x-unique` was
/// set and that name was taken.
///
/// `export_write_docx` with a film instead of a document, and the same argument
/// for why an uncontained absolute path is not a hole: it is **absent from the
/// tool schema** (`test/modes.test.mjs` names it), so no tool call reaches it
/// however the model is prompted. The path comes from the OS save panel, or is
/// the Downloads folder the page asked Tauri for joined to a name made from the
/// title, when the person pressed **Download**. The bytes come from
/// `videoexport.ts`, which renders them in the page with Remotion's web renderer
/// from exactly the storyboard the person pressing the button has been
/// previewing and editing — or, for subtitles and the storyboard backup, writes
/// out that storyboard's own words. The model wrote some of those words — as
/// plain fields, never code, drawn by the app's own components — and a person
/// watched them and asked for them to be saved; the model never chooses where,
/// or whether.
///
/// Two ways to write, chosen by the `x-unique` header:
///
/// - without it, a file already at the path is replaced: that is the save
///   panel's path, and the panel has already asked the person whether to.
///   The replacing is atomic (`replace`): the film is written beside the old
///   file under a temporary name, flushed to the disk, and only then renamed
///   over it, so a disk that fills up part-way leaves the old file whole
///   rather than half a new one in its place;
/// - with `x-unique: 1`, nothing is ever replaced. The name is a wish: if
///   `Title.mp4` is taken, `Title (2).mp4` is tried, then `(3)`, up to
///   `(999)`, each created with `create_new` so that a file which appears
///   between the check and the write is not overwritten either — the check
///   *is* the write. This is **Download**, which saves to the Downloads folder
///   without asking, and so must never cost the person a file. It is flushed
///   to the disk before it is reported saved, and removed if that fails.
///
/// Its refusals follow from what the request and the file are supposed to be,
/// and each is cheaper than the write it prevents:
///
/// - a missing `x-path` header, or one that is not percent-encoded UTF-8 — a
///   caller other than `writeVideoFile`, or a bug in it; an `x-unique` that is
///   anything but `1`;
/// - a path that is not absolute, or holds a control character: neither the
///   save panel nor the Downloads folder is either;
/// - a name that is not one of the six kinds in the table at the top of this
///   file;
/// - a directory, for `export_write`'s reason (when replacing; a unique write
///   steps past one to the next free name);
/// - a folder that does not exist. It creates no directories, for
///   `apply_write`'s reason: the save panel only offers places that exist;
/// - a body that is not raw bytes — JSON means the caller did not send what
///   this command is for;
/// - more bytes than the kind's ceiling;
/// - bytes that are not what the name says: an MP4 without `ftyp`, a WebM
///   without its EBML magic, a PNG without its signature, a GIF that does not
///   begin `GIF89a` or `GIF87a`, subtitles that are not plain UTF-8 text, a
///   storyboard that is not JSON.
///
/// Async so a large write happens off the main thread and the window keeps
/// drawing while it lands.
#[tauri::command]
pub async fn export_write_video(request: Request<'_>) -> Result<String, String> {
    let path = request.headers().get(PATH_HEADER).map(|v| v.as_bytes());
    let unique = request.headers().get(UNIQUE_HEADER).map(|v| v.as_bytes());
    write_media(path, unique, request.body(), None)
}

/// `export_write_video` without the IPC request, and with an optional ceiling
/// in place of the kind's, so the tests can build its inputs and pin the size
/// check with a few bytes rather than a gibibyte of them.
pub fn write_media(path_header: Option<&[u8]>, unique_header: Option<&[u8]>, body: &InvokeBody, max: Option<usize>) -> Result<String, String> {
    let path = decode_path(path_header)?;
    let unique = match unique_header {
        None => false,
        Some(b"1") => true,
        Some(_) => return Err(format!("{path}: the request did not arrive intact")),
    };
    let (p, kind) = check_path(&path, !unique)?;
    let bytes = match body {
        InvokeBody::Raw(b) => b,
        InvokeBody::Json(_) => return Err(format!("{path}: the file did not arrive as bytes")),
    };
    let max = max.unwrap_or(kind.cap());
    if bytes.len() > max {
        return Err(format!("{path}: the file is larger than {}", size(max)));
    }
    kind.check(bytes).map_err(|why| format!("{path}: {why}"))?;
    let written = if unique {
        write_new(&p, bytes)?
    } else {
        replace(&p, bytes)?;
        p
    };
    remember(&written);
    Ok(written.to_string_lossy().into_owned())
}

/// `1 GB`, `64 MB`, `5 MB` — or bytes, for the tests' small ceilings.
fn size(n: usize) -> String {
    const MB: usize = 1024 * 1024;
    if n >= 1024 * MB {
        format!("{} GB", n / (1024 * MB))
    } else if n >= MB {
        format!("{} MB", n / MB)
    } else {
        format!("{n} bytes")
    }
}

/// `Title (n).ext` beside `p`: macOS's and Windows' own way of keeping both.
pub fn numbered(p: &Path, n: u32) -> PathBuf {
    if n <= 1 {
        return p.to_path_buf();
    }
    let stem = p.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let name = match p.extension() {
        Some(ext) => format!("{stem} ({n}).{}", ext.to_string_lossy()),
        None => format!("{stem} ({n})"),
    };
    p.with_file_name(name)
}

/// Write all of `bytes`, then make sure they are on the disk before anyone is
/// told they are. `write_all` succeeding means the system took the bytes, not
/// that the disk did: a network volume (SMB, NFS) or a FUSE file system may
/// report a full disk or an I/O error only when the file is flushed or closed,
/// and `File`'s drop throws a close error away. `sync_all` asks for the flush
/// and returns its error, so a film the disk did not take is reported, not
/// announced as saved.
fn put(f: &mut fs::File, bytes: &[u8]) -> io::Result<()> {
    f.write_all(bytes)?;
    flush_to_disk(f)
}

/// `sync_all`, for every file system the person may save to. On macOS it is
/// `fcntl(F_FULLFSYNC)`, which flushes the drive's own cache too and which
/// only some file systems offer (APFS, HFS+, FAT, UDF); the others — some
/// network and FUSE volumes — refuse the request itself, and there a plain
/// `fsync` is what can be had (SQLite falls back the same way). A file system
/// that cannot flush at all is not a failed write: the bytes are as safe as
/// the system makes them, which is what a save was before there was a flush.
fn flush_to_disk(f: &fs::File) -> io::Result<()> {
    match f.sync_all() {
        Ok(()) => Ok(()),
        #[cfg(target_os = "macos")]
        Err(e) if cannot_flush(&e) => match fsync(f) {
            Err(e) if cannot_flush(&e) => Ok(()),
            done => done,
        },
        #[cfg(not(target_os = "macos"))]
        Err(e) if cannot_flush(&e) => Ok(()),
        Err(e) => Err(e),
    }
}

/// An error that says the file system does not offer the flush asked for —
/// not that the flush failed. Unsupported (`ENOTSUP`, `EOPNOTSUPP`, `ENOSYS`),
/// an invalid request (`EINVAL`: Linux's word for a file that cannot be
/// synchronised), and `ENOTTY`, which is what a macOS file system without an
/// ioctl for `F_FULLFSYNC` answers; on Windows, `ERROR_INVALID_FUNCTION`. A
/// full disk (`ENOSPC`), an I/O error (`EIO`) or a lost connection is none of
/// these, and is the save's failure.
fn cannot_flush(e: &io::Error) -> bool {
    if matches!(e.kind(), ErrorKind::Unsupported | ErrorKind::InvalidInput) {
        return true;
    }
    let code = e.raw_os_error();
    #[cfg(target_os = "macos")]
    let refused = matches!(code, Some(libc::ENOTTY | libc::ENOTSUP | libc::EOPNOTSUPP | libc::ENOSYS | libc::EINVAL));
    // `libc` is a dependency on macOS only, so Linux's numbers are written
    // out: ENOTTY 25, EOPNOTSUPP 95, ENOSYS 38, EINVAL 22.
    #[cfg(target_os = "linux")]
    let refused = matches!(code, Some(25 | 95 | 38 | 22));
    #[cfg(windows)]
    let refused = matches!(code, Some(1));
    #[cfg(not(any(target_os = "macos", target_os = "linux", windows)))]
    let refused = {
        let _ = code;
        false
    };
    refused
}

/// A plain `fsync`, for a macOS file system that does not offer `F_FULLFSYNC`.
#[cfg(target_os = "macos")]
fn fsync(f: &fs::File) -> io::Result<()> {
    use std::os::fd::AsRawFd;
    loop {
        // SAFETY: the descriptor belongs to `f`, which is borrowed, and so
        // open, for the whole of the call.
        if unsafe { libc::fsync(f.as_raw_fd()) } == 0 {
            return Ok(());
        }
        let e = io::Error::last_os_error();
        if e.kind() != ErrorKind::Interrupted {
            return Err(e);
        }
    }
}

/// A file being written beside the one it will replace, under a name of its
/// own. Dropping it removes it — every early return, and a panic, leave
/// nothing behind — unless `put_in_place` has renamed it over the target.
///
/// The name is `.vylo-saving-<pid>-<n>.tmp`: hidden (a dot file) so the
/// folder does not show a half-written file while a large film lands, in the
/// same folder so the rename stays on one file system (a rename cannot cross
/// two, and a copy would not be atomic), and short — not the film's own name
/// with something added, because a title of a hundred and twenty Arabic
/// letters is already near the 255 bytes a file name may have, and a longer
/// temporary name would fail where the film's own would not. It is created
/// with `create_new`, so it never replaces anything and never follows a link
/// left at that name. A process killed between creating it and renaming it
/// (a crash, a power cut) leaves it there; the old file is whole beside it.
struct Temporary {
    path: Option<PathBuf>,
    file: Option<fs::File>,
}

impl Temporary {
    fn new(dir: &Path) -> io::Result<Temporary> {
        let mut taken = None;
        for _ in 0..MAX_TEMPORARY {
            let n = SAVING.fetch_add(1, Ordering::Relaxed);
            let path = dir.join(format!(".vylo-saving-{}-{n}.tmp", std::process::id()));
            match OpenOptions::new().write(true).create_new(true).open(&path) {
                Ok(file) => return Ok(Temporary { path: Some(path), file: Some(file) }),
                Err(e) if e.kind() == ErrorKind::AlreadyExists => taken = Some(e),
                Err(e) => return Err(e),
            }
        }
        Err(taken.unwrap_or_else(|| ErrorKind::AlreadyExists.into()))
    }

    fn file(&mut self) -> &mut fs::File {
        self.file.as_mut().expect("a temporary file is open until it is put in place")
    }

    /// Close it and rename it over `to`. From here it is the saved file, and
    /// dropping this removes nothing; if the rename fails, dropping it removes
    /// the temporary file and `to` is as it was.
    fn put_in_place(mut self, to: &Path) -> io::Result<()> {
        drop(self.file.take());
        let from = self.path.as_deref().expect("a temporary file has a path until it is put in place");
        fs::rename(from, to)?;
        self.path = None;
        Ok(())
    }
}

impl Drop for Temporary {
    fn drop(&mut self) {
        // Closed first: Windows removes an open file only once it is closed.
        drop(self.file.take());
        if let Some(p) = self.path.take() {
            let _ = fs::remove_file(p);
        }
    }
}

/// **Save as…**: put `bytes` at `p`, replacing what is there, so that the path
/// holds the old file whole or the new one whole, never half of either.
///
/// `fs::write` truncates the old file first and then writes. A disk that
/// fills part-way (`ENOSPC`) used to leave the person with neither: the old
/// film gone, and at its name an MP4 whose index comes first, so it opens and
/// then stops short. Here the film is written under a temporary name in the
/// same folder (`Temporary`), flushed to the disk (`put`), and renamed over
/// `p` only once all of it is there; a rename within one folder is atomic on
/// macOS, Linux and Windows. Any error — creating, writing, flushing,
/// renaming — removes the temporary file and leaves `p` untouched.
///
/// What this costs, and why it is accepted:
///
/// - while it is written, the new film and the old one are both on the disk,
///   so replacing a large film needs room for two. A disk with room for only
///   one now refuses the save and keeps the old film, where it used to lose
///   the old film and might have kept a whole new one;
/// - a folder that lets the person change a file but not add one (rare on a
///   personal Mac, where the save panel only offers folders it can write to)
///   refuses a replace that writing in place would have allowed;
/// - the new file is a new file: the old one's Finder tags, extended
///   attributes and owner are not carried over. Its permission bits are, so a
///   film kept private (`0600`) stays private;
/// - a link at `p` is replaced by the film, rather than written through: the
///   save panel showed the name in this folder, and this folder is where the
///   film goes. The link's target is not touched.
///
/// A file at `p` that the person may not write is refused, as `fs::write`
/// refused it, even though the rename alone could replace it: a film marked
/// read-only, or locked, was marked so to be kept. That is checked by opening
/// it for writing — without truncating, so nothing in it changes — which asks
/// the system exactly the question `fs::write` asked.
fn replace(p: &Path, bytes: &[u8]) -> Result<(), String> {
    replace_with(p, &|f: &mut fs::File| put(f, bytes))
}

/// `replace`, with how the bytes are written passed in, so the tests can make
/// the write fail part-way the way a full disk does.
fn replace_with(p: &Path, fill: &dyn Fn(&mut fs::File) -> io::Result<()>) -> Result<(), String> {
    let shown = p.to_string_lossy();
    let fail = |e: io::Error| format!("{shown}: {e}");
    let dir = p.parent().filter(|d| d.is_dir()).ok_or_else(|| format!("{shown}: its folder does not exist"))?;
    // A plain file already there: may it be written? (`symlink_metadata`, so a
    // link is neither followed nor asked about: it is replaced.)
    let old = p.symlink_metadata().ok().filter(|m| m.file_type().is_file());
    if old.is_some() {
        OpenOptions::new().write(true).open(p).map_err(fail)?;
    }
    let mut temp = Temporary::new(dir).map_err(fail)?;
    #[cfg(unix)]
    if let Some(m) = &old {
        use std::os::unix::fs::PermissionsExt;
        // Before a byte is written, so a private film is never readable by
        // others even for a moment. Best effort: some volumes (FAT, some
        // network shares) keep no permission bits and refuse the request.
        let _ = temp.file().set_permissions(fs::Permissions::from_mode(m.permissions().mode() & 0o777));
    }
    fill(temp.file()).map_err(fail)?;
    temp.put_in_place(p).map_err(fail)?;
    sync_folder(dir);
    Ok(())
}

/// Flush the folder, so the rename itself survives a power cut that follows
/// it, and not only the bytes it renamed. Best effort, and its failure is not
/// the save's: the film is already whole at its name, and some file systems
/// (and every Windows one, through `File::open`) do not flush a folder.
fn sync_folder(dir: &Path) {
    #[cfg(unix)]
    if let Ok(d) = fs::File::open(dir) {
        let _ = d.sync_all();
    }
    #[cfg(not(unix))]
    let _ = dir;
}

/// Write `bytes` to the first of `p`, `p (2)`, `p (3)`… that does not exist,
/// creating it exclusively — `O_EXCL`, which also refuses to follow a symlink
/// left at the name — so nothing already there is ever replaced. A write that
/// fails halfway, or whose flush to the disk fails (`put`), removes what it
/// began, rather than leave half a film — or report one as saved.
fn write_new(p: &Path, bytes: &[u8]) -> Result<PathBuf, String> {
    write_new_with(p, &|f: &mut fs::File| put(f, bytes))
}

/// `write_new`, with how the bytes are written passed in, for the tests.
fn write_new_with(p: &Path, fill: &dyn Fn(&mut fs::File) -> io::Result<()>) -> Result<PathBuf, String> {
    let shown = p.to_string_lossy();
    for n in 1..=MAX_NUMBERED {
        let at = numbered(p, n);
        match OpenOptions::new().write(true).create_new(true).open(&at) {
            Ok(mut f) => {
                if let Err(e) = fill(&mut f) {
                    drop(f);
                    let _ = fs::remove_file(&at);
                    return Err(format!("{}: {e}", at.to_string_lossy()));
                }
                return Ok(at);
            }
            // A file, a folder or a link already has this name: the next one.
            Err(e) if e.kind() == ErrorKind::AlreadyExists => continue,
            // Windows says "access denied" for an existing folder of that name.
            Err(_) if at.symlink_metadata().is_ok() => continue,
            Err(e) => return Err(format!("{}: {e}", at.to_string_lossy())),
        }
    }
    Err(format!("{shown}: there are already {MAX_NUMBERED} files with this name"))
}

/// The `x-path` header, percent-decoded. `encodeURIComponent` leaves only
/// unreserved ASCII and `%XX` escapes of UTF-8, so anything else — a bad
/// escape, a stray byte, a sequence that is not UTF-8 — is refused rather than
/// guessed at.
fn decode_path(header: Option<&[u8]>) -> Result<String, String> {
    let raw = header.ok_or_else(|| "no place to save the file was given".to_string())?;
    let bad = || "the place to save the file did not arrive intact".to_string();
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
        return Err("no place to save the file was given".into());
    }
    Ok(path)
}

/// A path to save at, checked: absolute, named as one of the six kinds, in a
/// folder that exists, and — when it may replace what is there — not a folder.
/// `pdf::check_pdf_path` for the Video panel's files.
fn check_path(path: &str, replacing: bool) -> Result<(PathBuf, Kind), String> {
    let p = PathBuf::from(path);
    if path.chars().any(|c| c.is_control()) || !p.is_absolute() {
        return Err(format!("{path}: is not a place to save to"));
    }
    let kind = Kind::of(&p).ok_or_else(|| format!("{path}: is not a file the Video panel saves (.mp4, .webm, .png, .gif, .srt or .json)"))?;
    if replacing && p.is_dir() {
        return Err(format!("{path}: is a directory"));
    }
    if !p.parent().is_some_and(Path::is_dir) {
        return Err(format!("{path}: its folder does not exist"));
    }
    Ok((p, kind))
}

/// Open a file the Video panel just saved in the app the system opens it with
/// — the film in the video player, the poster or the GIF in the image viewer,
/// the subtitles in a text editor — for the **Open** button beside "Saved to …".
///
/// Absent from the tool schema (`test/modes.test.mjs` names it), and narrower
/// than that alone would make it, because unlike `reveal_path` it hands a file
/// to another program:
///
/// - only a path `export_write_video` wrote in this run of the app, exactly as
///   it returned it. Nothing else on the disk can be opened through here,
///   whoever asks;
/// - only `.mp4`, `.webm`, `.png`, `.gif` and `.srt` — what a player or a
///   viewer shows.
///   Never the storyboard, and never anything that runs;
/// - only a plain file that is still there: not a folder, not a symlink;
/// - only while it still is what was written: its first bytes are checked
///   again — `ftyp`, the EBML magic, the PNG or GIF signature, UTF-8 text — so a file
///   swapped at that path since is refused rather than opened.
///
/// The path goes to `open` (macOS), `explorer` (Windows) or `xdg-open` as one
/// argument, never through a shell.
#[tauri::command]
pub fn open_exported(path: String) -> Result<(), String> {
    let p = check_openable(&path)?;
    open(&p).map_err(|e| format!("{path}: could not be opened ({e})"))
}

/// Everything `open_exported` checks, without the opening, for the tests.
pub fn check_openable(path: &str) -> Result<PathBuf, String> {
    let p = PathBuf::from(path);
    if path.chars().any(|c| c.is_control()) || !p.is_absolute() {
        return Err(format!("{path}: is not a path on this machine"));
    }
    let kind = Kind::of(&p).filter(|k| k.openable()).ok_or_else(|| format!("{path}: is not a video, a poster or subtitles"))?;
    if !was_written(&p) {
        return Err(format!("{path}: was not saved by the Video panel in this session"));
    }
    let meta = p.symlink_metadata().map_err(|_| format!("{path}: no longer exists"))?;
    if !meta.file_type().is_file() {
        return Err(format!("{path}: is not a file"));
    }
    // The head is enough for the four binary kinds; subtitles are read whole,
    // up to their ceiling, because a text file is text all the way through.
    let want = if kind == Kind::Srt { kind.cap() + 1 } else { 16 };
    let mut head = Vec::new();
    fs::File::open(&p)
        .and_then(|f| f.take(want as u64).read_to_end(&mut head))
        .map_err(|e| format!("{path}: {e}"))?;
    if head.len() > kind.cap() {
        return Err(format!("{path}: has changed since it was saved"));
    }
    kind.check(&head).map_err(|_| format!("{path}: has changed since it was saved"))?;
    Ok(p)
}

#[cfg(target_os = "macos")]
fn open(p: &Path) -> std::io::Result<()> {
    std::process::Command::new("open").arg(p).spawn().map(|_| ())
}

#[cfg(windows)]
fn open(p: &Path) -> std::io::Result<()> {
    // Explorer opens a file with the program registered for its type, as a
    // double-click would; `cmd /C start` would put the path through a shell.
    std::process::Command::new("explorer").arg(p).spawn().map(|_| ())
}

#[cfg(all(not(target_os = "macos"), not(windows)))]
fn open(p: &Path) -> std::io::Result<()> {
    std::process::Command::new("xdg-open").arg(p).spawn().map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeSet;

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

    /// A fresh folder per test: tests share a process, and two writing to one
    /// directory delete each other's files.
    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("vylo_exportvideo_{name}_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn listing(dir: &Path) -> BTreeSet<std::ffi::OsString> {
        fs::read_dir(dir).unwrap().flatten().map(|e| e.file_name()).collect()
    }

    /// Not a real film, but what the guard looks at: a box size, `ftyp`, then
    /// bytes that are not text, so a lossy round trip would show.
    fn film() -> Vec<u8> {
        let mut f = b"\x00\x00\x00\x20ftypisom".to_vec();
        f.extend((0u8..=255).cycle().take(4096));
        f
    }
    fn webm() -> Vec<u8> {
        let mut f = vec![0x1A, 0x45, 0xDF, 0xA3, 0x9F, 0x42, 0x86, 0x81, 0x01];
        f.extend((0u8..=255).rev().cycle().take(4096));
        f
    }
    fn png() -> Vec<u8> {
        let mut f = b"\x89PNG\r\n\x1a\n\x00\x00\x00\x0dIHDR".to_vec();
        f.extend((0u8..=255).cycle().take(2048));
        f
    }
    /// What Motion's GIF writer starts with: the signature, a 2 × 2 logical
    /// screen, then bytes that are not text.
    fn gif() -> Vec<u8> {
        let mut f = b"GIF89a\x02\x00\x02\x00\xf7\x00\x00".to_vec();
        f.extend((0u8..=255).cycle().take(2048));
        f.push(0x3B);
        f
    }
    /// The older version of the format, which the writer never makes but
    /// which is the same kind of file.
    fn gif87() -> Vec<u8> {
        let mut f = gif();
        f[3..6].copy_from_slice(b"87a");
        f
    }
    const SRT: &str = "1\r\n00:00:00,000 --> 00:00:02,500\r\nعيادة الأسنان\r\nڕێکلامی کلینیک ڤیدیۆ\r\n\r\n";
    const JSON: &str = "{\"vylo\":\"video\",\"video\":{\"title\":\"ڤیدیۆیا نوو\",\"scenes\":[]}}";

    /// Each of the six kinds is written byte for byte, whatever script its
    /// name is in, and a second save to the same place replaces the first.
    #[test]
    fn export_write_video_writes_each_kind_it_saves() {
        let dir = scratch("kinds");
        let at = |name: &str| dir.join(name).to_string_lossy().to_string();
        let write = |path: &str, bytes: &[u8]| write_media(Some(&encode(path)), None, &InvokeBody::Raw(bytes.to_vec()), None);

        for (name, bytes) in [
            ("promo.mp4", film()),
            ("Clip.MP4", film()),
            ("promo.webm", webm()),
            ("Poster.PNG", png()),
            ("promo.png", png()),
            ("loop.gif", gif()),
            ("Loop.GIF", gif87()),
            ("عيادة الأسنان 9x16.gif", gif()),
            ("promo.srt", SRT.as_bytes().to_vec()),
            ("promo.json", JSON.as_bytes().to_vec()),
            ("عيادة الأسنان.mp4", film()),
            ("ڕێکلامی کلینیک.webm", webm()),
            ("ڤیدیۆیا نوو.srt", format!("\u{feff}{SRT}").into_bytes()),
            ("a b+c&d%20.png", png()),
        ] {
            let got = write(&at(name), &bytes).unwrap_or_else(|e| panic!("{name}: {e}"));
            assert_eq!(got, at(name), "it says where it wrote");
            assert_eq!(fs::read(dir.join(name)).unwrap(), bytes, "{name}: the bytes on disk are the bytes sent");
        }

        // A second save to the same place replaces the first: the save panel
        // has already asked the person whether to.
        write(&at("promo.mp4"), b"\x00\x00\x00\x08ftypsecond").expect("should overwrite");
        assert_eq!(fs::read(dir.join("promo.mp4")).unwrap(), b"\x00\x00\x00\x08ftypsecond");
        let _ = fs::remove_dir_all(&dir);
    }

    /// Download: `Title.mp4`, then `Title (2).mp4`, `Title (3).mp4` — never a
    /// file replaced, a folder or a link of that name stepped past, and the
    /// path that was actually written is what comes back.
    #[test]
    fn a_unique_write_never_replaces_and_numbers_the_name() {
        let dir = scratch("unique");
        let at = |name: &str| dir.join(name).to_string_lossy().to_string();
        let unique = |path: &str, bytes: &[u8]| write_media(Some(&encode(path)), Some(b"1"), &InvokeBody::Raw(bytes.to_vec()), None);

        let first = film();
        assert_eq!(unique(&at("ڕێکلام.mp4"), &first).unwrap(), at("ڕێکلام.mp4"));
        let mut second = film();
        second.push(2);
        assert_eq!(unique(&at("ڕێکلام.mp4"), &second).unwrap(), at("ڕێکلام (2).mp4"));
        let mut third = film();
        third.push(3);
        assert_eq!(unique(&at("ڕێکلام.mp4"), &third).unwrap(), at("ڕێکلام (3).mp4"));
        assert_eq!(fs::read(dir.join("ڕێکلام.mp4")).unwrap(), first, "the first was not replaced");
        assert_eq!(fs::read(dir.join("ڕێکلام (2).mp4")).unwrap(), second);
        assert_eq!(fs::read(dir.join("ڕێکلام (3).mp4")).unwrap(), third);

        // The numbering is per name, and per extension.
        assert_eq!(unique(&at("ڕێکلام.png"), &png()).unwrap(), at("ڕێکلام.png"));
        assert_eq!(unique(&at("ڕێکلام.gif"), &gif()).unwrap(), at("ڕێکلام.gif"));
        assert_eq!(unique(&at("ڕێکلام.gif"), &gif87()).unwrap(), at("ڕێکلام (2).gif"));
        assert_eq!(fs::read(dir.join("ڕێکلام.gif")).unwrap(), gif(), "the first GIF was not replaced");
        assert_eq!(unique(&at("ڕێکلام.srt"), SRT.as_bytes()).unwrap(), at("ڕێکلام.srt"));

        // A folder with the name is stepped past rather than refused.
        fs::create_dir_all(dir.join("Film.mp4")).unwrap();
        assert_eq!(unique(&at("Film.mp4"), &first).unwrap(), at("Film (2).mp4"));
        assert!(dir.join("Film.mp4").is_dir(), "the folder is untouched");

        // A link at the name is never followed: its target keeps its bytes.
        #[cfg(unix)]
        {
            let target = dir.join("elsewhere.txt");
            fs::write(&target, "keep me").unwrap();
            std::os::unix::fs::symlink(&target, dir.join("Linked.mp4")).unwrap();
            assert_eq!(unique(&at("Linked.mp4"), &first).unwrap(), at("Linked (2).mp4"));
            assert_eq!(fs::read_to_string(&target).unwrap(), "keep me");
            // A dangling one too.
            std::os::unix::fs::symlink(dir.join("nowhere"), dir.join("Dangling.mp4")).unwrap();
            assert_eq!(unique(&at("Dangling.mp4"), &first).unwrap(), at("Dangling (2).mp4"));
            assert!(!dir.join("nowhere").exists(), "the link's target was not created");
        }

        // Checks come first: a refused unique write numbers nothing.
        let before = listing(&dir);
        assert!(unique(&at("ڕێکلام.mp4"), b"not a film").unwrap_err().contains("is not an MP4 video"));
        assert!(unique(&at("ڕێکلام.exe"), &first).unwrap_err().contains("is not a file the Video panel saves"));
        assert!(unique(&at("ڕێکلام.gif"), &png()).unwrap_err().contains("is not a GIF image"));
        assert_eq!(listing(&dir), before, "a refusal wrote nothing");

        // The header means one thing.
        for bad in [b"0".as_slice(), b"true", b"", b"1 "] {
            let err = write_media(Some(&encode(&at("x.mp4"))), Some(bad), &InvokeBody::Raw(first.clone()), None).unwrap_err();
            assert!(err.contains("did not arrive intact"), "{err}");
        }
        assert_eq!(listing(&dir), before);

        // `numbered` itself.
        let p = Path::new("/a/Title.mp4");
        assert_eq!(numbered(p, 1), PathBuf::from("/a/Title.mp4"));
        assert_eq!(numbered(p, 2), PathBuf::from("/a/Title (2).mp4"));
        assert_eq!(numbered(Path::new("/a/Title (2).mp4"), 2), PathBuf::from("/a/Title (2) (2).mp4"));
        assert_eq!(numbered(Path::new("/a/عيادة.webm"), 12), PathBuf::from("/a/عيادة (12).webm"));
        let _ = fs::remove_dir_all(&dir);
    }

    /// Every refusal fires and leaves nothing behind — a missing or mangled
    /// header, a relative path, a name the panel never saves, a directory, a
    /// missing folder, a JSON body, bytes that are not what the name says, and
    /// too many of them.
    #[test]
    fn export_write_video_refuses_what_it_does_not_save() {
        let dir = scratch("refuse");
        let at = |name: &str| dir.join(name).to_string_lossy().to_string();
        let raw = InvokeBody::Raw(film());
        let before = listing(&dir);
        let refused = |header: Option<&[u8]>, body: &InvokeBody, why: &str| {
            let err = write_media(header, None, body, None)
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
        for name in [
            ".zshrc", "profile.zsh", "notes.txt", "promo", "promo.mp4.txt", "promo.mov", "promo.m4v", "thesis.docx",
            "mp4", ".mp4", ".png", "run.sh", "Setup.exe", "a.app", "page.html", "img.svg", "sub.vtt", "x.webp", "x.jpg",
            ".gif", "gif", "loop.gifv", "loop.gif.exe", "x.apng", "x.jpeg",
        ] {
            refused(Some(&encode(&at(name))), &raw, "is not a file the Video panel saves");
        }
        refused(Some(&encode(&dir.to_string_lossy())), &raw, "is not a file the Video panel saves");
        // A directory whose name ends in .mp4 is still a directory.
        fs::create_dir_all(dir.join("folder.mp4")).unwrap();
        refused(Some(&encode(&at("folder.mp4"))), &raw, "is a directory");
        // No directories are made: the save panel only offers places that exist.
        let missing = dir.join("no such folder").join("promo.mp4");
        refused(Some(&encode(&missing.to_string_lossy())), &raw, "its folder does not exist");
        assert!(!dir.join("no such folder").exists(), "the parent was not created");

        // The body.
        refused(Some(&encode(&at("json.mp4"))), &InvokeBody::Json(serde_json::json!({ "data": "AAAA" })), "did not arrive as bytes");
        refused(Some(&encode(&at("json.srt"))), &InvokeBody::Json(serde_json::json!("1\n")), "did not arrive as bytes");
        let not = |name: &str, bytes: &[u8], why: &str| refused(Some(&encode(&at(name))), &InvokeBody::Raw(bytes.to_vec()), why);
        for (name, bytes) in [
            ("empty.mp4", b"".as_slice()),
            ("short.mp4", b"\x00\x00\x00\x08ftp".as_slice()),
            ("zip.mp4", b"PK\x03\x04zip-ftyp".as_slice()),
            ("webm.mp4", &webm()[..]),
            ("text.mp4", b"#!/bin/sh\nrm -rf ~\n".as_slice()),
            ("shifted.mp4", b"\x00\x00\x00\x00\x08ftypisom".as_slice()),
        ] {
            not(name, bytes, "is not an MP4 video");
        }
        for (name, bytes) in [
            ("empty.webm", b"".as_slice()),
            ("mp4.webm", &film()[..]),
            ("short.webm", b"\x1a\x45\xdf".as_slice()),
            ("shifted.webm", b"\x00\x1a\x45\xdf\xa3".as_slice()),
        ] {
            not(name, bytes, "is not a WebM video");
        }
        for (name, bytes) in [
            ("empty.png", b"".as_slice()),
            ("jpeg.png", b"\xff\xd8\xff\xe0\x00\x10JFIF".as_slice()),
            ("text.png", b"PNG\r\n".as_slice()),
            ("almost.png", b"\x89PNG\r\n\x1a\x00".as_slice()),
            ("svg.png", b"<svg xmlns='http://www.w3.org/2000/svg'/>".as_slice()),
        ] {
            not(name, bytes, "is not a PNG image");
        }
        for (name, bytes) in [
            ("empty.gif", b"".as_slice()),
            ("gif.gif", &png()[..]),
            ("mp4.gif", &film()[..]),
            ("short.gif", b"GIF89".as_slice()),
            ("lower.gif", b"gif89a\x01\x00\x01\x00".as_slice()),
            ("future.gif", b"GIF90a\x01\x00\x01\x00".as_slice()),
            ("shifted.gif", b"\x00GIF89a\x01\x00".as_slice()),
            ("svg.gif", b"<svg xmlns='http://www.w3.org/2000/svg'/>".as_slice()),
            ("text.gif", b"#!/bin/sh\nGIF89a\n".as_slice()),
        ] {
            not(name, bytes, "is not a GIF image");
        }
        // And a GIF is not anything else.
        not("gif.png", &gif(), "is not a PNG image");
        not("gif.mp4", &gif(), "is not an MP4 video");
        not("latin1.srt", b"1\n00:00:00,000 --> 00:00:01,000\ncaf\xe9\n", "is not UTF-8 text");
        not("binary.srt", &film()[..], "is not UTF-8 text");
        not("nul.srt", b"1\n00:00:00,000 --> 00:00:01,000\nhi\x00\n", "is not plain text");
        not("escape.srt", b"1\n\x1b[31mred\x1b[0m\n", "is not plain text");
        not("bell.srt", "\u{7}".as_bytes(), "is not plain text");
        not("broken.json", b"{\"title\": ", "is not JSON");
        not("script.json", b"#!/usr/bin/env node\nconsole.log(1)", "is not JSON");
        not("latin1.json", b"{\"t\":\"caf\xe9\"}", "is not UTF-8 text");
        not("empty.json", b"", "is not JSON");

        let mut expected = before.clone();
        expected.insert("folder.mp4".into());
        assert_eq!(listing(&dir), expected, "a refusal wrote nothing");
        let _ = fs::remove_dir_all(&dir);
    }

    /// Each kind has its own ceiling. Exactly at it is written; over it is
    /// refused, and refused before the bytes are looked at.
    #[test]
    fn each_kind_has_a_ceiling() {
        assert_eq!(Kind::Mp4.cap(), 1024 * 1024 * 1024);
        assert_eq!(Kind::Webm.cap(), 1024 * 1024 * 1024);
        assert_eq!(Kind::Png.cap(), 64 * 1024 * 1024);
        assert_eq!(Kind::Gif.cap(), 64 * 1024 * 1024);
        assert_eq!(Kind::Srt.cap(), 5 * 1024 * 1024);
        assert_eq!(Kind::Json.cap(), 5 * 1024 * 1024);

        let dir = scratch("caps");
        let at = |name: &str| dir.join(name).to_string_lossy().to_string();
        let cap = b"\x00\x00\x00\x08ftyp12".to_vec();
        write_media(Some(&encode(&at("cap.mp4"))), None, &InvokeBody::Raw(cap.clone()), Some(cap.len())).expect("exactly the ceiling is allowed");
        assert_eq!(fs::read(dir.join("cap.mp4")).unwrap(), cap);
        let err = write_media(Some(&encode(&at("big.mp4"))), None, &InvokeBody::Raw(cap.clone()), Some(cap.len() - 1)).expect_err("one byte over the ceiling");
        assert!(err.contains("larger than"), "{err}");
        let err = write_media(Some(&encode(&at("bigjunk.mp4"))), None, &InvokeBody::Raw(vec![0; 64]), Some(10)).expect_err("too big and not an MP4");
        assert!(err.contains("larger than"), "the size is checked first: {err}");
        let small = gif();
        write_media(Some(&encode(&at("cap.gif"))), None, &InvokeBody::Raw(small.clone()), Some(small.len())).expect("a GIF exactly at the ceiling");
        let err = write_media(Some(&encode(&at("big.gif"))), None, &InvokeBody::Raw(small.clone()), Some(small.len() - 1)).expect_err("a GIF one byte over");
        assert!(err.contains("larger than"), "{err}");
        // The real ceiling, with real bytes: one byte over 64 MiB is refused,
        // and said in the units a person reads.
        let mut huge = gif();
        huge.resize(MAX_IMAGE_BYTES + 1, 0);
        let err = write_media(Some(&encode(&at("huge.gif"))), None, &InvokeBody::Raw(huge), None).unwrap_err();
        assert!(err.contains("larger than 64 MB"), "{err}");

        // The real text ceiling, with real bytes: five mebibytes of subtitles
        // pass, one more byte does not.
        let text = "a\n".repeat(MAX_TEXT_BYTES / 2);
        assert_eq!(text.len(), MAX_TEXT_BYTES);
        write_media(Some(&encode(&at("long.srt"))), None, &InvokeBody::Raw(text.clone().into_bytes()), None).expect("five MB of subtitles");
        let err = write_media(Some(&encode(&at("longer.srt"))), None, &InvokeBody::Raw(format!("{text}a").into_bytes()), None).unwrap_err();
        assert!(err.contains("larger than 5 MB"), "{err}");
        let json = format!("\"{}\"", "a".repeat(MAX_TEXT_BYTES - 1));
        let err = write_media(Some(&encode(&at("big.json"))), None, &InvokeBody::Raw(json.into_bytes()), None).unwrap_err();
        assert!(err.contains("larger than 5 MB"), "{err}");

        let names: BTreeSet<_> = listing(&dir);
        assert_eq!(names, ["cap.gif", "cap.mp4", "long.srt"].iter().map(std::ffi::OsString::from).collect(), "only what passed was written");
        let _ = fs::remove_dir_all(&dir);
    }

    /// Open only what this command wrote, only a kind a player or viewer
    /// shows, only a plain file, and only while it still is what was written.
    #[test]
    fn open_exported_opens_only_what_was_just_written() {
        let dir = scratch("open");
        let at = |name: &str| dir.join(name).to_string_lossy().to_string();
        let write = |name: &str, bytes: &[u8]| write_media(Some(&encode(&at(name))), Some(b"1"), &InvokeBody::Raw(bytes.to_vec()), None).unwrap();

        // What was written opens, by the path the write returned.
        for (name, bytes) in [
            ("film.mp4", film()),
            ("film.webm", webm()),
            ("poster.png", png()),
            ("loop.gif", gif()),
            ("old.gif", gif87()),
            ("ڤیدیۆ.srt", SRT.as_bytes().to_vec()),
        ] {
            let got = write(name, &bytes);
            assert_eq!(check_openable(&got).unwrap(), dir.join(name), "{name}");
        }
        let second = write("film.mp4", &film());
        assert!(second.ends_with("film (2).mp4"));
        check_openable(&second).expect("the numbered one too");

        let refused = |path: &str, why: &str| {
            let err = check_openable(path).expect_err(path);
            assert!(err.contains(why), "{path}: expected {why:?}, got {err:?}");
        };
        // The storyboard is written but never opened.
        let backup = write("board.json", JSON.as_bytes());
        refused(&backup, "is not a video, a poster or subtitles");
        // A file of the right kind that this command did not write.
        fs::write(dir.join("other.mp4"), film()).unwrap();
        refused(&at("other.mp4"), "was not saved by the Video panel");
        // Paths that are not paths, or not the kinds.
        refused("film.mp4", "is not a path on this machine");
        refused(&format!("{}\n", at("film.mp4")), "is not a path on this machine");
        for name in ["run.sh", "Setup.exe", "a.app", "page.html", "film.mov", "x"] {
            refused(&at(name), "is not a video, a poster or subtitles");
        }

        // Gone since.
        let gone = write("gone.mp4", &film());
        fs::remove_file(&gone).unwrap();
        refused(&gone, "no longer exists");
        // Swapped for a folder, or for a link.
        let swapped = write("swapped.png", &png());
        fs::remove_file(&swapped).unwrap();
        fs::create_dir(&swapped).unwrap();
        refused(&swapped, "is not a file");
        #[cfg(unix)]
        {
            let linked = write("linked.mp4", &film());
            fs::remove_file(&linked).unwrap();
            std::os::unix::fs::symlink(dir.join("film.mp4"), &linked).unwrap();
            refused(&linked, "is not a file");
        }
        // Rewritten with something that is not what it was.
        let changed = write("changed.mp4", &film());
        fs::write(&changed, b"#!/bin/sh\necho hi\n").unwrap();
        refused(&changed, "has changed since it was saved");
        let changed = write("changed.srt", SRT.as_bytes());
        fs::write(&changed, b"1\n\x00\x01\x02").unwrap();
        refused(&changed, "has changed since it was saved");
        let changed = write("changed.png", &png());
        fs::write(&changed, b"").unwrap();
        refused(&changed, "has changed since it was saved");
        let changed = write("changed.gif", &gif());
        fs::write(&changed, png()).unwrap();
        refused(&changed, "has changed since it was saved");

        // A refused write is not remembered.
        let err = write_media(Some(&encode(&at("never.mp4"))), None, &InvokeBody::Raw(b"no".to_vec()), None).unwrap_err();
        assert!(err.contains("is not an MP4 video"));
        fs::write(dir.join("never.mp4"), film()).unwrap();
        refused(&at("never.mp4"), "was not saved by the Video panel");

        // And the command itself refuses before it would spawn anything.
        assert!(open_exported(at("other.mp4")).is_err());
        assert!(open_exported("relative.mp4".into()).is_err());
        let _ = fs::remove_dir_all(&dir);
    }

    /// The list of written paths forgets the oldest first, and only them.
    #[test]
    fn the_written_list_is_bounded() {
        let base = Path::new("/vylo-bounded");
        let mut w = Written::new();
        for i in 0..(REMEMBERED + 10) {
            w.add(&base.join(format!("{i}.mp4")));
        }
        assert_eq!(w.0.len(), REMEMBERED);
        assert!(!w.has(&base.join("0.mp4")), "the oldest is forgotten");
        assert!(!w.has(&base.join("9.mp4")));
        assert!(w.has(&base.join("10.mp4")));
        assert!(w.has(&base.join(format!("{}.mp4", REMEMBERED + 9))));
        // Remembering again moves a path to the newest end instead of doubling it.
        w.add(&base.join("10.mp4"));
        assert_eq!(w.0.iter().filter(|p| **p == base.join("10.mp4")).count(), 1);
        assert_eq!(w.0.last(), Some(&base.join("10.mp4")));
        assert_eq!(w.0.len(), REMEMBERED);
    }

    /// The header decoder is the one piece written by hand; pin it against
    /// what `encodeURIComponent` produces for every script the app speaks.
    #[test]
    fn the_path_header_round_trips_what_encode_uri_component_sends() {
        for s in ["/Users/a/Movies/promo.mp4", "/Users/a/فيديو/عيادة.mp4", "/Users/a/ڤیدیۆ/ڕێکلام ٣٠ چرکە.webm", "C:\\Users\\a\\x y.png", "/tmp/100% (final)!.srt"] {
            assert_eq!(decode_path(Some(&encode(s))).unwrap(), s);
        }
        // Lower-case escapes are what some encoders emit; they mean the same.
        assert_eq!(decode_path(Some(b"/a/%d8%b9.mp4")).unwrap(), "/a/ع.mp4");
    }

    /// The kind comes from the extension, in any case, and nothing else.
    #[test]
    fn the_kind_is_the_extension() {
        assert_eq!(Kind::of(Path::new("/a/b.mp4")), Some(Kind::Mp4));
        assert_eq!(Kind::of(Path::new("/a/b.MP4")), Some(Kind::Mp4));
        assert_eq!(Kind::of(Path::new("/a/b.WebM")), Some(Kind::Webm));
        assert_eq!(Kind::of(Path::new("/a/b.png")), Some(Kind::Png));
        assert_eq!(Kind::of(Path::new("/a/b.gif")), Some(Kind::Gif));
        assert_eq!(Kind::of(Path::new("/a/b.GIF")), Some(Kind::Gif));
        assert_eq!(Kind::of(Path::new("/a/b.gifv")), None);
        assert_eq!(Kind::of(Path::new("/a/.gif")), None);
        assert_eq!(Kind::of(Path::new("/a/b.srt")), Some(Kind::Srt));
        assert_eq!(Kind::of(Path::new("/a/b.json")), Some(Kind::Json));
        assert_eq!(Kind::of(Path::new("/a/b.mp4.exe")), None);
        assert_eq!(Kind::of(Path::new("/a/.mp4")), None);
        assert_eq!(Kind::of(Path::new("/a/mp4")), None);
        assert_eq!(Kind::of(Path::new("/a/b.")), None);
    }

    // ── saving robustly: a full disk, a late error, a read-only place ──────

    /// What a disk that fills up part-way says: the system's own error, so its
    /// words are exactly the words the Export tab reads (`MotionExport.tsx`,
    /// `diskTrouble`): `No space left on device (os error 28)` on macOS and
    /// Linux, `ERROR_DISK_FULL` (112) on Windows.
    fn full_disk() -> io::Error {
        #[cfg(windows)]
        let e = io::Error::from_raw_os_error(112);
        #[cfg(not(windows))]
        let e = io::Error::from_raw_os_error(28);
        e
    }

    /// What a network volume says at the flush when the bytes it took never
    /// reached its disk: an I/O error (`EIO`).
    fn lost() -> io::Error {
        #[cfg(windows)]
        let e = io::Error::from_raw_os_error(1117);
        #[cfg(not(windows))]
        let e = io::Error::from_raw_os_error(5);
        e
    }

    /// The temporary files a replacing write makes, found in a folder.
    fn temporaries(dir: &Path) -> Vec<std::ffi::OsString> {
        listing(dir).into_iter().filter(|n| n.to_string_lossy().starts_with(".vylo-saving-")).collect()
    }

    fn names(list: &[&str]) -> BTreeSet<std::ffi::OsString> {
        list.iter().map(std::ffi::OsString::from).collect()
    }

    /// **Save as…** over an existing file replaces it by a rename: the new
    /// bytes are there afterwards, and nothing else is — no temporary file is
    /// left beside it. In every script the app speaks, at a name near the
    /// longest a file system allows, with its permission bits, and over a link.
    #[test]
    fn save_as_replaces_by_a_rename_and_leaves_no_temporary_file() {
        let dir = scratch("atomic");
        let at = |name: &str| dir.join(name).to_string_lossy().to_string();
        let save = |path: &str, bytes: &[u8]| write_media(Some(&encode(path)), None, &InvokeBody::Raw(bytes.to_vec()), None);
        let mut second = film();
        second.extend(b"the second film, longer than the first");

        // Over an existing film: the new one is there, and only it.
        fs::write(dir.join("promo.mp4"), film()).unwrap();
        assert_eq!(save(&at("promo.mp4"), &second).unwrap(), at("promo.mp4"));
        assert_eq!(fs::read(dir.join("promo.mp4")).unwrap(), second, "the new bytes, all of them");
        assert_eq!(listing(&dir), names(&["promo.mp4"]), "no temporary file beside it");
        // Shorter than what it replaces: no tail of the old film is left.
        let short = b"\x00\x00\x00\x08ftypshort".to_vec();
        save(&at("promo.mp4"), &short).unwrap();
        assert_eq!(fs::read(dir.join("promo.mp4")).unwrap(), short);

        // Arabic and Kurdish names, for each kind Motion saves, written new and
        // then replaced.
        let mut png2 = png();
        png2.extend(b"second");
        for (name, first, then) in [
            ("عيادة الأسنان.mp4", film(), second.clone()),
            ("ڕێکلامی کلینیک ٣٠ چرکە.gif", gif(), gif87()),
            ("ڤیدیۆیا نوو.png", png(), png2.clone()),
            ("Kurdî û عەرەبی.MP4", film(), second.clone()),
        ] {
            assert_eq!(save(&at(name), &first).unwrap_or_else(|e| panic!("{name}: {e}")), at(name));
            assert_eq!(save(&at(name), &then).unwrap_or_else(|e| panic!("{name}: {e}")), at(name));
            assert_eq!(fs::read(dir.join(name)).unwrap(), then, "{name}: replaced");
        }

        // A title of 120 Arabic letters is 240 bytes, near the 255 a name may
        // have. The temporary name does not grow with it, so the save works
        // wherever the film's own name does.
        let long = format!("{}.mp4", "ع".repeat(120));
        assert_eq!(long.len(), 244);
        save(&at(&long), &film()).unwrap_or_else(|e| panic!("a long Arabic name: {e}"));
        save(&at(&long), &second).unwrap_or_else(|e| panic!("a long Arabic name, replaced: {e}"));
        assert_eq!(fs::read(dir.join(&long)).unwrap(), second);

        // The permission bits are carried over: a film kept private stays private.
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(dir.join("promo.mp4"), fs::Permissions::from_mode(0o600)).unwrap();
            save(&at("promo.mp4"), &second).unwrap();
            assert_eq!(fs::metadata(dir.join("promo.mp4")).unwrap().permissions().mode() & 0o777, 0o600, "still private");
            fs::set_permissions(dir.join("promo.mp4"), fs::Permissions::from_mode(0o640)).unwrap();
            save(&at("promo.mp4"), &short).unwrap();
            assert_eq!(fs::metadata(dir.join("promo.mp4")).unwrap().permissions().mode() & 0o777, 0o640);
        }

        // A link at the name is replaced by the film, not written through: the
        // file it pointed at, wherever that is, keeps its bytes.
        #[cfg(unix)]
        {
            let target = dir.join("elsewhere.txt");
            fs::write(&target, "keep me").unwrap();
            std::os::unix::fs::symlink(&target, dir.join("Linked.mp4")).unwrap();
            save(&at("Linked.mp4"), &second).unwrap();
            assert_eq!(fs::read_to_string(&target).unwrap(), "keep me", "the link's target is untouched");
            let meta = dir.join("Linked.mp4").symlink_metadata().unwrap();
            assert!(meta.file_type().is_file(), "the name now holds the film itself");
            assert_eq!(fs::read(dir.join("Linked.mp4")).unwrap(), second);
        }

        // Many saves in a row, and to a new name: still nothing left behind.
        for i in 0..20u8 {
            let mut f = film();
            f.push(i);
            save(&at("again.mp4"), &f).unwrap();
            assert_eq!(fs::read(dir.join("again.mp4")).unwrap(), f);
        }
        assert!(temporaries(&dir).is_empty(), "{:?}", temporaries(&dir));
        let _ = fs::remove_dir_all(&dir);
    }

    /// A Save as… that fails — the disk full half-way through the film, an
    /// error that arrives only at the flush, a panic, a rename the folder
    /// refuses — leaves the old file exactly as it was, and no temporary file.
    ///
    /// The failures are made by handing `replace_with` a write that fails the
    /// way the system's does, with the system's own error: this cannot fill a
    /// real disk (that is `a_real_full_disk`, run by hand on a small volume).
    #[test]
    fn a_failed_save_as_leaves_the_old_file_whole() {
        let dir = scratch("failed");
        let p = dir.join("عيادة الأسنان.mp4");
        let shown = p.to_string_lossy().to_string();
        let old = film();
        fs::write(&p, &old).unwrap();
        let before = listing(&dir);
        let mut new = film();
        new.extend((0u8..=255).rev().cycle().take(8192));

        // The disk fills half-way through the film.
        let half = |f: &mut fs::File| -> io::Result<()> {
            f.write_all(&new[..new.len() / 2])?;
            Err(full_disk())
        };
        let err = replace_with(&p, &half).unwrap_err();
        assert!(err.starts_with(&format!("{shown}: ")), "the error names the file asked for, not the temporary one: {err}");
        assert!(err.ends_with(&format!("{}", full_disk())), "and says what the system said: {err}");
        #[cfg(unix)]
        assert!(err.ends_with("No space left on device (os error 28)"), "{err}");
        assert_eq!(fs::read(&p).unwrap(), old, "the old film is whole");
        assert_eq!(listing(&dir), before, "and nothing is beside it");

        // All of it written, and then the flush fails: a network volume's late error.
        let late = |f: &mut fs::File| -> io::Result<()> {
            f.write_all(&new)?;
            Err(lost())
        };
        assert!(replace_with(&p, &late).unwrap_err().ends_with(&format!("{}", lost())));
        assert_eq!(fs::read(&p).unwrap(), old);
        assert_eq!(listing(&dir), before);

        // A write that panics: the temporary file goes with the unwinding.
        let panicked = std::panic::catch_unwind(|| replace_with(&p, &|_f: &mut fs::File| -> io::Result<()> { panic!("a writer that panics") }));
        assert!(panicked.is_err());
        assert_eq!(fs::read(&p).unwrap(), old);
        assert_eq!(listing(&dir), before);

        // Nothing at the name yet: a failed first save leaves nothing at all.
        let fresh = dir.join("ڕێکلام.mp4");
        assert!(replace_with(&fresh, &half).is_err());
        assert!(!fresh.exists());
        assert_eq!(listing(&dir), before);

        // The rename refused: a folder (not empty) at the name. `check_path`
        // refuses a folder before any of this; this is the folder that appears
        // between that check and the rename.
        let folder = dir.join("folder.mp4");
        fs::create_dir(&folder).unwrap();
        fs::write(folder.join("inside.txt"), "keep me").unwrap();
        assert!(replace_with(&folder, &|f: &mut fs::File| f.write_all(&new)).is_err());
        assert_eq!(fs::read_to_string(folder.join("inside.txt")).unwrap(), "keep me");
        let mut with_folder = before.clone();
        with_folder.insert("folder.mp4".into());
        assert_eq!(listing(&dir), with_folder, "no temporary file after a failed rename either");

        // And the same file saved for real afterwards is fine.
        replace(&p, &new).unwrap();
        assert_eq!(fs::read(&p).unwrap(), new);
        assert!(temporaries(&dir).is_empty());
        let _ = fs::remove_dir_all(&dir);
    }

    /// Download: a write that fails part-way, or whose flush fails after every
    /// byte was taken, removes the file it began, so a failure is never a
    /// half film in the Downloads folder — and the name it took is free again.
    #[test]
    fn a_failed_download_leaves_nothing() {
        let dir = scratch("download-fails");
        let p = dir.join("ڕێکلام.mp4");
        let half = |f: &mut fs::File| -> io::Result<()> {
            f.write_all(&film()[..1000])?;
            Err(full_disk())
        };
        let late = |f: &mut fs::File| -> io::Result<()> {
            f.write_all(&film())?;
            Err(lost())
        };
        let err = write_new_with(&p, &half).unwrap_err();
        assert!(err.starts_with(&format!("{}: ", p.to_string_lossy())) && err.ends_with(&format!("{}", full_disk())), "{err}");
        assert!(listing(&dir).is_empty(), "the partial film was removed");
        assert!(write_new_with(&p, &late).unwrap_err().ends_with(&format!("{}", lost())));
        assert!(listing(&dir).is_empty(), "the film whose flush failed was removed");

        // With a film already at the name: it is kept, the numbered one that
        // failed is removed, and the error names the numbered one.
        let first = film();
        fs::write(&p, &first).unwrap();
        let err = write_new_with(&p, &half).unwrap_err();
        assert!(err.contains("ڕێکلام (2).mp4"), "{err}");
        assert_eq!(listing(&dir), names(&["ڕێکلام.mp4"]));
        assert_eq!(fs::read(&p).unwrap(), first);
        // The next Download takes the name the failure gave back.
        assert_eq!(write_new(&p, &film()).unwrap(), dir.join("ڕێکلام (2).mp4"));
        let _ = fs::remove_dir_all(&dir);
    }

    /// A place the system will not let the person write: the old file is kept
    /// and the system's reason is passed on (the Export tab turns it into a
    /// sentence). A file marked read-only is refused as `fs::write` refused
    /// it, though a rename could replace it. A read-only folder refuses the
    /// temporary file, so it refuses the save — where writing in place would
    /// have replaced the old file — and the old file is untouched.
    #[cfg(unix)]
    #[test]
    fn a_read_only_file_or_folder_keeps_the_old_file() {
        use std::os::unix::fs::PermissionsExt;
        let dir = scratch("readonly");
        let at = |name: &str| dir.join(name).to_string_lossy().to_string();
        let save = |path: &str, bytes: &[u8]| write_media(Some(&encode(path)), None, &InvokeBody::Raw(bytes.to_vec()), None);
        let p = dir.join("ڤیدیۆ.mp4");
        let old = film();
        fs::write(&p, &old).unwrap();
        let mut new = film();
        new.extend(b"new");
        let mode = |q: &Path, m: u32| fs::set_permissions(q, fs::Permissions::from_mode(m)).unwrap();
        // Root may write anywhere; the refusals below are then not the system's to make.
        let enforced = |q: &Path| OpenOptions::new().write(true).open(q).is_err();

        mode(&p, 0o444);
        if enforced(&p) {
            let err = save(&at("ڤیدیۆ.mp4"), &new).unwrap_err();
            assert!(err.ends_with("Permission denied (os error 13)"), "{err}");
            assert_eq!(fs::read(&p).unwrap(), old, "a read-only film is not replaced");
            assert_eq!(listing(&dir), names(&["ڤیدیۆ.mp4"]));
        }
        mode(&p, 0o644);

        mode(&dir, 0o555);
        let probe = dir.join("probe");
        let locked = OpenOptions::new().write(true).create_new(true).open(&probe).is_err();
        let _ = fs::remove_file(&probe);
        if locked {
            let err = save(&at("ڤیدیۆ.mp4"), &new).unwrap_err();
            assert!(err.ends_with("Permission denied (os error 13)"), "{err}");
            assert_eq!(fs::read(&p).unwrap(), old, "the old film is whole");
            let err = write_media(Some(&encode(&at("نوێ.mp4"))), Some(b"1"), &InvokeBody::Raw(new.clone()), None).unwrap_err();
            assert!(err.ends_with("Permission denied (os error 13)"), "a download there too: {err}");
            assert_eq!(listing(&dir), names(&["ڤیدیۆ.mp4"]), "nothing was added");
        }
        mode(&dir, 0o755);
        save(&at("ڤیدیۆ.mp4"), &new).expect("writable again");
        assert_eq!(fs::read(&p).unwrap(), new);
        let _ = fs::remove_dir_all(&dir);
    }

    /// A file system that cannot flush is not a failed save; a flush that
    /// fails is. And the flush itself works on the disk the tests run on.
    #[test]
    fn a_flush_the_file_system_does_not_offer_is_not_a_failure() {
        assert!(cannot_flush(&io::Error::from(ErrorKind::Unsupported)));
        assert!(cannot_flush(&io::Error::from(ErrorKind::InvalidInput)));
        #[cfg(unix)]
        {
            assert!(cannot_flush(&io::Error::from_raw_os_error(25)), "ENOTTY: no ioctl for F_FULLFSYNC");
            assert!(cannot_flush(&io::Error::from_raw_os_error(22)), "EINVAL");
        }
        #[cfg(target_os = "macos")]
        {
            assert!(cannot_flush(&io::Error::from_raw_os_error(libc::ENOTSUP)));
            assert!(cannot_flush(&io::Error::from_raw_os_error(libc::EOPNOTSUPP)));
        }
        assert!(!cannot_flush(&full_disk()), "a full disk is the save's failure");
        assert!(!cannot_flush(&lost()), "so is an I/O error");
        assert!(!cannot_flush(&io::Error::from(ErrorKind::StorageFull)));
        assert!(!cannot_flush(&io::Error::from(ErrorKind::PermissionDenied)));
        #[cfg(unix)]
        {
            assert!(!cannot_flush(&io::Error::from_raw_os_error(30)), "EROFS");
            assert!(!cannot_flush(&io::Error::from_raw_os_error(69)), "EDQUOT on macOS");
            assert!(!cannot_flush(&io::Error::from_raw_os_error(122)), "EDQUOT on Linux");
        }

        let dir = scratch("flush");
        let mut f = OpenOptions::new().write(true).create_new(true).open(dir.join("f.mp4")).unwrap();
        put(&mut f, &film()).expect("write and flush on a local disk");
        drop(f);
        assert_eq!(fs::read(dir.join("f.mp4")).unwrap(), film());
        let _ = fs::remove_dir_all(&dir);
    }

    /// A real full disk, not a simulated one. Ignored by default: it needs a
    /// small volume to fill, which a test should not make on its own. On macOS:
    ///
    /// ```text
    /// hdiutil create -size 8m -fs HFS+ -volname vylofull <dir>/full.dmg
    /// hdiutil attach -nobrowse -mountpoint <dir>/full <dir>/full.dmg
    /// VYLO_FULL_DISK=<dir>/full cargo test --offline --lib -- --ignored a_real_full_disk
    /// hdiutil detach <dir>/full
    /// ```
    #[test]
    #[ignore]
    fn a_real_full_disk() {
        let Some(root) = std::env::var_os("VYLO_FULL_DISK") else {
            return;
        };
        let dir = PathBuf::from(root).join(format!("vylo_full_{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let at = |name: &str| dir.join(name).to_string_lossy().to_string();
        let sized = |n: usize, seed: u8| {
            let mut f = film();
            f.resize(n, seed);
            f
        };
        // What is in the folder, without macOS's `._name` files: on a volume
        // that keeps no extended attributes (exFAT, FAT) the system stores a
        // file's attributes in one of those beside it. They belong to the old
        // film, not to the save.
        let seen = |d: &Path| -> BTreeSet<std::ffi::OsString> { listing(d).into_iter().filter(|n| !n.to_string_lossy().starts_with("._")).collect() };
        let old = sized(1024 * 1024, 1);
        fs::write(dir.join("عيادة.mp4"), &old).unwrap();

        // Larger than the whole volume.
        let big = sized(64 * 1024 * 1024, 2);
        let err = write_media(Some(&encode(&at("عيادة.mp4"))), None, &InvokeBody::Raw(big.clone()), None).unwrap_err();
        eprintln!("save as, full disk: {err}");
        assert!(err.ends_with(&format!("{}", full_disk())), "{err}");
        assert_eq!(fs::read(dir.join("عيادة.mp4")).unwrap(), old, "the old film is whole");
        assert_eq!(seen(&dir), names(&["عيادة.mp4"]), "no temporary file");

        let err = write_media(Some(&encode(&at("عيادة.mp4"))), Some(b"1"), &InvokeBody::Raw(big), None).unwrap_err();
        eprintln!("download, full disk: {err}");
        assert!(err.ends_with(&format!("{}", full_disk())), "{err}");
        assert_eq!(seen(&dir), names(&["عيادة.mp4"]), "no partial download");

        // A film that fits still replaces the old one.
        let fits = sized(2 * 1024 * 1024, 3);
        write_media(Some(&encode(&at("عيادة.mp4"))), None, &InvokeBody::Raw(fits.clone()), None).unwrap();
        assert_eq!(fs::read(dir.join("عيادة.mp4")).unwrap(), fits);
        assert_eq!(seen(&dir), names(&["عيادة.mp4"]));
        let _ = fs::remove_dir_all(&dir);
    }
}
