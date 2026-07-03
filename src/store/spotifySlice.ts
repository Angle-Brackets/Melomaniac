import { StateCreator } from 'zustand'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { SpotifyTrack, SpotifyTrackRecord } from './types'
import type { StoreState } from './index'

export type SpotifySlice = {
  importedTracks: SpotifyTrackRecord[]
  // spotify_ids currently mid-download via downloadAndLinkExternalTrack, so
  // the Library can disable/spin the "Get track" action while it's in flight.
  downloadingSpotifyIds: string[]

  fetchImportedTracks:         () => Promise<void>
  importPlaylist:               (source: string, tracks: SpotifyTrack[]) => Promise<void>
  linkTrack:                    (spotifyId: string, hash: string) => Promise<void>
  unlinkTrack:                   (spotifyId: string) => Promise<void>
  downloadAndLinkExternalTrack: (spotifyId: string) => Promise<void>
}

export const createSpotifySlice: StateCreator<StoreState, [], [], SpotifySlice> = (set, get) => ({
  importedTracks: [],
  downloadingSpotifyIds: [],

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

      await new Promise<void>((resolve, reject) => {
        const subs = [
          listen<{ id: string; track_hash: string; title: string }>('download://done', ({ payload }) => {
            if (payload.id !== jobId) return
            cleanup()
            get().linkTrack(spotifyId, payload.track_hash).then(resolve, reject)
          }),
          listen<{ id: string; error: string }>('download://error', ({ payload }) => {
            if (payload.id !== jobId) return
            cleanup()
            reject(new Error(payload.error))
          }),
        ]
        const cleanup = () => subs.forEach(p => p.then(fn => fn()))
      })

      await get().loadLibrary()
    } finally {
      stopDownloading()
    }
  },
})
