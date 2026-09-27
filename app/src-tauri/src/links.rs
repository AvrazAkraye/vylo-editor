//! Reading what a link the person gave points at: a page, an image on it, or a
//! piece of a video, for the Video module to build a film from.
//!
//! ## The three commands
//!
//! | command         | what it returns                                   | at most  |
//! |-----------------|---------------------------------------------------|----------|
//! | `link_fetch`    | a page's HTML, its final URL, status and type     | 3 MiB    |
//! | `link_bytes`    | an image from that page, base64, sniffed by magic | 10 MiB   |
//! | `clip_download` | up to 60 s of a video, re-encoded to H.264 + AAC  | 60 MiB   |
//!
//! None of them write anywhere the person can see. `clip_download` works in a
//! fresh directory under the OS temp dir and removes it before it returns,
//! whether it succeeded or not; the other two use one temporary file each, and
//! remove that too.
//!
//! ## Why these are not in the tool schema
//!
//! Every URL these commands see comes from the person's own words — a link they
//! typed or pasted — or from a page such a link pointed at. None comes from
//! the model: the commands are **absent from the tool schema**
//! (`test/modes.test.mjs` names them in ABSENT, `test/e2e.test.mjs` checks they
//! never reach the wire), so no tool call reaches them however the model is
//! prompted. That is what keeps "no model output reaches disk or a shell
//! without a human approving it" true while the app downloads things.
//!
//! ## Why there is no shell
//!
//! The downloads are other programs — `curl`, `yt-dlp`, `ffmpeg`, `ffprobe` —
//! and each is started with an explicit argv through `std::process::Command`,
//! never `sh -c`, so no character in a URL is ever interpreted by a shell. The
//! URL is always the last argument and always follows `--`, so a URL that
//! begins with `-` cannot be read as an option either; `valid_url` refuses one
//! anyway, along with anything that is not `http:` or `https:`, anything with
//! whitespace or control characters in it, and anything longer than 2048
//! characters. Local and private-network hosts are allowed on purpose: this is
//! a desktop app and testing against `localhost` is a thing people do.

use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use serde::Serialize;

/// The longest URL accepted. Browsers take more, but a link a person pastes is
/// well under this, and a longer one is more likely a data blob than a page.
pub const MAX_URL_CHARS: usize = 2048;

/// How much of a page `link_fetch` hands back. Enough for any article's text
/// and its `og:` tags; the rest of a big page is scripts.
pub const MAX_HTML_BYTES: usize = 3 * 1024 * 1024;

/// What curl may download for a page before it gives up. Larger than
/// `MAX_HTML_BYTES` so a page a little over the cut is truncated, not refused.
const MAX_PAGE_DOWNLOAD: u64 = 8_000_000;

/// The largest image `link_bytes` returns.
pub const MAX_IMAGE_BYTES: u64 = 10 * 1024 * 1024;

/// The largest clip `clip_download` returns. Sixty seconds of 720p at CRF 26 is
/// a fraction of this; the ceiling is for a source that defeats the encoder.
pub const MAX_CLIP_BYTES: u64 = 60 * 1024 * 1024;

/// The longest clip, and the length used when none is asked for.
pub const MAX_CLIP_SECONDS: f64 = 60.0;
pub const DEFAULT_CLIP_SECONDS: f64 = 20.0;

/// How long each program may run before it is killed. curl has its own
/// `--max-time`; the outer limit is for a curl that ignores it.
const CURL_TIMEOUT: Duration = Duration::from_secs(40);
const YTDLP_TIMEOUT: Duration = Duration::from_secs(180);
const FFMPEG_TIMEOUT: Duration = Duration::from_secs(120);
const FFPROBE_TIMEOUT: Duration = Duration::from_secs(30);

/// A desktop Safari's user agent. Some sites serve a stub, or nothing, to a
/// user agent they do not recognise, and the person asked for the page they
/// would see in their browser.
const USER_AGENT: &str =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";

/// yt-dlp's format choice: an MP4 at most 720 lines tall with M4A audio when
/// the site has them separately, then a single MP4, then anything at most 720
/// lines tall, then anything. 720p is more than a 60-second clip in a film
/// needs, and a smaller source downloads and re-encodes sooner.
const YTDLP_FORMAT: &str = "bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[height<=720][ext=mp4]/bv*[height<=720]+ba/b";

// ---------------------------------------------------------------------------
// What the commands return
// ---------------------------------------------------------------------------

/// A page, as `link_fetch` read it.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkFetched {
    /// The URL after redirects, so relative links on the page resolve against
    /// where it really is.
    pub url: String,
    pub status: u16,
    pub content_type: String,
    /// The body as UTF-8, invalid sequences replaced, at most `MAX_HTML_BYTES`.
    /// Empty unless the page is HTML or XHTML.
    pub html: String,
}

/// An image, as `link_bytes` read it.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkBytes {
    /// Base64, standard alphabet, padded.
    pub data: String,
    /// From the bytes, not from what the server said.
    pub mime: String,
    pub bytes: u64,
}

/// A piece of a video, as `clip_download` cut it, with its credit.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipDownloaded {
    /// Base64 of the MP4.
    pub data: String,
    pub bytes: u64,
    pub seconds: f64,
    pub width: u32,
    pub height: u32,
    pub has_audio: bool,
    pub title: String,
    pub author: String,
    pub source_url: String,
    /// yt-dlp's extractor, "Youtube" or "Vimeo", or else the link's host.
    pub site: String,
    /// Empty when the site does not say.
    pub license: String,
    /// The whole source's length, so the panel can say "20 s of 12 min".
    pub full_seconds: f64,
}

// ---------------------------------------------------------------------------
// The commands
// ---------------------------------------------------------------------------

/// Fetch a page the person linked. Off the main thread: a slow site must not
/// stop the window drawing.
#[tauri::command]
pub async fn link_fetch(url: String) -> Result<LinkFetched, String> {
    tauri::async_runtime::spawn_blocking(move || fetch_page(&url))
        .await
        .map_err(|_| "The page could not be read.".to_string())?
}

/// Fetch an image found on a page the person linked.
#[tauri::command]
pub async fn link_bytes(url: String) -> Result<LinkBytes, String> {
    tauri::async_runtime::spawn_blocking(move || fetch_image(&url))
        .await
        .map_err(|_| "The image could not be read.".to_string())?
}

/// Download a video the person linked and cut `seconds` of it from `start`.
#[tauri::command]
pub async fn clip_download(url: String, start: Option<f64>, seconds: Option<f64>) -> Result<ClipDownloaded, String> {
    tauri::async_runtime::spawn_blocking(move || download_clip(&url, start, seconds))
        .await
        .map_err(|_| "The video could not be downloaded.".to_string())?
}

// ---------------------------------------------------------------------------
// URL checks
// ---------------------------------------------------------------------------

/// Whether `url` is one these commands will hand to another program: `http:`
/// or `https:` with a host, no whitespace or control characters anywhere, at
/// most `MAX_URL_CHARS` long. The error is the sentence the panel shows.
pub fn valid_url(url: &str) -> Result<(), String> {
    if url.is_empty() {
        return Err("The link is empty.".into());
    }
    if url.chars().count() > MAX_URL_CHARS {
        return Err("The link is too long.".into());
    }
    if url.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err("The link has spaces or control characters in it.".into());
    }
    let lower = url.to_ascii_lowercase();
    let rest = if let Some(r) = lower.strip_prefix("https://") {
        r
    } else if let Some(r) = lower.strip_prefix("http://") {
        r
    } else {
        return Err("Only http and https links can be opened.".into());
    };
    // A host must follow the scheme: `https:///etc/passwd` and `http://?x` are
    // not links to anywhere.
    match rest.chars().next() {
        None | Some('/') | Some('?') | Some('#') | Some('@') => Err("The link has no host.".into()),
        Some(_) => Ok(()),
    }
}

/// The link's host, for `site` when yt-dlp does not name its extractor.
fn host_of(url: &str) -> String {
    let rest = url.split_once("://").map(|(_, r)| r).unwrap_or(url);
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    let host = authority.rsplit('@').next().unwrap_or("");
    let host = if host.starts_with('[') {
        host.split(']').next().map(|h| format!("{h}]")).unwrap_or_default()
    } else {
        host.split(':').next().unwrap_or("").to_string()
    };
    host.trim_start_matches("www.").to_string()
}

// ---------------------------------------------------------------------------
// Finding the programs
// ---------------------------------------------------------------------------

/// Where to look for a program after PATH. An app opened from Finder gets
/// launchd's PATH, `/usr/bin:/bin:/usr/sbin:/sbin`, which has none of what
/// Homebrew installs.
const EXTRA_DIRS: &[&str] = &["/opt/homebrew/bin", "/usr/local/bin"];

fn exe_name(name: &str) -> String {
    if cfg!(windows) { format!("{name}.exe") } else { name.to_string() }
}

/// A program by name: on PATH, then in Homebrew's two prefixes.
fn find_program(name: &str) -> Option<PathBuf> {
    let file = exe_name(name);
    let path_dirs = std::env::var_os("PATH").map(|p| std::env::split_paths(&p).collect::<Vec<_>>()).unwrap_or_default();
    path_dirs
        .into_iter()
        .chain(EXTRA_DIRS.iter().map(PathBuf::from))
        .map(|d| d.join(&file))
        .find(|p| p.is_file())
}

/// curl. macOS and Windows 10+ ship it in a fixed place, which is preferred to
/// PATH so a curl somebody put earlier on PATH is not the one that runs.
fn curl_program() -> Result<PathBuf, String> {
    let fixed = if cfg!(target_os = "macos") {
        Some(PathBuf::from("/usr/bin/curl"))
    } else if cfg!(windows) {
        std::env::var_os("SystemRoot").map(|r| PathBuf::from(r).join("System32").join("curl.exe"))
    } else {
        None
    };
    fixed.filter(|p| p.is_file()).or_else(|| find_program("curl")).ok_or_else(|| "curl is not installed.".to_string())
}

// ---------------------------------------------------------------------------
// Running them
// ---------------------------------------------------------------------------

/// A command with no console window on Windows, where a GUI app that starts a
/// console program otherwise flashes a terminal over itself.
fn command(program: &Path) -> Command {
    #[allow(unused_mut)]
    let mut cmd = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

/// Run `program` with `args` and wait at most `limit`, killing it after that.
///
/// stdout and stderr are drained on their own threads while it runs: yt-dlp's
/// JSON for one YouTube video is several hundred kilobytes, more than a pipe
/// holds, and a child blocked on a full pipe never exits.
fn run(program: &Path, args: &[String], limit: Duration) -> Result<Output, RunError> {
    let mut child = command(program)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|_| RunError::Spawn)?;
    let drain = |pipe: Option<Box<dyn Read + Send>>| {
        std::thread::spawn(move || {
            let mut buf = Vec::new();
            if let Some(mut p) = pipe {
                let _ = p.read_to_end(&mut buf);
            }
            buf
        })
    };
    let out = drain(child.stdout.take().map(|p| Box::new(p) as Box<dyn Read + Send>));
    let err = drain(child.stderr.take().map(|p| Box::new(p) as Box<dyn Read + Send>));
    let deadline = Instant::now() + limit;
    let status = loop {
        match child.try_wait() {
            Ok(Some(s)) => break s,
            Ok(None) if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(RunError::Timeout);
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(100)),
            Err(_) => {
                let _ = child.kill();
                return Err(RunError::Spawn);
            }
        }
    };
    Ok(Output { status, stdout: out.join().unwrap_or_default(), stderr: err.join().unwrap_or_default() })
}

#[derive(Debug)]
enum RunError {
    Spawn,
    Timeout,
}

// ---------------------------------------------------------------------------
// Temporary files
// ---------------------------------------------------------------------------

/// A directory of its own under the OS temp dir, removed when this is dropped
/// — on every return path, the error ones included.
struct TempDir(PathBuf);

impl TempDir {
    fn new(kind: &str) -> Result<TempDir, String> {
        static N: AtomicU64 = AtomicU64::new(0);
        let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
        let n = N.fetch_add(1, Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!("vylo-{kind}-{}-{nanos}-{n}", std::process::id()));
        // `create_dir`, not `create_dir_all`: a directory that already exists
        // is somebody else's, and this one is about to be removed.
        fs::create_dir(&dir).map_err(|_| "A temporary folder could not be made.".to_string())?;
        Ok(TempDir(dir))
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

/// Read at most `max` bytes of a file.
fn read_capped(path: &Path, max: u64) -> Result<Vec<u8>, String> {
    let file = fs::File::open(path).map_err(|_| "Nothing was downloaded.".to_string())?;
    let mut buf = Vec::new();
    file.take(max).read_to_end(&mut buf).map_err(|_| "The download could not be read.".to_string())?;
    Ok(buf)
}

// ---------------------------------------------------------------------------
// curl
// ---------------------------------------------------------------------------

/// What curl prints after the body, three lines, so the final URL, status and
/// type arrive without parsing headers.
const CURL_WRITE_OUT: &str = "\n%{url_effective}\n%{http_code}\n%{content_type}";

/// The argv for a page. `--max-filesize` stops a link to a 2 GB file early;
/// `--` keeps the URL from ever being read as an option.
pub fn curl_page_args(url: &str, out: &Path) -> Vec<String> {
    let mut a: Vec<String> = ["-sSL", "--max-time", "25", "--max-redirs", "10", "--max-filesize"].iter().map(|s| s.to_string()).collect();
    a.push(MAX_PAGE_DOWNLOAD.to_string());
    a.extend(["--compressed", "-A", USER_AGENT, "-w", CURL_WRITE_OUT, "-o"].iter().map(|s| s.to_string()));
    a.push(out.to_string_lossy().into_owned());
    a.push("--".into());
    a.push(url.into());
    a
}

/// The argv for an image. `-f` makes a 404 an error rather than an HTML page
/// that then fails the magic check with a less useful message.
pub fn curl_image_args(url: &str, out: &Path) -> Vec<String> {
    let mut a: Vec<String> = ["-sSLf", "--max-time", "25", "--max-redirs", "10", "--max-filesize"].iter().map(|s| s.to_string()).collect();
    a.push(MAX_IMAGE_BYTES.to_string());
    a.extend(["-A", USER_AGENT, "-o"].iter().map(|s| s.to_string()));
    a.push(out.to_string_lossy().into_owned());
    a.push("--".into());
    a.push(url.into());
    a
}

/// curl's exit code as a sentence. The common ones get their own; the rest
/// share one.
fn curl_error(code: Option<i32>, what: &str) -> String {
    match code {
        Some(6) => "The site's name could not be found.".into(),
        Some(7) => "The site could not be reached.".into(),
        Some(22) => format!("The site refused the {what}."),
        Some(28) => "The site took too long to answer.".into(),
        Some(35) | Some(51) | Some(60) => "The site's secure connection could not be checked.".into(),
        Some(47) => "The link redirects too many times.".into(),
        Some(63) => format!("The {what} is too large."),
        _ => format!("The {what} could not be downloaded."),
    }
}

fn fetch_page(url: &str) -> Result<LinkFetched, String> {
    valid_url(url)?;
    let curl = curl_program()?;
    let dir = TempDir::new("page")?;
    let body = dir.0.join("body");
    let out = run(&curl, &curl_page_args(url, &body), CURL_TIMEOUT).map_err(|e| match e {
        RunError::Spawn => "curl could not be started.".to_string(),
        RunError::Timeout => "The site took too long to answer.".to_string(),
    })?;
    if !out.status.success() {
        return Err(curl_error(out.status.code(), "page"));
    }
    let (final_url, status, content_type) = parse_write_out(&String::from_utf8_lossy(&out.stdout));
    let is_html = {
        let t = content_type.to_ascii_lowercase();
        t.contains("text/html") || t.contains("xhtml")
    };
    let html = if is_html {
        String::from_utf8_lossy(&read_capped(&body, MAX_HTML_BYTES as u64)?).into_owned()
    } else {
        String::new()
    };
    Ok(LinkFetched { url: if final_url.is_empty() { url.to_string() } else { final_url }, status, content_type, html })
}

/// The three lines `CURL_WRITE_OUT` prints: the last three lines of stdout.
fn parse_write_out(stdout: &str) -> (String, u16, String) {
    // Not trimmed first: the write-out is the last thing curl prints, so the
    // final line is the type even when it is empty.
    let mut lines = stdout.rsplitn(3, '\n');
    let content_type = lines.next().unwrap_or("").trim().to_string();
    let status = lines.next().unwrap_or("").trim().parse().unwrap_or(0);
    let url = lines.next().unwrap_or("").trim().to_string();
    (url, status, content_type)
}

fn fetch_image(url: &str) -> Result<LinkBytes, String> {
    valid_url(url)?;
    let curl = curl_program()?;
    let dir = TempDir::new("image")?;
    let file = dir.0.join("image");
    let out = run(&curl, &curl_image_args(url, &file), CURL_TIMEOUT).map_err(|e| match e {
        RunError::Spawn => "curl could not be started.".to_string(),
        RunError::Timeout => "The site took too long to answer.".to_string(),
    })?;
    if !out.status.success() {
        return Err(curl_error(out.status.code(), "image"));
    }
    // One byte past the limit, so a file exactly at it is kept and one over it
    // is told apart from one that is not.
    let bytes = read_capped(&file, MAX_IMAGE_BYTES + 1)?;
    if bytes.len() as u64 > MAX_IMAGE_BYTES {
        return Err("The image is too large.".into());
    }
    let mime = sniff_image(&bytes).ok_or_else(|| "The link is not a JPEG, PNG, GIF or WebP image.".to_string())?;
    Ok(LinkBytes { data: BASE64.encode(&bytes), mime: mime.into(), bytes: bytes.len() as u64 })
}

/// The image type from its first bytes. What the server said is not asked: a
/// server that calls an HTML error page `image/png` is common.
pub fn sniff_image(b: &[u8]) -> Option<&'static str> {
    if b.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("image/jpeg")
    } else if b.starts_with(&[0x89, 0x50, 0x4E, 0x47]) {
        Some("image/png")
    } else if b.starts_with(b"GIF") {
        Some("image/gif")
    } else if b.len() >= 12 && &b[0..4] == b"RIFF" && &b[8..12] == b"WEBP" {
        Some("image/webp")
    } else {
        None
    }
}

// ---------------------------------------------------------------------------
// yt-dlp, ffmpeg, ffprobe
// ---------------------------------------------------------------------------

/// The argv for yt-dlp. `--dump-json --no-simulate` is what the deprecated
/// `--print-json` stands for: print the video's metadata as one JSON line, and
/// download it too. `--no-playlist` takes the one video from a link that is
/// also in a playlist; `--restrict-filenames` keeps the temporary name ASCII.
pub fn ytdlp_args(url: &str, dir: &Path, ffmpeg_dir: &Path) -> Vec<String> {
    let mut a: Vec<String> = [
        // No config file, from anywhere: a user's or system yt-dlp config can
        // add options — `--exec` runs a command — that this argv never chose.
        "--ignore-config",
        "--no-playlist",
        "--no-warnings",
        "--no-progress",
        "--restrict-filenames",
        "-f",
        YTDLP_FORMAT,
        "--merge-output-format",
        "mp4",
        "--max-filesize",
        "400M",
        "--socket-timeout",
        "30",
        "--dump-json",
        "--no-simulate",
        "-o",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();
    a.push(dir.join("src.%(ext)s").to_string_lossy().into_owned());
    a.push("--ffmpeg-location".into());
    a.push(ffmpeg_dir.to_string_lossy().into_owned());
    a.push("--".into());
    a.push(url.into());
    a
}

/// Where the cut starts and how long it is, from what was asked and how long
/// the source is (0 when the site did not say).
///
/// The start is held inside the source, and a second short of its end when the
/// source is longer than a second, so a start past the end still cuts the last
/// moment rather than nothing. The length is 1 to 60 seconds, 20 when not given.
pub fn clamp_cut(start: Option<f64>, seconds: Option<f64>, duration: f64) -> (f64, f64) {
    let finite = |v: Option<f64>| v.filter(|x| x.is_finite());
    let mut s = finite(start).unwrap_or(0.0).max(0.0);
    if duration > 0.0 {
        s = s.min(if duration > 1.0 { duration - 1.0 } else { 0.0 });
    }
    let len = finite(seconds).unwrap_or(DEFAULT_CLIP_SECONDS).clamp(1.0, MAX_CLIP_SECONDS);
    (s, len)
}

/// A number of seconds as ffmpeg reads it: plain decimal, milliseconds.
fn secs(v: f64) -> String {
    format!("{v:.3}")
}

/// The argv for ffmpeg: seek, cut, scale down to at most 1280 wide keeping the
/// aspect ratio (`-2` keeps the height even, which yuv420p needs), 30 fps,
/// H.264 High and AAC stereo at 48 kHz, which every WebView decodes. A source
/// with no audio gives a clip with none; `-c:a` with no audio stream is not an
/// error. `-ss` before `-i` seeks by keyframe and then decodes to the exact
/// frame, which is fast and, since this re-encodes, exact.
pub fn ffmpeg_args(src: &Path, start: f64, seconds: f64, out: &Path) -> Vec<String> {
    let mut a: Vec<String> = ["-v", "error", "-y", "-ss"].iter().map(|s| s.to_string()).collect();
    a.push(secs(start));
    a.push("-i".into());
    a.push(src.to_string_lossy().into_owned());
    a.push("-t".into());
    a.push(secs(seconds));
    a.extend(
        [
            "-vf", "scale='min(1280,iw)':-2,fps=30", "-c:v", "libx264", "-preset", "veryfast", "-crf", "26", "-pix_fmt", "yuv420p", "-profile:v",
            "high", "-c:a", "aac", "-b:a", "128k", "-ac", "2", "-ar", "48000", "-movflags", "+faststart",
        ]
        .iter()
        .map(|s| s.to_string()),
    );
    a.push(out.to_string_lossy().into_owned());
    a
}

pub fn ffprobe_args(file: &Path) -> Vec<String> {
    let mut a: Vec<String> = ["-v", "error", "-print_format", "json", "-show_streams", "-show_format"].iter().map(|s| s.to_string()).collect();
    a.push(file.to_string_lossy().into_owned());
    a
}

/// What the credit needs from yt-dlp's JSON.
#[derive(Debug, Default, PartialEq)]
pub struct SourceInfo {
    pub title: String,
    pub author: String,
    pub duration: f64,
    pub webpage_url: String,
    pub site: String,
    pub license: String,
}

/// The JSON line yt-dlp printed. It prints one per video, and with
/// `--no-playlist` there is one; the last line that parses is taken so a stray
/// line before it does not matter.
pub fn parse_ytdlp_json(stdout: &str) -> Option<SourceInfo> {
    let v: serde_json::Value = stdout.lines().rev().find_map(|l| serde_json::from_str(l.trim()).ok().filter(|v: &serde_json::Value| v.is_object()))?;
    let s = |k: &str| v.get(k).and_then(|x| x.as_str()).unwrap_or("").trim().to_string();
    let first = |ks: &[&str]| ks.iter().map(|k| s(k)).find(|x| !x.is_empty()).unwrap_or_default();
    Some(SourceInfo {
        title: s("title"),
        author: first(&["uploader", "channel", "creator", "artist"]),
        duration: v.get("duration").and_then(|x| x.as_f64()).unwrap_or(0.0),
        webpage_url: s("webpage_url"),
        site: first(&["extractor_key", "extractor"]),
        license: s("license"),
    })
}

/// What ffprobe says about the clip: width, height, length, and whether there
/// is sound.
fn parse_ffprobe(json: &str) -> Option<(u32, u32, f64, bool)> {
    let v: serde_json::Value = serde_json::from_str(json).ok()?;
    let streams = v.get("streams")?.as_array()?;
    let video = streams.iter().find(|s| s.get("codec_type").and_then(|t| t.as_str()) == Some("video"))?;
    let has_audio = streams.iter().any(|s| s.get("codec_type").and_then(|t| t.as_str()) == Some("audio"));
    let dim = |k: &str| video.get(k).and_then(|x| x.as_u64()).unwrap_or(0) as u32;
    let duration = v
        .get("format")
        .and_then(|f| f.get("duration"))
        .and_then(|d| d.as_str().and_then(|s| s.parse().ok()).or_else(|| d.as_f64()))
        .unwrap_or(0.0);
    Some((dim("width"), dim("height"), duration, has_audio))
}

/// The last line of a program's stderr that says something, for an error the
/// panel can show. yt-dlp's are one line and start `ERROR: `.
fn last_line(stderr: &[u8]) -> String {
    let text = String::from_utf8_lossy(stderr);
    let line = text.lines().rev().map(str::trim).find(|l| !l.is_empty()).unwrap_or("");
    let line = line.trim_start_matches("ERROR:").trim();
    line.chars().take(300).collect()
}

fn download_clip(url: &str, start: Option<f64>, seconds: Option<f64>) -> Result<ClipDownloaded, String> {
    valid_url(url)?;
    let ytdlp = find_program("yt-dlp").ok_or_else(|| "yt-dlp is not installed".to_string())?;
    let ffmpeg = find_program("ffmpeg").ok_or_else(|| "ffmpeg is not installed".to_string())?;
    let ffmpeg_dir = ffmpeg.parent().map(Path::to_path_buf).unwrap_or_default();
    let ffprobe = ffmpeg_dir.join(exe_name("ffprobe"));
    let ffprobe = if ffprobe.is_file() { ffprobe } else { find_program("ffprobe").ok_or_else(|| "ffprobe is not installed".to_string())? };

    let dir = TempDir::new("clip")?;

    // 1. The source.
    let got = run(&ytdlp, &ytdlp_args(url, &dir.0, &ffmpeg_dir), YTDLP_TIMEOUT).map_err(|e| match e {
        RunError::Spawn => "yt-dlp could not be started.".to_string(),
        RunError::Timeout => "The video took more than three minutes to download.".to_string(),
    })?;
    if !got.status.success() {
        let why = last_line(&got.stderr);
        return Err(if why.is_empty() { "The video could not be downloaded.".into() } else { format!("The video could not be downloaded: {why}") });
    }
    let info = parse_ytdlp_json(&String::from_utf8_lossy(&got.stdout)).unwrap_or_default();
    // The merged file is `src.mp4`, but a site with a single non-MP4 format
    // gives `src.webm` or the like, so look for whatever `src.*` is left that
    // is not a part-file.
    let src = fs::read_dir(&dir.0)
        .map_err(|_| "The download could not be read.".to_string())?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .find(|p| {
            let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
            name.starts_with("src.") && !name.ends_with(".part") && !name.ends_with(".ytdl") && p.is_file()
        })
        .ok_or_else(|| "The site gave no video to download.".to_string())?;

    // 2. The cut.
    let (from, len) = clamp_cut(start, seconds, info.duration);
    let clip = dir.0.join("clip.mp4");
    let cut = run(&ffmpeg, &ffmpeg_args(&src, from, len, &clip), FFMPEG_TIMEOUT).map_err(|e| match e {
        RunError::Spawn => "ffmpeg could not be started.".to_string(),
        RunError::Timeout => "Cutting the clip took more than two minutes.".to_string(),
    })?;
    if !cut.status.success() || !clip.is_file() {
        return Err("The clip could not be cut from the video.".into());
    }

    // 3. What it came out as.
    let probe = run(&ffprobe, &ffprobe_args(&clip), FFPROBE_TIMEOUT).map_err(|_| "The clip could not be measured.".to_string())?;
    let (width, height, clip_seconds, has_audio) =
        parse_ffprobe(&String::from_utf8_lossy(&probe.stdout)).ok_or_else(|| "The clip has no picture.".to_string())?;

    let bytes = read_capped(&clip, MAX_CLIP_BYTES + 1)?;
    if bytes.len() as u64 > MAX_CLIP_BYTES {
        return Err("The clip is larger than 60 MB.".into());
    }
    if bytes.is_empty() {
        return Err("The clip came out empty.".into());
    }

    Ok(ClipDownloaded {
        data: BASE64.encode(&bytes),
        bytes: bytes.len() as u64,
        seconds: if clip_seconds > 0.0 { clip_seconds } else { len },
        width,
        height,
        has_audio,
        title: info.title,
        author: info.author,
        source_url: if info.webpage_url.is_empty() { url.to_string() } else { info.webpage_url },
        site: if info.site.is_empty() { host_of(url) } else { info.site },
        license: info.license,
        full_seconds: info.duration,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_http_and_https() {
        assert!(valid_url("https://example.com").is_ok());
        assert!(valid_url("http://example.com/a?b=c#d").is_ok());
        assert!(valid_url("HTTPS://EXAMPLE.COM/").is_ok());
        assert!(valid_url("http://localhost:8080/v.mp4").is_ok());
        assert!(valid_url("https://www.youtube.com/watch?v=aqz-KE-bpKQ").is_ok());
    }

    #[test]
    fn refuses_what_is_not_a_web_link() {
        for bad in [
            "",
            "-x",
            "--exec=rm -rf ~",
            "file:///etc/passwd",
            "javascript:alert(1)",
            "ftp://example.com/a",
            "example.com",
            "https://",
            "https:///etc/passwd",
            "https://exa mple.com",
            "https://example.com/\n--exec",
            "https://example.com/\t",
            "https://example.com/\u{0}",
            " https://example.com",
        ] {
            assert!(valid_url(bad).is_err(), "accepted {bad:?}");
        }
    }

    #[test]
    fn refuses_an_overlong_link() {
        let ok = format!("https://example.com/{}", "a".repeat(MAX_URL_CHARS - 20));
        assert_eq!(ok.chars().count(), MAX_URL_CHARS);
        assert!(valid_url(&ok).is_ok());
        assert!(valid_url(&format!("{ok}a")).is_err());
    }

    /// The URL is the last argument and follows `--`, in every argv.
    fn url_last_after_dashdash(args: &[String], url: &str) {
        let n = args.len();
        assert_eq!(args[n - 1], url);
        assert_eq!(args[n - 2], "--");
        assert_eq!(args.iter().filter(|a| a.as_str() == "--").count(), 1);
    }

    #[test]
    fn curl_argv_puts_the_url_after_dashdash() {
        let url = "https://example.com/page";
        let out = Path::new("/tmp/x/body");
        let page = curl_page_args(url, out);
        url_last_after_dashdash(&page, url);
        assert!(page.windows(2).any(|w| w[0] == "-o" && w[1] == "/tmp/x/body"));
        assert!(page.windows(2).any(|w| w[0] == "--max-filesize" && w[1] == "8000000"));
        assert!(page.windows(2).any(|w| w[0] == "-w" && w[1] == CURL_WRITE_OUT));
        let img = curl_image_args(url, out);
        url_last_after_dashdash(&img, url);
        assert!(img.windows(2).any(|w| w[0] == "--max-filesize" && w[1] == MAX_IMAGE_BYTES.to_string()));
    }

    #[test]
    fn ytdlp_argv_ignores_every_config_file() {
        let args = ytdlp_args("https://youtu.be/x", Path::new("/tmp/d"), Path::new("/opt/homebrew/bin"));
        assert_eq!(args[0], "--ignore-config");
        assert!(!args.iter().any(|a| a == "--exec" || a.starts_with("--exec")));
    }

    #[test]
        fn ytdlp_argv_puts_the_url_after_dashdash() {
        let url = "https://www.youtube.com/watch?v=aqz-KE-bpKQ";
        let a = ytdlp_args(url, Path::new("/tmp/d"), Path::new("/opt/homebrew/bin"));
        url_last_after_dashdash(&a, url);
        assert!(a.contains(&"--no-playlist".to_string()));
        assert!(a.windows(2).any(|w| w[0] == "-f" && w[1] == YTDLP_FORMAT));
        assert!(a.windows(2).any(|w| w[0] == "-o" && w[1] == "/tmp/d/src.%(ext)s"));
        assert!(a.windows(2).any(|w| w[0] == "--ffmpeg-location" && w[1] == "/opt/homebrew/bin"));
        assert!(a.windows(2).any(|w| w[0] == "--max-filesize" && w[1] == "400M"));
        // Not even a URL that looks like an option can become one.
        let sneaky = "--exec=touch /tmp/pwned";
        let a = ytdlp_args(sneaky, Path::new("/tmp/d"), Path::new("/b"));
        url_last_after_dashdash(&a, sneaky);
    }

    #[test]
    fn ffmpeg_argv_cuts_what_was_clamped() {
        let a = ffmpeg_args(Path::new("/tmp/d/src.mp4"), 30.0, 8.0, Path::new("/tmp/d/clip.mp4"));
        assert!(a.windows(2).any(|w| w[0] == "-ss" && w[1] == "30.000"));
        assert!(a.windows(2).any(|w| w[0] == "-t" && w[1] == "8.000"));
        assert!(a.windows(2).any(|w| w[0] == "-i" && w[1] == "/tmp/d/src.mp4"));
        assert_eq!(a.last().unwrap(), "/tmp/d/clip.mp4");
        // -ss comes before -i, so it seeks the input rather than trimming output.
        let ss = a.iter().position(|x| x == "-ss").unwrap();
        let i = a.iter().position(|x| x == "-i").unwrap();
        assert!(ss < i);
    }

    #[test]
    fn the_cut_is_clamped() {
        assert_eq!(clamp_cut(None, None, 600.0), (0.0, 20.0));
        assert_eq!(clamp_cut(Some(30.0), Some(8.0), 600.0), (30.0, 8.0));
        assert_eq!(clamp_cut(Some(-5.0), Some(0.2), 600.0), (0.0, 1.0));
        assert_eq!(clamp_cut(Some(10.0), Some(500.0), 600.0), (10.0, 60.0));
        // Past the end: the last second, not nothing.
        assert_eq!(clamp_cut(Some(900.0), Some(10.0), 120.0), (119.0, 10.0));
        // Unknown duration: the start is only held at zero.
        assert_eq!(clamp_cut(Some(900.0), None, 0.0), (900.0, 20.0));
        assert_eq!(clamp_cut(Some(f64::NAN), Some(f64::INFINITY), 60.0), (0.0, 20.0));
    }

    #[test]
    fn images_are_told_by_their_bytes() {
        assert_eq!(sniff_image(&[0xFF, 0xD8, 0xFF, 0xE0, 0, 0]), Some("image/jpeg"));
        assert_eq!(sniff_image(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]), Some("image/png"));
        assert_eq!(sniff_image(b"GIF89a...."), Some("image/gif"));
        assert_eq!(sniff_image(b"RIFF\x10\x00\x00\x00WEBPVP8 "), Some("image/webp"));
        assert_eq!(sniff_image(b"RIFF\x10\x00\x00\x00WAVEfmt "), None);
        assert_eq!(sniff_image(b"<!doctype html><html>"), None);
        assert_eq!(sniff_image(b""), None);
        assert_eq!(sniff_image(b"RIFF"), None);
    }

    #[test]
    fn curl_write_out_is_read_from_the_end() {
        let (u, s, t) = parse_write_out("\nhttps://example.com/\n200\ntext/html; charset=UTF-8");
        assert_eq!((u.as_str(), s, t.as_str()), ("https://example.com/", 200, "text/html; charset=UTF-8"));
        let (u, s, t) = parse_write_out("\nhttps://x.test/a.png\n404\n");
        assert_eq!((u.as_str(), s, t.as_str()), ("https://x.test/a.png", 404, ""));
    }

    #[test]
    fn ytdlp_json_gives_the_credit() {
        let out = "some noise\n{\"title\":\"Big Buck Bunny\",\"channel\":\"Blender\",\"duration\":634.5,\"webpage_url\":\"https://www.youtube.com/watch?v=aqz-KE-bpKQ\",\"extractor_key\":\"Youtube\",\"license\":\"Creative Commons Attribution license (reuse allowed)\"}\n";
        let i = parse_ytdlp_json(out).unwrap();
        assert_eq!(i.title, "Big Buck Bunny");
        assert_eq!(i.author, "Blender");
        assert_eq!(i.duration, 634.5);
        assert_eq!(i.site, "Youtube");
        assert!(i.license.starts_with("Creative Commons"));
        assert_eq!(parse_ytdlp_json("not json"), None);
    }

    #[test]
    fn ffprobe_json_gives_size_length_and_sound() {
        let j = r#"{"streams":[{"codec_type":"video","width":1280,"height":720},{"codec_type":"audio"}],"format":{"duration":"8.000000"}}"#;
        assert_eq!(parse_ffprobe(j), Some((1280, 720, 8.0, true)));
        let silent = r#"{"streams":[{"codec_type":"video","width":640,"height":360}],"format":{"duration":"3.5"}}"#;
        assert_eq!(parse_ffprobe(silent), Some((640, 360, 3.5, false)));
        assert_eq!(parse_ffprobe(r#"{"streams":[{"codec_type":"audio"}]}"#), None);
    }

    #[test]
    fn host_names_the_site() {
        assert_eq!(host_of("https://www.example.com/a/b"), "example.com");
        assert_eq!(host_of("http://user@vimeo.com:443/1"), "vimeo.com");
        assert_eq!(host_of("http://[::1]:8080/x"), "[::1]");
    }

    #[test]
    fn the_temp_dir_goes_away() {
        let p = {
            let d = TempDir::new("test").unwrap();
            fs::write(d.0.join("f"), b"x").unwrap();
            d.0.clone()
        };
        assert!(!p.exists());
    }
}
