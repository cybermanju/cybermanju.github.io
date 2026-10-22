//! Android launcher bridge (Gaveta de Apps) — thin Tauri wrappers.
//!
//! The heavy lifting (PackageManager JNI, icon raster, icon-pack lookup)
//! lives in the reusable `cybermanju-launcher` crate so any Rust-on-Android
//! host can use it. These commands only validate args, forward, and keep the
//! AGENT-1 error prefixes (`unsupported:` off-Android, `invalid:`,
//! `not_found:` from the crate).

use cybermanju_launcher::{AndroidApp, IconPack, NotificationState, StoredMessage};

/// List every launchable Android app, label-sorted, with 96px PNG icons.
///
/// Desktop/web/WASM refuse with `unsupported:` — there is no mock data; the
/// drawer renders that state honestly instead of fake rows.
#[tauri::command(async)]
pub fn launcher_list_apps() -> Result<Vec<AndroidApp>, String> {
    cybermanju_launcher::list_apps()
}

/// Open one app by package name (`FLAG_ACTIVITY_NEW_TASK`).
#[tauri::command(async)]
pub fn launcher_open_app(package_name: String) -> Result<(), String> {
    cybermanju_launcher::validate_package_name(&package_name)?;
    cybermanju_launcher::open_app(package_name.trim())
}

/// Open the system uninstall sheet for one package (`ACTION_DELETE`).
#[tauri::command(async)]
pub fn launcher_uninstall_app(package_name: String) -> Result<(), String> {
    cybermanju_launcher::validate_package_name(&package_name)?;
    cybermanju_launcher::uninstall_app(package_name.trim())
}

/// List installed icon-pack themes (theme-discovery intents).
#[tauri::command(async)]
pub fn launcher_list_icon_packs() -> Result<Vec<IconPack>, String> {
    cybermanju_launcher::list_icon_packs()
}

/// Resolve one app's icon from one icon pack (best-effort PNG data URL).
#[tauri::command(async)]
pub fn launcher_pack_icon(pack_package: String, app_package: String) -> Result<String, String> {
    cybermanju_launcher::validate_package_name(&pack_package)?;
    cybermanju_launcher::validate_package_name(&app_package)?;
    cybermanju_launcher::pack_icon(pack_package.trim(), app_package.trim())
}

/// List installed mail/chat/social apps only (email, WhatsApp, Instagram,
/// Facebook, Messenger, Telegram, …) — the messages-hub quick launch.
#[tauri::command(async)]
pub fn launcher_list_social_apps() -> Result<Vec<AndroidApp>, String> {
    cybermanju_launcher::list_social_apps()
}

/// Stored messaging/social notifications, newest first (from the host app's
/// notification-listener mirror; capped server-side).
#[tauri::command(async)]
pub fn launcher_list_messages(limit: Option<usize>) -> Result<Vec<StoredMessage>, String> {
    cybermanju_launcher::list_messages(limit.unwrap_or(100))
}

/// Wipe the stored notification mirror.
#[tauri::command(async)]
pub fn launcher_clear_messages() -> Result<(), String> {
    cybermanju_launcher::clear_messages()
}

/// Whether the user granted notification access to this app.
#[tauri::command(async)]
pub fn launcher_notification_state() -> Result<NotificationState, String> {
    cybermanju_launcher::notification_state()
}

/// Jump to the system notification-access settings screen.
#[tauri::command(async)]
pub fn launcher_open_notification_settings() -> Result<(), String> {
    cybermanju_launcher::open_notification_settings()
}

/// Hand an external link to the system resolver (`Intent.ACTION_VIEW`).
///
/// Android-only path behind `src/utils/openExternal.ts`: the WebView cannot
/// launch a browser itself and `plugin-shell open` spawns `xdg-open`, which
/// Android does not ship — that failure surfaced as
/// `Scoped shell IO error: No such file or directory (os error 2)` on every
/// Google/GitHub/GitLab sign-in button. Desktop builds keep the shell opener
/// in the frontend, so they never reach this command (`unsupported:` there).
#[tauri::command(async)]
pub fn launcher_open_url(url: String) -> Result<(), String> {
    cybermanju_launcher::open_url(url.trim())
}

/// Hand one device file to a viewer/editor (`OPEN WITH SYSTEM`).
///
/// Same Android-only story as `launcher_open_url`, over a FileProvider
/// `content://` URI — Android 7+ refuses `file://` data
/// (`FileUriExposedException`). Directories refuse with `unsupported:` (no
/// app-to-app folder hand-off on Android).
#[tauri::command(async)]
pub fn launcher_open_file(path: String) -> Result<(), String> {
    cybermanju_launcher::open_file(path.trim())
}

/// Foreground Android voice and explicitly confirmed notification/accessibility actions.
/// Not mapped to REST: only the bundled local Android UI may invoke this bridge.
#[tauri::command(async)]
pub fn android_voice_command(
    action: String,
    payload: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    cybermanju_launcher::voice_command(&action, payload.unwrap_or_else(|| serde_json::json!({})))
}

/// Clipboard access only for an explicit, recent action in the bundled Android UI.
/// Cut writes text only; the UI must preserve its selection until written=true.
/// Never expose through REST/agent tools or call during startup, polling or timers.
#[tauri::command(async)]
pub fn android_clipboard_command<R: tauri::Runtime>(
    window: tauri::WebviewWindow<R>,
    action: String,
    payload: serde_json::Value,
) -> Result<serde_json::Value, String> {
    use tauri::Manager;
    let url = window
        .url()
        .map_err(|_| "auth: clipboard origin unavailable".to_string())?;
    let bundled = (url.scheme() == "tauri" && url.host_str() == Some("localhost"))
        || (matches!(url.scheme(), "http" | "https") && url.host_str() == Some("tauri.localhost"));
    let development = cfg!(debug_assertions)
        && window
            .app_handle()
            .config()
            .build
            .dev_url
            .as_ref()
            .is_some_and(|dev| url.origin() == dev.origin());
    if window.label() != "main" || !(bundled || development) {
        return Err("auth: clipboard requires the bundled main UI".into());
    }
    cybermanju_launcher::clipboard::command(&action, payload)
}

/// Native widget host actions, restricted to the bundled main UI (never REST/tools).
#[tauri::command(async)]
pub fn android_widget_command<R: tauri::Runtime>(
    window: tauri::WebviewWindow<R>,
    action: String,
    payload: serde_json::Value,
) -> Result<serde_json::Value, String> {
    use tauri::Manager;
    let url = window
        .url()
        .map_err(|_| "auth: widget origin unavailable".to_string())?;
    let bundled = (url.scheme() == "tauri" && url.host_str() == Some("localhost"))
        || (matches!(url.scheme(), "http" | "https") && url.host_str() == Some("tauri.localhost"));
    let development = cfg!(debug_assertions)
        && window
            .app_handle()
            .config()
            .build
            .dev_url
            .as_ref()
            .is_some_and(|dev| url.origin() == dev.origin());
    if window.label() != "main" || !(bundled || development) {
        return Err("auth: widgets require the bundled main UI".into());
    }
    cybermanju_launcher::widgets::command(&action, payload)
}

/// HOME role commands are device-local and unavailable to remote or secondary UI.
/// Foreground/resumed/unlocked checks for requests remain in the Android host,
/// where Activity focus is authoritative (not desktop-only window APIs).
fn require_home_role_ui<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) -> Result<(), String> {
    let url = window
        .url()
        .map_err(|_| "auth: Home role origin unavailable".to_string())?;
    let bundled = (url.scheme() == "tauri" && url.host_str() == Some("localhost"))
        || (matches!(url.scheme(), "http" | "https") && url.host_str() == Some("tauri.localhost"));
    if window.label() != "main" || !bundled {
        return Err("auth: Home role requires the bundled main UI".into());
    }
    Ok(())
}

/// Passive observation only: never opens Android's role picker or settings.
#[tauri::command(async)]
pub fn android_home_role_status<R: tauri::Runtime>(
    window: tauri::WebviewWindow<R>,
) -> Result<serde_json::Value, String> {
    require_home_role_ui(&window)?;
    cybermanju_launcher::home_role_command("status", serde_json::json!({}))
}

/// Only the visible Home CTA calls this; Android alone grants the HOME role.
/// request_id is correlation, not consent; never expose via automation/Agent/REST.
#[tauri::command(async)]
pub fn android_home_role_request<R: tauri::Runtime>(
    window: tauri::WebviewWindow<R>,
    request_id: String,
) -> Result<serde_json::Value, String> {
    require_home_role_ui(&window)?;
    cybermanju_launcher::home_role_command(
        "request",
        serde_json::json!({ "requestId": request_id }),
    )
}

/// Run one allowlisted native action from the bundled automation UI only.
/// This command is intentionally unavailable to REST, secondary webviews and
/// arbitrary remote content.
#[tauri::command(async)]
pub fn automation_native_dispatch<R: tauri::Runtime>(
    window: tauri::WebviewWindow<R>,
    request: cybermanju_launcher::automation::NativeActionRequest,
) -> cybermanju_launcher::automation::NativeActionResult {
    use tauri::Manager;
    let Ok(url) = window.url() else {
        return cybermanju_launcher::automation::deny_request(request, "untrusted_ui");
    };
    let bundled = (url.scheme() == "tauri" && url.host_str() == Some("localhost"))
        || (matches!(url.scheme(), "http" | "https") && url.host_str() == Some("tauri.localhost"));
    let development = cfg!(debug_assertions)
        && window
            .app_handle()
            .config()
            .build
            .dev_url
            .as_ref()
            .is_some_and(|dev| url.origin() == dev.origin());
    if window.label() != "main" || !(bundled || development) {
        return cybermanju_launcher::automation::deny_request(request, "untrusted_ui");
    }
    cybermanju_launcher::automation::dispatch_native_action(request)
}
