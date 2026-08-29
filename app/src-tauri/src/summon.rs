//! The global shortcut: one chord, and nothing at all until somebody sets one.
//!
//! ## Off until it is set
//!
//! There is no default binding, and that is the design rather than a
//! preference. A chord claimed system-wide by an application nobody has in
//! front of them is a bug in *somebody else's* software until they work out
//! what took it — a genuinely expensive afternoon for the person it happens to.
//! So the plugin is built with an empty shortcut list, and the only thing that
//! ever registers one is [`set`], reached from the Settings field.
//!
//! ## Why the chord is vetted here as well as in the field
//!
//! `src/shortcut.ts` refuses a chord with no modifier before it can be saved.
//! It is refused again here because the binding is read back out of
//! `localStorage`, which is editable from devtools like anything else in the
//! webview, and a stored `"KeyA"` turning into a system-wide grab of the letter
//! A is not a failure worth leaving open. Same reasoning as `workspace.ts`
//! validating the tabs it restores: a stored value is input, not memory.
//!
//! ## What the model can reach here
//!
//! Nothing. `set_global_shortcut` is absent from the tool schema like
//! `apply_write` and the pty commands, and the webview is not granted the
//! plugin's own `global-shortcut:*` permissions either, so the one chord that
//! can ever be registered is the one a person typed into the field.

use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_global_shortcut::{Error, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

/// Told to the window when the chord is pressed. The same literal is in
/// `src/shortcut.ts`, which is the only listener.
pub const SUMMONED: &str = "vylo://summon";

/// The chord registered right now.
///
/// Kept so a change the OS refuses can put the working one back: Settings only
/// stores a binding once [`set`] returns `Ok`, so leaving nothing registered
/// after a failure would make Rust and the stored setting disagree about what
/// the machine will answer to.
#[derive(Default)]
pub struct Bound(Mutex<Option<String>>);

/// Parse an accelerator, and refuse the combinations that must never be global.
pub fn vet(accel: &str) -> Result<Shortcut, String> {
    let chord: Shortcut = accel
        .parse()
        .map_err(|e| format!("could not read \"{accel}\" as a key combination: {e}"))?;

    // Shift is not enough on its own: a global Shift+K takes the letter K away
    // from every text field on the machine, this app's own composer included.
    if !chord
        .mods
        .intersects(Modifiers::CONTROL | Modifiers::ALT | Modifiers::SUPER)
    {
        return Err(format!(
            "\"{accel}\" has no Control, Alt or Command in it, so it would swallow that key everywhere"
        ));
    }
    Ok(chord)
}

/// Register `chord`, with the handler that answers it.
fn arm<R: Runtime>(app: &AppHandle<R>, chord: Shortcut) -> Result<(), Error> {
    app.global_shortcut().on_shortcut(chord, |app, _, event| {
        // The handler is called for the release as well as the press. Summoning
        // on both would raise the window twice for one keystroke, the second
        // time after the user has already started typing into it.
        if event.state == ShortcutState::Pressed {
            summon(app);
        }
    })
}

/// Bind the global shortcut to `accel`, or unbind it entirely when `accel` is
/// `None`.
///
/// Registering and unregistering happen here rather than at startup so the
/// setting takes effect as it is changed. Nothing about this needs a restart,
/// and a shortcut that only works after one is a shortcut people conclude is
/// broken.
pub fn set<R: Runtime>(
    app: &AppHandle<R>,
    bound: &Bound,
    accel: Option<String>,
) -> Result<(), String> {
    let wanted = accel
        .map(|a| a.trim().to_string())
        .filter(|a| !a.is_empty());
    let chord = match &wanted {
        Some(a) => Some(vet(a)?),
        None => None,
    };

    // A poisoned lock means a previous call panicked between the two halves of
    // a swap. Nothing here is worth taking the app down for, and the recovered
    // value is only ever the accelerator we might put back.
    let mut held = match bound.0.lock() {
        Ok(h) => h,
        Err(poisoned) => poisoned.into_inner(),
    };

    // Everything goes, not just the chord we think is ours: if a registration
    // ever survives its bookkeeping, unregistering by name would leave it live
    // with nothing left that knows how to remove it.
    //
    // What we were holding is forgotten only once that has actually happened,
    // or a failure here would leave a chord registered that nothing records.
    app.global_shortcut()
        .unregister_all()
        .map_err(|e| format!("could not release the previous shortcut: {e}"))?;
    let previous = held.take();

    let Some(chord) = chord else { return Ok(()) };

    match arm(app, chord) {
        Ok(()) => {
            *held = wanted;
            Ok(())
        }
        Err(e) => {
            // Put the working binding back, so a refused change costs the user
            // the change and not the shortcut they already had.
            if let Some(old) = previous {
                if let Ok(c) = vet(&old) {
                    if arm(app, c).is_ok() {
                        *held = Some(old);
                    }
                }
            }
            Err(e.to_string())
        }
    }
}

/// Bring the window up and tell it a message is being started.
///
/// A summons, never a toggle. The point of the chord is to reach the composer
/// from whatever you were doing, and one that *hid* the editor whenever it
/// happened to be in front would make the one case the user can already see the
/// unpredictable one.
fn summon<R: Runtime>(app: &AppHandle<R>) {
    let Some(w) = app.get_webview_window("main") else { return };
    // All three, in this order: a minimised window ignores `set_focus`, and a
    // hidden one is not raised by it either.
    let _ = w.unminimize();
    let _ = w.show();
    let _ = w.set_focus();
    // The last step — the caret into the composer — belongs to the window,
    // which is the only side that knows what is on screen.
    let _ = app.emit(SUMMONED, ());
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri_plugin_global_shortcut::Code;

    /// The half of the contract this side owns: what `shortcut.ts` may send.
    /// Both files list these key names, so a new one has to be added twice —
    /// which is the point, because a name only this side accepts is a field
    /// that offers a chord the OS then refuses.
    fn every_key_the_field_can_send() -> Vec<String> {
        let mut keys: Vec<String> = "Space Enter Tab Escape Backspace Delete Insert Home End \
             PageUp PageDown ArrowUp ArrowDown ArrowLeft ArrowRight Minus Equal BracketLeft \
             BracketRight Backslash Semicolon Quote Backquote Comma Period Slash"
            .split_whitespace()
            .map(String::from)
            .collect();
        for c in 'A'..='Z' {
            keys.push(format!("Key{c}"));
        }
        for d in 0..=9 {
            keys.push(format!("Digit{d}"));
        }
        for f in 1..=12 {
            keys.push(format!("F{f}"));
        }
        keys
    }

    #[test]
    fn every_key_the_settings_field_can_send_is_one_this_side_can_register() {
        for key in every_key_the_field_can_send() {
            let accel = format!("Control+{key}");
            assert!(vet(&accel).is_ok(), "{accel} was refused");
        }
    }

    #[test]
    fn a_chord_keeps_the_modifiers_it_was_written_with() {
        let chord = vet("Control+Alt+Shift+Super+KeyK").expect("all four modifiers");
        for m in [
            Modifiers::CONTROL,
            Modifiers::ALT,
            Modifiers::SHIFT,
            Modifiers::SUPER,
        ] {
            assert!(chord.mods.contains(m), "lost {m:?}");
        }
        assert_eq!(chord.key, Code::KeyK);
    }

    /// The reason this function exists rather than parsing straight into the
    /// plugin: the binding comes back out of editable storage.
    #[test]
    fn a_chord_with_no_real_modifier_is_refused_however_it_arrives() {
        for accel in ["KeyA", "Shift+KeyA", "Shift+Space", "F5"] {
            let err = vet(accel).expect_err("a bare key must not be registerable");
            assert!(err.contains("swallow"), "{accel}: {err}");
        }
    }

    #[test]
    fn nonsense_is_reported_rather_than_registered() {
        // Empty, a dangling separator, a key nothing can bind, and the
        // modifiers written after the key -- which the parser rejects outright.
        for accel in ["", "Control+", "Control+NotAKey", "KeyA+Control", "   "] {
            assert!(vet(accel).is_err(), "{accel} should not have parsed");
        }
    }

    /// Both sides of the field's two states have to be expressible.
    #[test]
    fn a_plain_summoning_chord_is_accepted_on_either_platform() {
        for accel in [
            "Super+Shift+Space",
            "Control+Shift+Space",
            "Control+Alt+KeyK",
            "Super+Backquote",
            "Alt+F1",
        ] {
            assert!(vet(accel).is_ok(), "{accel} was refused");
        }
    }
}
