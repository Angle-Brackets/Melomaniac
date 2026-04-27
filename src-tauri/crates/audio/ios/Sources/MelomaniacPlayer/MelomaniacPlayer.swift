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
// @_cdecl functions have no `self`, so shared state lives at module scope.

private var player: AVAudioPlayer?
private let playerDelegate = PlayerDelegate()

// MPRemoteCommand.addTarget(handler:) returns an opaque token.
// From Apple docs: "You need to retain the returned handle to keep the handler
// active." If the token is deallocated, iOS silently removes the handler and
// will NOT show the Now Playing widget in Control Centre / lock screen.
private var remoteCommandTokens: [Any] = []

// ── UTI helpers ───────────────────────────────────────────────────────────────
//
// AVAudioPlayer(contentsOf:fileTypeHint:) expects a UTI string, not MIME.
// We use raw UTI string literals rather than AVFileType members because some
// members (e.g. AVFileType.flac) exist only on macOS and are absent from the
// iOS SDK — using them would cause a compile error against iPhoneSimulator.

private func mimeToUTI(_ mime: String) -> String? {
    switch mime {
    case "audio/mpeg", "audio/mp3":               return "public.mp3"
    case "audio/flac":                            return "org.xiph.flac"
    case "audio/mp4", "audio/m4a",
         "audio/aac", "audio/x-m4a":             return "com.apple.m4a-audio"
    case "audio/wav", "audio/wave", "audio/x-wav": return "com.microsoft.waveform-audio"
    case "audio/aiff", "audio/x-aiff":           return "public.aiff-audio"
    case "audio/caf":                             return "com.apple.coreaudio-format"
    default:                                      return nil
    }
}

private func detectUTI(_ url: URL) -> String? {
    guard let handle = try? FileHandle(forReadingFrom: url) else { return nil }
    let bytes = [UInt8](handle.readData(ofLength: 12))
    handle.closeFile()
    guard bytes.count >= 4 else { return nil }

    if bytes[0]==0x49, bytes[1]==0x44, bytes[2]==0x33                               { return "public.mp3" }
    if bytes[0]==0xFF, bytes[1]==0xFB || bytes[1]==0xF3 || bytes[1]==0xF2           { return "public.mp3" }
    if bytes[0]==0x66, bytes[1]==0x4C, bytes[2]==0x61, bytes[3]==0x43               { return "org.xiph.flac" }
    if bytes.count>=8, bytes[4]==0x66, bytes[5]==0x74, bytes[6]==0x79, bytes[7]==0x70 { return "com.apple.m4a-audio" }
    if bytes[0]==0x52, bytes[1]==0x49, bytes[2]==0x46, bytes[3]==0x46               { return "com.microsoft.waveform-audio" }
    if bytes[0]==0x63, bytes[1]==0x61, bytes[2]==0x66, bytes[3]==0x66               { return "com.apple.coreaudio-format" }
    return nil
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Runs `block` on the main thread.
// • If already on main: executes immediately (avoids the deadlock that
//   DispatchQueue.main.sync would cause when called from main).
// • If on a background thread: blocks the caller until main finishes.
//   This is intentional for MPNowPlayingInfoCenter — we want the update to
//   be visible before the Swift function returns to Rust.
private func onMain(_ block: () -> Void) {
    if Thread.isMainThread { block() } else { DispatchQueue.main.sync(execute: block) }
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

/// Loads an audio file. `pathPtr` is an absolute path; `mimeHint` is an
/// optional IANA MIME type string (may be NULL).
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

@_cdecl("melo_play")
public func meloPlay() -> Bool { player?.play() ?? false }

@_cdecl("melo_pause")
public func meloPause() { player?.pause() }

@_cdecl("melo_stop")
public func meloStop() { player?.stop(); player = nil }

@_cdecl("melo_seek")
public func meloSeek(_ positionMs: UInt64) {
    guard let p = player else { return }
    p.currentTime = min(Double(positionMs) / 1000.0, p.duration)
}

@_cdecl("melo_set_volume")
public func meloSetVolume(_ volume: Float) {
    player?.volume = max(0.0, min(1.0, volume))
}

@_cdecl("melo_position_ms")
public func meloPositionMs() -> UInt64 {
    guard let p = player else { return 0 }
    return UInt64(max(0.0, p.currentTime) * 1000.0)
}

@_cdecl("melo_duration_ms")
public func meloDurationMs() -> UInt64 {
    guard let p = player else { return 0 }
    return UInt64(max(0.0, p.duration) * 1000.0)
}

@_cdecl("melo_is_playing")
public func meloIsPlaying() -> Bool { player?.isPlaying ?? false }

@_cdecl("melo_is_finished")
public func meloIsFinished() -> Bool { playerDelegate.consume() }

/// Updates MPNowPlayingInfoCenter (lock-screen / Control Centre widget).
///
/// Called every 250 ms from the Rust monitoring thread (a background thread).
/// Two rules apply:
///   1. MPNowPlayingInfoCenter must be written from the main thread.
///   2. UnsafePointer<CChar> arguments are only valid for this call frame;
///      they must be copied to Swift Strings *before* any thread boundary.
///
/// We satisfy both by copying strings synchronously, then dispatching the
/// MPNowPlayingInfoCenter write to the main thread via `onMain`, which blocks
/// the monitoring thread briefly but ensures the update is visible immediately.
@_cdecl("melo_update_now_playing")
public func meloUpdateNowPlaying(
    _ titlePtr:     UnsafePointer<CChar>,
    _ artistPtr:    UnsafePointer<CChar>,
    _ albumPtr:     UnsafePointer<CChar>?,
    _ positionSecs: Float
) {
    // Copy before the thread boundary — pointers are frame-scoped.
    let title    = String(cString: titlePtr)
    let artist   = String(cString: artistPtr)
    let album    = albumPtr.map { String(cString: $0) }
    let position = Double(positionSecs)

    onMain {
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
// MeloCommand codes (must match the Rust enum in ios.rs):
//   0=Play  1=Pause  2=NextTrack  3=PreviousTrack  4=TogglePlayPause
//
// A @convention(c) function pointer is a plain value (memory address of the
// static extern "C" fn in Rust). It is safe to capture in closures and use
// across threads.

public typealias MeloCommandCallback = @convention(c) (Int32) -> Void

/// Registers lock-screen transport controls that call back into Rust.
///
/// MPRemoteCommandCenter must be configured on the main thread. The tokens
/// returned by addTarget(handler:) are stored in `remoteCommandTokens` —
/// without this, iOS immediately deregisters the handlers and will not show
/// the Now Playing widget in Control Centre or on the lock screen.
@_cdecl("melo_register_remote_commands")
public func meloRegisterRemoteCommands(_ callback: MeloCommandCallback) {
    onMain {
        let c = MPRemoteCommandCenter.shared()
        remoteCommandTokens = [
            c.playCommand.addTarget            { _ in callback(0); return .success },
            c.pauseCommand.addTarget           { _ in callback(1); return .success },
            c.nextTrackCommand.addTarget       { _ in callback(2); return .success },
            c.previousTrackCommand.addTarget   { _ in callback(3); return .success },
            c.togglePlayPauseCommand.addTarget { _ in callback(4); return .success },
        ]
    }
}
