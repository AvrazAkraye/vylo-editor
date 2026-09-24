//! Saving the page as a PDF, and showing a saved file in Finder or Explorer.
//!
//! ## A PDF without the print dialog
//!
//! The first version of Save as PDF opened the system's print dialog and left
//! the researcher to find "Save as PDF" in it. Both webviews can write the
//! printed page to a file themselves: WebKit through a print operation whose
//! job is a save to a URL rather than a printer, and WebView2 through
//! `PrintToPdf`. Either way the page is laid out with its print styles — the
//! Research panel's paper view, with everything else hidden — and paginated
//! as A4, and the file goes where the save panel said.
//!
//! ## Why these are not in the tool schema
//!
//! `save_pdf` writes to an absolute path, which is the save panel's, the way
//! `export_write_docx` does; what it writes is the document the person was
//! reading when they pressed the button. `reveal_path` writes nothing and opens
//! nothing: it selects a file in the file manager. Neither has anything a model
//! needs, so both are absent from `TOOLS` and named in `test/modes.test.mjs`'s
//! ABSENT list.

use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Sender};
use std::time::Duration;

/// What the platform half reports: done, or why not.
type Done = Result<(), String>;

/// A path from the save panel, checked: absolute, named `.pdf`, not a folder,
/// in a folder that exists. The panel only offers such paths; this is for a
/// bug upstream, which must not put a PDF where a `.zshrc` was.
pub fn check_pdf_path(path: &str) -> Result<PathBuf, String> {
    let p = PathBuf::from(path);
    if path.chars().any(|c| c.is_control()) || !p.is_absolute() {
        return Err(format!("{path}: is not a place to save to"));
    }
    let pdf = p.extension().and_then(|e| e.to_str()).is_some_and(|e| e.eq_ignore_ascii_case("pdf"));
    if !pdf {
        return Err(format!("{path}: is not a .pdf file"));
    }
    if p.is_dir() {
        return Err(format!("{path}: is a directory"));
    }
    if !p.parent().is_some_and(Path::is_dir) {
        return Err(format!("{path}: its folder does not exist"));
    }
    Ok(p)
}

/// Save what the window shows, as printed, to `path` — for Research's Save as PDF.
///
/// The panel has put its paper view into the page before calling this, and
/// takes it out when this returns. A thesis is a few seconds' layout; the wait
/// is bounded so a webview that never answers does not hold the button forever.
#[tauri::command]
pub async fn save_pdf(window: tauri::WebviewWindow, path: String) -> Result<(), String> {
    let p = check_pdf_path(&path)?;
    let (tx, rx) = mpsc::channel::<Done>();
    render(&window, p, tx)?;
    let got = tauri::async_runtime::spawn_blocking(move || rx.recv_timeout(Duration::from_secs(300)))
        .await
        .map_err(|e| e.to_string())?;
    match got {
        Ok(done) => done.map_err(|e| format!("{path}: {e}")),
        Err(_) => Err(format!("{path}: the PDF was not finished")),
    }
}

#[cfg(target_os = "macos")]
fn render(window: &tauri::WebviewWindow, path: PathBuf, tx: Sender<Done>) -> Result<(), String> {
    window
        .with_webview(move |wv| mac::print_to(wv.inner(), wv.ns_window(), &path, tx))
        .map_err(|e| e.to_string())
}

#[cfg(windows)]
fn render(window: &tauri::WebviewWindow, path: PathBuf, tx: Sender<Done>) -> Result<(), String> {
    window
        .with_webview(move |wv| {
            use webview2_com::Microsoft::Web::WebView2::Win32::{ICoreWebView2Environment6, ICoreWebView2_7};
            use webview2_com::PrintToPdfCompletedHandler;
            use windows::core::{Interface, HSTRING};

            let answer = tx.clone();
            let go = || -> windows::core::Result<()> {
                // SAFETY: WebView2's COM interfaces, used on the thread
                // `with_webview` runs this on — the webview's own. Each call's
                // result is checked; the handler owns what it captures.
                unsafe {
                    let core7: ICoreWebView2_7 = wv.controller().CoreWebView2()?.cast()?;
                    // A4 with 2.5 cm margins, stated rather than left to the
                    // defaults (1 cm, US Letter, no backgrounds). The page's
                    // own @page rule says the same, so whichever of the two
                    // WebView2 follows, the margins are the Word file's.
                    let env6: ICoreWebView2Environment6 = wv.environment().cast()?;
                    let s = env6.CreatePrintSettings()?;
                    let margin = 2.5 / 2.54;
                    s.SetPageWidth(210.0 / 25.4)?;
                    s.SetPageHeight(297.0 / 25.4)?;
                    s.SetMarginTop(margin)?;
                    s.SetMarginBottom(margin)?;
                    s.SetMarginLeft(margin)?;
                    s.SetMarginRight(margin)?;
                    s.SetShouldPrintBackgrounds(true)?;
                    s.SetShouldPrintHeaderAndFooter(false)?;
                    let handler = PrintToPdfCompletedHandler::create(Box::new(move |hr, ok| {
                        let _ = answer.send(match hr {
                            Err(e) => Err(e.to_string()),
                            Ok(()) if ok => Ok(()),
                            Ok(()) => Err("the PDF could not be written".into()),
                        });
                        Ok(())
                    }));
                    core7.PrintToPdf(&HSTRING::from(path.to_string_lossy().as_ref()), &s, &handler)
                }
            };
            if let Err(e) = go() {
                let _ = tx.send(Err(e.to_string()));
            }
        })
        .map_err(|e| e.to_string())
}

#[cfg(all(not(target_os = "macos"), not(windows)))]
fn render(_window: &tauri::WebviewWindow, _path: PathBuf, _tx: Sender<Done>) -> Result<(), String> {
    Err("saving as PDF is not available on this system".into())
}

#[cfg(target_os = "macos")]
mod mac {
    //! WebKit's print operation, with a save job instead of a printer.
    //!
    //! The operation has to run modally for the window: the synchronous
    //! `runOperation` returns before WebKit has laid the page out and leaves a
    //! file that is not a PDF. The modal run calls back when the file is
    //! written, so the callback is a small Objective-C object made here.

    use super::Done;
    use objc2::encode::{Encode, Encoding};
    use objc2::rc::Retained;
    use objc2::runtime::{AnyObject, Bool, NSObject};
    use objc2::{class, define_class, msg_send, sel, AllocAnyThread, DefinedClass};
    use std::ffi::{c_void, CString};
    use std::path::Path;
    use std::sync::mpsc::Sender;
    use std::sync::Mutex;

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct Size {
        width: f64,
        height: f64,
    }
    // SAFETY: laid out as CGSize is, two doubles.
    unsafe impl Encode for Size {
        const ENCODING: Encoding = Encoding::Struct("CGSize", &[f64::ENCODING, f64::ENCODING]);
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct Rect {
        origin: Size,
        size: Size,
    }
    // SAFETY: laid out as CGRect is, a CGPoint (two doubles) and a CGSize.
    unsafe impl Encode for Rect {
        const ENCODING: Encoding = Encoding::Struct(
            "CGRect",
            &[Encoding::Struct("CGPoint", &[f64::ENCODING, f64::ENCODING]), Size::ENCODING],
        );
    }

    pub struct Ivars {
        tx: Mutex<Option<Sender<Done>>>,
    }

    define_class!(
        // SAFETY: NSObject has no subclassing requirements, and `Finished`
        // implements no Drop.
        #[unsafe(super(NSObject))]
        #[name = "VyloPdfFinished"]
        #[ivars = Ivars]
        struct Finished;

        impl Finished {
            // SAFETY: the signature NSPrintOperation's didRunSelector is
            // documented to have.
            #[unsafe(method(printOperationDidRun:success:contextInfo:))]
            fn did_run(&self, _op: *mut AnyObject, success: Bool, _ctx: *mut c_void) {
                let tx = self.ivars().tx.lock().ok().and_then(|mut t| t.take());
                if let Some(tx) = tx {
                    let _ = tx.send(if success.as_bool() { Ok(()) } else { Err("the PDF could not be written".into()) });
                }
            }
        }
    );

    // AppKit's own constants. It compares the job disposition to
    // NSPrintSaveJob by identity, so a string with the same letters in it is
    // not a save job: the operation waits for a printer that never answers.
    #[link(name = "AppKit", kind = "framework")]
    extern "C" {
        static NSPrintSaveJob: *mut AnyObject;
        static NSPrintJobSavingURL: *mut AnyObject;
    }

    /// An NSString, or nil for a string with a NUL in it.
    unsafe fn ns(s: &str) -> *mut AnyObject {
        match CString::new(s) {
            Ok(c) => msg_send![class!(NSString), stringWithUTF8String: c.as_ptr()],
            Err(_) => std::ptr::null_mut(),
        }
    }

    pub fn print_to(webview: *mut c_void, window: *mut c_void, path: &Path, tx: Sender<Done>) {
        let (wk, win) = (webview as *mut AnyObject, window as *mut AnyObject);
        if wk.is_null() || win.is_null() {
            let _ = tx.send(Err("the window has no page to save".into()));
            return;
        }
        // SAFETY: `wk` is the WKWebView and `win` its NSWindow, handed over by
        // `with_webview` on the main thread, where AppKit must be called.
        // Every selector is on the class it is sent to (NSPrintInfo,
        // NSMutableDictionary, NSURL, WKWebView, NSPrintOperation, NSView),
        // and each object made here is checked for nil before use.
        unsafe {
            let url_path = ns(&path.to_string_lossy());
            if url_path.is_null() {
                let _ = tx.send(Err("that name cannot be saved to".into()));
                return;
            }
            let shared: *mut AnyObject = msg_send![class!(NSPrintInfo), sharedPrintInfo];
            // A copy, so the app's shared print settings are not changed.
            let info: *mut AnyObject = msg_send![shared, copy];
            let _: () = msg_send![info, setJobDisposition: NSPrintSaveJob];
            let dict: *mut AnyObject = msg_send![info, dictionary];
            let url: *mut AnyObject = msg_send![class!(NSURL), fileURLWithPath: url_path];
            let _: () = msg_send![dict, setObject: url, forKey: NSPrintJobSavingURL];
            let _: () = msg_send![info, setPaperSize: Size { width: 595.28, height: 841.89 }];
            // The page's own @page rule sets the margins. Set here as well,
            // WebKit scales the page down to fit inside both.
            let _: () = msg_send![info, setTopMargin: 0.0f64];
            let _: () = msg_send![info, setBottomMargin: 0.0f64];
            let _: () = msg_send![info, setLeftMargin: 0.0f64];
            let _: () = msg_send![info, setRightMargin: 0.0f64];
            let op: *mut AnyObject = msg_send![wk, printOperationWithPrintInfo: info];
            if op.is_null() {
                let _ = tx.send(Err("this system cannot print the page".into()));
                return;
            }
            let _: () = msg_send![op, setShowsPrintPanel: false];
            let _: () = msg_send![op, setShowsProgressPanel: false];
            // WebKit's print view starts with no size, and prints blank pages
            // unless it is given the web view's.
            let view: *mut AnyObject = msg_send![op, view];
            if !view.is_null() {
                let bounds: Rect = msg_send![wk, bounds];
                let _: () = msg_send![view, setFrame: bounds];
            }
            let done = Finished::alloc().set_ivars(Ivars { tx: Mutex::new(Some(tx)) });
            let done: Retained<Finished> = msg_send![super(done), init];
            let _: () = msg_send![
                op,
                runOperationModalForWindow: win,
                delegate: &*done,
                didRunSelector: sel!(printOperationDidRun:success:contextInfo:),
                contextInfo: std::ptr::null_mut::<c_void>()
            ];
            // The operation does not keep its delegate, and it calls back after
            // this returns. A few bytes a PDF, kept for the life of the app.
            std::mem::forget(done);
        }
    }
}

/// Show a file selected in Finder, or in Explorer on Windows.
///
/// For a file the person is looking at in the app: a row of the explorer, or a
/// document they have just saved. It opens nothing — `open -R` and
/// `explorer /select,` only select the file in a window of the file manager —
/// so there is nothing here that runs, whatever the file is. The path goes as
/// one argument, never through a shell.
#[tauri::command]
pub fn reveal_path(path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if path.chars().any(|c| c.is_control()) || !p.is_absolute() {
        return Err(format!("{path}: is not a path on this machine"));
    }
    if !p.exists() {
        return Err(format!("{path}: no longer exists"));
    }
    reveal(&p).map_err(|e| format!("{path}: could not be shown ({e})"))
}

#[cfg(target_os = "macos")]
fn reveal(p: &Path) -> std::io::Result<()> {
    std::process::Command::new("open").arg("-R").arg(p).spawn().map(|_| ())
}

#[cfg(windows)]
fn reveal(p: &Path) -> std::io::Result<()> {
    use std::os::windows::process::CommandExt;
    // Explorer reads `/select,` and the path as one argument, quoted inside it;
    // the usual quoting of the whole argument is what it does not understand.
    // A Windows path cannot contain a quote, so this one cannot be broken out of.
    std::process::Command::new("explorer")
        .raw_arg(format!("/select,\"{}\"", p.display()))
        .spawn()
        .map(|_| ())
}

#[cfg(all(not(target_os = "macos"), not(windows)))]
fn reveal(p: &Path) -> std::io::Result<()> {
    let dir = if p.is_dir() { p } else { p.parent().unwrap_or(p) };
    std::process::Command::new("xdg-open").arg(dir).spawn().map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_pdf_path_is_checked_before_anything_is_written() {
        let dir = std::env::temp_dir();
        let ok = dir.join("vylo-pdf-check.pdf");
        assert!(check_pdf_path(&ok.to_string_lossy()).is_ok());
        assert!(check_pdf_path(&dir.join("x.PDF").to_string_lossy()).is_ok());
        assert!(check_pdf_path(&dir.join(".zshrc").to_string_lossy()).is_err());
        assert!(check_pdf_path(&dir.join("notes.txt").to_string_lossy()).is_err());
        assert!(check_pdf_path("relative.pdf").is_err());
        assert!(check_pdf_path(&dir.join("no-such-folder-vylo").join("a.pdf").to_string_lossy()).is_err());
        assert!(check_pdf_path(&format!("{}\n.pdf", dir.join("a").display())).is_err());
    }

    #[test]
    fn reveal_refuses_what_is_not_a_real_absolute_path() {
        assert!(reveal_path("relative/file.txt".into()).is_err());
        assert!(reveal_path(std::env::temp_dir().join("vylo-surely-not-here-7f3a").to_string_lossy().into_owned()).is_err());
        assert!(reveal_path(format!("{}\n", std::env::temp_dir().display())).is_err());
    }
}
