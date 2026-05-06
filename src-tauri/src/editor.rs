use std::path::PathBuf;

use melomaniac_storage::{
    editor::{read_metadata, scan_directory, write_metadata_to_file, edit_cas_track},
    read_cas_metadata, AudioMetadata, FileEntry,
};
use tauri::State;

use crate::storage::StorageState;

/// Read all metadata from any audio file path on disk.
#[tauri::command]
pub async fn file_read_metadata(path: String) -> Result<AudioMetadata, String> {
    read_metadata(&PathBuf::from(&path))
        .await
        .map_err(|e| e.to_string())
}

/// Write metadata back to a non-CAS audio file on disk.
#[tauri::command]
pub async fn file_write_metadata(
    path:     String,
    metadata: AudioMetadata,
) -> Result<(), String> {
    write_metadata_to_file(&PathBuf::from(&path), &metadata)
        .await
        .map_err(|e| e.to_string())
}

/// List all audio files in a directory with basic metadata.
#[tauri::command]
pub async fn file_scan_directory(path: String) -> Result<Vec<FileEntry>, String> {
    scan_directory(&PathBuf::from(&path))
        .await
        .map_err(|e| e.to_string())
}

/// Read all metadata from a CAS library track by its hash.
#[tauri::command]
pub async fn library_read_metadata(
    hash:    String,
    storage: State<'_, StorageState>,
) -> Result<AudioMetadata, String> {
    read_cas_metadata(&hash, &storage.cas, &storage.db)
        .await
        .map_err(|e| e.to_string())
}

/// Edit a track already in the CAS library:
/// rewrites the blob with new tags, assigns a new hash, patches all branch
/// trees in parallel, commits each affected branch, updates the DB.
/// Returns the new track hash.
#[tauri::command]
pub async fn library_edit_track(
    hash:     String,
    metadata: AudioMetadata,
    storage:  State<'_, StorageState>,
) -> Result<String, String> {
    edit_cas_track(&hash, &metadata, &storage.cas, &storage.db)
        .await
        .map_err(|e| e.to_string())
}
