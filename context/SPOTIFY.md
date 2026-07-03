# Spotify Integration — Design & Progress

## Overview

First-party Spotify integration: import playlists/liked songs, match them
against the local CAS library, and fill gaps via the existing yt-dlp download
pipeline. Staged rollout — import/match first, live streaming (if ever) later.
YouTube Music is a planned second provider once the Spotify path is proven
out; this doc covers Spotify only.

Scope decisions (confirmed with user):
- **Staged**: import + match now, live playback streaming deferred/maybe-never.
- **Spotify first**, YouTube Music later.
- Desktop OAuth redirect: **dedicated loopback HTTP listener**, not the
  existing Axum LAN sync server (port 7700) — kept fully separate from sync.
- Spotify Developer app already registered by the user. Client ID
  (`a3249b8aca7a4a499a99574751f5a9a6`) is a public PKCE client ID, not a
  secret — safe to keep in source.

---

## Auth model — PKCE, no client secret

Desktop app is a native/public client, so it uses OAuth 2.0 **Authorization
Code + PKCE**, matching Spotify's guidance for apps that can't safely hold a
client secret.

- `CLIENT_ID = "a3249b8aca7a4a499a99574751f5a9a6"`
- Desktop redirect URI: `http://127.0.0.1:17342/callback` (fixed port —
  Spotify requires an exact redirect URI match, no wildcard ports)
- iOS redirect URI (planned): `melomaniac://spotify-callback`
- Scopes (Phase 1): `playlist-read-private playlist-read-collaborative user-library-read`

### Desktop flow
1. `spotify_connect` generates a PKCE `code_verifier` (64 random URL-safe
   bytes) + `code_challenge` (SHA-256, base64 URL-safe no-pad) and a random
   CSRF `state`.
2. Opens the system browser to `accounts.spotify.com/authorize` via
   `app.shell().open(...)` (existing `tauri_plugin_shell` dependency — no new
   crate needed).
3. Binds a one-shot `tokio::net::TcpListener` on `127.0.0.1:17342`, hand-parses
   the raw HTTP GET request line for `/callback?code=...&state=...`, replies
   with a minimal "you can close this window" HTML page, 120s timeout.
4. Exchanges the code for tokens at `accounts.spotify.com/api/token` via
   `reqwest`'s `.form(&params)` (confirmed not feature-gated in reqwest 0.12 —
   only `.json()` needs the `json` feature).
5. Refresh token persisted in the **OS keyring** (`keyring` crate v3,
   service `melomaniac`, user `spotify_refresh_token` — same pattern as
   `crates/sync/src/identity.rs`'s node identity storage). Confirmed v3 API is
   `delete_credential()`, not the v2 `delete_password()`.
6. Access token cached in memory (`SpotifyState.cached: Mutex<Option<...>>`)
   with a 30s expiry buffer; `get_valid_access_token` transparently refreshes
   via the stored refresh token when needed.

### iOS flow
Not implemented yet. Will need `ASWebAuthenticationSession` via Swift FFI,
extending the existing extern "C" callback pattern in
`crates/sync/src/ios.rs` / `crates/sync/ios/` (Swift package). `spotify_connect`
on iOS currently returns a stub error.

---

## Rust implementation — `src-tauri/src/spotify.rs`

New file, ~500 lines. Structure:

- `SpotifyState { cached: Mutex<Option<CachedAccessToken>> }` — managed via
  `app.manage(spotify::SpotifyState::new())` in `lib.rs`.
- PKCE helpers: `random_url_safe(len)`, `code_challenge(verifier)`.
- `wait_for_callback(expected_state)` — the hand-rolled loopback listener.
- `exchange_code` / `refresh_access_token` — token endpoint calls.
- Keyring helpers: `save_refresh_token`, `load_refresh_token`,
  `clear_refresh_token`.
- `get_valid_access_token(state)` — cache-or-refresh entrypoint used by every
  API-calling command.
- Response-shape structs mirroring Spotify's JSON: `MeResponse`,
  `PlaylistsPage`/`PlaylistItem`/`PlaylistTracksRef`/`SpotifyImage`,
  `TracksPage`/`PlaylistTrackItem`, `SavedTracksPage`/`SavedTrackItem`,
  `TrackObject`/`ArtistObject`/`AlbumObject`/`ExternalIds`. All paginate via
  Spotify's `next` field (cursor URL, followed until `null`).
- `get_json<T>()` — shared authenticated-GET-and-deserialize helper.

### Tauri commands (all registered in `lib.rs`)

| Command | Args | Returns | Notes |
|---|---|---|---|
| `spotify_connect` | — | `Result<(), String>` | Desktop: real PKCE+loopback flow. iOS: stub error. |
| `spotify_disconnect` | — | `Result<(), String>` | Clears in-memory cache + keyring entry. |
| `spotify_is_connected` | — | `bool` | Checks for a stored refresh token. |
| `spotify_get_account` | — | `Result<SpotifyAccount, String>` | `GET /v1/me`. |
| `spotify_get_playlists` | — | `Result<Vec<SpotifyPlaylist>, String>` | `GET /v1/me/playlists`, paginated. |
| `spotify_get_playlist_tracks` | `playlist_id: String` | `Result<Vec<SpotifyTrack>, String>` | `GET /v1/playlists/{id}/tracks`, paginated. |
| `spotify_get_liked_tracks` | — | `Result<Vec<SpotifyTrack>, String>` | `GET /v1/me/tracks`, paginated. |

`SpotifyTrack` carries `title`, `artist`, `album`, `duration_ms`, and `isrc`
(from `external_ids`) — ISRC is the strongest signal for the matching engine
(Task below), title/artist/duration are the fallback.

### Cargo.toml additions

```toml
reqwest = { version = "0.12", features = ["rustls-tls", "json"], default-features = false }
tokio   = { version = "1", features = ["sync", "fs", "macros", "rt", "net", "io-util", "time"] }
keyring = "3"
rand    = "0.8"
sha2    = "0.10"
url     = "2"
```

`reqwest`'s `json` feature was added for response deserialization (`.form()`
itself needs no feature flag — confirmed by reading the vendored crate
source). `tokio` gained `net`/`io-util`/`time` for the raw loopback listener
and its timeout.

---

## Status

**Done:**
- [x] Spotify Developer app registered, Client ID obtained
- [x] `spotify.rs` written: PKCE flow, loopback listener, token
      exchange/refresh, keyring persistence, account/playlists/liked-tracks
      API client
- [x] Wired into `lib.rs` (`mod spotify;`, state managed, 7 commands
      registered)
- [x] `Cargo.toml` dependencies added
- [x] `cargo check --workspace` passes clean

**Schema quirks discovered via live testing** (not documented by Spotify,
found by inspecting real responses with the debug-only `spotify_debug_raw`
command):
- `SimplifiedPlaylistObject.tracks` (the `{href, total}` ref in `/me/playlists`)
  is actually returned as `items` for this account — handled via
  `#[serde(alias = "tracks")] items: PlaylistTracksRef`.
- The playlist-tracks endpoint path itself: `GET /v1/playlists/{id}/tracks`
  returns `403 Forbidden`; `GET /v1/playlists/{id}/items` returns `200 OK`.
  `spotify_get_playlist_tracks` now hits `/items`.
- Within each entry of that endpoint's response, the nested track object is
  keyed `item` (singular), not `track` — handled via
  `#[serde(alias = "track")] item: Option<TrackObject>` on `PlaylistTrackItem`.
  Note there's also an unrelated boolean `"track": true` *inside* that nested
  object (a type discriminator alongside `"episode": false`), which is not
  the track data itself.
- All three confirmed fixed and working end-to-end: `spotify_get_playlists`
  and `spotify_get_playlist_tracks` verified against the user's real account
  (5 playlists; 353/353 tracks returned correctly for "Chill moosic").
- `spotify_get_liked_tracks` (`GET /v1/me/tracks`) confirmed working —
  does *not* share the `track`/`item` rename quirk; `SavedTrackItem.track`
  deserializes correctly as-is.

**Not started:**
- [ ] iOS `ASWebAuthenticationSession` bridge (`spotify_connect` is
      stub-only on iOS)
- [ ] Track matching engine — match `SpotifyTrack` (title/artist/duration/isrc)
      against local CAS library tracks
- [ ] Wire unmatched tracks into the existing yt-dlp pipeline — reuse
      `downloader::download_enqueue` with a `ytsearch1:<query>` pseudo-URL,
      no new download infra needed
- [ ] Spotify Settings UI — connect/disconnect button, playlist picker,
      match-results review screen (matched / needs-download / ambiguous)

**Deferred / open questions:**
- Live Spotify streaming playback (`librespot` integration, per the older
  `PLAN.md` checklist) — out of scope for this staged rollout; import+match
  only for now.
- YouTube Music integration — second provider, after Spotify path is proven.
- `tauri_plugin_shell::Shell::open` is deprecated in favor of
  `tauri-plugin-opener` upstream; left as-is for now (still functional, just
  a warning) since pulling in a new plugin wasn't in scope for this pass.
