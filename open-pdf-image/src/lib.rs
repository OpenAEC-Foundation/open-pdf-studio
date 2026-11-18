//! Beeldwerk dat in de app op de interface-thread in JavaScript liep.
//!
//! * [`png_xobject`]: een PNG wordt de twee streams van een beeld-XObject
//!   (kleur en zacht masker, elk Flate), zoals `embedPng` van de PDF-bibliotheek
//!   ze maakt. De JS-kant (`js/pdf/embed-png-rust.js`) bouwt alleen nog de
//!   woordenboeken.
//!
//! Het volgt de JS-route op de pixel; wat hier niet bewezen gelijk is, geeft
//! `Skip` en blijft in JavaScript.

pub mod png_xobject;

#[cfg(test)]
mod tests;

/// Zoals `DecompressionStream('deflate')`: zlib-formaat; afgekapte invoer en
/// rommel na het einde zijn fouten. `hint` is de verwachte grootte, `limit`
/// de bovengrens. Alleen de tests pakken uit.
#[cfg(test)]
pub(crate) fn inflate(input: &[u8], hint: usize, limit: usize) -> Option<Vec<u8>> {
    use zlib_rs::{Inflate, InflateFlush, Status};
    let mut d = Inflate::new(true, 15);
    let mut out = vec![0u8; hint.max(64).min(limit + 1)];
    let mut len = 0usize;
    loop {
        let (voor_in, voor_uit) = (d.total_in(), d.total_out());
        let status = d.decompress(&input[voor_in as usize..], &mut out[len..], InflateFlush::NoFlush).ok()?;
        len = d.total_out() as usize;
        if status == Status::StreamEnd {
            break;
        }
        if len == out.len() {
            if len > limit {
                return None;
            }
            let erbij = len.max(4096).min(limit + 1 - len);
            out.resize(len + erbij, 0);
        } else if d.total_in() == voor_in && d.total_out() == voor_uit {
            return None; // afgekapt
        }
    }
    if d.total_in() as usize != input.len() {
        return None;
    }
    out.truncate(len);
    Some(out)
}

/// Onder deze grootte per draad loont verdelen niet.
const BLOK: usize = 1 << 20;
const MAX_DRADEN: usize = 6;

/// zlib-formaat op het gegeven niveau (6 is het niveau van de JS-route).
///
/// Grote invoer wordt in stukken over een paar draden verdeeld: elk stuk een
/// eigen ruwe Deflate-reeks die op een bytegrens eindigt (sync flush), achter
/// elkaar gezet tussen één zlib-kop en één Adler-32 over het geheel. Dat is
/// een gewone zlib-stroom; alleen kan een stuk niet naar het vorige
/// terugverwijzen, wat op deze groottes niets uitmaakt.
pub(crate) fn deflate(input: &[u8], niveau: i32) -> Option<Vec<u8>> {
    let kernen = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1);
    let draden = kernen.min(MAX_DRADEN).min(input.len() / BLOK);
    if draden < 2 {
        return deflate_enkel(input, niveau);
    }
    let stukken: Vec<&[u8]> = input.chunks(input.len().div_ceil(draden)).collect();
    let laatste = stukken.len() - 1;
    let (delen, adler) = std::thread::scope(|s| {
        let taken: Vec<_> = stukken
            .iter()
            .enumerate()
            .map(|(i, stuk)| s.spawn(move || deflate_stuk(stuk, niveau, i == laatste)))
            .collect();
        let adler = zlib_rs::adler32::adler32(1, input);
        let delen: Vec<Option<Vec<u8>>> = taken.into_iter().map(|t| t.join().ok().flatten()).collect();
        (delen, adler)
    });
    let mut out = Vec::with_capacity(6 + delen.iter().map(|d| d.as_ref().map_or(0, |d| d.len())).sum::<usize>());
    // CMF 0x78 (venster 32 KiB), FLG met het niveau erin en een geldige controle.
    out.extend_from_slice(&[0x78, match niveau { 0..=1 => 0x01, 2..=5 => 0x5e, 6 => 0x9c, _ => 0xda }]);
    for deel in delen {
        out.extend_from_slice(&deel?);
    }
    out.extend_from_slice(&adler.to_be_bytes());
    Some(out)
}

fn deflate_stuk(stuk: &[u8], niveau: i32, laatste: bool) -> Option<Vec<u8>> {
    use zlib_rs::{Deflate, DeflateFlush, Status};
    let mut d = Deflate::new(niveau, false, 15);
    let mut out = vec![0u8; zlib_rs::compress_bound(stuk.len()) + 64];
    let status = d.compress(stuk, &mut out, if laatste { DeflateFlush::Finish } else { DeflateFlush::SyncFlush }).ok()?;
    let geschreven = d.total_out() as usize;
    // Alles gelezen, en de uitvoer niet vol (dan is de flush compleet).
    if d.total_in() as usize != stuk.len() || geschreven >= out.len() || (laatste && status != Status::StreamEnd) {
        return None;
    }
    out.truncate(geschreven);
    Some(out)
}

fn deflate_enkel(input: &[u8], niveau: i32) -> Option<Vec<u8>> {
    let mut out = vec![0u8; zlib_rs::compress_bound(input.len())];
    let (data, rc) = zlib_rs::compress_slice(&mut out, input, zlib_rs::DeflateConfig::new(niveau));
    if rc != zlib_rs::ReturnCode::Ok {
        return None;
    }
    let n = data.len();
    out.truncate(n);
    Some(out)
}
