//! Read aloud through the OS speech engine (#384).
//!
//! The WebView's speechSynthesis is tried first (js/accessibility/speech.js);
//! these commands are the fallback where it has no voices (WebKitGTK on
//! Linux, mostly). One utterance at a time: `tts_speak` starts the engine's
//! process and returns when it exits, `tts_stop` kills it.

pub mod opdracht;

use opdracht::{kies_motor, lees_stemmen, spreek_opdracht, stemmen_opdracht, Motor, Opdracht};
use serde::Serialize;
use std::io::Write;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// The running speech process, if any.
#[derive(Default)]
pub struct SpraakProces(pub Arc<Mutex<Option<Child>>>);

#[derive(Serialize)]
pub struct SpraakInfo {
    pub available: bool,
    pub engine: Option<String>,
    pub voices: Vec<String>,
}

fn op_pad(programma: &str) -> bool {
    let Some(pad) = std::env::var_os("PATH") else { return false };
    std::env::split_paths(&pad).any(|map| {
        let kandidaat = map.join(programma);
        kandidaat.is_file()
    })
}

fn huidige_motor() -> Option<Motor> {
    kies_motor(std::env::consts::OS, op_pad)
}

fn commando(o: &Opdracht) -> Command {
    #[cfg(target_os = "windows")]
    let mut c = {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let mut c = Command::new(&o.programma);
        c.creation_flags(CREATE_NO_WINDOW);
        c
    };
    #[cfg(not(target_os = "windows"))]
    let mut c = Command::new(&o.programma);
    c.args(&o.argumenten);
    for (k, v) in &o.omgeving {
        c.env(k, v);
    }
    c
}

fn stop_proces(slot: &Mutex<Option<Child>>) {
    if let Ok(mut s) = slot.lock() {
        if let Some(mut kind) = s.take() {
            let _ = kind.kill();
            let _ = kind.wait();
        }
    }
}

/// Which native engine is available, and its voices.
#[tauri::command]
pub async fn tts_info() -> Result<SpraakInfo, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let Some(motor) = huidige_motor() else {
            return SpraakInfo { available: false, engine: None, voices: vec![] };
        };
        let o = stemmen_opdracht(motor);
        let uitvoer = commando(&o).stdin(Stdio::null()).stderr(Stdio::null()).output();
        match uitvoer {
            Ok(u) => SpraakInfo {
                available: true,
                engine: Some(motor.naam().to_string()),
                voices: lees_stemmen(motor, &String::from_utf8_lossy(&u.stdout)),
            },
            // The engine's program could not be started at all.
            Err(_) => SpraakInfo { available: false, engine: Some(motor.naam().to_string()), voices: vec![] },
        }
    })
    .await
    .map_err(|e| e.to_string())
}

/// Speak `text`; returns when the engine is done or `tts_stop` killed it.
#[tauri::command]
pub async fn tts_speak(
    text: String,
    voice: Option<String>,
    rate: Option<f64>,
    state: tauri::State<'_, SpraakProces>,
) -> Result<(), String> {
    let slot = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let motor = huidige_motor().ok_or_else(|| "no speech engine".to_string())?;
        stop_proces(&slot);
        let o = spreek_opdracht(motor, &text, voice.as_deref(), rate.unwrap_or(1.0));
        let mut c = commando(&o);
        c.stdout(Stdio::null()).stderr(Stdio::null());
        c.stdin(if o.stdin.is_some() { Stdio::piped() } else { Stdio::null() });
        let mut kind = c.spawn().map_err(|e| format!("{}: {}", o.programma, e))?;
        if let (Some(tekst), Some(mut invoer)) = (o.stdin.as_ref(), kind.stdin.take()) {
            let _ = invoer.write_all(tekst.as_bytes());
            // Dropping stdin closes it: the engine sees the end of the text.
        }
        {
            let mut s = slot.lock().map_err(|e| e.to_string())?;
            *s = Some(kind);
        }
        loop {
            {
                let mut s = slot.lock().map_err(|e| e.to_string())?;
                match s.as_mut() {
                    // Stopped (or replaced) by another call.
                    None => return Ok(()),
                    Some(k) => match k.try_wait() {
                        Ok(Some(status)) => {
                            *s = None;
                            return if status.success() { Ok(()) } else { Err(format!("{} exited with {}", o.programma, status)) };
                        }
                        Ok(None) => {}
                        Err(e) => {
                            *s = None;
                            return Err(e.to_string());
                        }
                    },
                }
            }
            std::thread::sleep(Duration::from_millis(40));
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Stop speaking.
#[tauri::command]
pub fn tts_stop(state: tauri::State<'_, SpraakProces>) {
    stop_proces(&state.0);
}
