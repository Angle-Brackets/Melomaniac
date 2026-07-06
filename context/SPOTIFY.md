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

The app is a native/public client on every platform, so it uses OAuth 2.0
**Authorization Code + PKCE**, matching Spotify's guidance for apps that
can't safely hold a client secret. The platform-specific half of the flow
(presenting the login UI and catching the redirect) lives behind a shared
`OAuthBridge` trait (`melomaniac-oauth` crate) — `spotify.rs` itself is
100% provider logic and doesn't know or care which platform it's running on.

- `CLIENT_ID = "a3249b8aca7a4a499a99574751f5a9a6"`
- Desktop redirect URI: `http://127.0.0.1:17342/callback` (fixed port —
  Spotify requires an exact redirect URI match, no wildcard ports)
- iOS redirect URI: `http://127.0.0.1:17343/callback` (loopback, same
  mechanism as desktop, different fixed port). A custom URL scheme
  (`melomaniac://oauth-callback`) was tried first, but Spotify's 2025
  redirect URI security requirements no longer accept custom schemes —
  only HTTPS or a loopback address.
- Scopes (Phase 1): `playlist-read-private playlist-read-collaborative user-library-read`

### `melomaniac-oauth` crate (`src-tauri/crates/oauth/`)

- `OAuthBridge` trait (`src/lib.rs`) — `redirect_uri() -> &str` +
  `authenticate(auth_url) -> Result<String, String>` (blocks until the
  provider redirects back, returns the raw callback query string). Same
  platform-bridge-behind-a-trait pattern as `AudioBridge`/`SyncBridge`.
- `loopback.rs` — shared by both platforms: binds a one-shot
  `TcpListener`, hand-parses the `GET /callback?...` request line, replies
  with a minimal "you can close this window" HTML page. 120s timeout at
  the call site in each bridge.
- `desktop.rs` (`DesktopOAuthBridge`) — opens the system browser via the
  `open` crate, then blocks on the loopback listener on port 17342.
- `ios.rs` (`IosOAuthBridge`) — presents an `ASWebAuthenticationSession`
  sheet via Swift FFI (`crates/oauth/ios/`, `MelomaniacOAuth` Swift
  package) purely as UI chrome; the actual redirect is still caught by the
  same loopback listener on port 17343, since Spotify won't accept the
  session's own custom-scheme callback mechanism as a redirect URI. The
  session's completion handler only matters for detecting a manual
  cancel/dismiss — whichever of "loopback received a request" or "user
  cancelled the sheet" fires first wins the race (`ios.rs`'s `PENDING`
  channel). `melo_oauth_dismiss` closes the sheet once the loopback side
  has an answer, so it doesn't linger open on a page that already served
  its purpose.

### `spotify.rs` flow (both platforms, identical)
1. `spotify_connect` generates a PKCE `code_verifier` (64 random URL-safe
   bytes) + `code_challenge` (SHA-256, base64 URL-safe no-pad) and a random
   CSRF `state`.
2. Builds the `accounts.spotify.com/authorize` URL using
   `state.bridge.redirect_uri()` for the redirect param, then calls
   `state.bridge.authenticate(&auth_url)` (via `spawn_blocking`, since both
   bridge implementations block synchronously) — this is the only point
   where platform divergence happens.
3. Parses the returned query string for `code`/`state`/`error`; verifies
   `state` matches (CSRF check) before proceeding.
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

---

## Rust implementation — `src-tauri/src/spotify.rs`

Provider logic only — no platform-specific code (that all lives in
`melomaniac-oauth`, see above). Structure:

- `SpotifyState { bridge: Arc<dyn OAuthBridge>, cached: Mutex<Option<CachedAccessToken>> }`
  — managed via `app.manage(spotify::SpotifyState::new(bridge))` in `lib.rs`,
  where `lib.rs` picks `DesktopOAuthBridge` or `IosOAuthBridge` via cfg-gating
  (the only place the platform split happens).
- PKCE helpers: `random_url_safe(len)`, `code_challenge(verifier)`.
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
| `spotify_connect` | — | `Result<(), String>` | Identical PKCE+loopback flow on desktop and iOS via `OAuthBridge`. |
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

**Done (continued):**
- [x] Track matching engine — `spotify_import_playlist_tracks` matches each
      `SpotifyTrack` (title/artist/duration, ISRC short-circuit hook wired
      but not yet fed — see the fingerprinting backlog item in `PLAN.md`)
      against local CAS library tracks; >=90% confidence auto-links silently,
      otherwise the track is persisted as an external (unmatched) row.
      Persisted in the `spotify_tracks` table (`crates/storage`), including a
      `position` column preserving Spotify's native track order.
- [x] Unmatched tracks wired into the existing yt-dlp pipeline —
      `downloadAndLinkExternalTrack` (frontend) composes
      `download_enqueue` with a `ytsearch1:<query>` pseudo-URL and links the
      resulting hash on completion; no new download infra needed.
- [x] Spotify UI — **not a modal**: after discussion, playlist browsing moved
      to first-class virtual entries in the sidebar (desktop) / playlist list
      (mobile). Settings only holds a small connect/disconnect row
      (`SettingsModal.tsx` desktop, `Settings.tsx` mobile). Clicking a virtual
      playlist entry fetches + shows its tracks reusing the same external-row
      rendering (badge for matched, dashed + "Get track" for unmatched).
      Once every track in a virtual playlist is matched/downloaded, a
      Promote button lets the user manually turn it into a real local
      playlist (own commit history) — deliberately not automatic, so
      bulk-downloading tracks doesn't force a matching playlist into the
      sidebar. See the
      "Spotify Playlists as Virtual Sidebar Entries" plan for the full
      component breakdown (desktop: `Sidebar.tsx`, `SpotifyPlaylistView.tsx`,
      `SpotifyTrackRow.tsx`; mobile: `Library.tsx`'s `PlaylistsList`,
      `SpotifyPlaylistDetail.tsx`, `spotifyRows.tsx`).

**Done (continued) — download quality + rejection:**
- [x] Post-download duration validation — the yt-dlp `ytsearch1:` pipeline
      takes YouTube's top hit unconditionally, which is occasionally wrong
      (cover, extended mix, wrong song entirely). `DonePayload`
      (`src-tauri/src/downloader.rs`) now carries `duration_ms` (available
      in-process from `ingest_bytes`/`extract_tags`, no extra round-trip
      needed). `downloadAndLinkExternalTrack` (`spotifySlice.ts`) compares it
      against the Spotify track's expected `duration_ms`; a mismatch beyond
      ±8s (mirrors the matcher's `DURATION_GATE_MS`) skips auto-link and
      surfaces a "needs review" row instead (`SpotifyRow.kind === 'review'`)
      with Keep-anyway / Discard-and-retry actions, rendered in
      `SpotifyPlaylistView.tsx` (desktop) and `SpotifyPlaylistDetail.tsx`
      (mobile). Discard deletes the downloaded blob/DB row via
      `library_remove_track` and leaves the Spotify track external so the
      user can retry later; Keep links it despite the mismatch.
- [x] Persistent, provider-agnostic match-rejection mechanism — a matched
      track (even at high algorithmic confidence) can be flatly wrong, and
      the old "Unlink" just demoted it back to external without stopping the
      matcher from re-suggesting the same wrong hash on the next re-import.
      New `track_rejections` table (migration 0013), keyed by
      `(external_id, hash)` where `external_id` is provider-prefixed
      (`"spotify:<spotify_id>"` today) rather than a `spotify_tracks` foreign
      key — deliberately generalized per explicit user request ("rejection
      should actually apply to ALL external tracks from spotify or yt or
      elsewhere") so a future provider can reuse it without a schema change.
      `best_match` (`matching.rs`) excludes rejected hashes from
      consideration, including through the ISRC short-circuit — rejection
      applies regardless of confidence score. "Unlink" is now "Reject
      match"/"Reject Spotify match" everywhere it appeared (desktop context
      menu + row action, mobile long-press sheet); it unlinks and blacklists
      in one action rather than being a separate softer option. Does not
      touch the local library track itself — it may be legitimately correct
      for something else.

**Done (continued) — iOS auth + cross-device sync:**
- [x] iOS OAuth bridge — `spotify_connect` now works identically on iOS and
      desktop via the shared `OAuthBridge` trait (`melomaniac-oauth` crate).
      `ASWebAuthenticationSession` presents the login sheet, but the redirect
      itself is caught by a real on-device loopback TCP listener
      (`http://127.0.0.1:17343/callback`), not the session's own scheme
      interception — Spotify's 2025 redirect URI rules reject custom URL
      schemes outright. See the "Auth model" section above for the full
      bridge breakdown.
- [x] Cross-device sync of external-track match state — `spotify_tracks`
      generalized to the provider-generic `external_tracks` table, synced via
      a new `/external_matches` peer endpoint with a provenance-first
      precedence rule (manual link/unlink/reject always beats an auto-match).
      Runs in both the auto-sync fast path and manual "Sync Now". See
      `PLAN.md`'s Spotify Integration section for the full writeup.

**Deferred / open questions:**
- Live Spotify streaming playback (`librespot` integration, per the older
  `PLAN.md` checklist) — out of scope for this staged rollout; import+match
  only for now.
- Ongoing Spotify → local sync for already-promoted playlists (diff commits
  when the Spotify-side playlist later changes) — `promotedSpotifySources` is
  session-only today, and revisiting a promoted playlist's source doesn't
  re-sync it at all. Needs a persisted local-playlist ↔ Spotify-source link;
  see `PLAN.md`'s Spotify Integration backlog.
- YouTube Music integration — second provider, after Spotify path is proven.
