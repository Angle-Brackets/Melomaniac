use std::{
    collections::{HashMap, VecDeque},
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tauri_plugin_shell::{process::CommandEvent, ShellExt};
use tokio::sync::Semaphore;

use crate::storage::StorageState;

// ── Types ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum DownloadStatus {
    Queued,
    Downloading,
    Ingesting,
    Done,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadJob {
    pub id:       String,
    pub url:      String,
    pub status:   DownloadStatus,
    pub progress: f32,
    pub title:    Option<String>,
    pub error:    Option<String>,
}

// ── Events ────────────────────────────────────────────────────────────────────

#[derive(Clone, Serialize)]
struct ProgressPayload { id: String, pct: f32, status: String, title: Option<String> }

#[derive(Clone, Serialize)]
struct DonePayload { id: String, track_hash: String, title: String }

#[derive(Clone, Serialize)]
struct ErrorPayload { id: String, error: String }

// ── Manager ───────────────────────────────────────────────────────────────────

pub struct DownloadManager {
    jobs:      Mutex<HashMap<String, DownloadJob>>,
    order:     Mutex<VecDeque<String>>,
    semaphore: Arc<Semaphore>,
    /// One cancel-sender per active job; sending () signals the task to abort.
    cancels:   Mutex<HashMap<String, tokio::sync::oneshot::Sender<()>>>,
}

impl DownloadManager {
    pub fn new() -> Self {
        Self {
            jobs:      Mutex::new(HashMap::new()),
            order:     Mutex::new(VecDeque::new()),
            semaphore: Arc::new(Semaphore::new(3)),
            cancels:   Mutex::new(HashMap::new()),
        }
    }

    fn insert(&self, job: DownloadJob) {
        let mut order = self.order.lock().unwrap();
        let mut jobs  = self.jobs.lock().unwrap();
        order.push_back(job.id.clone());
        jobs.insert(job.id.clone(), job);
    }

    fn patch<F: FnOnce(&mut DownloadJob)>(&self, id: &str, f: F) -> Option<DownloadJob> {
        let mut jobs = self.jobs.lock().unwrap();
        if let Some(j) = jobs.get_mut(id) { f(j); Some(j.clone()) } else { None }
    }
}

// ── Progress parsing ──────────────────────────────────────────────────────────

pub(crate) fn parse_pct(line: &[u8]) -> Option<f32> {
    let s = std::str::from_utf8(line).ok()?.trim();
    let after = s.strip_prefix("[download]")?.trim();
    let pct_s = after.split('%').next()?.trim();
    pct_s.parse::<f32>().ok().map(|p| (p / 100.0).clamp(0.0, 1.0))
}

pub(crate) fn parse_title(line: &[u8]) -> Option<String> {
    let s = std::str::from_utf8(line).ok()?.trim().to_string();
    // yt-dlp prints the title via --print before_dl:title on its own line
    // We mark those lines with a sentinel prefix to tell them apart
    s.strip_prefix("MELO_TITLE:").map(str::to_string)
}

pub(crate) fn parse_filepath(line: &[u8]) -> Option<String> {
    let s = std::str::from_utf8(line).ok()?.trim();
    s.strip_prefix("MELO_PATH:").map(str::to_string)
}

// ── Core download task ────────────────────────────────────────────────────────

async fn run_download(
    id:      String,
    url:     String,
    app:     AppHandle,
    mgr:     Arc<DownloadManager>,
    storage: Arc<StorageState>,
    cancel:  tokio::sync::oneshot::Receiver<()>,
) {
    let _permit = mgr.semaphore.acquire().await.unwrap();

    mgr.patch(&id, |j| j.status = DownloadStatus::Downloading);
    app.emit("download://progress", ProgressPayload {
        id: id.clone(), pct: 0.0, status: "downloading".into(), title: None,
    }).ok();

    let result = do_download(&id, &url, &app, &mgr, &storage, cancel).await;

    mgr.cancels.lock().unwrap().remove(&id);

    match result {
        Ok((hash, title)) => {
            mgr.patch(&id, |j| { j.status = DownloadStatus::Done; j.progress = 1.0; j.title = Some(title.clone()); });
            app.emit("download://done", DonePayload { id, track_hash: hash, title }).ok();
        }
        Err(e) => {
            mgr.patch(&id, |j| { j.status = DownloadStatus::Failed; j.error = Some(e.clone()); });
            app.emit("download://error", ErrorPayload { id, error: e }).ok();
        }
    }
}

async fn do_download(
    id:      &str,
    url:     &str,
    app:     &AppHandle,
    mgr:     &Arc<DownloadManager>,
    storage: &Arc<StorageState>,
    mut cancel: tokio::sync::oneshot::Receiver<()>,
) -> Result<(String, String), String> {
    let tmp_template = format!("/tmp/melomaniac_{}.%(ext)s", id);

    let (mut rx, _child) = app.shell()
        .sidecar("yt-dlp")
        .map_err(|e| e.to_string())?
        .args([
            "--format",      "bestaudio",
            "--output",      &tmp_template,
            "--newline",
            "--js-runtimes", "node,deno",
            // Print title and final path on separate labelled lines so we can
            // reliably parse them from the mixed stdout stream
            "--print",       &format!("MELO_TITLE:%(title)s"),
            "--print",       "after_move:MELO_PATH:%(filepath)s",
            url,
        ])
        .spawn()
        .map_err(|e| e.to_string())?;

    let mut title:    Option<String> = None;
    let mut filepath: Option<String> = None;

    loop {
        tokio::select! {
            _ = &mut cancel => {
                return Err("Cancelled".into());
            }
            event = rx.recv() => {
                match event {
                    Some(CommandEvent::Stdout(line)) => {
                        if let Some(t) = parse_title(&line)    { title    = Some(t); }
                        if let Some(p) = parse_filepath(&line) { filepath = Some(p); }
                        if let Some(pct) = parse_pct(&line) {
                            mgr.patch(id, |j| j.progress = pct);
                            let t = mgr.jobs.lock().unwrap().get(id).and_then(|j| j.title.clone());
                            app.emit("download://progress", ProgressPayload {
                                id: id.to_string(), pct, status: "downloading".into(), title: t,
                            }).ok();
                        }
                    }
                    Some(CommandEvent::Stderr(line)) => {
                        // surface errors but don't abort — yt-dlp writes lots of
                        // non-fatal info to stderr
                        eprintln!("[yt-dlp] {}", String::from_utf8_lossy(&line));
                    }
                    Some(CommandEvent::Terminated(payload)) => {
                        if payload.code != Some(0) {
                            return Err(format!(
                                "yt-dlp exited with code {:?}", payload.code
                            ));
                        }
                        break;
                    }
                    None => break,
                    _ => {}
                }
            }
        }
    }

    let path = filepath.ok_or("yt-dlp did not report output path")?;
    let title = title.unwrap_or_else(|| url.to_string());

    // Ingest
    mgr.patch(id, |j| j.status = DownloadStatus::Ingesting);
    app.emit("download://progress", ProgressPayload {
        id: id.to_string(), pct: 1.0, status: "ingesting".into(), title: Some(title.clone()),
    }).ok();

    let bytes = tokio::fs::read(&path).await
        .map_err(|e| format!("Could not read output file: {e}"))?;
    tokio::fs::remove_file(&path).await.ok();

    let name_hint = std::path::Path::new(&path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("track.m4a");

    let record = melomaniac_storage::ingest::ingest_bytes(&bytes, name_hint, &storage.cas, &storage.db)
        .await
        .map_err(|e| e.to_string())?;

    // Stamp provenance
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs() as i64;
    storage.db.set_track_provenance(&record.hash, now, Some(url))
        .await
        .map_err(|e| e.to_string())?;

    // Prefer the tag title from the file; fall back to what yt-dlp reported
    let final_title = if record.title.is_empty() { title } else { record.title.clone() };
    Ok((record.hash, final_title))
}

// ── Tauri commands ────────────────────────────────────────────────────────────

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_pct_happy_path() {
        let line = b"[download]  42.3% of ~1.00MiB at  1.00MiB/s ETA 00:00";
        let pct = parse_pct(line).unwrap();
        let expected = 42.3_f32 / 100.0;
        assert!((pct - expected).abs() < 1e-4, "got {pct}");
    }

    #[test]
    fn parse_pct_none_for_non_download_line() {
        assert!(parse_pct(b"[info] Downloading video").is_none());
        assert!(parse_pct(b"MELO_TITLE:some song").is_none());
        assert!(parse_pct(b"").is_none());
    }

    #[test]
    fn parse_pct_clamps_to_zero_one() {
        // yt-dlp can emit values slightly over 100 — clamp to 1.0
        let over = b"[download] 100.0% of ...";
        assert_eq!(parse_pct(over), Some(1.0));

        let zero = b"[download]   0.0% of ...";
        assert_eq!(parse_pct(zero), Some(0.0));
    }

    #[test]
    fn parse_title_happy_path() {
        let line = b"MELO_TITLE:My Favourite Song";
        assert_eq!(parse_title(line), Some("My Favourite Song".to_string()));
    }

    #[test]
    fn parse_title_none_for_non_matching() {
        assert!(parse_title(b"[download]  50.0%").is_none());
        assert!(parse_title(b"MELO_PATH:/tmp/foo.m4a").is_none());
        assert!(parse_title(b"").is_none());
    }

    #[test]
    fn parse_filepath_happy_path() {
        let line = b"MELO_PATH:/tmp/melomaniac_abc123.m4a";
        assert_eq!(parse_filepath(line), Some("/tmp/melomaniac_abc123.m4a".to_string()));
    }

    #[test]
    fn parse_filepath_none_for_non_matching() {
        assert!(parse_filepath(b"[download]  50.0%").is_none());
        assert!(parse_filepath(b"MELO_TITLE:some title").is_none());
        assert!(parse_filepath(b"").is_none());
    }
}

// ── Tauri commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn download_enqueue(
    url:     String,
    app:     AppHandle,
    mgr:     tauri::State<'_, Arc<DownloadManager>>,
    storage: tauri::State<'_, StorageState>,
) -> Result<String, String> {
    let id  = uuid::Uuid::new_v4().to_string();
    let job = DownloadJob {
        id:       id.clone(),
        url:      url.clone(),
        status:   DownloadStatus::Queued,
        progress: 0.0,
        title:    None,
        error:    None,
    };
    mgr.insert(job);

    app.emit("download://progress", ProgressPayload {
        id: id.clone(), pct: 0.0, status: "queued".into(), title: None,
    }).ok();

    let (cancel_tx, cancel_rx) = tokio::sync::oneshot::channel::<()>();
    mgr.cancels.lock().unwrap().insert(id.clone(), cancel_tx);

    let mgr_arc     = Arc::clone(&mgr);
    let storage_arc = Arc::new((*storage).clone());

    let id_ret = id.clone();
    tokio::spawn(async move {
        run_download(id, url, app, mgr_arc, storage_arc, cancel_rx).await;
    });

    Ok(id_ret)
}

#[tauri::command]
pub fn download_queue(
    mgr: tauri::State<'_, Arc<DownloadManager>>,
) -> Vec<DownloadJob> {
    let jobs  = mgr.jobs.lock().unwrap();
    let order = mgr.order.lock().unwrap();
    order.iter().filter_map(|id| jobs.get(id).cloned()).collect()
}

#[tauri::command]
pub async fn download_cancel(
    id:  String,
    mgr: tauri::State<'_, Arc<DownloadManager>>,
) -> Result<(), String> {
    if let Some(tx) = mgr.cancels.lock().unwrap().remove(&id) {
        tx.send(()).ok();
    }
    mgr.patch(&id, |j| {
        if j.status != DownloadStatus::Done {
            j.status = DownloadStatus::Failed;
            j.error  = Some("Cancelled".into());
        }
    });
    Ok(())
}
