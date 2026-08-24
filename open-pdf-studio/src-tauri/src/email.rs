// Open the user's default mail client with a PDF attached. This only opens a
// draft — the user reviews and sends it; the app never sends mail autonomously.
//
// Windows : Simple MAPI (MAPISendMail) — works with the default MAPI client.
// Linux   : xdg-email --attach.
// macOS   : Mail.app via osascript.

#[tauri::command]
pub async fn email_pdf(path: String, subject: Option<String>) -> Result<(), String> {
    let subject = subject.unwrap_or_default();
    // MAPISendMail is blocking (it shows the client's compose window), so run
    // it off the async runtime.
    tokio::task::spawn_blocking(move || email_impl(&path, &subject))
        .await
        .map_err(|e| format!("email task failed: {e}"))?
}

#[cfg(target_os = "windows")]
fn email_impl(path: &str, subject: &str) -> Result<(), String> {
    use std::ffi::CString;
    use std::path::Path;
    use std::os::raw::{c_char, c_void};

    // Simple MAPI structs (ANSI). Layout must match mapi.h exactly.
    #[repr(C)]
    struct MapiFileDesc {
        reserved: u32,
        flags: u32,
        position: u32,
        path_name: *const c_char,
        file_name: *const c_char,
        file_type: *mut c_void,
    }
    #[repr(C)]
    struct MapiMessage {
        reserved: u32,
        subject: *const c_char,
        note_text: *const c_char,
        message_type: *const c_char,
        date_received: *const c_char,
        conversation_id: *const c_char,
        flags: u32,
        originator: *mut c_void,
        recip_count: u32,
        recips: *mut c_void,
        file_count: u32,
        files: *const MapiFileDesc,
    }
    // raw-dylib: MSVC's mapi32.lib exporteert MAPISendMail niet (mingw's
    // libmapi32.a wel — daarom linkte de GNU-build lokaal en faalde CI/MSVC
    // met LNK2019 __imp_MAPISendMail). raw-dylib genereert de import
    // rechtstreeks, zonder import-library, op beide toolchains.
    #[link(name = "mapi32", kind = "raw-dylib")]
    extern "system" {
        fn MAPISendMail(
            session: usize,
            ui_param: usize,
            message: *const MapiMessage,
            flags: u32,
            reserved: u32,
        ) -> u32;
    }
    const MAPI_LOGON_UI: u32 = 0x0000_0001;
    const MAPI_DIALOG: u32 = 0x0000_0008;
    const SUCCESS_SUCCESS: u32 = 0;
    const MAPI_USER_ABORT: u32 = 1;

    let file_name = Path::new(path)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("document.pdf");
    let c_path = CString::new(path).map_err(|e| e.to_string())?;
    let c_file = CString::new(file_name).map_err(|e| e.to_string())?;
    let c_subject = CString::new(subject).map_err(|e| e.to_string())?;

    let file = MapiFileDesc {
        reserved: 0,
        flags: 0,
        position: u32::MAX, // not embedded at a character position
        path_name: c_path.as_ptr(),
        file_name: c_file.as_ptr(),
        file_type: std::ptr::null_mut(),
    };
    let message = MapiMessage {
        reserved: 0,
        subject: c_subject.as_ptr(),
        note_text: std::ptr::null(),
        message_type: std::ptr::null(),
        date_received: std::ptr::null(),
        conversation_id: std::ptr::null(),
        flags: 0,
        originator: std::ptr::null_mut(),
        recip_count: 0,
        recips: std::ptr::null_mut(),
        file_count: 1,
        files: &file,
    };

    let r = unsafe { MAPISendMail(0, 0, &message, MAPI_LOGON_UI | MAPI_DIALOG, 0) };
    if r == SUCCESS_SUCCESS || r == MAPI_USER_ABORT {
        Ok(())
    } else {
        Err(format!(
            "No default email program found (MAPI code {r}). Set up a MAPI mail client (e.g. Outlook/Thunderbird)."
        ))
    }
}

#[cfg(target_os = "linux")]
fn email_impl(path: &str, subject: &str) -> Result<(), String> {
    std::process::Command::new("xdg-email")
        .arg("--subject")
        .arg(subject)
        .arg("--attach")
        .arg(path)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("xdg-email is not available: {e}"))
}

#[cfg(target_os = "macos")]
fn email_impl(path: &str, subject: &str) -> Result<(), String> {
    let safe_subject = subject.replace('"', "'");
    let safe_path = path.replace('"', "'");
    let script = format!(
        "tell application \"Mail\"\n\
         set newMsg to make new outgoing message with properties {{subject:\"{}\", visible:true}}\n\
         tell newMsg to make new attachment with properties {{file name:(POSIX file \"{}\")}}\n\
         activate\n\
         end tell",
        safe_subject, safe_path
    );
    std::process::Command::new("osascript")
        .arg("-e")
        .arg(script)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("Could not open the mail client: {e}"))
}

#[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
fn email_impl(_path: &str, _subject: &str) -> Result<(), String> {
    Err("Email is not supported on this platform.".to_string())
}
