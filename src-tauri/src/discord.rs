use std::sync::Mutex;
use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};

// ── State ─────────────────────────────────────────────────────────────────────

pub struct DiscordState {
    client: Mutex<Option<DiscordIpcClient>>,
}

impl DiscordState {
    pub fn new() -> Self {
        Self { client: Mutex::new(None) }
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn connect(app_id: &str) -> Result<DiscordIpcClient, String> {
    let mut client = DiscordIpcClient::new(app_id);  // infallible — no socket I/O yet
    client.connect().map_err(|e| e.to_string())?;
    Ok(client)
}

// ── Commands ──────────────────────────────────────────────────────────────────

const APP_ID: &str = "1501840436703268934";

/// Called from the frontend whenever the Discord Rich Presence toggle changes.
#[tauri::command]
pub fn discord_apply_settings(
    enabled: bool,
    state:   tauri::State<'_, DiscordState>,
) -> Result<(), String> {
    let mut guard = state.client.lock().unwrap();

    if let Some(mut c) = guard.take() {
        c.close().ok();
    }

    if enabled {
        *guard = Some(connect(APP_ID)?);
    }

    Ok(())
}

/// Update the Rich Presence activity. No-op if Discord is not connected.
#[tauri::command]
pub fn discord_set_activity(
    title:  String,
    artist: String,
    album:  Option<String>,
    state:  tauri::State<'_, DiscordState>,
) -> Result<(), String> {
    let mut guard = state.client.lock().unwrap();
    let Some(client) = guard.as_mut() else { return Ok(()); };

    let state_line = match &album {
        Some(al) if !al.is_empty() => format!("{artist} — {al}"),
        _ => artist.clone(),
    };

    let payload = activity::Activity::new()
        .activity_type(activity::ActivityType::Listening)
        .details(&title)
        .state(&state_line);

    client.set_activity(payload).map_err(|e| e.to_string())
}

/// Clear the Rich Presence activity (e.g. on pause/stop). No-op if not connected.
#[tauri::command]
pub fn discord_clear_activity(
    state: tauri::State<'_, DiscordState>,
) -> Result<(), String> {
    let mut guard = state.client.lock().unwrap();
    let Some(client) = guard.as_mut() else { return Ok(()); };
    client.clear_activity().map_err(|e| e.to_string())
}
