# Melomaniac — LAN P2P Sync Design

> How paired Melomaniac nodes discover each other on a home network, exchange
> playlist DAGs and audio blobs, and resolve conflicts — without accounts,
> central servers, or port forwarding.

---

## 1. Guiding Constraints

- **No accounts, no relay server.** Trust is established directly between
  devices using public-key cryptography.
- **Mobile is always a client, never a host.** iOS/Android cannot serve blobs
  to other devices. They pull; desktops push and serve.
- **Sync is playlist-scoped.** A mobile device opts into syncing specific
  playlists, not the whole library. Desktops sync everything with each other.
- **Streaming is out of scope (Phase 2).** Phase 1 is eager blob replication
  over LAN only. Once a playlist is synced it plays from local storage.

---

## 2. Cryptographic Identity

On first launch the Rust backend generates an **Ed25519 keypair**. The private
key lives in the OS keyring (`keyring` crate). The public key is the node's
permanent identity — it never changes, even if the hostname does.

```
Node identity = Ed25519 public key (32 bytes)
Display name  = OS hostname (user-editable in Settings)
Fingerprint   = first 24 hex chars of the public key, grouped in 4s
                e.g.  AB12·CD34·EF56·1234·ABCD·EF12
```

A **trust list** (`known_devices.json` in the app data dir, signed with the
node's own private key so tampering is detectable) maps public keys to display
names and sync permissions.

---

## 3. Discovery — mDNS

Desktop nodes broadcast via mDNS (`mdns-sd` crate):

```
Service type:  _melomaniac._tcp.local
TXT record:
  v=1                          protocol version
  pk=<base64 public key>       node identity
  name=<display name>          human-readable label
  mode=<open|closed>           whether unknown peers are accepted
```

Mobile nodes (and other desktops) listen passively. On seeing a broadcast the
Rust layer checks: is this public key in `known_devices`?

- **Yes** → mark peer as reachable, trigger auto-sync if applicable.
- **No + mode=open** → surface a pairing request to the user.
- **No + mode=closed** → silently ignore.

mDNS is LAN-only. There is no WAN discovery in Phase 1.

---

## 4. Pairing

### 4.1 Timed Discovery Window (same LAN, unknown devices)

A Settings toggle opens a **5-minute discoverable window** on the local node
(`mode=open` in the TXT record). After the window closes the TXT record reverts
to `mode=closed`. The window is non-renewable without another explicit tap —
you can't accidentally leave yourself open.

When an unknown node sees `mode=open` and initiates contact, both sides see an
**approval dialog**:

```
"ANKITS-MACBOOK" wants to sync
Fingerprint: AB12·CD34·EF56·1234

[Decline]  [Allow]
```

Both parties must click Allow. On acceptance each node appends the other's
public key + display name to its trust list.

### 4.2 QR Code (targeted / cross-network)

Either party can display a QR code in the app. The code encodes:

```json
{
  "pk": "<base64 public key>",
  "name": "ANKITS-MACBOOK",
  "addr": "192.168.1.42:7700",   // current LAN IP + port, optional hint
  "token": "<32-byte random>",    // one-time auth token
  "exp": 1234567890               // unix timestamp, 10 minutes from now
}
```

The **one-time token** expires after first use or after 10 minutes, whichever
comes first. A screenshot of the QR cannot be replayed. No approval dialog is
shown for QR-initiated pairings — the act of displaying and scanning is the
user intent signal.

Mobile always has a camera so it can scan a desktop's QR. Desktop-to-desktop
QR works if one machine has a webcam, or the user can transfer the pairing
file (see §4.3).

### 4.3 Mobile as Trust Anchor (cross-network, no camera)

If a phone is already paired with Desktop A and Desktop B, it can introduce
them to each other. The phone signs a short "introduction" message with its
private key attesting that it trusts both parties. Each desktop verifies the
phone's signature against the phone's known public key, then appends the other
desktop to its trust list without any further dialog.

### 4.4 Pairing File (.melopair)

Desktop A exports a file containing its public key and display name, signed
with its private key. The user transfers it by any means (USB, email, etc.).
Desktop B imports it — no network required. Useful for air-gapped setups or
initial cross-network pairing before any tunnel exists.

---

## 5. The Blob Server (Desktop / Android only)

Each non-iOS node runs a lightweight HTTP server (Axum) on a fixed local port
(default `7700`, configurable). It exposes three endpoints:

```
GET  /manifest          → JSON list of all playlists this node has
GET  /hashes            → JSON list of all CAS blob hashes this node has
GET  /blob/:hash        → raw blob bytes (content-type varies)
POST /ping              → liveness check, returns {pk, name, ts}
```

All endpoints require a signed `Authorization` header — the client signs the
request timestamp with its private key and the server verifies the signature
against the client's known public key. Unknown public keys get a 403.

Mobile never runs this server. It is a pure HTTP client.

---

## 6. The `melomaniac-sync` Crate

Mirrors the audio bridge pattern. A platform-agnostic trait sits in the crate
root; platform implementations live behind `cfg` gates.

```rust
pub trait SyncBridge: Send + Sync {
    /// Start mDNS broadcasting and peer listening.
    fn start_discovery(&self) -> Result<(), SyncError>;
    fn stop_discovery(&self) -> Result<(), SyncError>;

    /// Currently reachable paired peers.
    fn peers(&self) -> Vec<PeerInfo>;

    /// Pull all data for a playlist from the best available peer.
    fn sync_playlist(&self, playlist_id: &str) -> Result<SyncReport, SyncError>;

    /// Full sync with a specific peer (desktop-to-desktop).
    fn sync_with(&self, peer_pk: &[u8]) -> Result<SyncReport, SyncError>;

    /// Open the discoverable window for `duration_secs`.
    fn open_discovery_window(&self, duration_secs: u64);

    /// Generate a QR payload (one-time token, current addr, public key).
    fn generate_qr_payload(&self) -> QrPayload;

    /// Consume an inbound QR payload and complete pairing.
    fn accept_qr_pairing(&self, payload: &QrPayload) -> Result<(), SyncError>;
}
```

### Platform implementations

| Platform | mDNS | Network events | Blob server |
|---|---|---|---|
| Desktop (mac/win/linux) | `mdns-sd` crate | Tokio file watcher | Axum in-process |
| Android | `NsdManager` via JNI | `ConnectivityManager` callback | Axum in Foreground Service |
| iOS | `Network` framework via Swift FFI | `NWPathMonitor` via Swift FFI | — (client only) |

The iOS implementation follows the same FFI bridge as audio: a handful of
`@_cdecl` Swift exports (`melo_sync_start_discovery`,
`melo_sync_on_network_change`, `melo_sync_stop`) called from Rust through an
`extern "C"` block in `src/ios.rs` of the sync crate.

---

## 7. Sync Protocol

### 7.1 Playlist-scoped pull (mobile → desktop)

```
1. Mobile discovers desktop peer via mDNS.
2. Mobile fetches GET /manifest from desktop.
3. For each playlist in the manifest:
   a. If not in mobile's known_playlists → render as ghost card (§8).
   b. If already synced → check if desktop HEAD != mobile HEAD → queue delta sync.
4. For a ghost card the user taps to sync:
   a. Mobile fetches GET /hashes from desktop.
   b. Diffs against its own CAS.
   c. Pulls missing DAG objects (tiny, ~200 bytes each) first.
   d. Pulls missing audio blobs — largest last so metadata is available fast.
   e. Updates local SQLite and branch HEAD refs.
```

### 7.2 Full sync (desktop ↔ desktop)

Bidirectional. Each side runs steps 7.1 in both directions, then merges DAGs.
Desktops sync the entire CAS, not just selected playlists.

```
1. A connects to B, B connects to A (simultaneous, deduplicated by hash).
2. Each sends its full hash list.
3. Each requests hashes it is missing.
4. After blob transfer, each side runs DAG merge (§7.3).
```

### 7.3 DAG Merge

The playlist DAG uses the same object model as git (see DESIGN-playlist-git.md).
Merge follows two rules:

**Auto-merge (non-destructive):** If one side has commits the other lacks and
there is no common-ancestor conflict (pure fast-forward or independent branch
additions), the merge is committed automatically with no user interaction.

**Conflict (destructive):** If the same object was modified on both sides since
the last common ancestor, the backend writes a `MERGING` state and emits a diff
payload to the frontend — only the conflicting metadata, not full database
tables. The user resolves it in the Diff Viewer UI (§8) and the result becomes
the merge commit.

---

## 8. Diff Viewer UI

A conflict is any case where the same playlist object was mutated on both sides
since the last common ancestor commit. Without a resolution UI, the playlist
is permanently stuck in `MERGING` and further syncs of that playlist are
blocked. The Diff Viewer is therefore in scope for Phase 1.

### 8.1 What can conflict

| Conflict type | Example |
|---|---|
| Track order | Desktop reordered tracks A→B→C; mobile reordered to A→C→B |
| Track deletion | Desktop deleted track X; mobile added a note/AB point to X |
| Metadata edit | Both sides renamed the playlist simultaneously |
| Branch divergence | Both sides created a branch named `chill` from the same HEAD |
| AB loop points | Both sides set different A/B markers on the same track |

Track **additions** to different positions are always auto-merged (non-destructive).
Track additions to the **same position** are a conflict.

### 8.2 What the backend sends to the frontend

The Rust merge engine streams only the diff — not the full track list. The
payload is a list of `ConflictChunk`s:

```json
{
  "playlist_id": "...",
  "common_ancestor": "<commit hash>",
  "ours_head": "<commit hash>",
  "theirs_head": "<commit hash>",
  "conflicts": [
    {
      "id": "conflict-1",
      "kind": "track_order",
      "context": ["track-A", "track-B", "track-C"],
      "ours":   ["track-A", "track-C", "track-B"],
      "theirs": ["track-A", "track-B", "track-C"]
    },
    {
      "id": "conflict-2",
      "kind": "track_deleted_vs_modified",
      "track_hash": "...",
      "ours":   null,
      "theirs": { "ab_a": 0.2, "ab_b": 0.8 }
    }
  ]
}
```

The frontend never receives entire database tables — only the changed objects
and enough surrounding context to render the diff.

### 8.3 Resolution UI

The Diff Viewer is a full-screen modal (desktop) or sheet (mobile) that opens
when a playlist enters `MERGING` state. It shows one conflict chunk at a time:

```
┌─────────────────────────────────────────────────────────┐
│  ⚠ Merge conflict — "Late Night Drives"  (2 of 3)       │
│                                                         │
│  Track order changed on both devices                    │
│                                                         │
│  YOUR VERSION          │  THEIR VERSION                 │
│  ─────────────────     │  ─────────────────             │
│  1. Midnight City      │  1. Midnight City              │
│  2. ▶ Tame Impala      │  2. Neon Cathedral  ← conflict │
│  3. Neon Cathedral     │  3. ▶ Tame Impala  ← conflict  │
│                                                         │
│        [Keep Mine]   [Keep Theirs]   [Keep Both]        │
└─────────────────────────────────────────────────────────┘
```

Each conflict chunk offers contextually appropriate choices:

| Conflict kind | Choices |
|---|---|
| Track order | Keep Mine / Keep Theirs |
| Track deleted vs modified | Delete it / Keep with changes |
| Metadata (name, description) | Keep Mine / Keep Theirs |
| Branch name collision | Rename Mine / Rename Theirs / Keep Both (auto-rename) |
| AB loop points | Keep Mine / Keep Theirs |

After all chunks are resolved the user clicks **Create Merge Commit**. The
backend receives the resolution choices, constructs the merged tree and commit
objects, writes them to the CAS, and clears the `MERGING` state. The playlist
is now in sync on both sides.

### 8.4 Escape hatch

If the user doesn't want to resolve the conflict right now, they can dismiss
the Diff Viewer. The playlist remains in `MERGING` and shows a warning badge.
Sync of other playlists continues unaffected. The conflict is not lost.

---

## 9. Ghost Playlists (Mobile UI)

When the manifest contains a playlist that is not in the mobile's local
database, it is rendered as a **ghost card** — same dimensions as a real
playlist card but with:

- Dotted outline border instead of solid
- Artwork shown if the artwork blob is small enough to prefetch during manifest
  fetch (< 500 KB); otherwise a placeholder
- Name and branch count from the manifest
- A size label: "342 MB · not synced"

Tapping a ghost card shows a confirmation sheet:

```
Sync "Late Night Drives"?
342 MB · 47 tracks · 3 branches

This playlist will be downloaded over Wi-Fi
and kept up to date automatically.

[Cancel]  [Sync]
```

After the user confirms, the card transitions to a **syncing** state (same
dotted outline, progress ring overlay). On completion it becomes a normal card.

Already-synced playlists show a subtle sync indicator (a small dot or icon) if
the desktop has updates the mobile hasn't pulled yet.

---

## 9. Auto-Sync Trigger

| Platform | Trigger |
|---|---|
| Desktop | Continuous — peers reconnect via mDNS whenever reachable |
| Android | `ConnectivityManager.NetworkCallback` fires on Wi-Fi join → Foreground Service initiates sync |
| iOS | App foreground event — sync runs when user opens the app on home Wi-Fi |

iOS cannot auto-sync in background. This is acceptable for V1: the playlist
will be up to date within seconds of opening the app at home.

---

## 11. What Is Not In Phase 1

- **Remote streaming** — no Cloudflare tunnels, no routing table, no WAN
  access. LAN only.
- **Desktop as iOS sync host over cellular** — Phase 2.
- **Android implementation** — iOS + desktop first; Android follows the same
  pattern once the trait is stable.
