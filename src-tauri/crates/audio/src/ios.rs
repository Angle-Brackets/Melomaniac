use crate::{AudioBridge, AudioError, AudioSource, TrackMetadata, AudioEvent};
use std::sync::mpsc::Sender;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

/// A stub implementation of [`AudioBridge`] for iOS.
/// 
/// This will eventually delegate to `tauri-plugin-native-audio` for AVPlayer integration.
pub struct IosBridge {
    _event_tx: Sender<AudioEvent>,
    position_ms: Arc<AtomicU64>,
}

impl IosBridge {
    pub fn new(event_tx: Sender<AudioEvent>) -> Self {
        Self {
            _event_tx: event_tx,
            position_ms: Arc::new(AtomicU64::new(0)),
        }
    }
}

impl AudioBridge for IosBridge {
    fn load(&self, _source: &AudioSource, _metadata: TrackMetadata) -> Result<(), AudioError> {
        self.position_ms.store(0, Ordering::SeqCst);
        Ok(())
    }

    fn play(&self) -> Result<(), AudioError> {
        Ok(())
    }

    fn pause(&self) -> Result<(), AudioError> {
        Ok(())
    }

    fn stop(&self) -> Result<(), AudioError> {
        self.position_ms.store(0, Ordering::SeqCst);
        Ok(())
    }

    fn seek(&self, position_ms: u64) -> Result<(), AudioError> {
        self.position_ms.store(position_ms, Ordering::SeqCst);
        Ok(())
    }

    fn set_volume(&self, _volume: f32) -> Result<(), AudioError> {
        Ok(())
    }

    fn position_ms(&self) -> Result<u64, AudioError> {
        Ok(self.position_ms.load(Ordering::SeqCst))
    }
}
