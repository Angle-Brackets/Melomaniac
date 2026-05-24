# Melomaniac — Future Features

## Export / Download track from library

Melomaniac operates as an Apple Music-style vault: at import time the audio
file is copied into the content-addressed store (CAS) and the original path is
discarded. The editor writes edited metadata into the CAS blob (new hash),
not back to the source file.

**Planned feature:** let users export a CAS track back to the filesystem.

Implementation sketch:
- New Tauri command `library_export_track(hash: String, dest_path: String)`
- Reads the blob from CAS, writes it to `dest_path`
- On desktop: use `tauri-plugin-dialog` to let the user pick a save location
- On iOS: write to the Files app via the document picker / share sheet

## Architecture note: metadata edits create commits (intentional, do not change)

When a track's metadata is edited, the CAS blob changes bytes → new BLAKE3 hash.
`patch_trees_parallel` rewrites every branch tree that references the old hash
and creates a new commit per affected branch. This is the correct behaviour:
the new commit is what makes the change visible to peers during sync — without
it, syncing devices would see no HEAD change and skip the branch entirely.
Metadata edits propagate to all users through the normal sync flow for free.
