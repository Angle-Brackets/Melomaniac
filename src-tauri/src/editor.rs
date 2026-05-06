use std::path::PathBuf;

use melomaniac_storage::{
    editor::{read_metadata, scan_directory, write_metadata_to_file, edit_cas_track},
    read_cas_metadata, set_cas_artwork, replace_cas_artwork, set_artwork_for_track_list,
    file_set_artwork as storage_file_set_artwork,
    AudioMetadata, FileEntry,
};

#[derive(serde::Serialize)]
pub struct BulkArtworkResult {
    pub new_artwork_hash: String,
    pub affected_hashes:  Vec<String>,
}
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

/// Set artwork for a CAS library track.
/// Stores the image as a standalone artwork blob in CAS and updates `artwork_hash`.
/// Returns the new artwork hash so the frontend can refresh the display.
#[tauri::command]
pub async fn library_set_artwork(
    hash:        String,
    image_bytes: Vec<u8>,
    storage:     State<'_, StorageState>,
) -> Result<String, String> {
    set_cas_artwork(&hash, image_bytes, &storage.cas, &storage.db)
        .await
        .map_err(|e| e.to_string())
}

/// Embed artwork directly into a filesystem audio file (non-CAS).
#[tauri::command]
pub async fn file_set_artwork(
    path:        String,
    image_bytes: Vec<u8>,
) -> Result<(), String> {
    storage_file_set_artwork(&PathBuf::from(&path), image_bytes)
        .await
        .map_err(|e| e.to_string())
}

/// Set the same artwork for an explicit list of track hashes (single blob write, bulk DB update).
#[tauri::command]
pub async fn library_set_artwork_for_tracks(
    hashes:      Vec<String>,
    image_bytes: Vec<u8>,
    storage:     State<'_, StorageState>,
) -> Result<BulkArtworkResult, String> {
    let (new_artwork_hash, affected_hashes) =
        set_artwork_for_track_list(hashes, image_bytes, &storage.cas, &storage.db)
            .await
            .map_err(|e| e.to_string())?;
    Ok(BulkArtworkResult { new_artwork_hash, affected_hashes })
}

/// Replace an existing artwork blob across all tracks that share it.
/// Returns the new artwork hash plus every track hash that was updated,
/// so the frontend can refresh artworkUrls for all affected rows at once.
#[tauri::command]
pub async fn library_replace_artwork(
    old_artwork_hash: String,
    image_bytes:      Vec<u8>,
    storage:          State<'_, StorageState>,
) -> Result<BulkArtworkResult, String> {
    let (new_artwork_hash, affected_hashes) =
        replace_cas_artwork(&old_artwork_hash, image_bytes, &storage.cas, &storage.db)
            .await
            .map_err(|e| e.to_string())?;
    Ok(BulkArtworkResult { new_artwork_hash, affected_hashes })
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
