#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! SwingLab desktop shell.
//!
//! The web app does all the analysis; this process exists to watch a folder
//! and hand new TrackMan exports to it. The player exports once from TPS at
//! the end of a session and the report is waiting for them.
//!
//! Nothing here parses shot data. Parsing lives in `@swinglab/core` so that
//! the desktop app, the mobile PWA and the test suite all share one
//! implementation — a second parser in Rust would be a second set of bugs.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use notify_debouncer_mini::{new_debouncer, notify::RecursiveMode, DebouncedEventKind};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

/// A file the watcher decided is worth handing to the front end.
#[derive(Clone, Serialize)]
struct DiscoveredFile {
    name: String,
    path: String,
    text: String,
}

#[derive(Default)]
struct WatchState {
    /// Held so the watcher thread stays alive; dropping it stops watching.
    debouncer: Mutex<Option<notify_debouncer_mini::Debouncer<notify::RecommendedWatcher>>>,
}

/// TPS writes `.csv`; some presets write `.txt`. Anything else is noise —
/// screenshots, PDFs, the OS's own index files.
fn is_candidate(path: &Path) -> bool {
    matches!(
        path.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase).as_deref(),
        Some("csv") | Some("txt") | Some("tsv")
    )
}

fn read_file(path: &Path) -> Option<DiscoveredFile> {
    // A file that is still being written reads as invalid UTF-8 or empty.
    // The debouncer already waits for writes to settle; this is the backstop.
    let text = std::fs::read_to_string(path).ok()?;
    if text.trim().is_empty() {
        return None;
    }
    Some(DiscoveredFile {
        name: path.file_name()?.to_string_lossy().into_owned(),
        path: path.to_string_lossy().into_owned(),
        text,
    })
}

/// Start watching `folder`. Replaces any existing watch.
#[tauri::command]
fn watch_folder(app: AppHandle, state: State<'_, WatchState>, folder: String) -> Result<(), String> {
    let path = PathBuf::from(&folder);
    if !path.is_dir() {
        return Err(format!("{folder} is not a folder"));
    }

    let handle = app.clone();
    // Two seconds is long enough that a large export has finished being
    // written, and short enough that it still feels immediate.
    let mut debouncer = new_debouncer(Duration::from_secs(2), move |result| {
        let events = match result {
            Ok(events) => events,
            Err(_) => return,
        };
        for event in events {
            if event.kind != DebouncedEventKind::Any {
                continue;
            }
            if !is_candidate(&event.path) {
                continue;
            }
            if let Some(file) = read_file(&event.path) {
                let _ = handle.emit("swinglab://file-discovered", file);
            }
        }
    })
    .map_err(|e| e.to_string())?;

    debouncer
        .watcher()
        .watch(&path, RecursiveMode::NonRecursive)
        .map_err(|e| e.to_string())?;

    *state.debouncer.lock().map_err(|e| e.to_string())? = Some(debouncer);
    Ok(())
}

#[tauri::command]
fn stop_watching(state: State<'_, WatchState>) -> Result<(), String> {
    *state.debouncer.lock().map_err(|e| e.to_string())? = None;
    Ok(())
}

/// Read the files already sitting in a folder, so pointing the app at a
/// folder full of past exports backfills history instead of only catching
/// what arrives next.
#[tauri::command]
fn scan_folder(folder: String) -> Result<Vec<DiscoveredFile>, String> {
    let entries = std::fs::read_dir(&folder).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() && is_candidate(&path) {
            if let Some(file) = read_file(&path) {
                out.push(file);
            }
        }
    }
    Ok(out)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(WatchState::default())
        .invoke_handler(tauri::generate_handler![watch_folder, stop_watching, scan_folder])
        .setup(|app| {
            #[cfg(debug_assertions)]
            if let Some(window) = app.get_webview_window("main") {
                window.open_devtools();
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to start SwingLab");
}
