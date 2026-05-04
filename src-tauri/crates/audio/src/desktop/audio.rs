use std::{
    fs::File,
    io::BufReader,
    path::PathBuf,
    sync::{
        atomic::{AtomicU64, Ordering},
        mpsc::{self, RecvTimeoutError, SyncSender},
        Arc,
    },
    thread,
    time::Duration,
};

// rodio 0.22 API:
//   MixerDeviceSink  — owns the cpal stream (replaces OutputStream + OutputStreamHandle)
//   Player           — controls a queued source (replaces Sink)
//   DeviceSinkBuilder::open_default_sink() — opens the OS audio device
use rodio::{Decoder, DeviceSinkBuilder, MixerDeviceSink, Player, Source};

use crate::{AudioBridge, AudioError, AudioEvent, AudioSource, TrackMetadata};

// ── Internal command protocol ─────────────────────────────────────────────────

enum Cmd {
    Load(PathBuf, TrackMetadata),
    Play,
    Pause,
    Stop,
    Seek(u64),
    Volume(f32),
}

struct Request {
    cmd: Cmd,
    resp: SyncSender<Result<(), AudioError>>,
}

// ── Public bridge ─────────────────────────────────────────────────────────────

/// Desktop `AudioBridge` implementation backed by a dedicated audio thread.
///
/// `MixerDeviceSink` contains a `cpal::Stream` which is `!Send` on macOS
/// (CoreAudio ties stream operations to the creating thread). All rodio calls
/// therefore run on one long-lived OS thread; this struct holds only
/// `Send`-safe handles so it can live in Tauri's managed state.
pub struct DesktopBridge {
    req_tx: SyncSender<Request>,
    position_ms: Arc<AtomicU64>,
    duration_ms: Arc<AtomicU64>,
}

impl DesktopBridge {
    /// Spawn the audio thread and open the default OS output device.
    /// Returns an error if no audio output device is available.
    pub fn new(event_tx: mpsc::Sender<AudioEvent>) -> Result<Self, AudioError> {
        let (req_tx, req_rx) = mpsc::sync_channel::<Request>(32);
        let position_ms = Arc::new(AtomicU64::new(0));
        let duration_ms = Arc::new(AtomicU64::new(0));
        let (init_tx, init_rx) = mpsc::sync_channel::<Result<(), AudioError>>(0);

        let pos = Arc::clone(&position_ms);
        let dur = Arc::clone(&duration_ms);

        thread::Builder::new()
            .name("melomaniac-audio".into())
            .spawn(move || audio_thread(req_rx, event_tx, pos, dur, init_tx))
            .map_err(|e| AudioError::Playback(e.to_string()))?;

        // Block until the output device is confirmed open (or failed).
        init_rx
            .recv()
            .map_err(|_| AudioError::Playback("audio thread failed to start".into()))??;

        Ok(Self { req_tx, position_ms, duration_ms })
    }

    fn send(&self, cmd: Cmd) -> Result<(), AudioError> {
        let (resp_tx, resp_rx) = mpsc::sync_channel(0);
        self.req_tx
            .send(Request { cmd, resp: resp_tx })
            .map_err(|_| AudioError::Playback("audio thread disconnected".into()))?;
        resp_rx
            .recv()
            .map_err(|_| AudioError::Playback("audio thread disconnected".into()))?
    }
}

// ── Audio thread ──────────────────────────────────────────────────────────────

fn audio_thread(
    req_rx: mpsc::Receiver<Request>,
    event_tx: mpsc::Sender<AudioEvent>,
    position_ms: Arc<AtomicU64>,
    duration_ms: Arc<AtomicU64>,
    init_tx: SyncSender<Result<(), AudioError>>,
) {
    // MixerDeviceSink must live for the duration of this thread. Dropping it
    // destroys the cpal stream and silences all Players backed by it.
    let mut device_sink = match DeviceSinkBuilder::open_default_sink() {
        Ok(sink) => {
            let _ = init_tx.send(Ok(()));
            sink
        }
        Err(e) => {
            let _ = init_tx.send(Err(AudioError::Playback(e.to_string())));
            return;
        }
    };
    // Suppress the default stderr message rodio prints when MixerDeviceSink drops.
    device_sink.log_on_drop(false);

    let mut player: Option<Player> = None;
    let mut track_active = false;
    let mut volume: f32 = 1.0;

    loop {
        match req_rx.recv_timeout(Duration::from_millis(250)) {
            Ok(req) => {
                let result = handle_cmd(
                    req.cmd,
                    &device_sink,
                    &mut player,
                    &mut track_active,
                    &mut volume,
                    &position_ms,
                    &duration_ms,
                    &event_tx,
                );
                let _ = req.resp.send(result);
            }

            Err(RecvTimeoutError::Timeout) => {
                position_tick(&player, &position_ms, &event_tx);
                detect_track_end(&mut player, &mut track_active, &position_ms, &event_tx);
            }

            Err(RecvTimeoutError::Disconnected) => break,
        }
    }
}

fn position_tick(
    player: &Option<Player>,
    position_ms: &Arc<AtomicU64>,
    event_tx: &mpsc::Sender<AudioEvent>,
) {
    if let Some(ref p) = *player {
        if !p.is_paused() && !p.empty() {
            let pos = p.get_pos().as_millis() as u64;
            position_ms.store(pos, Ordering::Relaxed);
            let _ = event_tx.send(AudioEvent::PositionChanged(pos));
        }
    }
}

fn detect_track_end(
    player: &mut Option<Player>,
    track_active: &mut bool,
    position_ms: &Arc<AtomicU64>,
    event_tx: &mpsc::Sender<AudioEvent>,
) {
    if *track_active {
        if let Some(ref p) = *player {
            if p.empty() {
                *track_active = false;
                position_ms.store(0, Ordering::Relaxed);
                let _ = event_tx.send(AudioEvent::TrackEnded);
            }
        }
    }
}

// ── Command handler ───────────────────────────────────────────────────────────

fn handle_cmd(
    cmd: Cmd,
    device_sink: &MixerDeviceSink,
    player: &mut Option<Player>,
    track_active: &mut bool,
    volume: &mut f32,
    position_ms: &Arc<AtomicU64>,
    duration_ms: &Arc<AtomicU64>,
    event_tx: &mpsc::Sender<AudioEvent>,
) -> Result<(), AudioError> {
    match cmd {
        Cmd::Load(path, _metadata) => {
            // Dropping the Player stops its audio immediately.
            *player = None;
            *track_active = false;
            position_ms.store(0, Ordering::Relaxed);
            duration_ms.store(0, Ordering::Relaxed);

            let file = File::open(&path)
                .map_err(|_| AudioError::SourceNotFound(path.display().to_string()))?;
            let source = Decoder::new(BufReader::new(file))
                .map_err(|e| AudioError::UnsupportedFormat(e.to_string()))?;

            // Capture duration before the source is moved into the Player.
            let dur_ms = source.total_duration()
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);
            duration_ms.store(dur_ms, Ordering::Relaxed);
            let _ = event_tx.send(AudioEvent::DurationKnown(dur_ms));

            let new_player = Player::connect_new(device_sink.mixer());
            new_player.set_volume(*volume);
            // Pause before appending so audio does not start immediately on load.
            new_player.pause();
            new_player.append(source);

            *player = Some(new_player);
            *track_active = true;
        }

        Cmd::Play => {
            player.as_ref().ok_or(AudioError::NotLoaded)?.play();
        }

        Cmd::Pause => {
            player.as_ref().ok_or(AudioError::NotLoaded)?.pause();
        }

        Cmd::Stop => {
            // Drop the Player — its Drop impl signals the queue to stop.
            *player = None;
            *track_active = false;
            position_ms.store(0, Ordering::Relaxed);
        }

        Cmd::Seek(pos_ms) => {
            let p = player.as_ref().ok_or(AudioError::NotLoaded)?;
            let dur = duration_ms.load(Ordering::Relaxed);
            // Only clamp if duration is known; 0 means unknown.
            let target = if dur > 0 { pos_ms.min(dur) } else { pos_ms };
            p.try_seek(Duration::from_millis(target))
                .map_err(|e| AudioError::Playback(e.to_string()))?;
            position_ms.store(target, Ordering::Relaxed);
        }

        Cmd::Volume(vol) => {
            let clamped = vol.clamp(0.0, 1.0);
            *volume = clamped;
            // Apply immediately if a Player exists; otherwise applied on next Load.
            if let Some(ref p) = *player {
                p.set_volume(clamped);
            }
        }
    }

    Ok(())
}

// ── Trait impl ────────────────────────────────────────────────────────────────

impl AudioBridge for DesktopBridge {
    fn load(&self, source: &AudioSource, metadata: TrackMetadata) -> Result<(), AudioError> {
        let path = match source {
            AudioSource::File(p) => p.clone(),
            // Stream is uninhabited — this arm can never be reached.
            AudioSource::Stream(_, never) => match *never {},
        };
        self.send(Cmd::Load(path, metadata))
    }

    fn play(&self) -> Result<(), AudioError> {
        self.send(Cmd::Play)
    }

    fn pause(&self) -> Result<(), AudioError> {
        self.send(Cmd::Pause)
    }

    fn stop(&self) -> Result<(), AudioError> {
        self.send(Cmd::Stop)
    }

    fn seek(&self, position_ms: u64) -> Result<(), AudioError> {
        self.send(Cmd::Seek(position_ms))
    }

    fn set_volume(&self, volume: f32) -> Result<(), AudioError> {
        self.send(Cmd::Volume(volume))
    }

    /// Reads from a shared atomic — no round-trip to the audio thread.
    fn position_ms(&self) -> Result<u64, AudioError> {
        Ok(self.position_ms.load(Ordering::Relaxed))
    }
}
