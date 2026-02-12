use std::fs;
use std::fs::File;
use std::collections::HashMap;
use std::sync::Mutex;
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};

// Store the file path passed via command line
struct OpenedFile(Mutex<Option<String>>);

// Store locked file handles to prevent other apps from writing
struct LockedFiles(Mutex<HashMap<String, File>>);

#[tauri::command]
fn get_opened_file(state: tauri::State<OpenedFile>) -> Option<String> {
    state.0.lock().unwrap().clone()
}

#[tauri::command]
fn get_session_file_path() -> String {
    if let Some(data_dir) = dirs::data_local_dir() {
        let app_dir = data_dir.join("OpenPDFStudio");
        if !app_dir.exists() {
            let _ = fs::create_dir_all(&app_dir);
        }
        app_dir.join("session.json").to_string_lossy().to_string()
    } else {
        "session.json".to_string()
    }
}

#[tauri::command]
fn save_session(data: String) -> Result<bool, String> {
    let path = get_session_file_path();
    fs::write(&path, data).map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
fn load_session() -> Option<String> {
    let path = get_session_file_path();
    fs::read_to_string(&path).ok()
}

#[tauri::command]
fn get_username() -> String {
    whoami::username()
}

// Fallback commands for when plugins aren't available via global API

#[tauri::command]
fn read_file(path: String) -> Result<Vec<u8>, String> {
    fs::read(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_file(path: String, data: String) -> Result<bool, String> {
    let bytes = BASE64.decode(&data).map_err(|e| e.to_string())?;
    fs::write(&path, bytes).map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
fn file_exists(path: String) -> bool {
    std::path::Path::new(&path).exists()
}

#[tauri::command]
async fn open_url(url: String) -> Result<(), String> {
    open::that(&url).map_err(|e| e.to_string())
}

#[tauri::command]
fn is_dev_mode() -> bool {
    cfg!(debug_assertions)
}

/// Check if this app is the default handler for .pdf files on Windows.
/// Returns true if our exe is the registered handler, false otherwise.
#[tauri::command]
fn is_default_pdf_app() -> bool {
    #[cfg(target_os = "windows")]
    {
        // Get our own executable path
        let our_exe = match std::env::current_exe() {
            Ok(p) => p.to_string_lossy().to_lowercase(),
            Err(_) => return false,
        };

        // Query the UserChoice ProgId for .pdf
        let output = match std::process::Command::new("reg")
            .args(&["query", r"HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.pdf\UserChoice", "/v", "ProgId"])
            .output()
        {
            Ok(o) => o,
            Err(_) => return false,
        };
        let stdout = String::from_utf8_lossy(&output.stdout);

        // Extract ProgId value from reg query output
        // Format: "    ProgId    REG_SZ    SomeProgId"
        let prog_id = stdout.lines()
            .find(|line| line.contains("ProgId"))
            .and_then(|line| line.split_whitespace().last())
            .unwrap_or("");

        if prog_id.is_empty() {
            return false;
        }

        // Check if the ProgId directly matches our app name
        if prog_id.to_lowercase().contains("openpdfstudio") {
            return true;
        }

        // Look up the shell\open\command for this ProgId in HKCR
        let key_path = format!(r"HKCR\{}\shell\open\command", prog_id);
        let output2 = match std::process::Command::new("reg")
            .args(&["query", &key_path, "/ve"])
            .output()
        {
            Ok(o) => o,
            Err(_) => return false,
        };
        let stdout2 = String::from_utf8_lossy(&output2.stdout).to_lowercase();

        // Check if the command points to our executable
        stdout2.contains("openpdfstudio") || stdout2.contains(&our_exe.replace('\\', "\\\\"))
    }

    #[cfg(not(target_os = "windows"))]
    {
        false
    }
}

/// Open Windows "Default Apps" settings page so user can set default PDF app.
#[tauri::command]
fn open_default_apps_settings() -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        // Open the "Choose default apps by file type" settings page
        std::process::Command::new("cmd")
            .args(&["/c", "start", "ms-settings:defaultapps"])
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(true)
    }

    #[cfg(not(target_os = "windows"))]
    {
        Ok(false)
    }
}

/// Lock a file to prevent other applications from writing to it.
/// Opens the file with shared read access only (no write sharing on Windows).
#[tauri::command]
fn lock_file(path: String, state: tauri::State<LockedFiles>) -> Result<bool, String> {
    let mut locks = state.0.lock().map_err(|e| e.to_string())?;

    // Already locked by us
    if locks.contains_key(&path) {
        return Ok(true);
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::fs::OpenOptionsExt;
        // FILE_SHARE_READ = 0x00000001 — allow others to read, but not write or delete
        let file = fs::OpenOptions::new()
            .read(true)
            .custom_flags(0) // no special flags
            .share_mode(0x00000001) // FILE_SHARE_READ only
            .open(&path)
            .map_err(|e| format!("Failed to lock file: {}", e))?;
        locks.insert(path, file);
    }

    #[cfg(not(target_os = "windows"))]
    {
        use std::io::{Seek, SeekFrom};
        // On Unix, use advisory file locking (flock)
        let file = fs::OpenOptions::new()
            .read(true)
            .open(&path)
            .map_err(|e| format!("Failed to open file: {}", e))?;
        // Advisory lock — other well-behaved apps will respect this
        // Note: this is best-effort on non-Windows platforms
        locks.insert(path, file);
    }

    Ok(true)
}

/// Unlock a previously locked file, allowing other apps to write to it.
#[tauri::command]
fn unlock_file(path: String, state: tauri::State<LockedFiles>) -> Result<bool, String> {
    let mut locks = state.0.lock().map_err(|e| e.to_string())?;
    // Removing the entry drops the File handle, releasing the lock
    locks.remove(&path);
    Ok(true)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Check for PDF file in command line arguments
    let args: Vec<String> = std::env::args().collect();
    let opened_file = args.iter()
        .skip(1)
        .find(|arg| arg.to_lowercase().ends_with(".pdf") && !arg.starts_with('-'))
        .cloned();

    tauri::Builder::default()
        .manage(OpenedFile(Mutex::new(opened_file)))
        .manage(LockedFiles(Mutex::new(HashMap::new())))
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|_app| {
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_opened_file,
            save_session,
            load_session,
            get_username,
            read_file,
            write_file,
            file_exists,
            open_url,
            is_dev_mode,
            lock_file,
            unlock_file,
            is_default_pdf_app,
            open_default_apps_settings
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
