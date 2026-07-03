use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rand::Rng;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

const CLIENT_ID: &str = "a3249b8aca7a4a499a99574751f5a9a6";
const REDIRECT_URI: &str = "http://127.0.0.1:17342/callback";
const REDIRECT_PORT: u16 = 17342;
const AUTH_URL: &str = "https://accounts.spotify.com/authorize";
const TOKEN_URL: &str = "https://accounts.spotify.com/api/token";
const SCOPES: &str = "playlist-read-private playlist-read-collaborative user-library-read";
const KEYRING_SERVICE: &str = "melomaniac";
const KEYRING_USER: &str = "spotify_refresh_token";

pub struct SpotifyState {
    cached: Mutex<Option<CachedAccessToken>>,
}

struct CachedAccessToken {
    access_token: String,
    expires_at: u64,
}

impl SpotifyState {
    pub fn new() -> Self {
        Self {
            cached: Mutex::new(None),
        }
    }
}

fn now_unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock before unix epoch")
        .as_secs()
}

// ── PKCE helpers ─────────────────────────────────────────────────────────

fn random_url_safe(len: usize) -> String {
    let bytes: Vec<u8> = (0..len).map(|_| rand::thread_rng().r#gen()).collect();
    URL_SAFE_NO_PAD.encode(bytes)
}

fn code_challenge(verifier: &str) -> String {
    let digest = Sha256::digest(verifier.as_bytes());
    URL_SAFE_NO_PAD.encode(digest)
}

// ── Loopback OAuth callback listener ────────────────────────────────────

/// Starts a one-shot HTTP listener on the fixed redirect port, waits for
/// Spotify's browser redirect carrying `code`/`state`, and replies with a
/// minimal HTML page telling the user they can close the tab.
async fn wait_for_callback(expected_state: &str) -> Result<String, String> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    let listener = TcpListener::bind(("127.0.0.1", REDIRECT_PORT))
        .await
        .map_err(|e| format!("failed to bind loopback callback listener: {e}"))?;

    let accept_and_parse = async {
        loop {
            let (mut stream, _) = listener
                .accept()
                .await
                .map_err(|e| format!("callback listener accept failed: {e}"))?;

            let mut buf = vec![0u8; 8192];
            let n = stream
                .read(&mut buf)
                .await
                .map_err(|e| format!("failed to read callback request: {e}"))?;
            let request = String::from_utf8_lossy(&buf[..n]);

            // Request line looks like: "GET /callback?code=...&state=... HTTP/1.1"
            let path = request
                .lines()
                .next()
                .and_then(|line| line.split_whitespace().nth(1))
                .unwrap_or("");

            let body;
            let result = if let Some(query) = path.split_once('?').map(|(_, q)| q) {
                let params: std::collections::HashMap<String, String> =
                    url::form_urlencoded::parse(query.as_bytes())
                        .into_owned()
                        .collect();

                if let Some(err) = params.get("error") {
                    body = format!(
                        "<html><body><h2>Spotify authorization failed: {err}</h2>\
                         You can close this window.</body></html>"
                    );
                    Some(Err(format!("Spotify returned an error: {err}")))
                } else {
                    match (params.get("code"), params.get("state")) {
                        (Some(code), Some(state)) if state == expected_state => {
                            body = "<html><body><h2>Melomaniac connected to Spotify.</h2>\
                                    You can close this window.</body></html>"
                                .to_string();
                            Some(Ok(code.clone()))
                        }
                        (Some(_), Some(_)) => {
                            body = "<html><body><h2>Authorization state mismatch.</h2>\
                                    You can close this window.</body></html>"
                                .to_string();
                            Some(Err("state mismatch in Spotify callback".to_string()))
                        }
                        _ => {
                            body = "<html><body><h2>Missing authorization code.</h2>\
                                    You can close this window.</body></html>"
                                .to_string();
                            None
                        }
                    }
                }
            } else {
                body = "<html><body><h2>Not found.</h2></body></html>".to_string();
                None
            };

            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            );
            let _ = stream.write_all(response.as_bytes()).await;
            let _ = stream.shutdown().await;

            if let Some(result) = result {
                return result;
            }
            // Unrecognized request (e.g. favicon) — keep listening for the real callback.
        }
    };

    tokio::time::timeout(std::time::Duration::from_secs(120), accept_and_parse)
        .await
        .map_err(|_| "timed out waiting for Spotify authorization".to_string())?
}

// ── Token exchange / refresh ─────────────────────────────────────────────

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    expires_in: u64,
    refresh_token: Option<String>,
}

async fn exchange_code(code: &str, verifier: &str) -> Result<TokenResponse, String> {
    let client = reqwest::Client::new();
    let params = [
        ("grant_type", "authorization_code"),
        ("code", code),
        ("redirect_uri", REDIRECT_URI),
        ("client_id", CLIENT_ID),
        ("code_verifier", verifier),
    ];

    let response = client
        .post(TOKEN_URL)
        .form(&params)
        .send()
        .await
        .map_err(|e| format!("token exchange request failed: {e}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("Spotify token exchange failed ({status}): {text}"));
    }

    response
        .json::<TokenResponse>()
        .await
        .map_err(|e| format!("failed to parse token response: {e}"))
}

async fn refresh_access_token(refresh_token: &str) -> Result<TokenResponse, String> {
    let client = reqwest::Client::new();
    let params = [
        ("grant_type", "refresh_token"),
        ("refresh_token", refresh_token),
        ("client_id", CLIENT_ID),
    ];

    let response = client
        .post(TOKEN_URL)
        .form(&params)
        .send()
        .await
        .map_err(|e| format!("token refresh request failed: {e}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("Spotify token refresh failed ({status}): {text}"));
    }

    response
        .json::<TokenResponse>()
        .await
        .map_err(|e| format!("failed to parse refresh response: {e}"))
}

// ── Keyring persistence ───────────────────────────────────────────────────

fn save_refresh_token(token: &str) -> Result<(), String> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)
        .and_then(|entry| entry.set_password(token))
        .map_err(|e| format!("failed to save Spotify refresh token: {e}"))
}

fn load_refresh_token() -> Option<String> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)
        .ok()?
        .get_password()
        .ok()
}

fn clear_refresh_token() -> Result<(), String> {
    match keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER) {
        Ok(entry) => match entry.delete_credential() {
            Ok(()) => Ok(()),
            // Already absent — disconnecting when never connected is not an error.
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(format!("failed to clear Spotify refresh token: {e}")),
        },
        Err(e) => Err(format!("failed to access keyring: {e}")),
    }
}

/// Returns a valid access token, refreshing via the stored refresh token if
/// the cached one is missing or close to expiry. Errors if the user has
/// never connected (no refresh token in the keyring).
async fn get_valid_access_token(state: &SpotifyState) -> Result<String, String> {
    {
        let cached = state.cached.lock().unwrap();
        if let Some(token) = cached.as_ref() {
            // 30s buffer avoids racing expiry mid-request.
            if token.expires_at > now_unix() + 30 {
                return Ok(token.access_token.clone());
            }
        }
    }

    let refresh_token =
        load_refresh_token().ok_or_else(|| "Spotify is not connected".to_string())?;
    let token_response = refresh_access_token(&refresh_token).await?;

    if let Some(new_refresh) = &token_response.refresh_token {
        save_refresh_token(new_refresh)?;
    }

    let expires_at = now_unix() + token_response.expires_in;
    *state.cached.lock().unwrap() = Some(CachedAccessToken {
        access_token: token_response.access_token.clone(),
        expires_at,
    });

    Ok(token_response.access_token)
}

// ── Spotify Web API response shapes ───────────────────────────────────────

#[derive(Serialize)]
pub struct SpotifyAccount {
    pub id: String,
    pub display_name: Option<String>,
    pub email: Option<String>,
}

#[derive(Deserialize)]
struct MeResponse {
    id: String,
    display_name: Option<String>,
    email: Option<String>,
}

#[derive(Serialize)]
pub struct SpotifyPlaylist {
    pub id: String,
    pub name: String,
    pub track_count: u32,
    pub image_url: Option<String>,
}

#[derive(Deserialize)]
struct SpotifyImage {
    url: String,
}

#[derive(Deserialize)]
struct PlaylistTracksRef {
    total: u32,
}

#[derive(Deserialize)]
struct PlaylistItem {
    id: String,
    name: String,
    // Spotify's SimplifiedPlaylistObject calls this field `tracks` per the
    // published docs, but some accounts/rollouts return it as `items` —
    // accept either.
    #[serde(alias = "tracks")]
    items: PlaylistTracksRef,
    images: Vec<SpotifyImage>,
}

#[derive(Deserialize)]
struct PlaylistsPage {
    items: Vec<PlaylistItem>,
    next: Option<String>,
}

#[derive(Serialize, Deserialize)]
pub struct SpotifyTrack {
    pub id: Option<String>,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub duration_ms: u64,
    pub isrc: Option<String>,
}

#[derive(Deserialize)]
struct ArtistObject {
    name: String,
}

#[derive(Deserialize)]
struct AlbumObject {
    name: String,
}

#[derive(Deserialize)]
struct ExternalIds {
    isrc: Option<String>,
}

#[derive(Deserialize)]
struct TrackObject {
    id: Option<String>,
    name: String,
    artists: Vec<ArtistObject>,
    album: AlbumObject,
    duration_ms: u64,
    external_ids: Option<ExternalIds>,
}

#[derive(Deserialize)]
struct PlaylistTrackItem {
    // The playlist-items endpoint nests the track payload under `item`, not
    // `track` as Spotify's docs claim for the `tracks` endpoint — accept
    // either since this appears to vary by account/rollout.
    #[serde(alias = "track")]
    item: Option<TrackObject>,
}

#[derive(Deserialize)]
struct TracksPage {
    items: Vec<PlaylistTrackItem>,
    next: Option<String>,
}

#[derive(Deserialize)]
struct SavedTrackItem {
    track: TrackObject,
}

#[derive(Deserialize)]
struct SavedTracksPage {
    items: Vec<SavedTrackItem>,
    next: Option<String>,
}

fn track_object_to_spotify_track(t: TrackObject) -> SpotifyTrack {
    SpotifyTrack {
        id: t.id,
        title: t.name,
        artist: t
            .artists
            .into_iter()
            .map(|a| a.name)
            .collect::<Vec<_>>()
            .join(", "),
        album: t.album.name,
        duration_ms: t.duration_ms,
        isrc: t.external_ids.and_then(|e| e.isrc),
    }
}

async fn get_json<T: for<'de> Deserialize<'de>>(
    client: &reqwest::Client,
    url: &str,
    access_token: &str,
) -> Result<T, String> {
    let response = client
        .get(url)
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| format!("Spotify API request failed: {e}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("Spotify API error ({status}): {text}"));
    }

    let text = response
        .text()
        .await
        .map_err(|e| format!("failed to read Spotify API response: {e}"))?;

    serde_json::from_str::<T>(&text).map_err(|e| {
        let snippet: String = text.chars().take(1000).collect();
        format!("failed to parse Spotify API response: {e}\nbody: {snippet}")
    })
}

/// Debug-only: fetch a Spotify API URL and return the raw response body
/// unparsed, for inspecting response shapes during development.
#[cfg(debug_assertions)]
#[tauri::command]
pub async fn spotify_debug_raw(
    url: String,
    state: tauri::State<'_, SpotifyState>,
) -> Result<String, String> {
    let access_token = get_valid_access_token(&state).await?;
    let client = reqwest::Client::new();
    let response = client
        .get(&url)
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = response.status();
    let text = response.text().await.map_err(|e| e.to_string())?;
    Ok(format!("{status}\n{text}"))
}

// ── Tauri commands ────────────────────────────────────────────────────────

#[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
#[tauri::command]
pub async fn spotify_connect(
    app: tauri::AppHandle,
    state: tauri::State<'_, SpotifyState>,
) -> Result<(), String> {
    use tauri_plugin_shell::ShellExt;

    let verifier = random_url_safe(64);
    let challenge = code_challenge(&verifier);
    let csrf_state = random_url_safe(16);

    let auth_url = url::Url::parse_with_params(
        AUTH_URL,
        &[
            ("client_id", CLIENT_ID),
            ("response_type", "code"),
            ("redirect_uri", REDIRECT_URI),
            ("code_challenge_method", "S256"),
            ("code_challenge", &challenge),
            ("scope", SCOPES),
            ("state", &csrf_state),
        ],
    )
    .map_err(|e| format!("failed to build authorization URL: {e}"))?;

    app.shell()
        .open(auth_url.as_str(), None)
        .map_err(|e| format!("failed to open browser: {e}"))?;

    let code = wait_for_callback(&csrf_state).await?;
    let token_response = exchange_code(&code, &verifier).await?;

    let refresh_token = token_response
        .refresh_token
        .ok_or_else(|| "Spotify did not return a refresh token".to_string())?;
    save_refresh_token(&refresh_token)?;

    let expires_at = now_unix() + token_response.expires_in;
    *state.cached.lock().unwrap() = Some(CachedAccessToken {
        access_token: token_response.access_token,
        expires_at,
    });

    Ok(())
}

#[cfg(target_os = "ios")]
#[tauri::command]
pub async fn spotify_connect(_state: tauri::State<'_, SpotifyState>) -> Result<(), String> {
    Err("Spotify connect is not yet implemented on iOS".to_string())
}

#[tauri::command]
pub fn spotify_disconnect(state: tauri::State<'_, SpotifyState>) -> Result<(), String> {
    *state.cached.lock().unwrap() = None;
    clear_refresh_token()
}

#[tauri::command]
pub fn spotify_is_connected() -> bool {
    load_refresh_token().is_some()
}

#[tauri::command]
pub async fn spotify_get_account(
    state: tauri::State<'_, SpotifyState>,
) -> Result<SpotifyAccount, String> {
    let access_token = get_valid_access_token(&state).await?;
    let client = reqwest::Client::new();
    let me: MeResponse = get_json(&client, "https://api.spotify.com/v1/me", &access_token).await?;

    Ok(SpotifyAccount {
        id: me.id,
        display_name: me.display_name,
        email: me.email,
    })
}

#[tauri::command]
pub async fn spotify_get_playlists(
    state: tauri::State<'_, SpotifyState>,
) -> Result<Vec<SpotifyPlaylist>, String> {
    let access_token = get_valid_access_token(&state).await?;
    let client = reqwest::Client::new();

    let mut playlists = Vec::new();
    let mut next_url =
        Some("https://api.spotify.com/v1/me/playlists?limit=50".to_string());

    while let Some(url) = next_url {
        let page: PlaylistsPage = get_json(&client, &url, &access_token).await?;
        for item in page.items {
            playlists.push(SpotifyPlaylist {
                id: item.id,
                name: item.name,
                track_count: item.items.total,
                image_url: item.images.into_iter().next().map(|i| i.url),
            });
        }
        next_url = page.next;
    }

    Ok(playlists)
}

#[tauri::command]
pub async fn spotify_get_playlist_tracks(
    playlist_id: String,
    state: tauri::State<'_, SpotifyState>,
) -> Result<Vec<SpotifyTrack>, String> {
    let access_token = get_valid_access_token(&state).await?;
    let client = reqwest::Client::new();

    let mut tracks = Vec::new();
    let mut next_url = Some(format!(
        "https://api.spotify.com/v1/playlists/{playlist_id}/items?limit=100"
    ));

    while let Some(url) = next_url {
        let page: TracksPage = get_json(&client, &url, &access_token).await?;
        for entry in page.items {
            if let Some(track) = entry.item {
                tracks.push(track_object_to_spotify_track(track));
            }
        }
        next_url = page.next;
    }

    Ok(tracks)
}

#[tauri::command]
pub async fn spotify_get_liked_tracks(
    state: tauri::State<'_, SpotifyState>,
) -> Result<Vec<SpotifyTrack>, String> {
    let access_token = get_valid_access_token(&state).await?;
    let client = reqwest::Client::new();

    let mut tracks = Vec::new();
    let mut next_url = Some("https://api.spotify.com/v1/me/tracks?limit=50".to_string());

    while let Some(url) = next_url {
        let page: SavedTracksPage = get_json(&client, &url, &access_token).await?;
        for item in page.items {
            tracks.push(track_object_to_spotify_track(item.track));
        }
        next_url = page.next;
    }

    Ok(tracks)
}
