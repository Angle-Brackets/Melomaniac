import AVFoundation
import Darwin
import MediaPlayer
import SafariServices
import UIKit

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
// Persisted across melo_update_now_playing calls so position ticks don't wipe cover art.
private var currentArtwork: MPMediaItemArtwork? = nil

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
//   This is intentional — we want state changes to be visible before
//   returning to Rust.
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
        NSLog("[Melo] AVAudioSession configured: .playback, active=true")
        return true
    } catch {
        NSLog("[Melo] AVAudioSession setup failed: \(error)")
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
        NSLog("[Melo] Loaded '\(url.lastPathComponent)', duration=\(player?.duration ?? 0)s, uti=\(uti ?? "nil")")
        return true
    } catch {
        NSLog("[Melo] Load failed: \(error)")
        player = nil
        return false
    }
}

// play / pause / stop all run on the main thread via onMain{} so that:
//   1. AVAudioPlayer state changes are always visible on the main run loop.
//   2. MPNowPlayingInfoCenter can be updated immediately (requires main thread)
//      with the correct playbackRate, rather than waiting for the 250ms monitor.
//      iOS uses playbackRate to decide whether to display the Now Playing widget;
//      if the first write has rate=0.0 (set during load, before play is called)
//      it may not surface the widget even after a later rate=1.0 update.

@_cdecl("melo_play")
public func meloPlay() -> Bool {
    var result = false
    onMain {
        guard let p = player else {
            NSLog("[Melo] play: no player loaded")
            return
        }
        result = p.play()
        NSLog("[Melo] play() → \(result), isPlaying=\(p.isPlaying)")
        guard result else { return }

        // Update Now Playing immediately so the widget appears as soon as
        // playback starts — the 250ms monitoring thread would be too slow.
        if var info = MPNowPlayingInfoCenter.default().nowPlayingInfo {
            info[MPNowPlayingInfoPropertyPlaybackRate]          = 1.0
            info[MPNowPlayingInfoPropertyElapsedPlaybackTime]   = p.currentTime
            MPNowPlayingInfoCenter.default().nowPlayingInfo = info
            NSLog("[Melo] NowPlaying: rate→1.0, pos=\(p.currentTime)")
        } else {
            NSLog("[Melo] play: nowPlayingInfo is nil — melo_update_now_playing not called yet")
        }
    }
    return result
}

@_cdecl("melo_pause")
public func meloPause() {
    onMain {
        player?.pause()
        NSLog("[Melo] pause()")
        if var info = MPNowPlayingInfoCenter.default().nowPlayingInfo {
            info[MPNowPlayingInfoPropertyPlaybackRate]         = 0.0
            info[MPNowPlayingInfoPropertyElapsedPlaybackTime]  = player?.currentTime ?? 0.0
            MPNowPlayingInfoCenter.default().nowPlayingInfo = info
        }
    }
}

@_cdecl("melo_stop")
public func meloStop() {
    onMain {
        player?.stop()
        player = nil
        currentArtwork = nil
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
        NSLog("[Melo] stop()")
    }
}

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
            MPMediaItemPropertyTitle:                           title,
            MPMediaItemPropertyArtist:                          artist,
            MPMediaItemPropertyPlaybackDuration:                duration,
            MPNowPlayingInfoPropertyElapsedPlaybackTime:        position,
            MPNowPlayingInfoPropertyPlaybackRate:               isPlaying ? 1.0 : 0.0,
            // Tells the system that 1× is the default speed; required by some
            // lock-screen implementations to render the scrubber correctly.
            MPNowPlayingInfoPropertyDefaultPlaybackRate:        1.0,
        ]
        if let album  = album        { info[MPMediaItemPropertyAlbumTitle] = album }
        if let art    = currentArtwork { info[MPMediaItemPropertyArtwork]   = art   }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }
}

/// Sets cover-art for the current track in MPNowPlayingInfoCenter.
/// `pathPtr` is an absolute path to the image file, or NULL to clear.
/// Must be called after melo_update_now_playing so the info dict already exists.
@_cdecl("melo_set_artwork_path")
public func meloSetArtworkPath(_ pathPtr: UnsafePointer<CChar>?) {
    let path = pathPtr.map { String(cString: $0) }
    onMain {
        if let path = path, let image = UIImage(contentsOfFile: path) {
            let size = image.size
            currentArtwork = MPMediaItemArtwork(boundsSize: size) { _ in image }
        } else {
            currentArtwork = nil
        }
        if var info = MPNowPlayingInfoCenter.default().nowPlayingInfo {
            if let art = currentArtwork {
                info[MPMediaItemPropertyArtwork] = art
            } else {
                info.removeValue(forKey: MPMediaItemPropertyArtwork)
            }
            MPNowPlayingInfoCenter.default().nowPlayingInfo = info
        }
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

// Second arg is the seek position in seconds; 0.0 for all non-seek commands.
public typealias MeloCommandCallback = @convention(c) (Int32, Double) -> Void

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

        // isEnabled defaults to true when addTarget is called, but setting it
        // explicitly prevents stale false state from a prior partial registration.
        c.playCommand.isEnabled                    = true
        c.pauseCommand.isEnabled                   = true
        c.nextTrackCommand.isEnabled               = true
        c.previousTrackCommand.isEnabled           = true
        c.togglePlayPauseCommand.isEnabled         = true
        c.changePlaybackPositionCommand.isEnabled  = true
        c.likeCommand.isEnabled                    = true
        c.changeShuffleModeCommand.isEnabled       = true

        remoteCommandTokens = [
            c.playCommand.addTarget            { _ in callback(0, 0.0); return .success },
            c.pauseCommand.addTarget           { _ in callback(1, 0.0); return .success },
            c.nextTrackCommand.addTarget       { _ in callback(2, 0.0); return .success },
            c.previousTrackCommand.addTarget   { _ in callback(3, 0.0); return .success },
            c.togglePlayPauseCommand.addTarget { _ in callback(4, 0.0); return .success },
            c.changePlaybackPositionCommand.addTarget { event in
                guard let seekEvent = event as? MPChangePlaybackPositionCommandEvent else {
                    return .commandFailed
                }
                let secs = seekEvent.positionTime
                // Seek immediately for a responsive scrubber; also notify Rust/frontend.
                player?.currentTime = secs
                if var info = MPNowPlayingInfoCenter.default().nowPlayingInfo {
                    info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = secs
                    MPNowPlayingInfoCenter.default().nowPlayingInfo = info
                }
                callback(5, secs)
                return .success
            },
            c.likeCommand.addTarget { _ in callback(6, 0.0); return .success },
            c.changeShuffleModeCommand.addTarget { event in
                guard let e = event as? MPChangeShuffleModeCommandEvent else { return .commandFailed }
                callback(7, Double(e.shuffleType.rawValue))
                return .success
            },
        ]
        NSLog("[Melo] Remote commands registered (\(remoteCommandTokens.count) tokens)")
    }
}

/// Reflects the current shuffle mode on the lock-screen shuffle button.
/// 0 = off (.off), 1 = random (.items), 2 = smart (.collections)
@_cdecl("melo_set_shuffle_state")
public func meloSetShuffleState(_ mode: Int32) {
    onMain {
        let type: MPShuffleType = mode == 1 ? .items : mode == 2 ? .collections : .off
        MPRemoteCommandCenter.shared().changeShuffleModeCommand.currentShuffleType = type
    }
}

/// Reflects the current track's liked state on the lock-screen heart button.
@_cdecl("melo_set_like_state")
public func meloSetLikeState(_ isActive: Bool) {
    onMain {
        MPRemoteCommandCenter.shared().likeCommand.isActive = isActive
    }
}

// ── Process metrics ───────────────────────────────────────────────────────────
//
// sysinfo's iOS backend is a stub that returns zeros. These two exports query
// Mach kernel APIs directly so the Settings developer panel shows real values.

/// Returns the process's resident physical memory in bytes.
@_cdecl("melo_memory_bytes")
public func meloMemoryBytes() -> UInt64 {
    var info = mach_task_basic_info()
    var count = mach_msg_type_number_t(MemoryLayout<mach_task_basic_info>.size) / 4
    let kr = withUnsafeMutablePointer(to: &info) {
        $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
            task_info(mach_task_self_, task_flavor_t(MACH_TASK_BASIC_INFO), $0, &count)
        }
    }
    return kr == KERN_SUCCESS ? info.resident_size : 0
}

/// Returns the process's current CPU usage as a percentage (sum across threads).
/// Uses thread_basic_info.cpu_usage which is a decayed-average snapshot per thread,
/// scaled by TH_USAGE_SCALE (1000) → divide by 10 to get percent.
@_cdecl("melo_cpu_usage_percent")
public func meloCpuUsagePercent() -> Float {
    var threadList: thread_act_array_t? = nil
    var threadCount: mach_msg_type_number_t = 0
    guard task_threads(mach_task_self_, &threadList, &threadCount) == KERN_SUCCESS,
          let threads = threadList else { return 0.0 }
    defer {
        vm_deallocate(mach_task_self_,
                      vm_address_t(UInt(bitPattern: threadList)),
                      vm_size_t(threadCount) * vm_size_t(MemoryLayout<thread_t>.size))
    }
    var usage: Float = 0.0
    for i in 0..<Int(threadCount) {
        var tinfo = thread_basic_info()
        var cnt = mach_msg_type_number_t(MemoryLayout<thread_basic_info>.size) / 4
        let kr = withUnsafeMutablePointer(to: &tinfo) {
            $0.withMemoryRebound(to: integer_t.self, capacity: Int(cnt)) {
                thread_info(threads[i], thread_flavor_t(THREAD_BASIC_INFO), $0, &cnt)
            }
        }
        // TH_FLAGS_IDLE = 0x2, TH_USAGE_SCALE = 1000
        if kr == KERN_SUCCESS && (tinfo.flags & 0x2) == 0 {
            usage += Float(tinfo.cpu_usage) / 1000.0 * 100.0
        }
    }
    return usage
}

// ── In-app URL opener (SFSafariViewController) ────────────────────────────────

@_cdecl("melo_open_url")
public func melo_open_url(_ urlCString: UnsafePointer<CChar>) {
    guard let urlStr = String(cString: urlCString, encoding: .utf8),
          let url = URL(string: urlStr) else { return }
    DispatchQueue.main.async {
        let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene
        guard let root = scene?.windows.first?.rootViewController else { return }
        let safari = SFSafariViewController(url: url)
        root.present(safari, animated: true)
    }
}
