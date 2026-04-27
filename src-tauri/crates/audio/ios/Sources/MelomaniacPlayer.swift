import AVFoundation
import MediaPlayer

// ── Playback-end delegate ─────────────────────────────────────────────────────
//
// AVAudioPlayer notifies its delegate on the main thread when playback ends
// naturally. We use NSLock to make `consume()` safe to call from the Rust
// monitoring thread.

private class PlayerDelegate: NSObject, AVAudioPlayerDelegate {
    private let lock = NSLock()
    private var _finished = false

    /// Returns true once after natural playback end; resets on the next read.
    func consume() -> Bool {
        lock.lock(); defer { lock.unlock() }
        let v = _finished
        _finished = false
        return v
    }

    func audioPlayerDidFinishPlaying(_: AVAudioPlayer, successfully _: Bool) {
        lock.lock(); defer { lock.unlock() }
        _finished = true
    }
}

// ── Module-global player state ────────────────────────────────────────────────
//
// All state is module-global so @_cdecl functions (which have no `self`)
// can reach it. The Swift runtime serialises calls from Rust's monitoring
// thread via the global actor / locks below.

private var player: AVAudioPlayer?
private let playerDelegate = PlayerDelegate()

// ── UTI helpers ───────────────────────────────────────────────────────────────
//
// AVAudioPlayer(contentsOf:fileTypeHint:) expects UTI strings (AVFileType),
// not MIME types. We convert the stored MIME type before passing it.

private func mimeToUTI(_ mime: String) -> String? {
    switch mime {
    case "audio/mpeg", "audio/mp3":
        return AVFileType.mp3.rawValue
    case "audio/flac":
        return AVFileType.flac.rawValue
    case "audio/mp4", "audio/m4a", "audio/aac", "audio/x-m4a":
        return AVFileType.m4a.rawValue
    case "audio/wav", "audio/wave", "audio/x-wav":
        return AVFileType.wav.rawValue
    case "audio/aiff", "audio/x-aiff":
        return AVFileType.aiff.rawValue
    case "audio/caf":
        return AVFileType.caf.rawValue
    default:
        return nil
    }
}

/// Reads the first 12 bytes of `url` and returns an AVFileType UTI based on
/// magic bytes. Returns nil if the format is unrecognised.
private func detectUTI(_ url: URL) -> String? {
    guard let handle = try? FileHandle(forReadingFrom: url) else { return nil }
    let bytes = [UInt8](handle.readData(ofLength: 12))
    handle.closeFile()
    guard bytes.count >= 4 else { return nil }

    // MP3: ID3 header
    if bytes[0] == 0x49, bytes[1] == 0x44, bytes[2] == 0x33 {
        return AVFileType.mp3.rawValue
    }
    // MP3: sync bytes
    if bytes[0] == 0xFF, bytes[1] == 0xFB || bytes[1] == 0xF3 || bytes[1] == 0xF2 {
        return AVFileType.mp3.rawValue
    }
    // FLAC: fLaC
    if bytes[0] == 0x66, bytes[1] == 0x4C, bytes[2] == 0x61, bytes[3] == 0x43 {
        return AVFileType.flac.rawValue
    }
    // M4A/AAC: ftyp at offset 4
    if bytes.count >= 8,
       bytes[4] == 0x66, bytes[5] == 0x74, bytes[6] == 0x79, bytes[7] == 0x70 {
        return AVFileType.m4a.rawValue
    }
    // WAV: RIFF
    if bytes[0] == 0x52, bytes[1] == 0x49, bytes[2] == 0x46, bytes[3] == 0x46 {
        return AVFileType.wav.rawValue
    }
    // CAF: caff
    if bytes[0] == 0x63, bytes[1] == 0x61, bytes[2] == 0x66, bytes[3] == 0x66 {
        return AVFileType.caf.rawValue
    }

    return nil
}

// ── C-callable exports ────────────────────────────────────────────────────────

/// Configures AVAudioSession for uninterrupted background music playback.
/// Call once at app startup before the first melo_load.
@_cdecl("melo_configure_session")
public func meloConfigureSession() -> Bool {
    do {
        try AVAudioSession.sharedInstance().setCategory(
            .playback,
            mode: .default,
            options: []
        )
        try AVAudioSession.sharedInstance().setActive(true)
        return true
    } catch {
        return false
    }
}

/// Loads an audio file. `pathPtr` is an absolute path; `mimeHint` is an
/// optional IANA MIME type string (may be NULL). Returns false on error.
@_cdecl("melo_load")
public func meloLoad(
    _ pathPtr: UnsafePointer<CChar>,
    _ mimeHint: UnsafePointer<CChar>?
) -> Bool {
    let path = String(cString: pathPtr)
    let url  = URL(fileURLWithPath: path)

    // Resolve file type hint: prefer stored MIME (converted to UTI), then
    // magic-byte detection, then let AVAudioPlayer try on its own.
    let uti: String?
    if let hint = mimeHint {
        uti = mimeToUTI(String(cString: hint)) ?? detectUTI(url)
    } else {
        uti = detectUTI(url)
    }

    do {
        if let uti = uti {
            player = try AVAudioPlayer(contentsOf: url, fileTypeHint: uti)
        } else {
            player = try AVAudioPlayer(contentsOf: url)
        }
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
public func meloPlay() -> Bool {
    return player?.play() ?? false
}

/// Pauses playback. No-op if not playing.
@_cdecl("melo_pause")
public func meloPause() {
    player?.pause()
}

/// Stops playback and releases the player. Resets position to 0.
@_cdecl("melo_stop")
public func meloStop() {
    player?.stop()
    player = nil
}

/// Seeks to `positionMs` milliseconds. Clamped to track duration.
@_cdecl("melo_seek")
public func meloSeek(_ positionMs: UInt64) {
    guard let p = player else { return }
    let secs = Double(positionMs) / 1000.0
    p.currentTime = min(secs, p.duration)
}

/// Sets volume. Clamped to 0.0–1.0.
@_cdecl("melo_set_volume")
public func meloSetVolume(_ volume: Float) {
    player?.volume = max(0.0, min(1.0, volume))
}

/// Returns current playback position in milliseconds. 0 if no track loaded.
@_cdecl("melo_position_ms")
public func meloPositionMs() -> UInt64 {
    guard let p = player else { return 0 }
    return UInt64(max(0.0, p.currentTime) * 1000.0)
}

/// Returns track duration in milliseconds. 0 if unknown.
@_cdecl("melo_duration_ms")
public func meloDurationMs() -> UInt64 {
    guard let p = player else { return 0 }
    return UInt64(max(0.0, p.duration) * 1000.0)
}

/// Returns true only while actively playing (not paused, not stopped).
@_cdecl("melo_is_playing")
public func meloIsPlaying() -> Bool {
    return player?.isPlaying ?? false
}

/// Returns true once after natural playback end; resets on the next call.
/// The Rust monitoring thread calls this every 250ms.
@_cdecl("melo_is_finished")
public func meloIsFinished() -> Bool {
    return playerDelegate.consume()
}

/// Updates MPNowPlayingInfoCenter with current track info and position.
/// `albumPtr` may be NULL. `positionSecs` is current elapsed time.
@_cdecl("melo_update_now_playing")
public func meloUpdateNowPlaying(
    _ titlePtr: UnsafePointer<CChar>,
    _ artistPtr: UnsafePointer<CChar>,
    _ albumPtr: UnsafePointer<CChar>?,
    _ positionSecs: Float
) {
    let title  = String(cString: titlePtr)
    let artist = String(cString: artistPtr)
    let album  = albumPtr.map { String(cString: $0) }

    let duration  = player?.duration ?? 0.0
    let isPlaying = player?.isPlaying ?? false

    var info: [String: Any] = [
        MPMediaItemPropertyTitle:                       title,
        MPMediaItemPropertyArtist:                      artist,
        MPMediaItemPropertyPlaybackDuration:            duration,
        MPNowPlayingInfoPropertyElapsedPlaybackTime:    Double(positionSecs),
        MPNowPlayingInfoPropertyPlaybackRate:           isPlaying ? 1.0 : 0.0,
    ]
    if let album = album {
        info[MPMediaItemPropertyAlbumTitle] = album
    }

    MPNowPlayingInfoCenter.default().nowPlayingInfo = info
}

// ── Remote command callback ───────────────────────────────────────────────────
//
// MeloCommand integer codes (must match the Rust enum in ios.rs):
//   0 = Play  1 = Pause  2 = NextTrack  3 = PreviousTrack  4 = TogglePlayPause

typealias MeloCommandCallback = @convention(c) (Int32) -> Void

/// Registers lock-screen transport controls. `callback` is called on each
/// button press with the corresponding MeloCommand integer code.
/// Call once at startup after melo_configure_session.
@_cdecl("melo_register_remote_commands")
public func meloRegisterRemoteCommands(_ callback: MeloCommandCallback) {
    let center = MPRemoteCommandCenter.shared()

    center.playCommand.addTarget { _ in
        callback(0); return .success
    }
    center.pauseCommand.addTarget { _ in
        callback(1); return .success
    }
    center.nextTrackCommand.addTarget { _ in
        callback(2); return .success
    }
    center.previousTrackCommand.addTarget { _ in
        callback(3); return .success
    }
    center.togglePlayPauseCommand.addTarget { _ in
        callback(4); return .success
    }
}
