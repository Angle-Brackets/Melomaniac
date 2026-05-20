// Slice pattern keeps each concern isolated and makes cross-slice access explicit.
// If a slice needs to read another slice's state, widen its StateCreator generic to StoreState
// and import StoreState here with `import type` to avoid a circular runtime dependency.
import { create } from 'zustand'
import { createPlaybackSlice, PlaybackSlice } from './playbackSlice'
import { createQueueSlice, QueueSlice } from './queueSlice'
import { createLibrarySlice, LibrarySlice } from './librarySlice'
import { createPlaylistSlice, PlaylistSlice } from './playlistSlice'
import { createSyncSlice, SyncSlice } from './syncSlice'

export type StoreState = PlaybackSlice & QueueSlice & LibrarySlice & PlaylistSlice & SyncSlice

export const useStore = create<StoreState>()((...a) => ({
  ...createPlaybackSlice(...a),
  ...createQueueSlice(...a),
  ...createLibrarySlice(...a),
  ...createPlaylistSlice(...a),
  ...createSyncSlice(...a),
}))
