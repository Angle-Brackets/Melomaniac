# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Run the full Tauri desktop app in development mode
npm run tauri dev

# Run only the frontend (Vite dev server at http://localhost:1420)
npm run dev

# Type-check and build the frontend for production
npm run build

# Build the distributable desktop app
npm run tauri build
```

There are no tests at this time.

## Architecture

Melomaniac is a desktop music player built with **Tauri 2** (Rust backend) + **React 18 / TypeScript** (frontend), bundled via Vite.

### Communication model
The frontend calls Rust via Tauri's `invoke()` API. Currently the only registered command is `greet` in `src-tauri/src/lib.rs`. New backend commands must be registered in `lib.rs` with `tauri::generate_handler![]` and declared with `#[tauri::command]`.

### Frontend layout (`src/`)
`App.tsx` composes four components stacked vertically:
1. **`Navbar`** — menu toggle + settings button (DaisyUI swap)
2. **`MusicCarousel`** — Swiper coverflow carousel wrapping multiple `MusicCard` instances
3. **`MusicInfo`** — static song/artist display (currently hardcoded)
4. **`MusicControls`** — full playback control bar (play/pause, skip, shuffle, repeat, like, add)

Styling uses **Tailwind CSS** + **DaisyUI** component classes. Icons come from **react-icons**.

### Backend (`src-tauri/src/`)
- `main.rs` — thin entry point; calls `lib.rs`
- `lib.rs` — Tauri app builder, plugin registration, and all `#[tauri::command]` functions

### Key config files
- `src-tauri/tauri.conf.json` — window size (800×600), app identifier, before-dev/build commands
- `vite.config.ts` — locked to port 1420; excludes `src-tauri/` from HMR watch
