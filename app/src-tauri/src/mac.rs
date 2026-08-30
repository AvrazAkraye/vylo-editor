//! Hiding macOS's own window buttons, so the app can draw its own.
//!
//! ## Why not `decorations: false`
//!
//! The obvious way to get rid of the traffic lights is to turn the whole title
//! bar off. On macOS that is `NSWindowStyleMask::Borderless | Resizable` — read
//! `set_decorations` in tao — and borderless costs the window its **rounded
//! corners**. Getting those back means either `transparent: true`, which on
//! macOS needs Tauri's `macos-private-api` feature, or reaching into the
//! content view's layer, which is this file again with more of it.
//!
//! So the title bar stays. `titleBarStyle: "Overlay"` with `hiddenTitle` keeps
//! the real window — its corners, its shadow, its resize edges, double-click to
//! zoom, and native full screen — and the only thing removed is the three
//! buttons, which the app replaces.
//!
//! ## Why this is not in the tool schema
//!
//! It hides three buttons on a window. There is nothing here a model needs and
//! nothing it could do with it, so like every other command that touches the
//! app rather than answering a question, it is absent from `TOOLS` and named in
//! `test/modes.test.mjs`'s ABSENT list.

/// Hide the close, minimise and zoom buttons on a window.
///
/// Idempotent, and safe to call on a window that has already had them hidden.
/// Silently does nothing off macOS and on a window whose native handle has gone
/// — a failure here means the title bar looks slightly wrong, which is not a
/// reason to fail whatever asked.
#[cfg(target_os = "macos")]
pub fn hide_window_buttons(window: &tauri::WebviewWindow) {
    use objc2::msg_send;
    use objc2::runtime::AnyObject;

    let Ok(ptr) = window.ns_window() else { return };
    if ptr.is_null() {
        return;
    }
    // NSWindowCloseButton = 0, NSWindowMiniaturizeButton = 1, NSWindowZoomButton = 2.
    // Named by number because the alternative is a dependency on objc2-app-kit
    // for three constants that have not moved since 10.0.
    for tag in 0usize..3 {
        // SAFETY: `ns_window` hands back the NSWindow this webview is hosted in,
        // and both selectors are on NSWindow and NSButton respectively. Each
        // result is checked for null before it is messaged, because
        // `standardWindowButton:` returns nil for a button a window does not
        // have — a panel, or a window built without that mask.
        unsafe {
            let ns: *mut AnyObject = ptr as *mut AnyObject;
            let button: *mut AnyObject = msg_send![ns, standardWindowButton: tag];
            if !button.is_null() {
                let _: () = msg_send![button, setHidden: true];
            }
        }
    }
}

#[cfg(not(target_os = "macos"))]
pub fn hide_window_buttons(_window: &tauri::WebviewWindow) {}

/// Ask again for the buttons to be hidden.
///
/// Called from the frontend after full screen is entered or left. macOS builds
/// a fresh title bar for the full-screen presentation and restores the original
/// one on the way back, and the buttons come back visible with it — so hiding
/// them once at startup is not enough, and the moment it is wrong is the moment
/// somebody is looking at the top of the window.
#[tauri::command]
pub fn hide_traffic_lights(window: tauri::WebviewWindow) {
    hide_window_buttons(&window);
}
