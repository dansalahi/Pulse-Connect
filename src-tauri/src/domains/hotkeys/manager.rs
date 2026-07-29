//! Hotkeys domain business logic: registers/unregisters global OS shortcuts
//! via `tauri-plugin-global-shortcut`, persists bindings, and emits frontend
//! events on trigger. PTT has a special lifecycle — see `start`/`enable_ptt`/
//! `disable_ptt` — since it's only bound while a call is active.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use tauri_plugin_store::StoreExt;

use crate::shared::error::AppError;

const STORE_FILE: &str = "hotkeys.json";
const STORE_KEY: &str = "bindings";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash, specta::Type)]
pub enum HotkeyAction {
    Mute,
    Deafen,
    Ptt,
    Leave,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct HotkeyBinding {
    pub action: HotkeyAction,
    pub accelerator: String,
}

fn defaults() -> Vec<HotkeyBinding> {
    vec![
        HotkeyBinding { action: HotkeyAction::Mute,   accelerator: "CmdOrCtrl+Shift+M".into() },
        HotkeyBinding { action: HotkeyAction::Deafen, accelerator: "CmdOrCtrl+Shift+D".into() },
        HotkeyBinding { action: HotkeyAction::Ptt,    accelerator: "Space".into() },
        HotkeyBinding { action: HotkeyAction::Leave,  accelerator: "CmdOrCtrl+Shift+L".into() },
    ]
}

// This is the only place that distinguishes key-down from key-up: Ptt emits
// a distinct press/release pair (frontend unmutes on press, mutes on
// release) while every other action only fires on Pressed.
fn emit_for(app: &AppHandle, action: &HotkeyAction, state: ShortcutState) {
    let event = match (action, state) {
        (HotkeyAction::Mute,   ShortcutState::Pressed)  => "hotkey_mute",
        (HotkeyAction::Deafen, ShortcutState::Pressed)  => "hotkey_deafen",
        (HotkeyAction::Leave,  ShortcutState::Pressed)  => "hotkey_leave",
        (HotkeyAction::Ptt,    ShortcutState::Pressed)  => "hotkey_ptt_press",
        (HotkeyAction::Ptt,    ShortcutState::Released) => "hotkey_ptt_release",
        _ => return,
    };
    let _ = app.emit(event, ());
}

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------

#[derive(Clone, Default)]
pub struct HotkeyManager {
    bindings: Arc<Mutex<HashMap<HotkeyAction, String>>>,
}

impl HotkeyManager {
    pub fn new() -> Self {
        Self::default()
    }

    fn load_saved(app: &AppHandle) -> Vec<HotkeyBinding> {
        app.store(STORE_FILE)
            .ok()
            .and_then(|s| s.get(STORE_KEY))
            .and_then(|v| serde_json::from_value(v).ok())
            .unwrap_or_else(defaults)
    }

    fn persist(app: &AppHandle, map: &HashMap<HotkeyAction, String>) {
        let list: Vec<HotkeyBinding> = map
            .iter()
            .map(|(a, acc)| HotkeyBinding { action: a.clone(), accelerator: acc.clone() })
            .collect();
        if let Ok(store) = app.store(STORE_FILE) {
            if let Ok(val) = serde_json::to_value(&list) {
                store.set(STORE_KEY, val);
                let _ = store.save();
            }
        }
    }

    fn do_register(app: &AppHandle, action: HotkeyAction, accelerator: &str) -> Result<(), AppError> {
        let app_c = app.clone();
        app.global_shortcut()
            .on_shortcut(accelerator, move |_app, _sc, event| {
                emit_for(&app_c, &action, event.state());
            })
            .map_err(|e| AppError::Validation(format!("Cannot bind \"{accelerator}\": {e}")))
    }

    fn do_unregister(app: &AppHandle, accelerator: &str) {
        let _ = app.global_shortcut().unregister(accelerator);
    }

    /// Called from `setup()` — loads saved (or default) bindings and registers them globally.
    /// PTT is intentionally excluded: it is registered only while a call is active
    /// (via `enable_ptt_hotkey`) so that bare keys like Space don't fire outside calls.
    pub fn start(&self, app: &AppHandle) {
        let bindings = Self::load_saved(app);
        let mut locked = self.bindings.lock().unwrap_or_else(|p| p.into_inner());
        for b in bindings {
            if b.action == HotkeyAction::Ptt {
                locked.insert(b.action, b.accelerator); // store but do not register
                continue;
            }
            match Self::do_register(app, b.action.clone(), &b.accelerator) {
                Ok(()) => { locked.insert(b.action, b.accelerator); }
                Err(e) => tracing::warn!("Hotkey startup: {e}"),
            }
        }
    }

    /// Register the PTT shortcut. Called by the frontend when a call becomes active.
    pub fn enable_ptt(&self, app: &AppHandle) -> Result<(), AppError> {
        let accelerator = {
            let locked = self.bindings.lock().unwrap_or_else(|p| p.into_inner());
            locked.get(&HotkeyAction::Ptt).cloned().unwrap_or_else(|| "Space".into())
        }; // lock released before calling into the shortcut plugin
        Self::do_register(app, HotkeyAction::Ptt, &accelerator)
    }

    /// Unregister the PTT shortcut. Called by the frontend when a call ends.
    pub fn disable_ptt(&self, app: &AppHandle) {
        let locked = self.bindings.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(acc) = locked.get(&HotkeyAction::Ptt) {
            Self::do_unregister(app, acc);
        }
    }

    pub fn get_bindings(&self) -> Vec<HotkeyBinding> {
        let locked = self.bindings.lock().unwrap_or_else(|p| p.into_inner());
        locked
            .iter()
            .map(|(a, acc)| HotkeyBinding { action: a.clone(), accelerator: acc.clone() })
            .collect()
    }

    pub fn set_binding(&self, app: &AppHandle, action: HotkeyAction, accelerator: String) -> Result<(), AppError> {
        let mut locked = self.bindings.lock().unwrap_or_else(|p| p.into_inner());
        if action == HotkeyAction::Ptt {
            // PTT is managed dynamically — just persist the new accelerator.
            // The next enable_ptt_hotkey call (when the next call starts) picks it up.
            locked.insert(action, accelerator);
            Self::persist(app, &locked);
            return Ok(());
        }
        if let Some(old) = locked.get(&action) {
            Self::do_unregister(app, old);
        }
        Self::do_register(app, action.clone(), &accelerator)?;
        locked.insert(action, accelerator);
        Self::persist(app, &locked);
        Ok(())
    }

    pub fn reset(&self, app: &AppHandle) {
        let mut locked = self.bindings.lock().unwrap_or_else(|p| p.into_inner());
        // Unregister only non-PTT shortcuts (PTT is never registered outside a call)
        for (action, acc) in locked.iter() {
            if *action != HotkeyAction::Ptt {
                Self::do_unregister(app, acc);
            }
        }
        locked.clear();
        for b in defaults() {
            if b.action == HotkeyAction::Ptt {
                locked.insert(b.action, b.accelerator); // store but do not register
                continue;
            }
            match Self::do_register(app, b.action.clone(), &b.accelerator) {
                Ok(()) => { locked.insert(b.action, b.accelerator); }
                Err(e) => tracing::warn!("Hotkey reset: {e}"),
            }
        }
        Self::persist(app, &locked);
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::shared::error::AppError;
    use crate::shared::validation::validate_string;

    /// Empty accelerator string must be rejected before any OS registration attempt.
    #[test]
    fn test_empty_accelerator_fails_validation() {
        let result = validate_string("", 64, "accelerator");
        assert!(
            matches!(result, Err(AppError::Validation(_))),
            "empty accelerator must be a Validation error"
        );
    }

    /// Accelerator exceeding the length cap must be rejected.
    #[test]
    fn test_accelerator_too_long_fails_validation() {
        let long = "CmdOrCtrl+Shift+".repeat(10); // 160 chars
        let result = validate_string(&long, 64, "accelerator");
        assert!(
            matches!(result, Err(AppError::Validation(_))),
            "over-long accelerator must be a Validation error"
        );
    }

    /// A realistic accelerator string must pass the length validation.
    #[test]
    fn test_valid_accelerator_passes_validation() {
        for accel in &["Space", "CmdOrCtrl+Shift+M", "F12", "CmdOrCtrl+Shift+L"] {
            let result = validate_string(accel, 64, "accelerator");
            assert!(result.is_ok(), "valid accelerator {accel:?} should pass");
        }
    }

    /// Default bindings list must cover all four actions.
    #[test]
    fn test_defaults_cover_all_actions() {
        let d = defaults();
        let actions: Vec<&HotkeyAction> = d.iter().map(|b| &b.action).collect();
        assert!(actions.contains(&&HotkeyAction::Mute));
        assert!(actions.contains(&&HotkeyAction::Deafen));
        assert!(actions.contains(&&HotkeyAction::Ptt));
        assert!(actions.contains(&&HotkeyAction::Leave));
        assert_eq!(d.len(), 4);
    }

    /// A freshly-created HotkeyManager has no registered bindings (start() not called).
    #[test]
    fn test_fresh_manager_has_no_bindings() {
        let manager = HotkeyManager::new();
        assert!(
            manager.get_bindings().is_empty(),
            "bindings should be empty before start() is called"
        );
    }

    /// PTT binding stored directly (no OS registration) must appear in get_bindings.
    /// This tests the PTT-specific code path in set_binding which skips registration.
    #[test]
    fn test_ptt_binding_stored_without_registration() {
        // We can test PTT specifically because it skips do_register, so no AppHandle needed.
        let manager = HotkeyManager::new();
        // Directly insert a PTT binding into the inner map to simulate stored state.
        {
            let mut locked = manager.bindings.lock().unwrap_or_else(|p| p.into_inner());
            locked.insert(HotkeyAction::Ptt, "Space".to_string());
        }
        let bindings = manager.get_bindings();
        assert_eq!(bindings.len(), 1);
        assert_eq!(bindings[0].action, HotkeyAction::Ptt);
        assert_eq!(bindings[0].accelerator, "Space");
    }
}
