//! Commando-schil voor de monochroom-hercompressie per beeld (#902). Het
//! rekenwerk staat in de crate `open-pdf-monochrome`; de JS-kant
//! (js/pdf/monochrome-rust.js) leest de PDF-structuur en valt terug op de
//! JS-encoder als dit commando ontbreekt, faalt of uitgezet is.
//!
//! Invoer: de ruwe streambytes als rauwe body, de afgeleide getallen als
//! JSON in de kop `x-opds-monochroom`. Uitvoer (rauwe bytes):
//!   byte 0 = 0 overslaan, 1 Flate, 2 CCITT G4
//!   overslaan: daarna de reden (ASCII)
//!   anders:    u32 LE Flate-lengte, u32 LE CCITT-lengte (0xFFFFFFFF = geen
//!              kandidaat), dan de gekozen databytes.

use open_pdf_monochrome::{optimize, Filter, Outcome, Params};
use serde::Deserialize;
use tauri::ipc::{InvokeBody, Request, Response};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Kop {
    width: usize,
    height: usize,
    bits: u8,
    channels: u8,
    flate_source: bool,
    decoded_size: usize,
    output_cap: usize,
    ccitt_fits: bool,
    black_is1: bool,
    decode_ok: bool,
    before: u64,
    flate_base: u64,
    ccitt_base: u64,
}

/// `OPDS_RUST_MONOCHROME=0` zet de Rust-route uit (vergelijken met JS).
#[tauri::command]
pub fn monochroom_rust_beschikbaar() -> bool {
    std::env::var("OPDS_RUST_MONOCHROME").map(|v| v.trim() != "0").unwrap_or(true)
}

fn lengte(n: Option<usize>) -> [u8; 4] {
    n.map(|n| n as u32).unwrap_or(u32::MAX).to_le_bytes()
}

#[tauri::command]
pub async fn monochroom_beeld(request: Request<'_>) -> Result<Response, String> {
    let kop = request.headers().get("x-opds-monochroom")
        .ok_or("Missing monochrome parameters")?.to_str().map_err(|e| e.to_string())?;
    let kop: Kop = serde_json::from_str(kop).map_err(|e| e.to_string())?;
    let bytes = match request.body() {
        InvokeBody::Raw(bytes) => bytes.clone(),
        InvokeBody::Json(_) => return Err("Expected a raw body".into()),
    };
    let params = Params {
        width: kop.width, height: kop.height, bits: kop.bits, channels: kop.channels,
        flate_source: kop.flate_source, decoded_size: kop.decoded_size, output_cap: kop.output_cap,
        ccitt_fits: kop.ccitt_fits, black_is1: kop.black_is1, decode_ok: kop.decode_ok,
        before: kop.before, flate_base: kop.flate_base, ccitt_base: kop.ccitt_base,
    };
    let uitkomst = tauri::async_runtime::spawn_blocking(move || optimize(&bytes, &params))
        .await
        .map_err(|e| e.to_string())?;
    Ok(Response::new(match uitkomst {
        Outcome::Skip(reden) => {
            let mut out = Vec::with_capacity(1 + reden.len());
            out.push(0);
            out.extend_from_slice(reden.as_bytes());
            out
        }
        Outcome::Encoded { filter, data, flate_len, ccitt_len } => {
            let mut out = Vec::with_capacity(9 + data.len());
            out.push(if filter == Filter::Flate { 1 } else { 2 });
            out.extend_from_slice(&lengte(flate_len));
            out.extend_from_slice(&lengte(ccitt_len));
            out.extend_from_slice(&data);
            out
        }
    }))
}
