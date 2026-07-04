import { StateCreator } from 'zustand'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { SpotifyAccount, SpotifyPlaylist, SpotifyTrack, SpotifyTrackRecord, TrackRecord } from './types'
import type { StoreState } from './index'

// A row in a virtual Spotify playlist view: a real local track
// (matched_hash resolved against librarySlice.tracks), a synthetic external
// row for a track that hasn't been downloaded/linked yet, or a freshly
// downloaded track awaiting a duration-mismatch review decision.
export type SpotifyRow =
  | { kind: 'local';    track: TrackRecord; spotifyId: string }
  | { kind: 'external'; record: SpotifyTrackRecord }
  | { kind: 'review';   review: SpotifyReviewTrack; record: SpotifyTrackRecord }

// A track that finished downloading but whose duration doesn't match what
// Spotify reported closely enough to trust automatically (yt-dlp's top
// search hit can be a cover, extended mix, etc.) — held out of the normal
// link flow until the user says Keep or Discard.
export type SpotifyReviewTrack = {
  spotifyId:   string
  hash:        string
  title:       string
  actualMs:    number
  expectedMs:  number
}

// Duration-mismatch tolerance for post-download review — mirrors the
// backend matcher's DURATION_GATE_MS (src-tauri/src/matching.rs) so a track
// that would have cleared the fuzzy matcher's duration gate doesn't get
// flagged for review too.
const REVIEW_DURATION_TOLERANCE_MS = 8_000

// A transient status message for Spotify actions (download complete, match
// rejected, etc.), rendered bottom-center on both platforms. `action` adds a
// single button (e.g. "Undo") alongside the message.
export type SpotifyToast = { message: string; action?: { label: string; onClick: () => void } }

export type SpotifySlice = {
  spotifyConnected: boolean
  spotifyAccount:   SpotifyAccount | null
  spotifyPlaylists: SpotifyPlaylist[]

  importedTracks: SpotifyTrackRecord[]
  // spotify_ids currently mid-download via downloadAndLinkExternalTrack, so
  // the Library can disable/spin the "Get track" action while it's in flight.
  downloadingSpotifyIds: string[]

  // "playlist:<id>" or "liked" — the virtual sidebar/list entry currently
  // being browsed, or null when viewing the real library/playlists.
  activeSpotifySource: string | null
  activeSpotifyLoading: boolean
  // Sources already promoted to a real local playlist this session, so a
  // fully-downloaded playlist doesn't get promoted twice while running.
  promotedSpotifySources: string[]

  // Downloaded tracks awaiting a Keep/Discard decision because their actual
  // duration didn't match what Spotify reported. Keyed by spotify_id.
  reviewTracks: Record<string, SpotifyReviewTrack>

  spotifyToast: SpotifyToast | null

  refreshSpotifyStatus:        () => Promise<void>
  connectSpotify:               () => Promise<void>
  disconnectSpotify:            () => Promise<void>
  openSpotifyPlaylist:          (source: string) => Promise<void>
  closeSpotifyPlaylist:         () => void

  fetchImportedTracks:         () => Promise<void>
  importPlaylist:               (source: string, tracks: SpotifyTrack[]) => Promise<void>
  linkTrack:                    (spotifyId: string, hash: string) => Promise<void>
  unlinkTrack:                   (spotifyId: string) => Promise<void>
  rejectMatch:                  (spotifyId: string, hash: string) => Promise<void>
  undoRejectMatch:              (spotifyId: string, hash: string) => Promise<void>
  downloadAndLinkExternalTrack: (spotifyId: string) => Promise<void>
  downloadAllTracks:            (source: string) => Promise<void>
  resolveReviewTrack:           (spotifyId: string, action: 'keep' | 'discard') => Promise<void>
  promotePlaylist:              (source: string) => Promise<void>
}

export const createSpotifySlice: StateCreator<StoreState, [], [], SpotifySlice> = (set, get) => {
  const showSpotifyToast = (message: string, action?: SpotifyToast['action'], durationMs = action ? 6000 : 3000) => {
    const toast: SpotifyToast = { message, action }
    set({ spotifyToast: toast })
    setTimeout(() => set(s => s.spotifyToast === toast ? { spotifyToast: null } : {}), durationMs)
  }

  return ({
  spotifyConnected: false,
  spotifyAccount: null,
  spotifyPlaylists: [],

  importedTracks: [],
  downloadingSpotifyIds: [],

  activeSpotifySource: null,
  activeSpotifyLoading: false,
  promotedSpotifySources: [],
  reviewTracks: {},
  spotifyToast: null,

  refreshSpotifyStatus: async () => {
    const connected = await invoke<boolean>('spotify_is_connected')
    if (!connected) {
      set({ spotifyConnected: false, spotifyAccount: null, spotifyPlaylists: [] })
      return
    }
    const [account, playlists] = await Promise.all([
      invoke<SpotifyAccount>('spotify_get_account'),
      invoke<SpotifyPlaylist[]>('spotify_get_playlists'),
    ])
    set({ spotifyConnected: true, spotifyAccount: account, spotifyPlaylists: playlists })
  },

  connectSpotify: async () => {
    await invoke('spotify_connect')
    await get().refreshSpotifyStatus()
  },

  disconnectSpotify: async () => {
    await invoke('spotify_disconnect')
    set({ spotifyConnected: false, spotifyAccount: null, spotifyPlaylists: [] })
  },

  openSpotifyPlaylist: async (source) => {
    set({ activeSpotifySource: source, activeSpotifyLoading: true })
    try {
      const tracks = source === 'liked'
        ? await invoke<SpotifyTrack[]>('spotify_get_liked_tracks')
        : await invoke<SpotifyTrack[]>('spotify_get_playlist_tracks', { playlistId: source.slice('playlist:'.length) })
      await get().importPlaylist(source, tracks)
    } finally {
      set({ activeSpotifyLoading: false })
    }
  },

  closeSpotifyPlaylist: () => set({ activeSpotifySource: null }),

  fetchImportedTracks: async () => {
    const tracks = await invoke<SpotifyTrackRecord[]>('spotify_get_imported_tracks')
    set({ importedTracks: tracks })
  },

  importPlaylist: async (source, tracks) => {
    const result = await invoke<SpotifyTrackRecord[]>('spotify_import_playlist_tracks', { source, tracks })
    set({ importedTracks: result })
  },

  linkTrack: async (spotifyId, hash) => {
    await invoke('spotify_link_track', { spotifyId, hash })
    await get().fetchImportedTracks()
  },

  unlinkTrack: async (spotifyId) => {
    await invoke('spotify_unlink_track', { spotifyId })
    await get().fetchImportedTracks()
  },

  // Like unlinkTrack, but permanently blacklists `hash` for this external
  // track so the matcher can never re-suggest it on a later re-import —
  // for when a link is actively wrong (even at high confidence), not just
  // undesired. Provider-agnostic on the backend (keyed by a prefixed
  // external_id), so this same flow will cover future non-Spotify sources.
  // Shows an "Undo" toast since this reverses less easily than a plain
  // unlink — a mistaken click shouldn't force a duplicate re-download.
  rejectMatch: async (spotifyId, hash) => {
    const title = get().importedTracks.find(t => t.spotify_id === spotifyId)?.title ?? 'track'
    await invoke('spotify_reject_track_match', { spotifyId, hash })
    await get().fetchImportedTracks()
    showSpotifyToast(`Rejected match for "${title}"`, {
      label: 'Undo',
      onClick: () => { get().undoRejectMatch(spotifyId, hash) },
    })
  },

  undoRejectMatch: async (spotifyId, hash) => {
    await invoke('spotify_undo_reject_track_match', { spotifyId, hash })
    await get().fetchImportedTracks()
    set({ spotifyToast: null })
  },

  // Composes the existing yt-dlp download pipeline with the new link command:
  // enqueue a ytsearch1 pseudo-URL, wait for that specific job to finish, then
  // link the resulting local hash. No new download infrastructure needed.
  downloadAndLinkExternalTrack: async (spotifyId) => {
    const track = get().importedTracks.find(t => t.spotify_id === spotifyId)
    if (!track) return

    set(s => ({ downloadingSpotifyIds: [...s.downloadingSpotifyIds, spotifyId] }))

    const stopDownloading = () => set(s => ({
      downloadingSpotifyIds: s.downloadingSpotifyIds.filter(id => id !== spotifyId),
    }))

    try {
      const query = `ytsearch1:${track.artist} - ${track.title}`
      const jobId: string = await invoke('download_enqueue', { url: query })

      const done = await new Promise<{ track_hash: string; title: string; duration_ms: number }>((resolve, reject) => {
        const subs = [
          listen<{ id: string; track_hash: string; title: string; duration_ms: number }>('download://done', ({ payload }) => {
            if (payload.id !== jobId) return
            cleanup()
            resolve(payload)
          }),
          listen<{ id: string; error: string }>('download://error', ({ payload }) => {
            if (payload.id !== jobId) return
            cleanup()
            reject(new Error(payload.error))
          }),
        ]
        const cleanup = () => subs.forEach(p => p.then(fn => fn()))
      })

      // yt-dlp's own tag extraction is unreliable (M4A downloads especially),
      // so once we know which Spotify track this is, overwrite title/artist/
      // album/artwork with Spotify's data instead of trusting whatever (if
      // anything) got embedded in the downloaded file.
      await invoke('spotify_apply_track_metadata', {
        hash: done.track_hash,
        title: track.title,
        artist: track.artist,
        album: track.album,
        artworkUrl: track.artwork_url,
      })

      await get().loadLibrary()

      const mismatch = Math.abs(done.duration_ms - track.duration_ms) > REVIEW_DURATION_TOLERANCE_MS
      if (mismatch) {
        set(s => ({
          reviewTracks: {
            ...s.reviewTracks,
            [spotifyId]: {
              spotifyId, hash: done.track_hash, title: done.title,
              actualMs: done.duration_ms, expectedMs: track.duration_ms,
            },
          },
        }))
        showSpotifyToast(`Downloaded "${track.title}" — duration looks off, please review`)
      } else {
        await get().linkTrack(spotifyId, done.track_hash)
        showSpotifyToast(`Downloaded "${track.title}"`)
      }
    } finally {
      stopDownloading()
    }
  },

  // Downloads/links every currently-external (unmatched) track for `source`
  // in parallel — the "Download All Tracks" action. Skips ids already mid-
  // download (e.g. a manual single-track download the user kicked off just
  // before hitting "Download All") so they don't get double-enqueued.
  downloadAllTracks: async (source) => {
    const reviewIds = new Set(Object.keys(get().reviewTracks))
    const ids = get().importedTracks
      .filter(t => t.source === source && !t.matched_hash && !reviewIds.has(t.spotify_id))
      .map(t => t.spotify_id)
      .filter(id => !get().downloadingSpotifyIds.includes(id))
    await Promise.all(ids.map(id => get().downloadAndLinkExternalTrack(id)))
  },

  // Resolve a duration-mismatch review: "keep" links the download anyway
  // (the user judged it's actually right despite the length difference),
  // "discard" deletes the downloaded blob/DB row and leaves the Spotify
  // track external so the user can retry with a different query later.
  resolveReviewTrack: async (spotifyId, action) => {
    const review = get().reviewTracks[spotifyId]
    if (!review) return

    if (action === 'keep') {
      await get().linkTrack(spotifyId, review.hash)
    } else {
      await invoke('library_remove_track', { hash: review.hash })
      await get().loadLibrary()
    }

    set(s => {
      const { [spotifyId]: _removed, ...rest } = s.reviewTracks
      return { reviewTracks: rest }
    })
  },

  // Promotes a fully-linked virtual Spotify playlist into a real local
  // playlist (own commit history, syncable like any hand-built playlist).
  // Deliberately manual (a button in the playlist view), not automatic —
  // some users just want to bulk-download the tracks without a matching
  // playlist entry cluttering the sidebar; they can delete the promoted
  // playlist afterwards without losing the downloaded tracks either way.
  // Reuses playlist_create + branch_append_tracks as-is, no new backend
  // command needed. (playlist_reorder_tracks only reorders hashes already
  // present in the tree, so it can't be used to populate a freshly-created,
  // empty playlist — branch_append_tracks appends in the given order, which
  // is exactly what a brand-new playlist needs.)
  promotePlaylist: async (source) => {
    if (get().promotedSpotifySources.includes(source)) return

    const rows = get().importedTracks.filter(t => t.source === source)
    if (rows.length === 0 || rows.some(r => !r.matched_hash)) return

    // Claim the promotion synchronously, before any `await`, so a double
    // click on the Promote button can't pass this check twice before either
    // click commits — which would otherwise create the local playlist twice.
    set(s => ({ promotedSpotifySources: [...s.promotedSpotifySources, source] }))

    const orderedHashes = [...rows]
      .sort((a, b) => a.position - b.position)
      .map(r => r.matched_hash as string)

    const playlistMeta = source === 'liked' ? null : get().spotifyPlaylists.find(p => `playlist:${p.id}` === source) ?? null
    const name = source === 'liked' ? 'Liked Songs' : playlistMeta?.name ?? 'Spotify Playlist'
    // Liked Songs has no playlist-level artwork from Spotify's API — fall
    // back to whichever track's cover art we have on hand.
    const artworkUrl = playlistMeta?.image_url ?? rows.find(r => r.artwork_url)?.artwork_url ?? null

    const created = await invoke<{ id: string }>('playlist_create', { name, description: null })
    await invoke('branch_append_tracks', {
      playlistId: created.id,
      branchName: 'main',
      hashes: orderedHashes,
      message: 'Import from Spotify',
    })

    if (artworkUrl) {
      try {
        const bytes = await invoke<number[]>('fetch_image_url', { url: artworkUrl })
        await invoke('playlist_set_artwork', {
          playlistId: created.id,
          branchName: 'main',
          imageBytes: bytes,
          message: 'Set artwork from Spotify',
        })
      } catch (e) {
        console.error('Failed to set promoted playlist artwork:', e)
      }
    }

    await get().loadPlaylists()
    showSpotifyToast(`Promoted "${name}" to a local playlist`)
  },
  })
}
