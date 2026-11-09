// Open the user's default mail client with a PDF attached. This only opens a
// draft — the user reviews and sends it; the app never sends mail autonomously.
//
// Windows : Simple MAPI (MAPISendMailW) — works with the default MAPI client.
//           Without a MAPI client the command fails and the app falls back
//           to a mailto: draft plus the file shown in Explorer
//           (js/pdf/delen.js).
// Linux   : xdg-email --attach.
// macOS   : no attachment route without native bindings; the app shows the
//           file in Finder instead (js/pdf/delen.js).
//
// `verzendkopie_schrijven` writes the copy that is sent (a document with
// unsaved changes, or the Android share sheet) into the app's cache folder.

/// Prefix of the error when no mail program can take the attachment; the
/// app then uses its fallback (js/pdf/delen.js).
pub const GEEN_MAILPROGRAMMA: &str = "OPDS_NO_MAIL_CLIENT";

/// `to` (recipient addresses) and `body` are optional: Share / send leaves
/// them empty, an approval request (js/approval-routing) fills them so the
/// draft shows exactly what the preview showed. The draft still opens in the
/// mail program's own window; the user sends it.
#[tauri::command]
pub async fn email_pdf(
    path: String,
    subject: Option<String>,
    to: Option<Vec<String>>,
    body: Option<String>,
) -> Result<(), String> {
    crate::headless::weiger("email_pdf")?;
    let subject = subject.unwrap_or_default();
    let to = schone_adressen(to.unwrap_or_default())?;
    let body = body.unwrap_or_default();
    // MAPISendMail is blocking (it shows the client's compose window), so run
    // it off the async runtime.
    tokio::task::spawn_blocking(move || email_impl(&path, &subject, &to, &body))
        .await
        .map_err(|e| format!("email task failed: {e}"))?
}

/// Addresses for the draft: at most 50, each a plain `local@domain` without
/// spaces, control characters or characters that could start another
/// argument or header (`-` at the start, `<`, `>`, `,`, `;`, `"`).
pub fn schone_adressen(adressen: Vec<String>) -> Result<Vec<String>, String> {
    if adressen.len() > 50 {
        return Err("too many recipients".into());
    }
    adressen
        .into_iter()
        .map(|a| {
            let a = a.trim().to_string();
            let geldig = a.len() <= 254
                && !a.starts_with('-')
                && a.matches('@').count() == 1
                && !a.starts_with('@')
                && !a.ends_with('@')
                && !a.chars().any(|c| c.is_whitespace() || c.is_control() || "<>,;\"".contains(c));
            if geldig { Ok(a) } else { Err(format!("invalid recipient address: {a}")) }
        })
        .collect()
}

#[cfg(target_os = "windows")]
fn email_impl(path: &str, subject: &str, to: &[String], body: &str) -> Result<(), String> {
    use std::os::raw::c_void;
    use std::path::Path;

    // Simple MAPI structs (Unicode). Layout must match mapi.h exactly.
    #[repr(C)]
    struct MapiFileDescW {
        reserved: u32,
        flags: u32,
        position: u32,
        path_name: *const u16,
        file_name: *const u16,
        file_type: *mut c_void,
    }
    #[repr(C)]
    struct MapiRecipDescW {
        reserved: u32,
        recip_class: u32,
        name: *const u16,
        address: *const u16,
        eid_size: u32,
        entry_id: *mut c_void,
    }
    #[repr(C)]
    struct MapiMessageW {
        reserved: u32,
        subject: *const u16,
        note_text: *const u16,
        message_type: *const u16,
        date_received: *const u16,
        conversation_id: *const u16,
        flags: u32,
        originator: *mut c_void,
        recip_count: u32,
        recips: *mut c_void,
        file_count: u32,
        files: *const MapiFileDescW,
    }
    // raw-dylib: MSVC's mapi32.lib exporteert de Simple-MAPI-functies niet
    // (mingw's libmapi32.a wel — daarom linkte de GNU-build lokaal en faalde
    // CI/MSVC met LNK2019). raw-dylib genereert de import rechtstreeks,
    // zonder import-library, op beide toolchains. MAPISendMailW bestaat
    // sinds Windows 8; heeft het mailprogramma alleen de ANSI-variant, dan
    // zet de stub in mapi32.dll het bericht zelf om.
    #[link(name = "mapi32", kind = "raw-dylib")]
    extern "system" {
        fn MAPISendMailW(
            session: usize,
            ui_param: usize,
            message: *const MapiMessageW,
            flags: u32,
            reserved: u32,
        ) -> u32;
    }
    const MAPI_LOGON_UI: u32 = 0x0000_0001;
    const MAPI_DIALOG: u32 = 0x0000_0008;
    const SUCCESS_SUCCESS: u32 = 0;
    const MAPI_USER_ABORT: u32 = 1;
    const MAPI_TO: u32 = 1;

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    if !Path::new(path).is_file() {
        return Err(format!("File not found: {path}"));
    }
    let file_name = Path::new(path)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("document.pdf");
    let w_path = wide(path);
    let w_file = wide(file_name);
    let w_subject = wide(subject);
    let w_body = wide(body);
    let w_namen: Vec<Vec<u16>> = to.iter().map(|a| wide(a)).collect();
    let w_adressen: Vec<Vec<u16>> = to.iter().map(|a| wide(&format!("SMTP:{a}"))).collect();
    let ontvangers: Vec<MapiRecipDescW> = w_namen
        .iter()
        .zip(w_adressen.iter())
        .map(|(n, a)| MapiRecipDescW {
            reserved: 0,
            recip_class: MAPI_TO,
            name: n.as_ptr(),
            address: a.as_ptr(),
            eid_size: 0,
            entry_id: std::ptr::null_mut(),
        })
        .collect();

    let file = MapiFileDescW {
        reserved: 0,
        flags: 0,
        position: u32::MAX, // not embedded at a character position
        path_name: w_path.as_ptr(),
        file_name: w_file.as_ptr(),
        file_type: std::ptr::null_mut(),
    };
    let message = MapiMessageW {
        reserved: 0,
        subject: w_subject.as_ptr(),
        note_text: if body.is_empty() { std::ptr::null() } else { w_body.as_ptr() },
        message_type: std::ptr::null(),
        date_received: std::ptr::null(),
        conversation_id: std::ptr::null(),
        flags: 0,
        originator: std::ptr::null_mut(),
        recip_count: ontvangers.len() as u32,
        recips: if ontvangers.is_empty() { std::ptr::null_mut() } else { ontvangers.as_ptr() as *mut c_void },
        file_count: 1,
        files: &file,
    };

    let r = unsafe { MAPISendMailW(0, 0, &message, MAPI_LOGON_UI | MAPI_DIALOG, 0) };
    if r == SUCCESS_SUCCESS || r == MAPI_USER_ABORT {
        Ok(())
    } else {
        Err(format!(
            "{GEEN_MAILPROGRAMMA}: no default email program took the attachment (MAPI code {r})"
        ))
    }
}

#[cfg(target_os = "linux")]
fn email_impl(path: &str, subject: &str, to: &[String], body: &str) -> Result<(), String> {
    let mut opdracht = std::process::Command::new("xdg-email");
    opdracht.arg("--utf8").arg("--subject").arg(subject);
    if !body.is_empty() {
        opdracht.arg("--body").arg(body);
    }
    opdracht.arg("--attach").arg(path);
    // Addresses come last; schone_adressen refused anything starting with '-'.
    for a in to {
        opdracht.arg(a);
    }
    opdracht
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("{GEEN_MAILPROGRAMMA}: xdg-email is not available: {e}"))
}

#[cfg(not(any(target_os = "windows", target_os = "linux")))]
fn email_impl(_path: &str, _subject: &str, _to: &[String], _body: &str) -> Result<(), String> {
    Err(format!("{GEEN_MAILPROGRAMMA}: attaching to an email is not supported on this platform"))
}

/// Bestandsnaam voor de verzendkopie: alleen de laatste padcomponent, zonder
/// tekens die geen bestandsnaam mogen zijn, en altijd eindigend op `.pdf`.
pub fn verzendnaam(naam: &str) -> String {
    let laatste = naam.rsplit(['/', '\\']).next().unwrap_or("");
    let schoon: String = laatste
        .chars()
        .map(|c| if c.is_control() || "<>:\"|?*".contains(c) { '_' } else { c })
        .collect();
    let schoon = schoon.trim().trim_matches('.').trim();
    let basis = if schoon.is_empty() { "document" } else { schoon };
    // Niet onbeperkt lang: sommige mailprogramma's weigeren lange namen.
    let basis: String = basis.chars().take(120).collect();
    if basis.to_lowercase().ends_with(".pdf") {
        basis
    } else {
        format!("{basis}.pdf")
    }
}

/// Verzendkopieën die ouder zijn dan een dag: het mailprogramma of de
/// ontvangende app heeft ze dan allang gelezen.
fn ruim_oude_kopieen_op(map: &std::path::Path) {
    let Ok(lijst) = std::fs::read_dir(map) else { return };
    let grens = std::time::Duration::from_secs(24 * 60 * 60);
    for item in lijst.flatten() {
        let pad = item.path();
        let oud = item
            .metadata()
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.elapsed().ok())
            .is_some_and(|d| d > grens);
        if oud {
            if pad.is_dir() {
                let _ = std::fs::remove_dir_all(&pad);
            } else {
                let _ = std::fs::remove_file(&pad);
            }
        }
    }
}

/// Schrijft de te verzenden kopie (body = PDF-bytes, header `x-opds-name` =
/// bestandsnaam, url-gecodeerd) in `<app-cache>/verzenden/<tijd>/<naam>` en
/// geeft het pad terug. Een eigen submap per kopie houdt de echte
/// bestandsnaam vrij, zodat de bijlage bij de ontvanger zo heet.
#[tauri::command]
pub async fn verzendkopie_schrijven(
    app: tauri::AppHandle,
    request: tauri::ipc::Request<'_>,
) -> Result<String, String> {
    use tauri::Manager;
    let kop = request
        .headers()
        .get("x-opds-name")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("document.pdf");
    let naam = verzendnaam(&urlencoding::decode(kop).map_err(|e| e.to_string())?);
    let bytes = match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => bytes.clone(),
        // Android cannot transport a raw IPC body.
        tauri::ipc::InvokeBody::Json(value) => {
            serde_json::from_value::<Vec<u8>>(value.get("data").cloned().ok_or("Missing file data")?)
                .map_err(|e| e.to_string())?
        }
    };
    let map = app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("no cache folder: {e}"))?
        .join("verzenden");
    tauri::async_runtime::spawn_blocking(move || {
        std::fs::create_dir_all(&map).map_err(|e| e.to_string())?;
        ruim_oude_kopieen_op(&map);
        let stempel = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);
        let submap = map.join(format!("{stempel}"));
        std::fs::create_dir_all(&submap).map_err(|e| e.to_string())?;
        let pad = submap.join(&naam);
        crate::atomic_file::write(&pad, &bytes).map_err(|e| e.to_string())?;
        pad.to_str()
            .map(str::to_owned)
            .ok_or_else(|| "send copy path is not valid UTF-8".to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::{schone_adressen, verzendnaam};

    #[test]
    fn schone_adressen_weigert_argumenten_en_kopregels() {
        assert_eq!(schone_adressen(vec![" a@example.org ".into()]).unwrap(), vec!["a@example.org".to_string()]);
        assert!(schone_adressen(vec!["--attach@x.org".into()]).is_err());
        assert!(schone_adressen(vec!["a@b.org\r\nBcc: c@d.org".into()]).is_err());
        assert!(schone_adressen(vec!["a@b.org, c@d.org".into()]).is_err());
        assert!(schone_adressen(vec!["geen-adres".into()]).is_err());
        assert!(schone_adressen(vec!["a@x.org".into(); 51]).is_err());
    }

    #[test]
    fn verzendnaam_houdt_alleen_een_veilige_bestandsnaam() {
        assert_eq!(verzendnaam("Offerte.pdf"), "Offerte.pdf");
        assert_eq!(verzendnaam("C:\\map\\Tekening A.PDF"), "Tekening A.PDF");
        assert_eq!(verzendnaam("../../etc/passwd"), "passwd.pdf");
        assert_eq!(verzendnaam("a:b?c"), "a_b_c.pdf");
        assert_eq!(verzendnaam(""), "document.pdf");
        assert_eq!(verzendnaam(".."), "document.pdf");
    }
}
