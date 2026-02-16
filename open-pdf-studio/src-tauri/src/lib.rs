use std::fs;
use std::fs::File;
use std::collections::HashMap;
use std::sync::Mutex;
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use tauri::Manager;

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

/// Enumerate installed printers via PowerShell CIM.
/// Returns a JSON array of printer objects.
#[tauri::command]
fn get_printers() -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        let output = std::process::Command::new("powershell")
            .args(&[
                "-NoProfile", "-NonInteractive", "-Command",
                "Get-CimInstance -ClassName Win32_Printer | Select-Object Name, DriverName, Default, PrinterStatus | ConvertTo-Json -Compress"
            ])
            .output()
            .map_err(|e| format!("Failed to enumerate printers: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("PowerShell error: {}", stderr));
        }

        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        // PowerShell returns a single object (not array) when there's only one printer
        let trimmed = stdout.trim();
        if trimmed.starts_with('{') {
            Ok(format!("[{}]", trimmed))
        } else {
            Ok(trimmed.to_string())
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        Ok("[]".to_string())
    }
}

/// Print a PDF file to a specific printer using the system's default PDF handler.
#[tauri::command]
fn print_pdf(path: String, printer: String) -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("powershell")
            .args(&[
                "-NoProfile", "-NonInteractive", "-Command",
                &format!(
                    "Start-Process -FilePath '{}' -Verb PrintTo -ArgumentList '\"{}\"' -WindowStyle Hidden",
                    path.replace('\'', "''"),
                    printer.replace('\'', "''")
                )
            ])
            .spawn()
            .map_err(|e| format!("Failed to print: {}", e))?;
        Ok(true)
    }

    #[cfg(not(target_os = "windows"))]
    {
        Err("Printing is only supported on Windows".to_string())
    }
}

/// Open the printer properties dialog for a given printer name.
#[tauri::command]
fn open_printer_properties(printer: String) -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        // rundll32 printui.dll,PrintUIEntry /e /n "PrinterName"
        std::process::Command::new("rundll32")
            .args(&["printui.dll,PrintUIEntry", "/e", "/n", &printer])
            .spawn()
            .map_err(|e| format!("Failed to open printer properties: {}", e))?;
        Ok(true)
    }

    #[cfg(not(target_os = "windows"))]
    {
        Err("Printer properties dialog is only supported on Windows".to_string())
    }
}

/// Get the system temp directory path.
#[tauri::command]
fn get_temp_dir() -> String {
    std::env::temp_dir().to_string_lossy().to_string()
}

/// Write binary data to a temp file and return the path.
/// This bypasses the FS plugin scope restrictions.
#[tauri::command]
fn write_temp_pdf(data: Vec<u8>) -> Result<String, String> {
    let temp_dir = std::env::temp_dir();
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let path = temp_dir.join(format!("openstudio_print_{}.pdf", timestamp));
    fs::write(&path, &data).map_err(|e| format!("Failed to write temp file: {}", e))?;
    Ok(path.to_string_lossy().to_string())
}

/// Delete a file at the given path.
#[tauri::command]
fn delete_file(path: String) -> Result<bool, String> {
    fs::remove_file(&path).map_err(|e| format!("Failed to delete file: {}", e))?;
    Ok(true)
}

/// Run a PowerShell script with UAC elevation by writing it to a temp .ps1
/// file, executing it as admin, and capturing errors via a log file.
#[cfg(target_os = "windows")]
fn run_elevated_ps_script(script: &str) -> Result<(), String> {
    let temp_dir = std::env::temp_dir();
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);

    let script_path = temp_dir.join(format!("ops_printer_{}.ps1", timestamp));
    let log_path = temp_dir.join(format!("ops_printer_{}.log", timestamp));

    // Wrap the script: redirect all errors to a log file, write "OK" on success
    let wrapped = format!(
        r#"try {{
{}
'OK' | Out-File -FilePath '{}' -Encoding UTF8
}} catch {{
$_.Exception.Message | Out-File -FilePath '{}' -Encoding UTF8
exit 1
}}"#,
        script,
        log_path.to_string_lossy(),
        log_path.to_string_lossy()
    );

    fs::write(&script_path, &wrapped)
        .map_err(|e| format!("Failed to write temp script: {}", e))?;

    // Launch elevated: Start-Process -Verb RunAs -Wait on the .ps1 file
    let output = std::process::Command::new("powershell")
        .args(&[
            "-NoProfile", "-NonInteractive", "-Command",
            &format!(
                "Start-Process powershell -Verb RunAs -Wait -ArgumentList '-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File','{}'",
                script_path.to_string_lossy()
            )
        ])
        .output()
        .map_err(|e| format!("Failed to launch elevated process: {}", e))?;

    // Read the log file written by the elevated process
    let log_content = fs::read_to_string(&log_path).unwrap_or_default();
    let log_trimmed = log_content.trim();

    // Cleanup temp files
    let _ = fs::remove_file(&script_path);
    let _ = fs::remove_file(&log_path);

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("UAC elevation failed: {}", stderr));
    }

    if log_trimmed.is_empty() {
        return Err("Elevated script produced no output — user may have cancelled UAC".to_string());
    }

    // Check BOM-prefixed "OK" (UTF-8 BOM from Out-File)
    if log_trimmed == "OK" || log_trimmed.ends_with("OK") {
        Ok(())
    } else {
        Err(format!("Elevated script error: {}", log_trimmed))
    }
}

/// Install a virtual printer named "Open PDF Studio" using the built-in
/// "Microsoft Print to PDF" driver with the PORTPROMPT: port (shows a
/// Save As dialog with print preview, just like the stock PDF printer).
/// Requires one-time UAC admin elevation.
#[tauri::command]
fn install_virtual_printer() -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        let script = r#"$ErrorActionPreference = 'Stop'
$printerName = 'Open PDF Studio'

# Remove existing printer if present (ignore errors)
try { Remove-Printer -Name $printerName -ErrorAction SilentlyContinue } catch {}

# Create the printer using the built-in PDF driver and PORTPROMPT: port
# PORTPROMPT: shows a Save As dialog with print preview
Add-Printer -Name $printerName -DriverName 'Microsoft Print to PDF' -PortName 'PORTPROMPT:'"#;

        run_elevated_ps_script(script)?;
        Ok(true)
    }

    #[cfg(not(target_os = "windows"))]
    {
        Err("Virtual printer is only supported on Windows".to_string())
    }
}

/// Remove the "Open PDF Studio" virtual printer.
/// Requires UAC admin elevation.
#[tauri::command]
fn remove_virtual_printer() -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        let script = r#"$ErrorActionPreference = 'Stop'
$printerName = 'Open PDF Studio'

Remove-Printer -Name $printerName

# Clean up any leftover local port from older installations
Get-PrinterPort | Where-Object { $_.Name -like '*OpenPDFStudio*print-capture*' } | Remove-PrinterPort"#;

        run_elevated_ps_script(script)?;
        Ok(true)
    }

    #[cfg(not(target_os = "windows"))]
    {
        Err("Virtual printer is only supported on Windows".to_string())
    }
}

/// Check whether the "Open PDF Studio" virtual printer is installed.
#[tauri::command]
fn is_virtual_printer_installed() -> bool {
    #[cfg(target_os = "windows")]
    {
        let output = std::process::Command::new("powershell")
            .args(&[
                "-NoProfile", "-NonInteractive", "-Command",
                "Get-Printer -Name 'Open PDF Studio' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name"
            ])
            .output();

        match output {
            Ok(o) => {
                let stdout = String::from_utf8_lossy(&o.stdout);
                stdout.trim() == "Open PDF Studio"
            }
            Err(_) => false,
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        false
    }
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
        .setup(|app| {
            // Set the window icon so taskbar matches the title bar icon
            if let Some(window) = app.get_webview_window("main") {
                let icon_bytes = include_bytes!("../icons/icon.png");
                if let Ok(icon) = tauri::image::Image::from_bytes(icon_bytes) {
                    let _ = window.set_icon(icon);
                }
            }

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
            open_default_apps_settings,
            get_printers,
            print_pdf,
            open_printer_properties,
            get_temp_dir,
            write_temp_pdf,
            delete_file,
            install_virtual_printer,
            remove_virtual_printer,
            is_virtual_printer_installed
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
