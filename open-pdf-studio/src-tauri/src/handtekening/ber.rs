//! BER naar DER, een kleine TLV-lezer en ASN.1-tijden.
//!
//! CMS in PDF's komt in de praktijk ook als BER voor (onbepaalde lengtes,
//! samengestelde OCTET STRING's). De `der`-crate weigert dat. `normaliseer`
//! zet lengtes om naar DER zonder de volgorde van elementen te veranderen, zodat
//! ondertekende attributen byte-voor-byte gelijk blijven aan wat de
//! ondertekenaar hashte. Alleen tags met één byte (alles wat CMS, X.509 en
//! RFC 3161 gebruiken).

/// Maximale nesting; dieper is geen echte handtekening maar een aanval op de stapel.
pub const MAX_DIEPTE: usize = 64;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BerFout {
    Afgekapt,
    /// Onbepaalde lengte waar DER verwacht wordt.
    OnbepaaldeLengte,
    OnbepaaldBijPrimitief,
    HogeTag,
    LengteTeGroot,
    TeDiep,
    VreemdDeelInString,
}

impl std::fmt::Display for BerFout {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let tekst = match self {
            BerFout::Afgekapt => "ASN.1 afgekapt",
            BerFout::OnbepaaldeLengte => "onbepaalde lengte in DER",
            BerFout::OnbepaaldBijPrimitief => "onbepaalde lengte bij een primitief element",
            BerFout::HogeTag => "tag met meerdere bytes",
            BerFout::LengteTeGroot => "lengteveld te groot",
            BerFout::TeDiep => "te diep genest",
            BerFout::VreemdDeelInString => "vreemd deel in samengestelde OCTET STRING",
        };
        f.write_str(tekst)
    }
}

/// Eén element: tag, inhoud en het hele element (kop + inhoud).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Tlv<'a> {
    pub tag: u8,
    pub inhoud: &'a [u8],
    pub geheel: &'a [u8],
}

/// Kop lezen: (tag, lengte of `None` bij onbepaald, kopgrootte).
fn lees_kop(b: &[u8]) -> Result<(u8, Option<usize>, usize), BerFout> {
    let tag = *b.first().ok_or(BerFout::Afgekapt)?;
    if tag & 0x1F == 0x1F {
        return Err(BerFout::HogeTag);
    }
    let l0 = *b.get(1).ok_or(BerFout::Afgekapt)?;
    if l0 == 0x80 {
        return Ok((tag, None, 2));
    }
    if l0 < 0x80 {
        return Ok((tag, Some(usize::from(l0)), 2));
    }
    let n = usize::from(l0 & 0x7F);
    if n > 4 {
        return Err(BerFout::LengteTeGroot);
    }
    let bytes = b.get(2..2 + n).ok_or(BerFout::Afgekapt)?;
    let lengte = bytes.iter().fold(0usize, |acc, &x| (acc << 8) | usize::from(x));
    Ok((tag, Some(lengte), 2 + n))
}

/// Leest één DER-element aan het begin van `b`; geeft het element en de rest.
pub fn lees_tlv(b: &[u8]) -> Result<(Tlv<'_>, &[u8]), BerFout> {
    let (tag, lengte, kop) = lees_kop(b)?;
    let n = lengte.ok_or(BerFout::OnbepaaldeLengte)?;
    let einde = kop.checked_add(n).ok_or(BerFout::Afgekapt)?;
    let geheel = b.get(..einde).ok_or(BerFout::Afgekapt)?;
    let inhoud = geheel.get(kop..).ok_or(BerFout::Afgekapt)?;
    let rest = b.get(einde..).ok_or(BerFout::Afgekapt)?;
    Ok((Tlv { tag, inhoud, geheel }, rest))
}

/// Alle elementen achter elkaar in `inhoud` (de inhoud van een SEQUENCE of SET).
pub fn kinderen(inhoud: &[u8]) -> Result<Vec<Tlv<'_>>, BerFout> {
    let mut uit = Vec::new();
    let mut rest = inhoud;
    while !rest.is_empty() {
        let (t, na) = lees_tlv(rest)?;
        uit.push(t);
        rest = na;
    }
    Ok(uit)
}

fn schrijf_lengte(uit: &mut Vec<u8>, n: usize) {
    if n < 0x80 {
        uit.push(n as u8);
        return;
    }
    let bytes = (n as u64).to_be_bytes();
    let eerste = bytes.iter().position(|&x| x != 0).unwrap_or(7);
    uit.push(0x80 | (8 - eerste) as u8);
    uit.extend_from_slice(&bytes[eerste..]);
}

/// Zet het eerste element van `b` om naar DER. Geeft de DER-bytes en het aantal
/// gelezen invoerbytes (vulbytes erachter, zoals de nullen in `/Contents`, blijven buiten).
///
/// Behalve onbepaalde lengtes worden ook niet-minimale lengtecoderingen
/// (bijvoorbeeld `82 00 03`) naar de minimale vorm herschreven; de inhoud en de
/// volgorde van elementen blijven gelijk. Elk samengesteld niveau bouwt zijn
/// inhoud in een eigen buffer op en kopieert die naar de ouder, dus het kopiëren
/// kost O(diepte·n) voor n invoerbytes (begrensd door [`MAX_DIEPTE`]).
pub fn normaliseer(b: &[u8]) -> Result<(Vec<u8>, usize), BerFout> {
    let mut uit = Vec::with_capacity(b.len());
    let gelezen = normaliseer_in(b, 0, &mut uit)?;
    Ok((uit, gelezen))
}

fn normaliseer_in(b: &[u8], diepte: usize, uit: &mut Vec<u8>) -> Result<usize, BerFout> {
    if diepte > MAX_DIEPTE {
        return Err(BerFout::TeDiep);
    }
    let (tag, lengte, kop) = lees_kop(b)?;
    let samengesteld = tag & 0x20 != 0;
    if !samengesteld {
        let n = lengte.ok_or(BerFout::OnbepaaldBijPrimitief)?;
        let einde = kop.checked_add(n).ok_or(BerFout::Afgekapt)?;
        let inhoud = b.get(kop..einde).ok_or(BerFout::Afgekapt)?;
        uit.push(tag);
        schrijf_lengte(uit, n);
        uit.extend_from_slice(inhoud);
        return Ok(einde);
    }
    let mut binnen = Vec::new();
    let mut pos = kop;
    match lengte {
        Some(n) => {
            let einde = kop.checked_add(n).ok_or(BerFout::Afgekapt)?;
            let deel = b.get(..einde).ok_or(BerFout::Afgekapt)?;
            while pos < einde {
                let rest = deel.get(pos..).ok_or(BerFout::Afgekapt)?;
                pos += normaliseer_in(rest, diepte + 1, &mut binnen)?;
            }
        }
        None => loop {
            let rest = b.get(pos..).ok_or(BerFout::Afgekapt)?;
            match rest {
                [0, 0, ..] => {
                    pos += 2;
                    break;
                }
                [] | [_] => return Err(BerFout::Afgekapt),
                _ => pos += normaliseer_in(rest, diepte + 1, &mut binnen)?,
            }
        },
    }
    if tag == 0x24 {
        // Samengestelde OCTET STRING: delen aaneenrijgen tot één primitieve.
        let mut data = Vec::new();
        for deel in kinderen(&binnen)? {
            if deel.tag != 0x04 {
                return Err(BerFout::VreemdDeelInString);
            }
            data.extend_from_slice(deel.inhoud);
        }
        uit.push(0x04);
        schrijf_lengte(uit, data.len());
        uit.extend_from_slice(&data);
    } else {
        uit.push(tag);
        schrijf_lengte(uit, binnen.len());
        uit.extend_from_slice(&binnen);
    }
    Ok(pos)
}

/// Seconden sinds 1970-01-01 UTC voor een datum en tijd in UTC (proleptisch
/// gregoriaans). `None` bij een onmogelijke maand, dag of tijd.
pub fn unix_tijd(jaar: i64, maand: u32, dag: u32, uur: u32, minuut: u32, seconde: u32) -> Option<i64> {
    let schrikkeljaar = (jaar % 4 == 0 && jaar % 100 != 0) || jaar % 400 == 0;
    let dagen_in_maand = match maand {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if schrikkeljaar => 29,
        2 => 28,
        _ => return None,
    };
    if !(1..=dagen_in_maand).contains(&dag) || uur > 23 || minuut > 59 || seconde > 60 {
        return None;
    }
    let y = if maand <= 2 { jaar - 1 } else { jaar };
    let era = (if y >= 0 { y } else { y - 399 }) / 400;
    let yoe = y - era * 400;
    let mp = (i64::from(maand) + 9) % 12;
    let doy = (153 * mp + 2) / 5 + i64::from(dag) - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let dagen = era * 146_097 + doe - 719_468;
    Some(dagen * 86_400 + i64::from(uur) * 3600 + i64::from(minuut) * 60 + i64::from(seconde))
}

/// UTCTime (tag `0x17`, `YYMMDDHHMM[SS]`) of GeneralizedTime (tag `0x18`,
/// `YYYYMMDDHHMM[SS][.fractie]`), gevolgd door `Z` of `±hhmm` (uur ≤ 23, minuten
/// ≤ 59). De fractie telt niet mee, maar moet minstens één cijfer hebben.
pub fn tijd_unix(tag: u8, inhoud: &[u8]) -> Option<i64> {
    let s = std::str::from_utf8(inhoud).ok()?;
    let cijfers = |t: &str| t.bytes().all(|b| b.is_ascii_digit());
    let (jaar, rest) = match tag {
        0x17 => {
            let yy = s.get(0..2).filter(|t| cijfers(t))?.parse::<i64>().ok()?;
            (if yy >= 50 { 1900 + yy } else { 2000 + yy }, s.get(2..)?)
        }
        0x18 => (s.get(0..4).filter(|t| cijfers(t))?.parse::<i64>().ok()?, s.get(4..)?),
        _ => return None,
    };
    let getal = |van: usize| -> Option<u32> { rest.get(van..van + 2).filter(|t| cijfers(t))?.parse().ok() };
    let (maand, dag, uur, minuut) = (getal(0)?, getal(2)?, getal(4)?, getal(6)?);
    let (seconde, mut pos) = match getal(8) {
        Some(s) => (s, 10),
        None => (0, 8),
    };
    if matches!(rest.as_bytes().get(pos), Some(b'.') | Some(b',')) {
        pos += 1;
        let begin = pos;
        while rest.as_bytes().get(pos).is_some_and(|b| b.is_ascii_digit()) {
            pos += 1;
        }
        if pos == begin {
            return None;
        }
    }
    let basis = unix_tijd(jaar, maand, dag, uur, minuut, seconde)?;
    let zone = rest.get(pos..)?;
    if zone == "Z" {
        return Some(basis);
    }
    let teken = match zone.as_bytes().first() {
        Some(b'+') => -1,
        Some(b'-') => 1,
        _ => return None,
    };
    if zone.len() != 5 || !cijfers(&zone[1..]) {
        return None;
    }
    let uren: i64 = zone[1..3].parse().ok()?;
    let minuten: i64 = zone[3..5].parse().ok()?;
    if uren > 23 || minuten > 59 {
        return None;
    }
    Some(basis + teken * (uren * 3600 + minuten * 60))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn fixture(naam: &str) -> Vec<u8> {
        std::fs::read(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/verifieer").join(naam)).unwrap()
    }

    #[test]
    fn tlv_en_kinderen() {
        let b = [0x30, 0x06, 0x02, 0x01, 0x05, 0x04, 0x01, 0xAA, 0xFF];
        let (seq, rest) = lees_tlv(&b).unwrap();
        assert_eq!(seq.tag, 0x30);
        assert_eq!(seq.geheel, &b[..8]);
        assert_eq!(rest, &[0xFF]);
        let k = kinderen(seq.inhoud).unwrap();
        assert_eq!(k.len(), 2);
        assert_eq!((k[0].tag, k[0].inhoud), (0x02, &[0x05][..]));
        assert_eq!((k[1].tag, k[1].inhoud), (0x04, &[0xAA][..]));
    }

    #[test]
    fn der_lezer_weigert_netjes() {
        assert_eq!(lees_tlv(&[]), Err(BerFout::Afgekapt));
        assert_eq!(lees_tlv(&[0x30]), Err(BerFout::Afgekapt));
        assert_eq!(lees_tlv(&[0x30, 0x05, 0x02]), Err(BerFout::Afgekapt));
        assert_eq!(lees_tlv(&[0x30, 0x80, 0x00, 0x00]), Err(BerFout::OnbepaaldeLengte));
        assert_eq!(lees_tlv(&[0x1F, 0x01, 0x00]), Err(BerFout::HogeTag));
        assert_eq!(lees_tlv(&[0x04, 0x85, 1, 0, 0, 0, 0]), Err(BerFout::LengteTeGroot));
        assert_eq!(lees_tlv(&[0x04, 0x84, 0xFF, 0xFF, 0xFF, 0xFF]), Err(BerFout::Afgekapt));
    }

    #[test]
    fn der_blijft_ongewijzigd() {
        let der = fixture("cms-rsa-sha256.der");
        assert_eq!(normaliseer(&der).unwrap(), (der.clone(), der.len()));
    }

    #[test]
    fn onbepaalde_lengtes_worden_bepaald() {
        let ber = [0x30, 0x80, 0x02, 0x01, 0x05, 0x00, 0x00, 0xEE];
        assert_eq!(normaliseer(&ber).unwrap(), (vec![0x30, 0x03, 0x02, 0x01, 0x05], 7));
    }

    #[test]
    fn samengestelde_octet_string_wordt_primitief() {
        let ber = [0x24, 0x80, 0x04, 0x02, 0xAA, 0xBB, 0x04, 0x01, 0xCC, 0x00, 0x00];
        assert_eq!(normaliseer(&ber).unwrap(), (vec![0x04, 0x03, 0xAA, 0xBB, 0xCC], 11));
        let genest = [0x30, 0x80, 0xA0, 0x80, 0x24, 0x04, 0x04, 0x02, 0xAA, 0xBB, 0x00, 0x00, 0x00, 0x00];
        assert_eq!(
            normaliseer(&genest).unwrap(),
            (vec![0x30, 0x06, 0xA0, 0x04, 0x04, 0x02, 0xAA, 0xBB], 14)
        );
    }

    #[test]
    fn lengtes_krijgen_minimale_vorm() {
        assert_eq!(normaliseer(&[0x04, 0x82, 0x00, 0x03, 1, 2, 3]).unwrap(), (vec![0x04, 0x03, 1, 2, 3], 7));
        let mut ber = vec![0x30, 0x80, 0x04, 0x81, 0xC8];
        ber.extend(std::iter::repeat(7u8).take(200));
        ber.extend([0x00, 0x00]);
        let (der, gelezen) = normaliseer(&ber).unwrap();
        assert_eq!(gelezen, ber.len());
        assert_eq!(&der[..5], &[0x30, 0x81, 0xCB, 0x04, 0x81]);
        assert_eq!(der.len(), 3 + 203);
    }

    #[test]
    fn ber_fixture_wordt_geldige_der() {
        let ber = fixture("cms-rsa-ber.der");
        assert_eq!(&ber[..2], &[0x30, 0x80]);
        let (der, gelezen) = normaliseer(&ber).unwrap();
        assert!(gelezen <= ber.len());
        assert_eq!(&der[..2], &[0x30, 0x82]);
        let (_, rest) = lees_tlv(&der).unwrap();
        assert!(rest.is_empty());
        assert_eq!(normaliseer(&der).unwrap(), (der.clone(), der.len()));
    }

    #[test]
    fn rommel_geeft_fout_zonder_paniek() {
        let ber = fixture("cms-rsa-ber.der");
        for n in 0..ber.len() {
            assert!(normaliseer(&ber[..n]).is_err(), "afgekapt op {n} hoort te falen");
        }
        assert_eq!(normaliseer(&[0x04, 0x80, 0x00, 0x00]), Err(BerFout::OnbepaaldBijPrimitief));
        assert_eq!(
            normaliseer(&[0x24, 0x80, 0x02, 0x01, 0x00, 0x00, 0x00]),
            Err(BerFout::VreemdDeelInString)
        );
        assert_eq!(normaliseer(&[0x30, 0x03, 0x02, 0x05, 0x00]), Err(BerFout::Afgekapt));
    }

    #[test]
    fn te_diep_genest_wordt_geweigerd() {
        let mut b = Vec::new();
        for _ in 0..100 {
            b.extend([0x30, 0x80]);
        }
        b.extend(std::iter::repeat(0u8).take(200));
        assert_eq!(normaliseer(&b), Err(BerFout::TeDiep));
    }

    #[test]
    fn unix_tijd_volgt_de_kalender() {
        assert_eq!(unix_tijd(1970, 1, 1, 0, 0, 0), Some(0));
        assert_eq!(unix_tijd(2000, 3, 1, 0, 0, 0), Some(951_868_800));
        assert_eq!(unix_tijd(2016, 2, 29, 12, 0, 0), Some(1_456_747_200));
        assert_eq!(unix_tijd(1999, 12, 31, 23, 59, 59), Some(946_684_799));
        assert_eq!(unix_tijd(1950, 1, 1, 0, 0, 0), Some(-631_152_000));
        assert_eq!(unix_tijd(2020, 13, 1, 0, 0, 0), None);
        assert_eq!(unix_tijd(2020, 1, 32, 0, 0, 0), None);
    }

    #[test]
    fn asn1_tijden_met_fractie_en_offset() {
        assert_eq!(tijd_unix(0x17, b"160418114016Z"), Some(1_460_979_616));
        assert_eq!(tijd_unix(0x17, b"491231235959Z"), Some(2_524_607_999));
        assert_eq!(tijd_unix(0x17, b"500101000000Z"), Some(-631_152_000));
        assert_eq!(tijd_unix(0x18, b"20130508191615.82Z"), Some(1_368_040_575));
        assert_eq!(tijd_unix(0x18, b"20191205153402.572Z"), Some(1_575_560_042));
        assert_eq!(tijd_unix(0x18, b"20180901162846+0200"), Some(1_535_812_126));
        assert_eq!(tijd_unix(0x18, b"20180915221037"), None);
        assert_eq!(tijd_unix(0x18, b"2018091522103Z"), None);
        assert_eq!(tijd_unix(0x04, b"20180915221037Z"), None);
        assert_eq!(tijd_unix(0x18, &[0xFF, 0xFE]), None);
    }

    #[test]
    fn dagen_per_maand_en_schrikkeljaren() {
        assert!(unix_tijd(2020, 2, 29, 0, 0, 0).is_some());
        assert!(unix_tijd(2000, 2, 29, 0, 0, 0).is_some());
        assert_eq!(unix_tijd(2021, 2, 29, 0, 0, 0), None);
        assert_eq!(unix_tijd(1900, 2, 29, 0, 0, 0), None);
        assert_eq!(unix_tijd(2020, 2, 30, 0, 0, 0), None);
        assert_eq!(unix_tijd(2021, 4, 31, 0, 0, 0), None);
        assert!(unix_tijd(2021, 12, 31, 0, 0, 0).is_some());
        assert_eq!(unix_tijd(2021, 11, 31, 0, 0, 0), None);
        assert_eq!(unix_tijd(2021, 1, 0, 0, 0, 0), None);
        assert_eq!(tijd_unix(0x17, b"210229120000Z"), None);
        assert_eq!(tijd_unix(0x18, b"20240229120000Z"), Some(1_709_208_000));
    }

    #[test]
    fn fractie_zonder_cijfers_en_onmogelijke_offset_geweigerd() {
        assert_eq!(tijd_unix(0x18, b"20180915221037.Z"), None);
        assert_eq!(tijd_unix(0x18, b"20180915221037,Z"), None);
        assert_eq!(tijd_unix(0x18, b"20180901162846+2400"), None);
        assert_eq!(tijd_unix(0x18, b"20180901162846+0060"), None);
        assert_eq!(tijd_unix(0x18, b"20180901162846-9999"), None);
        assert!(tijd_unix(0x18, b"20180901162846+2359").is_some());
        assert!(tijd_unix(0x18, b"20180901162846-0000").is_some());
    }
}
