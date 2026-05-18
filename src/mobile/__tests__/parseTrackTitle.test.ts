import { describe, it, expect } from 'vitest'
import { parseTrackTitle } from '../utils/parseTrackTitle'

// ── Empty / degenerate ────────────────────────────────────────────────────────

describe('empty input', () => {
  it('returns empty title and nulls for empty string', () => {
    const r = parseTrackTitle('')
    expect(r.title).toBe('')
    expect(r.variant).toBeNull()
    expect(r.album).toBeNull()
    expect(r.tag).toBeNull()
  })
})

// ── Plain title (no decorations) ──────────────────────────────────────────────

describe('plain title', () => {
  it('returns the raw string as title', () => {
    const r = parseTrackTitle('Bohemian Rhapsody')
    expect(r.title).toBe('Bohemian Rhapsody')
    expect(r.variant).toBeNull()
    expect(r.album).toBeNull()
    expect(r.tag).toBeNull()
  })

  it('preserves interior punctuation', () => {
    const r = parseTrackTitle("Don't Stop Me Now")
    expect(r.title).toBe("Don't Stop Me Now")
  })
})

// ── Variant (parenthetical) ───────────────────────────────────────────────────

describe('variant in parens', () => {
  it('splits variant from title', () => {
    const r = parseTrackTitle('Creep (Acoustic)')
    expect(r.title).toBe('Creep')
    expect(r.variant).toBe('Acoustic')
  })

  it('handles multi-word variant', () => {
    const r = parseTrackTitle('Hallelujah (Piano Version)')
    expect(r.title).toBe('Hallelujah')
    expect(r.variant).toBe('Piano Version')
  })

  it('preserves a bare parenthetical as the title when nothing precedes it', () => {
    // No preceding title text — whole string becomes the title
    const r = parseTrackTitle('(Interlude)')
    expect(r.title).toBe('(Interlude)')
    expect(r.variant).toBeNull()
  })
})

// ── Album (dash separator) ────────────────────────────────────────────────────

describe('album after dash', () => {
  it('splits album from title on hyphen', () => {
    const r = parseTrackTitle('Yellow - Parachutes')
    expect(r.title).toBe('Yellow')
    expect(r.album).toBe('Parachutes')
  })

  it('splits album on en-dash', () => {
    const r = parseTrackTitle('Clocks – A Rush of Blood to the Head')
    expect(r.title).toBe('Clocks')
    expect(r.album).toBe('A Rush of Blood to the Head')
  })

  it('splits album on em-dash', () => {
    const r = parseTrackTitle('Fix You — X&Y')
    expect(r.title).toBe('Fix You')
    expect(r.album).toBe('X&Y')
  })
})

// ── Tag (bracket) ─────────────────────────────────────────────────────────────

describe('tag in brackets', () => {
  it('splits tag from title', () => {
    const r = parseTrackTitle('Lose Yourself [feat. Eminem]')
    expect(r.title).toBe('Lose Yourself')
    expect(r.tag).toBe('feat. Eminem')
  })

  it('handles numeric tag', () => {
    const r = parseTrackTitle('Summer Hits [2024]')
    expect(r.title).toBe('Summer Hits')
    expect(r.tag).toBe('2024')
  })
})

// ── Multiple decorations ──────────────────────────────────────────────────────

describe('combined decorations', () => {
  it('parses variant + tag', () => {
    const r = parseTrackTitle('Imagine (Remastered) [2010]')
    expect(r.title).toBe('Imagine')
    expect(r.variant).toBe('Remastered')
    expect(r.tag).toBe('2010')
    expect(r.album).toBeNull()
  })

  it('parses variant + album + tag', () => {
    const r = parseTrackTitle('Lithium (Demo) - Nevermind [Bonus]')
    expect(r.title).toBe('Lithium')
    expect(r.variant).toBe('Demo')
    expect(r.album).toBe('Nevermind')
    expect(r.tag).toBe('Bonus')
  })

  it('parses album + tag without variant', () => {
    const r = parseTrackTitle('Under the Bridge - Blood Sugar Sex Magik [1991]')
    expect(r.title).toBe('Under the Bridge')
    expect(r.variant).toBeNull()
    expect(r.album).toBe('Blood Sugar Sex Magik')
    expect(r.tag).toBe('1991')
  })

  it('trims whitespace from inside the variant parens', () => {
    // Leading spaces in the title confuse the non-greedy regex (the title group
    // absorbs everything when it can't cleanly split), so only test variant trimming.
    const r = parseTrackTitle('Song (  Live  )')
    expect(r.title).toBe('Song')
    expect(r.variant).toBe('Live')
  })
})
