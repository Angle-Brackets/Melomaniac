use serde::Serialize;
use std::sync::Mutex;
use sysinfo::System;
use tauri::State;

#[derive(Serialize)]
pub struct AppStats {
    pub memory_mb: f64,
    pub cpu_usage: f32,
}

pub struct SystemState(pub Mutex<System>);

#[cfg(target_os = "linux")]
// Linux has a special implementation due to differences in memory management architectures.
// We use RssAnon to get the private memory usage.
fn get_private_memory_mb(fallback_bytes: u64) -> f64 {
    if let Ok(status) = std::fs::read_to_string("/proc/self/status") {
        for line in status.lines() {
            if line.starts_with("RssAnon:") {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 2 {
                    if let Ok(kb) = parts[1].parse::<f64>() {
                        return kb / 1024.0;
                    }
                }
            }
        }
    }
    fallback_bytes as f64 / 1_048_576.0
}

#[cfg(not(target_os = "linux"))]
fn get_private_memory_mb(fallback_bytes: u64) -> f64 {
    fallback_bytes as f64 / 1_048_576.0
}

#[tauri::command]
pub fn get_system_stats(state: State<'_, SystemState>) -> AppStats {
    let mut sys = state.0.lock().unwrap();
    sys.refresh_cpu_usage();
    let pid = sysinfo::get_current_pid().unwrap();
    sys.refresh_processes(sysinfo::ProcessesToUpdate::Some(&[pid]), true);

    let pid = sysinfo::get_current_pid().unwrap();
    if let Some(process) = sys.process(pid) {
        AppStats {
            memory_mb: get_private_memory_mb(process.memory()),
            cpu_usage: process.cpu_usage() / sys.cpus().len().max(1) as f32,
        }
    } else {
        AppStats {
            memory_mb: 0.0,
            cpu_usage: 0.0,
        }
    }
}
