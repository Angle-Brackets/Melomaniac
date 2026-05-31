import { describe, it, expect } from 'vitest'
import { trackRecordToTrack, TrackRecord } from '../../desktop/data'

function rec(overrides: Partial<TrackRecord> = {}): TrackRecord {
  return {
    hash:         'aabbcc112233',
    title:        'My Track',
    artist:       'Some Artist',
    album:        'Some Album',
    artwork_hash: null,
    duration_ms:  90061,   // 1:30:01 → but we test simpler durations below
    favorited:    false,
    mime_type:    null,
    ingested_at:  1700000000,
    source_url:   null,
    ...overrides,
  }
}

describe('trackRecordToTrack', () => {
  it('maps title and artist', () => {
    const t = trackRecordToTrack(rec({ title: 'Hello', artist: 'World' }), 0)
    expect(t.title).toBe('Hello')
    expect(t.artist).toBe('World')
  })

  it('uses album when present', () => {
    const t = trackRecordToTrack(rec({ album: 'Great Album' }), 0)
    expect(t.album).toBe('Great Album')
  })

  it('falls back to Unknown Album when album is null', () => {
    const t = trackRecordToTrack(rec({ album: null }), 0)
    expect(t.album).toBe('Unknown Album')
  })

  it('formats length as M:SS', () => {
    // 125_000 ms = 2 minutes 5 seconds → "2:05"
    const t = trackRecordToTrack(rec({ duration_ms: 125000 }), 0)
    expect(t.length).toBe('2:05')
  })

  it('formats length with zero-padded seconds', () => {
    // 61_000 ms = 1 minute 1 second → "1:01"
    const t = trackRecordToTrack(rec({ duration_ms: 61000 }), 0)
    expect(t.length).toBe('1:01')
  })

  it('passes through ingested_at', () => {
    const t = trackRecordToTrack(rec({ ingested_at: 1234567890 }), 0)
    expect(t.ingested_at).toBe(1234567890)
  })

  it('passes through source_url', () => {
    const t = trackRecordToTrack(rec({ source_url: 'https://yt.example/watch?v=abc' }), 0)
    expect(t.source_url).toBe('https://yt.example/watch?v=abc')
  })

  it('passes through source_url null', () => {
    const t = trackRecordToTrack(rec({ source_url: null }), 0)
    expect(t.source_url).toBeNull()
  })

  it('sets id to idx + 1', () => {
    expect(trackRecordToTrack(rec(), 0).id).toBe(1)
    expect(trackRecordToTrack(rec(), 4).id).toBe(5)
  })
})
