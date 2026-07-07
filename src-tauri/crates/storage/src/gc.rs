use std::collections::{HashMap, HashSet};

use crate::{CasStore, Database, StorageError, TreeBlob};

/// Best-effort display info for a track hash, gathered while walking the
/// library and every playlist's commit history.
#[derive(Debug, Clone)]
struct TrackMeta {
    title:  String,
    artist: String,
}

/// Result of a garbage-collection scan or run: how many CAS blobs were (or
/// would be) unreachable, and how many bytes that represents.
#[derive(Debug, Clone, serde::Serialize)]
pub struct GcReport {
    pub blobs_removed: usize,
    pub bytes_freed:   u64,
}

/// One CAS blob, for the "largest blobs" admin view — lets a user find a
/// specific oversized blob even if it's still `reachable` (i.e. normal GC
/// won't touch it because some commit history still points to it).
#[derive(Debug, Clone, serde::Serialize)]
pub struct BlobInfo {
    pub hash:       String,
    pub size_bytes: u64,
    pub reachable:  bool,
    /// Best-effort track title, if this blob is (or was) a track's audio —
    /// recovered from the library or from a playlist tree that mentions it.
    pub title:      Option<String>,
    pub artist:     Option<String>,
}

/// A playlist/branch whose commit history still references a given blob.
#[derive(Debug, Clone, serde::Serialize)]
pub struct BlobReference {
    pub playlist_name: String,
    pub branch_name:   String,
}

/// Collects CAS blobs (audio, artwork, tree, and commit objects) that are no
/// longer reachable from anywhere: not the current library, and not any
/// commit on any branch of any playlist, walking full history rather than
/// just branch HEADs. This mirrors default `git gc` semantics — a blob stays
/// alive as long as *any* commit, anywhere in a playlist's history, still
/// points to it, so every past revert target keeps working. Only blobs that
/// were never committed to a still-existing branch (or were part of a
/// playlist/branch that's since been deleted entirely) are ever collected.
pub struct GarbageCollector<'a> {
    cas: &'a CasStore,
    db:  &'a Database,
}

impl<'a> GarbageCollector<'a> {
    pub fn new(cas: &'a CasStore, db: &'a Database) -> Self {
        Self { cas, db }
    }

    async fn reachable_hashes(&self) -> Result<HashSet<String>, StorageError> {
        Ok(self.reachable_hashes_with_meta().await?.0)
    }

    /// Same full-history walk as `reachable_hashes`, but also gathers
    /// best-effort title/artist for any track hash encountered — in the
    /// library or in any playlist tree, live or historical.
    async fn reachable_hashes_with_meta(
        &self,
    ) -> Result<(HashSet<String>, HashMap<String, TrackMeta>), StorageError> {
        let mut reachable = HashSet::new();
        let mut meta: HashMap<String, TrackMeta> = HashMap::new();

        for track in self.db.get_all_tracks().await? {
            meta.insert(track.hash.clone(), TrackMeta { title: track.title.clone(), artist: track.artist.clone() });
            reachable.insert(track.hash);
            if let Some(art) = track.artwork_hash {
                reachable.insert(art);
            }
        }

        let mut visited_commits: HashSet<String> = HashSet::new();
        let mut visited_trees:   HashSet<String> = HashSet::new();

        for playlist in self.db.get_all_playlists().await? {
            for branch in self.db.get_branches(&playlist.id).await? {
                let Some(head) = branch.head_commit else { continue };
                let mut stack = vec![head];

                while let Some(commit_hash) = stack.pop() {
                    if !visited_commits.insert(commit_hash.clone()) {
                        continue;
                    }
                    reachable.insert(commit_hash.clone());

                    let Some(commit) = self.db.get_commit(&commit_hash).await? else { continue };

                    if visited_trees.insert(commit.tree_hash.clone()) {
                        reachable.insert(commit.tree_hash.clone());
                        if let Ok(bytes) = self.cas.read_blob(&commit.tree_hash).await {
                            if let Ok(tree) = TreeBlob::from_bytes(&bytes) {
                                for t in &tree.tracks {
                                    reachable.insert(t.hash.clone());
                                    if let Some(art) = &t.artwork_hash {
                                        reachable.insert(art.clone());
                                    }
                                    if let (Some(title), Some(artist)) = (&t.title, &t.artist) {
                                        meta.entry(t.hash.clone()).or_insert_with(|| TrackMeta {
                                            title: title.clone(),
                                            artist: artist.clone(),
                                        });
                                    }
                                }
                                if let Some(art) = &tree.meta.artwork_hash {
                                    reachable.insert(art.clone());
                                }
                            }
                        }
                    }

                    for parent in self.db.get_commit_parents(&commit_hash).await? {
                        stack.push(parent);
                    }
                }
            }
        }

        Ok((reachable, meta))
    }

    /// Hashes reachable from *current* state only: the library index and every
    /// playlist branch's HEAD tree. Unlike `reachable_hashes`, this ignores
    /// history — a hash stops being live the moment nothing currently
    /// browsable points at it, even if an older commit still does. Used to
    /// decide whether a just-deleted track is safe to purge immediately.
    pub async fn live_hashes(&self) -> Result<HashSet<String>, StorageError> {
        let mut live = HashSet::new();

        for track in self.db.get_all_tracks().await? {
            live.insert(track.hash);
            if let Some(art) = track.artwork_hash {
                live.insert(art);
            }
        }

        for playlist in self.db.get_all_playlists().await? {
            for branch in self.db.get_branches(&playlist.id).await? {
                let Some(head) = branch.head_commit else { continue };
                let Some(commit) = self.db.get_commit(&head).await? else { continue };
                if let Ok(bytes) = self.cas.read_blob(&commit.tree_hash).await {
                    if let Ok(tree) = TreeBlob::from_bytes(&bytes) {
                        for t in &tree.tracks {
                            live.insert(t.hash.clone());
                            if let Some(art) = &t.artwork_hash {
                                live.insert(art.clone());
                            }
                        }
                        if let Some(art) = &tree.meta.artwork_hash {
                            live.insert(art.clone());
                        }
                    }
                }
            }
        }

        Ok(live)
    }

    /// Read-only: computes what would be collected without deleting anything.
    pub async fn scan(&self) -> Result<GcReport, StorageError> {
        let reachable = self.reachable_hashes().await?;
        let mut blobs_removed = 0usize;
        let mut bytes_freed = 0u64;

        for hash in self.cas.list_all_hashes() {
            if !reachable.contains(&hash) {
                blobs_removed += 1;
                bytes_freed += self.cas.blob_size(&hash).unwrap_or(0);
            }
        }

        Ok(GcReport { blobs_removed, bytes_freed })
    }

    /// Deletes every unreachable CAS blob. Irreversible.
    pub async fn collect(&self) -> Result<GcReport, StorageError> {
        let reachable = self.reachable_hashes().await?;
        let mut blobs_removed = 0usize;
        let mut bytes_freed = 0u64;

        for hash in self.cas.list_all_hashes() {
            if !reachable.contains(&hash) {
                if let Some(size) = self.cas.delete_blob(&hash)? {
                    blobs_removed += 1;
                    bytes_freed += size;
                }
            }
        }

        Ok(GcReport { blobs_removed, bytes_freed })
    }

    /// Lists every CAS blob sorted largest-first, flagging whether normal GC
    /// would consider it reachable. Meant for tracking down a specific
    /// oversized blob (e.g. a bad download) that's stuck alive because some
    /// playlist's commit history still references it.
    pub async fn largest_blobs(&self, limit: usize) -> Result<Vec<BlobInfo>, StorageError> {
        let (reachable, meta) = self.reachable_hashes_with_meta().await?;
        let mut all: Vec<BlobInfo> = self
            .cas
            .list_all_hashes()
            .into_iter()
            .map(|hash| {
                let size_bytes = self.cas.blob_size(&hash).unwrap_or(0);
                let is_reachable = reachable.contains(&hash);
                let track_meta = meta.get(&hash);
                BlobInfo {
                    hash,
                    size_bytes,
                    reachable: is_reachable,
                    title: track_meta.map(|m| m.title.clone()),
                    artist: track_meta.map(|m| m.artist.clone()),
                }
            })
            .collect();
        all.sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes));
        all.truncate(limit);
        Ok(all)
    }

    /// Finds every still-existing playlist branch whose commit history
    /// (walking full ancestry, same as the reachability scan) references
    /// `hash` — as a track, its artwork, or a tree/commit object itself.
    pub async fn find_references(&self, hash: &str) -> Result<Vec<BlobReference>, StorageError> {
        let mut refs = Vec::new();

        for playlist in self.db.get_all_playlists().await? {
            for branch in self.db.get_branches(&playlist.id).await? {
                let Some(head) = branch.head_commit else { continue };
                let mut stack = vec![head];
                let mut visited: HashSet<String> = HashSet::new();
                let mut found = false;

                while let Some(commit_hash) = stack.pop() {
                    if found || !visited.insert(commit_hash.clone()) {
                        continue;
                    }
                    if commit_hash == hash {
                        found = true;
                        break;
                    }

                    let Some(commit) = self.db.get_commit(&commit_hash).await? else { continue };
                    if commit.tree_hash == hash {
                        found = true;
                        break;
                    }
                    if let Ok(bytes) = self.cas.read_blob(&commit.tree_hash).await {
                        if let Ok(tree) = TreeBlob::from_bytes(&bytes) {
                            let tree_refs_hash = tree.tracks.iter().any(|t| {
                                t.hash == hash || t.artwork_hash.as_deref() == Some(hash)
                            }) || tree.meta.artwork_hash.as_deref() == Some(hash);
                            if tree_refs_hash {
                                found = true;
                                break;
                            }
                        }
                    }

                    for parent in self.db.get_commit_parents(&commit_hash).await? {
                        stack.push(parent);
                    }
                }

                if found {
                    refs.push(BlobReference {
                        playlist_name: playlist.name.clone(),
                        branch_name: branch.name.clone(),
                    });
                }
            }
        }

        Ok(refs)
    }

    /// Deletes a single blob unconditionally, ignoring reachability. This is
    /// the escape hatch for a blob that `scan`/`collect` will never touch
    /// because it's still referenced by a commit on a still-existing branch.
    /// Irreversible, and it silently breaks `branch_revert_to` for any
    /// historical commit that pointed at this hash — callers must confirm
    /// with the user first, ideally after showing `find_references`.
    pub fn force_purge_blob(&self, hash: &str) -> Result<Option<u64>, StorageError> {
        self.cas.delete_blob(hash)
    }
}
