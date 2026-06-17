# Known Bugs

## Album Art Outline

A stray outline/border appears around album artwork. Exact cause not yet
investigated. Affects the desktop carousel / now-playing area.

---

## Resolved in a1.0.1

- **Mobile icon buttons showing outline circle instead of filled icon when active** — Active state for heart / shuffle / loop secondary buttons was rendering a hollow circle rather than a filled icon. Fixed.
- **Loop / shuffle / heart icon colors tied to album art instead of theme** — These icons were inheriting color from the dynamic album art palette instead of the CSS `--accent` variable. Fixed; all secondary buttons now use `--accent`.
- **AVAudioSession not resuming after interruption** — Audio did not resume after phone calls, Siri, or other iOS audio session interruptions. Fixed via `AVAudioSessionInterruptionNotification` handler that calls `audio_play` when `shouldResume` is set.
- **Named themes not resetting accent hue** — Selecting a named theme pill left the custom hue slider at its previous value, causing the theme's canonical hue to be overridden. Fixed; named theme selection now resets the slider to the theme's canonical hue.
