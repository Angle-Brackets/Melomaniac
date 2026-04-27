import AVFoundation
import MediaPlayer

// ── Playback-end delegate ─────────────────────────────────────────────────────
//
// AVAudioPlayerDelegate fires on the main thread, but `consume()` is called
// from the Rust monitoring thread every 250 ms. NSLock keeps that safe.

private class PlayerDelegate: NSObject, AVAudioPlayerDelegate {
    private let lock = NSLock()
    private var _finished = false

    func consume() -> Bool {
        lock.lock(); defer { lock.unlock() }
        let v = _finished; _finished = false; return v
    }

    func audioPlayerDidFinishPlaying(_: AVAudioPlayer, successfully _: Bool) {
        lock.lock(); defer { lock.unlock() }
        _finished = true
    }
}

// ── Module-global state ───────────────────────────────────────────────────────
//
// @_cdecl functions have no `self`, so all shared state lives at module scope.
// Only `player` is accessed from multiple threads; AVAudioPlayer itself is not
// thread-safe, but reads from the monitoring thread (position, isPlaying) are
// benign in practice. Writes (load/play/pause/stop) come from Tauri commands,
// which serialize naturally because the UI only issues one at a time.

private var player: AVAudioPlayer?
private let playerDelegate = PlayerDelegate()

// ── UTI helpers ───────────────────────────────────────────────────────────────
//
// AVAudioPlayer(contentsOf:fileTypeHint:) expects a UTI string, not a MIME
// type. We use raw UTI string literals rather than AVFileType members because
// several members (e.g. AVFileType.flac) exist only on macOS and are absent
// from the iOS SDK, which would cause a compile error.

private func mimeToUTI(_ mime: String) -> String? {
    switch mime {
    case "audio/mpeg", "audio/mp3":           return "public.mp3"
    case "audio/flac":                        return "org.xiph.flac"
    case "audio/mp4", "audio/m4a",
         "audio/aac", "audio/x-m4a":         return "com.apple.m4a-audio"
    case "audio/wav", "audio/wave",
         "audio/x-wav":                       return "com.microsoft.waveform-audio"
    case "audio/aiff", "audio/x-aiff":       return "public.aiff-audio"
    case "audio/caf":                         return "com.apple.coreaudio-format"
    default:                                  return nil
    }
}

// Falls back to magic-byte detection when no MIME hint is stored in the DB.
private func detectUTI(_ url: URL) -> String? {
    guard let handle = try? FileHandle(forReadingFrom: url) else { return nil }
    let bytes = [UInt8](handle.readData(ofLength: 12))
    handle.closeFile()
    guard bytes.count >= 4 else { return nil }

    if bytes[0] == 0x49, bytes[1] == 0x44, bytes[2] == 0x33              { return "public.mp3" }             // MP3: ID3
    if bytes[0] == 0xFF, bytes[1] == 0xFB || bytes[1] == 0xF3
                      || bytes[1] == 0xF2                                 { return "public.mp3" }             // MP3: sync
    if bytes[0] == 0x66, bytes[1] == 0x4C, bytes[2] == 0x61,
       bytes[3] == 0x43                                                   { return "org.xiph.flac" }          // FLAC: fLaC
    if bytes.count >= 8,
       bytes[4] == 0x66, bytes[5] == 0x74, bytes[6] == 0x79,
       bytes[7] == 0x70                                                   { return "com.apple.m4a-audio" }    // M4A: ftyp@4
    if bytes[0] == 0x52, bytes[1] == 0x49, bytes[2] == 0x46,
       bytes[3] == 0x46                                                   { return "com.microsoft.waveform-audio" } // WAV: RIFF
    if bytes[0] == 0x63, bytes[1] == 0x61, bytes[2] == 0x66,
       bytes[3] == 0x66                                                   { return "com.apple.coreaudio-format" }   // CAF: caff
    return nil
}

// ── C-callable exports ────────────────────────────────────────────────────────

/// Configures AVAudioSession for uninterrupted background playback.
/// The .playback category keeps audio alive when the device is locked or the
/// silent switch is flipped. Call once at startup before the first melo_load.
@_cdecl("melo_configure_session")
public func meloConfigureSession() -> Bool {
    do {
        try AVAudioSession.sharedInstance().setCategory(.playback, mode: .default, options: [])
        try AVAudioSession.sharedInstance().setActive(true)
        return true
    } catch {
        return false
    }
}

/// Loads an audio file from an absolute path. `mimeHint` is an IANA MIME type
/// string (may be NULL); used to resolve the AVAudioPlayer file-type hint so
/// that extension-less CAS blobs are decoded correctly.
@_cdecl("melo_load")
public func meloLoad(_ pathPtr: UnsafePointer<CChar>, _ mimeHint: UnsafePointer<CChar>?) -> Bool {
    let path = String(cString: pathPtr)
    let url  = URL(fileURLWithPath: path)

    let uti: String?
    if let hint = mimeHint {
        uti = mimeToUTI(String(cString: hint)) ?? detectUTI(url)
    } else {
        uti = detectUTI(url)
    }

    do {
        player = try uti != nil
            ? AVAudioPlayer(contentsOf: url, fileTypeHint: uti)
            : AVAudioPlayer(contentsOf: url)
        player?.delegate = playerDelegate
        player?.prepareToPlay()
        return true
    } catch {
        player = nil
        return false
    }
}

/// Begins or resumes playback. Returns false if no track is loaded.
@_cdecl("melo_play")
public func meloPlay() -> Bool { player?.play() ?? false }

/// Pauses playback, retaining the current position. No-op if not playing.
@_cdecl("melo_pause")
public func meloPause() { player?.pause() }

/// Stops playback and releases the player.
@_cdecl("melo_stop")
public func meloStop() { player?.stop(); player = nil }

/// Seeks to `positionMs` milliseconds. Clamped to track duration.
@_cdecl("melo_seek")
public func meloSeek(_ positionMs: UInt64) {
    guard let p = player else { return }
    p.currentTime = min(Double(positionMs) / 1000.0, p.duration)
}

/// Sets volume in 0.0–1.0.
@_cdecl("melo_set_volume")
public func meloSetVolume(_ volume: Float) {
    player?.volume = max(0.0, min(1.0, volume))
}

/// Current playback position in milliseconds. 0 if no track loaded.
@_cdecl("melo_position_ms")
public func meloPositionMs() -> UInt64 {
    guard let p = player else { return 0 }
    return UInt64(max(0.0, p.currentTime) * 1000.0)
}

/// Track duration in milliseconds. 0 if unknown.
@_cdecl("melo_duration_ms")
public func meloDurationMs() -> UInt64 {
    guard let p = player else { return 0 }
    return UInt64(max(0.0, p.duration) * 1000.0)
}

/// True only while actively playing (not paused, not stopped).
@_cdecl("melo_is_playing")
public func meloIsPlaying() -> Bool { player?.isPlaying ?? false }

/// True once after natural playback end; resets on the next call.
@_cdecl("melo_is_finished")
public func meloIsFinished() -> Bool { playerDelegate.consume() }

/// Updates MPNowPlayingInfoCenter (lock-screen / Control Centre widget).
/// Called from the Rust monitoring thread every 250 ms, so we dispatch to
/// the main thread — MPNowPlayingInfoCenter is main-thread-only.
/// IMPORTANT: C string pointers are only valid for this call frame, so they
/// must be copied to Swift Strings *before* entering the async block.
@_cdecl("melo_update_now_playing")
public func meloUpdateNowPlaying(
    _ titlePtr:  UnsafePointer<CChar>,
    _ artistPtr: UnsafePointer<CChar>,
    _ albumPtr:  UnsafePointer<CChar>?,
    _ positionSecs: Float
) {
    let title    = String(cString: titlePtr)
    let artist   = String(cString: artistPtr)
    let album    = albumPtr.map { String(cString: $0) }
    let position = Double(positionSecs)

    DispatchQueue.main.async {
        let duration  = player?.duration  ?? 0.0
        let isPlaying = player?.isPlaying ?? false

        var info: [String: Any] = [
            MPMediaItemPropertyTitle:                       title,
            MPMediaItemPropertyArtist:                      artist,
            MPMediaItemPropertyPlaybackDuration:            duration,
            MPNowPlayingInfoPropertyElapsedPlaybackTime:    position,
            MPNowPlayingInfoPropertyPlaybackRate:           isPlaying ? 1.0 : 0.0,
        ]
        if let album = album { info[MPMediaItemPropertyAlbumTitle] = album }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }
}

// ── Remote command callback ───────────────────────────────────────────────────
//
// A @convention(c) function pointer is just a memory address — a value type,
// not a reference. It is safe to capture across threads and in async blocks.
//
// MeloCommand codes (must match the Rust enum in ios.rs):
//   0=Play  1=Pause  2=NextTrack  3=PreviousTrack  4=TogglePlayPause

public typealias MeloCommandCallback = @convention(c) (Int32) -> Void

/// Registers lock-screen transport controls that call back into Rust.
/// MPRemoteCommandCenter must be configured from the main thread, so we
/// dispatch there. By the time audio starts (≥5 s after init), the async
/// block will have run.
@_cdecl("melo_register_remote_commands")
public func meloRegisterRemoteCommands(_ callback: MeloCommandCallback) {
    DispatchQueue.main.async {
        let c = MPRemoteCommandCenter.shared()
        c.playCommand.addTarget            { _ in callback(0); return .success }
        c.pauseCommand.addTarget           { _ in callback(1); return .success }
        c.nextTrackCommand.addTarget       { _ in callback(2); return .success }
        c.previousTrackCommand.addTarget   { _ in callback(3); return .success }
        c.togglePlayPauseCommand.addTarget { _ in callback(4); return .success }
    }
}
