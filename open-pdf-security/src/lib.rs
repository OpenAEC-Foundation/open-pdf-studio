//! Het standaard beveiligingsmechanisme uit de PDF 2.0-norm (ISO 32000-2,
//! Standard Security Handler, V 5 / R 6, AES-256): een PDF beveiligen met een
//! wachtwoord, de beveiliging van een bestaand bestand lezen, en een bewerkte
//! (ontsleutelde) versie terugschrijven met DEZELFDE beveiliging.
//!
//! - Gebruikerswachtwoord ("openen"): zonder dat opent het bestand niet. Leeg =
//!   het bestand opent vrij en alleen de rechten gelden.
//! - Eigenaarwachtwoord ("rechten"): met dit wachtwoord gelden de beperkingen
//!   niet. Leeg = het wordt een willekeurig wachtwoord dat niemand kent.
//!
//! Terugschrijven met dezelfde beveiliging: bij revisie 5 en 6 is de
//! bestandssleutel willekeurig en staat ze, versleuteld onder elk van de twee
//! wachtwoorden, in /UE en /OE. Wie één van de wachtwoorden kent, haalt de
//! sleutel terug ([`Beveiliging::uit_bestand`]) en versleutelt de nieuwe inhoud
//! daarmee; /O, /U, /OE, /UE, /P en /Perms blijven precies zoals ze waren, dus
//! beide wachtwoorden en de rechten blijven gelden, ook het wachtwoord dat de
//! app nooit heeft gezien. Oudere methoden (RC4, AES-128) worden alleen
//! beschreven ([`lees_info`]), niet teruggeschreven.
//!
//! lopdf leest het bestand in (ook objectstromen: die worden losse objecten) en
//! schrijft het weer weg; hier worden alleen de tekenreeksen en streams
//! versleuteld en het /Encrypt-woordenboek toegevoegd. Wat lopdf niet kon
//! inlezen, wordt opgezocht of de opdracht wordt geweigerd: nooit stil een
//! kopie waarin iets ontbreekt (zie `laad_volledig`).
//!
//! Fouten gaan als vaste code naar de interface (`FOUT_*`), eventueel met een
//! toelichting na ": "; de JS vertaalt de code. Nooit met een wachtwoord erin.

use std::collections::{HashMap, HashSet};
use std::io::Write as _;

use aes::cipher::{BlockEncrypt, KeyInit as _};
use cbc::cipher::{block_padding::{NoPadding, Pkcs7}, BlockEncryptMut, KeyIvInit};
use lopdf::xref::XrefEntry;
use lopdf::{Dictionary, Document, Object, ObjectId, StringFormat};
use rand::RngCore;
use sha2::{Digest, Sha256, Sha384, Sha512};
use unicode_normalization::UnicodeNormalization;
use zeroize::{Zeroize, Zeroizing};

type Aes256CbcEnc = cbc::Encryptor<aes::Aes256>;
type Aes128CbcEnc = cbc::Encryptor<aes::Aes128>;

/// Geen enkel wachtwoord ingevuld.
pub const FOUT_GEEN_WACHTWOORD: &str = "NEED_PASSWORD";
/// De bron is al versleuteld.
pub const FOUT_AL_BEVEILIGD: &str = "ALREADY_ENCRYPTED";
/// De bron is niet te lezen (toelichting: de oorzaak).
pub const FOUT_LEZEN: &str = "READ_FAILED";
/// Niet alle objecten van de bron zijn in te lezen (toelichting: hoeveel).
pub const FOUT_ONVOLLEDIG: &str = "INCOMPLETE";
/// Het doel is niet te schrijven (toelichting: de oorzaak).
pub const FOUT_SCHRIJVEN: &str = "WRITE_FAILED";

/// Waarom beveiligen niet lukte.
#[derive(Debug, PartialEq, Eq)]
pub enum BeveiligFout {
    GeenWachtwoord,
    AlBeveiligd,
    Lezen(String),
    /// Object-id's uit de xref die niet in te lezen waren.
    Onvolledig(Vec<u32>),
    Schrijven(String),
}

impl BeveiligFout {
    /// De tekst die naar de interface gaat: een vaste code, eventueel met een
    /// toelichting. Bevat nooit een wachtwoord.
    pub fn code(&self) -> String {
        match self {
            BeveiligFout::GeenWachtwoord => FOUT_GEEN_WACHTWOORD.to_string(),
            BeveiligFout::AlBeveiligd => FOUT_AL_BEVEILIGD.to_string(),
            BeveiligFout::Lezen(t) => format!("{FOUT_LEZEN}: {t}"),
            BeveiligFout::Onvolledig(ids) => format!("{FOUT_ONVOLLEDIG}: {}", ids.len()),
            BeveiligFout::Schrijven(t) => format!("{FOUT_SCHRIJVEN}: {t}"),
        }
    }
}

/// Wat het ontvangende programma mag doen. Alles uit = alleen lezen.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Rechten {
    pub print: bool,
    pub print_hoge_kwaliteit: bool,
    pub wijzigen: bool,
    pub kopieren: bool,
    pub annoteren: bool,
    pub formulieren: bool,
    pub samenstellen: bool,
    pub toegankelijkheid: bool,
}

impl Default for Rechten {
    fn default() -> Self {
        Rechten {
            print: true,
            print_hoge_kwaliteit: true,
            wijzigen: true,
            kopieren: true,
            annoteren: true,
            formulieren: true,
            samenstellen: true,
            toegankelijkheid: true,
        }
    }
}

impl Rechten {
    /// De /P-waarde (ISO 32000-2, tabel 22): bits 7, 8 en 13-32 staan aan,
    /// bits 1 en 2 uit; de rest volgt de rechten.
    pub fn bits(&self) -> i32 {
        let mut p: u32 = 0xFFFF_F0C0;
        let mut zet = |aan: bool, bit: u32| {
            if aan {
                p |= 1 << (bit - 1);
            }
        };
        zet(self.print, 3);
        zet(self.wijzigen, 4);
        zet(self.kopieren, 5);
        zet(self.annoteren, 6);
        zet(self.formulieren, 9);
        zet(self.toegankelijkheid, 10);
        zet(self.samenstellen, 11);
        zet(self.print_hoge_kwaliteit, 12);
        p as i32
    }

    /// De rechten die een /P-waarde geeft (omgekeerde van [`Rechten::bits`]).
    pub fn uit_bits(p: i32) -> Rechten {
        let p = p as u32;
        let aan = |bit: u32| p & (1 << (bit - 1)) != 0;
        Rechten {
            print: aan(3),
            wijzigen: aan(4),
            kopieren: aan(5),
            annoteren: aan(6),
            formulieren: aan(9),
            toegankelijkheid: aan(10),
            samenstellen: aan(11),
            print_hoge_kwaliteit: aan(12),
        }
    }

    /// Geen enkele beperking.
    pub fn alles_toegestaan(&self) -> bool {
        *self == Rechten::default()
    }
}

// ─── Wachtwoorden ──────────────────────────────────────────────────────────

/// Langste wachtwoord dat revisie 6 gebruikt, in UTF-8-bytes.
pub const MAX_WACHTWOORD_BYTES: usize = 127;

/// Het wachtwoord zoals revisie 6 het gebruikt: de toewijzingsstap van SASLprep
/// (bijzondere spaties worden een gewone spatie, "onzichtbare" tekens vervallen)
/// en NFKC, daarna UTF-8, hoogstens 127 bytes. Net als pdf.js zonder de
/// verbodsregels van SASLprep: die weigerden gewone wachtwoorden (een emoji,
/// Hebreeuws of Arabisch met cijfers erachter), en geen lezer past ze toe bij
/// het openen. De dialoog weigert al wat deze stap zou veranderen, zodat het
/// wachtwoord zoals getypt overal werkt (ook in PDFium, dat niets voorbereidt).
pub fn bereid_wachtwoord(w: &str) -> Zeroizing<Vec<u8>> {
    let mut gemapt: Zeroizing<String> = Zeroizing::new(String::with_capacity(w.len() + 4));
    for c in w.chars() {
        if stringprep::tables::non_ascii_space_character(c) {
            gemapt.push(' ');
        } else if !stringprep::tables::commonly_mapped_to_nothing(c) {
            gemapt.push(c);
        }
    }
    let mut genormaliseerd: Zeroizing<String> = Zeroizing::new(String::with_capacity(gemapt.len() * 3 + 4));
    genormaliseerd.extend(gemapt.nfkc());
    let mut b: Zeroizing<Vec<u8>> = Zeroizing::new(Vec::with_capacity(genormaliseerd.len()));
    b.extend_from_slice(genormaliseerd.as_bytes());
    b.truncate(MAX_WACHTWOORD_BYTES);
    b
}

/// De vormen waarmee een bestaand bestand geopend wordt, in volgorde en zonder
/// dubbele: zoals getypt, zoals revisie 6 het voorschrijft (`bereid_wachtwoord`),
/// en zoals getypt maar afgekapt op 127 bytes. PDFium bereidt een wachtwoord
/// niet voor; zo opent toch wat een andere schrijver volgens de norm schreef.
pub fn wachtwoord_vormen(w: &str) -> Vec<Zeroizing<Vec<u8>>> {
    let mut vormen: Vec<Zeroizing<Vec<u8>>> = Vec::with_capacity(3);
    let mut voeg_toe = |v: Zeroizing<Vec<u8>>| {
        if !vormen.iter().any(|x| x.as_slice() == v.as_slice()) {
            vormen.push(v);
        }
    };
    voeg_toe(Zeroizing::new(w.as_bytes().to_vec()));
    voeg_toe(bereid_wachtwoord(w));
    let mut afgekapt = Zeroizing::new(w.as_bytes().to_vec());
    afgekapt.truncate(MAX_WACHTWOORD_BYTES);
    voeg_toe(afgekapt);
    vormen
}

// ─── Sleutels ──────────────────────────────────────────────────────────────

/// Algoritme 2.B (ISO 32000-2): de wachtwoordhash van revisie 6. Alle
/// tussenbuffers (K, K1 bevat het wachtwoord 64 keer, E) worden gewist.
fn hash_r6(wachtwoord: &[u8], zout: &[u8], udata: &[u8]) -> Zeroizing<[u8; 32]> {
    let mut k: Zeroizing<Vec<u8>> = Zeroizing::new({
        let mut h = Sha256::new();
        h.update(wachtwoord);
        h.update(zout);
        h.update(udata);
        h.finalize().to_vec()
    });
    let mut k1: Zeroizing<Vec<u8>> = Zeroizing::new(Vec::with_capacity((wachtwoord.len() + 64 + udata.len()) * 64));
    let mut i: usize = 0;
    loop {
        k1.clear();
        for _ in 0..64 {
            k1.extend_from_slice(wachtwoord);
            k1.extend_from_slice(&k);
            k1.extend_from_slice(udata);
        }
        let e: Zeroizing<Vec<u8>> = Zeroizing::new(
            Aes128CbcEnc::new_from_slices(&k[0..16], &k[16..32])
                .expect("sleutel en iv zijn 16 bytes")
                .encrypt_padded_vec_mut::<NoPadding>(&k1),
        );
        let modulo = e[..16].iter().map(|b| *b as u32).sum::<u32>() % 3;
        k.zeroize();
        *k = match modulo {
            0 => Sha256::digest(&e[..]).to_vec(),
            1 => Sha384::digest(&e[..]).to_vec(),
            _ => Sha512::digest(&e[..]).to_vec(),
        };
        let laatste = *e.last().expect("e is niet leeg") as usize;
        i += 1;
        if i >= 64 && laatste <= i - 32 {
            break;
        }
    }
    let mut uit = Zeroizing::new([0u8; 32]);
    uit.copy_from_slice(&k[..32]);
    uit
}

/// AES-256-CBC zonder opvulling, iv nul (voor UE en OE: één of twee blokken).
fn aes256_cbc_nul_iv(sleutel: &[u8; 32], data: &[u8]) -> Vec<u8> {
    Aes256CbcEnc::new_from_slices(sleutel, &[0u8; 16])
        .expect("sleutel is 32 bytes, iv 16")
        .encrypt_padded_vec_mut::<NoPadding>(data)
}

/// De bestandssleutel plus de waarden voor het /Encrypt-woordenboek. De
/// bestandssleutel wordt gewist zodra dit wegvalt, ook bij een fout.
struct Sleutels {
    bestand: [u8; 32],
    u: Vec<u8>,
    ue: Vec<u8>,
    o: Vec<u8>,
    oe: Vec<u8>,
    perms: Vec<u8>,
}

impl Drop for Sleutels {
    fn drop(&mut self) {
        self.bestand.zeroize();
    }
}

fn maak_sleutels(gebruiker: &str, eigenaar: &str, p: i32, rng: &mut impl RngCore) -> Sleutels {
    let mut s = Sleutels { bestand: [0u8; 32], u: Vec::new(), ue: Vec::new(), o: Vec::new(), oe: Vec::new(), perms: Vec::new() };
    rng.fill_bytes(&mut s.bestand);

    let gw = bereid_wachtwoord(gebruiker);
    let mut ew = bereid_wachtwoord(eigenaar);
    if ew.is_empty() {
        // Geen eigenaarwachtwoord: een willekeurig, onbekend wachtwoord, zodat
        // niemand de rechten met een leeg wachtwoord kan omzeilen. 32 willekeurige
        // bytes als hex (64 tekens, 256 bits).
        const HEX: &[u8; 16] = b"0123456789abcdef";
        let mut w = Zeroizing::new([0u8; 32]);
        rng.fill_bytes(&mut w[..]);
        for b in w.iter() {
            ew.push(HEX[(b >> 4) as usize]);
            ew.push(HEX[(b & 0x0f) as usize]);
        }
    }

    let mut u_val_zout = [0u8; 8];
    let mut u_sleutel_zout = [0u8; 8];
    rng.fill_bytes(&mut u_val_zout);
    rng.fill_bytes(&mut u_sleutel_zout);
    s.u = hash_r6(&gw, &u_val_zout, &[]).to_vec();
    s.u.extend_from_slice(&u_val_zout);
    s.u.extend_from_slice(&u_sleutel_zout);
    s.ue = aes256_cbc_nul_iv(&hash_r6(&gw, &u_sleutel_zout, &[]), &s.bestand);

    let mut o_val_zout = [0u8; 8];
    let mut o_sleutel_zout = [0u8; 8];
    rng.fill_bytes(&mut o_val_zout);
    rng.fill_bytes(&mut o_sleutel_zout);
    s.o = hash_r6(&ew, &o_val_zout, &s.u).to_vec();
    s.o.extend_from_slice(&o_val_zout);
    s.o.extend_from_slice(&o_sleutel_zout);
    s.oe = aes256_cbc_nul_iv(&hash_r6(&ew, &o_sleutel_zout, &s.u), &s.bestand);

    s.perms = maak_perms(&s.bestand, p, true, rng);
    s
}

// ─── Versleutelen ──────────────────────────────────────────────────────────

/// Eén tekenreeks of stream: AES-256-CBC met een willekeurige iv voorop, PKCS#7.
fn versleutel_bytes(sleutel: &[u8; 32], data: &[u8], rng: &mut impl RngCore) -> Vec<u8> {
    let mut iv = [0u8; 16];
    rng.fill_bytes(&mut iv);
    let versleuteld = Aes256CbcEnc::new_from_slices(sleutel, &iv)
        .expect("sleutel is 32 bytes, iv 16")
        .encrypt_padded_vec_mut::<Pkcs7>(data);
    let mut uit = Vec::with_capacity(16 + versleuteld.len());
    uit.extend_from_slice(&iv);
    uit.extend_from_slice(&versleuteld);
    uit
}

fn versleutel_object(obj: &mut Object, sleutel: &[u8; 32], rng: &mut impl RngCore) {
    match obj {
        Object::String(bytes, formaat) => {
            *bytes = versleutel_bytes(sleutel, bytes, rng);
            // Versleutelde bytes zijn willekeurig: hex is het veiligst om weg te schrijven.
            *formaat = StringFormat::Hexadecimal;
        }
        Object::Array(items) => {
            for item in items.iter_mut() {
                versleutel_object(item, sleutel, rng);
            }
        }
        Object::Dictionary(dict) => versleutel_woordenboek(dict, sleutel, rng),
        Object::Stream(stream) => {
            versleutel_woordenboek(&mut stream.dict, sleutel, rng);
            stream.content = versleutel_bytes(sleutel, &stream.content, rng);
            let lengte = stream.content.len() as i64;
            stream.dict.set("Length", lengte);
        }
        _ => {}
    }
}

/// Een handtekeningwoordenboek (/Type /Sig of /DocTimeStamp)?
fn is_handtekening(dict: &Dictionary) -> bool {
    matches!(dict.get(b"Type").and_then(Object::as_name), Ok(n) if n == b"Sig" || n == b"DocTimeStamp")
}

fn versleutel_woordenboek(dict: &mut Dictionary, sleutel: &[u8; 32], rng: &mut impl RngCore) {
    let handtekening = is_handtekening(dict);
    for (naam, waarde) in dict.iter_mut() {
        // ISO 32000-2, 7.6.2: de /Contents van een handtekeningwoordenboek
        // blijft onversleuteld (de lezers die handtekeningen controleren
        // ontsleutelen hem ook niet).
        if handtekening && naam.as_slice() == b"Contents" {
            continue;
        }
        versleutel_object(waarde, sleutel, rng);
    }
}

/// Het /Encrypt-woordenboek (V 5, R 6, AESV3).
fn encrypt_woordenboek(s: &Sleutels, p: i32) -> Dictionary {
    let mut std_cf = Dictionary::new();
    std_cf.set("AuthEvent", Object::Name(b"DocOpen".to_vec()));
    std_cf.set("CFM", Object::Name(b"AESV3".to_vec()));
    std_cf.set("Length", 32i64);
    let mut cf = Dictionary::new();
    cf.set("StdCF", Object::Dictionary(std_cf));

    let hex = |b: &[u8]| Object::String(b.to_vec(), StringFormat::Hexadecimal);
    let mut d = Dictionary::new();
    d.set("Filter", Object::Name(b"Standard".to_vec()));
    d.set("V", 5i64);
    d.set("R", 6i64);
    d.set("Length", 256i64);
    d.set("CF", Object::Dictionary(cf));
    d.set("StmF", Object::Name(b"StdCF".to_vec()));
    d.set("StrF", Object::Name(b"StdCF".to_vec()));
    d.set("O", hex(&s.o));
    d.set("U", hex(&s.u));
    d.set("OE", hex(&s.oe));
    d.set("UE", hex(&s.ue));
    d.set("Perms", hex(&s.perms));
    d.set("P", p as i64);
    d
}

// ─── Volledig inlezen ──────────────────────────────────────────────────────

/// Id's uit de xref (in gebruik, los of in een objectstroom) die lopdf niet als
/// object heeft ingelezen.
fn ontbrekende_ids(doc: &Document) -> Vec<u32> {
    let aanwezig: HashSet<u32> = doc.objects.keys().map(|(id, _)| *id).collect();
    let mut uit: Vec<u32> = doc
        .reference_table
        .entries
        .iter()
        .filter(|(id, e)| {
            **id != 0
                && matches!(e, XrefEntry::Normal { .. } | XrefEntry::Compressed { .. })
                && !aanwezig.contains(*id)
        })
        .map(|(id, _)| *id)
        .collect();
    uit.sort_unstable();
    uit
}

/// Alle kopregels "N G obj" aan het begin van een regel: id -> (plek, generatie).
/// Bij meer dan één telt de laatste (de nieuwste versie van het object).
fn objectkoppen(bytes: &[u8]) -> HashMap<u32, (usize, u16)> {
    let mut uit = HashMap::new();
    let mut i = 0;
    while i + 3 <= bytes.len() {
        let Some(rel) = bytes[i..].windows(3).position(|w| w == b"obj") else { break };
        let p = i + rel;
        i = p + 3;
        // Na "obj" een scheidingsteken (niet "objstm" o.i.d.).
        if let Some(&na) = bytes.get(p + 3) {
            if !(na.is_ascii_whitespace() || b"<[(/%".contains(&na)) {
                continue;
            }
        }
        // Terug: witruimte, generatie, witruimte, nummer.
        let mut j = p;
        let tel_wit = |j: &mut usize| { let b = *j; while *j > 0 && bytes[*j - 1].is_ascii_whitespace() { *j -= 1; } b - *j };
        let tel_cijfers = |j: &mut usize| { let b = *j; while *j > 0 && bytes[*j - 1].is_ascii_digit() { *j -= 1; } b - *j };
        if tel_wit(&mut j) == 0 { continue; }
        let gen_eind = j;
        if tel_cijfers(&mut j) == 0 { continue; }
        let gen_begin = j;
        if tel_wit(&mut j) == 0 { continue; }
        let nr_eind = j;
        if tel_cijfers(&mut j) == 0 { continue; }
        let nr_begin = j;
        // Alleen aan het begin van een regel: minder kans op schijntreffers in
        // binaire streams.
        if nr_begin > 0 && bytes[nr_begin - 1] != b'\n' && bytes[nr_begin - 1] != b'\r' {
            continue;
        }
        let (Ok(nr), Ok(gen)) = (
            std::str::from_utf8(&bytes[nr_begin..nr_eind]).unwrap_or("").parse::<u32>(),
            std::str::from_utf8(&bytes[gen_begin..gen_eind]).unwrap_or("").parse::<u16>(),
        ) else { continue };
        uit.insert(nr, (nr_begin, gen));
    }
    uit
}

/// Een trailerwaarde als PDF-tekst (alleen wat in een trailer voorkomt).
fn trailer_waarde(o: &Object) -> Option<String> {
    match o {
        Object::Reference((id, gen)) => Some(format!("{id} {gen} R")),
        Object::Integer(i) => Some(i.to_string()),
        Object::String(b, _) => Some(format!("<{}>", b.iter().map(|x| format!("{x:02X}")).collect::<String>())),
        Object::Array(a) => {
            let delen: Option<Vec<String>> = a.iter().map(trailer_waarde).collect();
            delen.map(|d| format!("[{}]", d.join(" ")))
        }
        _ => None,
    }
}

/// `bytes` met een extra xref-doorsnede die de gegeven objecten naar hun
/// werkelijke plek laat wijzen (een gewone incrementele update).
fn met_herstelde_xref(bytes: &[u8], doc: &Document, herstel: &[(u32, usize, u16)]) -> Result<Vec<u8>, BeveiligFout> {
    let root = doc.trailer.get(b"Root").ok().and_then(trailer_waarde)
        .ok_or_else(|| BeveiligFout::Lezen("no /Root in the trailer".into()))?;
    let mut uit = Vec::with_capacity(bytes.len() + 64 + herstel.len() * 32);
    uit.extend_from_slice(bytes);
    if !uit.ends_with(b"\n") {
        uit.push(b'\n');
    }
    let begin = uit.len();
    let grootte = herstel.iter().map(|(id, _, _)| id + 1).max().unwrap_or(0).max(doc.max_id + 1);
    let fout = |e: std::io::Error| BeveiligFout::Lezen(e.to_string());
    write!(uit, "xref\n").map_err(fout)?;
    for (id, plek, gen) in herstel {
        // Elke regel precies 20 bytes.
        write!(uit, "{id} 1\n{plek:010} {gen:05} n\r\n").map_err(fout)?;
    }
    write!(uit, "trailer\n<</Size {grootte} /Root {root}").map_err(fout)?;
    for sleutel in ["Info", "ID"] {
        if let Some(w) = doc.trailer.get(sleutel.as_bytes()).ok().and_then(trailer_waarde) {
            write!(uit, " /{sleutel} {w}").map_err(fout)?;
        }
    }
    write!(uit, " /Prev {}>>\nstartxref\n{begin}\n%%EOF\n", doc.xref_start).map_err(fout)?;
    Ok(uit)
}

/// Leest de PDF met lopdf en zorgt dat er geen object ontbreekt.
///
/// lopdf (0.34, en ook nieuwere versies) rekent de PNG-voorspeller "Average"
/// verkeerd uit (`a + b / 2` i.p.v. `(a + b) / 2`). In een xref-stream met zo'n
/// rij wijst het item dan naar een verkeerde plek en ontbreekt het object stil
/// in het document; de beveiligde kopie verloor zo bv. annotatieweergaven.
/// Daarom: ontbrekende objecten opzoeken op hun kopregel, het bestand opnieuw
/// laten lezen met een extra xref-doorsnede die naar die plek wijst, en weigeren
/// als er daarna nog iets ontbreekt.
fn laad_volledig(bytes: &[u8]) -> Result<Document, BeveiligFout> {
    let doc = Document::load_mem(bytes).map_err(|e| BeveiligFout::Lezen(e.to_string()))?;
    let ontbrekend = ontbrekende_ids(&doc);
    if ontbrekend.is_empty() {
        return Ok(doc);
    }
    // Een al versleuteld bestand gaat niet verder; hier niet herstellen.
    if doc.trailer.get(b"Encrypt").is_ok() {
        return Ok(doc);
    }
    let koppen = objectkoppen(bytes);
    let herstel: Vec<(u32, usize, u16)> = ontbrekend
        .iter()
        .filter_map(|id| koppen.get(id).map(|(plek, gen)| (*id, *plek, *gen)))
        .collect();
    if herstel.is_empty() {
        return Err(BeveiligFout::Onvolledig(ontbrekend));
    }
    let aangevuld = met_herstelde_xref(bytes, &doc, &herstel)?;
    let doc = Document::load_mem(&aangevuld).map_err(|e| BeveiligFout::Lezen(e.to_string()))?;
    let nog = ontbrekende_ids(&doc);
    if !nog.is_empty() {
        return Err(BeveiligFout::Onvolledig(nog));
    }
    Ok(doc)
}

// ─── De beveiliging van een bestaand bestand ───────────────────────────────

/// Foutcode: geen van de wachtwoordvormen klopt.
pub const FOUT_VERKEERD_WACHTWOORD: &str = "WRONG_PASSWORD";
/// Foutcode: het bestand is niet versleuteld.
pub const FOUT_NIET_VERSLEUTELD: &str = "NOT_ENCRYPTED";
/// Foutcode: een oudere methode dan AES-256, die alleen beschreven wordt.
pub const FOUT_NIET_ONDERSTEUND: &str = "UNSUPPORTED_SECURITY";

/// Waarom de beveiliging van een bestand niet over te nemen is.
#[derive(Debug, PartialEq, Eq)]
pub enum OpenFout {
    /// Geen van de wachtwoordvormen klopt.
    VerkeerdWachtwoord,
    /// Het bestand is niet versleuteld.
    NietVersleuteld,
    /// Een andere methode dan AES-256 (revisie 5 of 6): wel beschreven, niet
    /// terug te schrijven.
    NietOndersteund(Info),
    /// Het bestand of zijn /Encrypt-woordenboek is niet te lezen.
    Lezen(String),
}

impl OpenFout {
    /// De tekst die naar de interface gaat. Bevat nooit een wachtwoord.
    pub fn code(&self) -> String {
        match self {
            OpenFout::VerkeerdWachtwoord => FOUT_VERKEERD_WACHTWOORD.to_string(),
            OpenFout::NietVersleuteld => FOUT_NIET_VERSLEUTELD.to_string(),
            OpenFout::NietOndersteund(i) => format!("{FOUT_NIET_ONDERSTEUND}: {}", i.methode),
            OpenFout::Lezen(t) => format!("{FOUT_LEZEN}: {t}"),
        }
    }
}

/// Wat een versleuteld bestand over zijn beveiliging zegt.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Info {
    /// "AES-256", "AES-128", "RC4 128-bit", "RC4 40-bit", of de naam van een
    /// ander beveiligingsfilter.
    pub methode: String,
    /// /Filter ("Standard" voor wachtwoordbeveiliging).
    pub filter: String,
    pub v: i64,
    pub r: i64,
    /// Sleutellengte in bits.
    pub lengte: i64,
    /// /P: de rechten als bits.
    pub p: i32,
    pub rechten: Rechten,
    pub versleutelt_metadata: bool,
}

fn encrypt_woordenboek_van(doc: &Document) -> Option<Dictionary> {
    match doc.trailer.get(b"Encrypt").ok()? {
        Object::Reference(id) => doc.get_dictionary(*id).ok().cloned(),
        Object::Dictionary(d) => Some(d.clone()),
        _ => None,
    }
}

fn getal(d: &Dictionary, k: &[u8]) -> Option<i64> {
    d.get(k).ok().and_then(|o| o.as_i64().ok())
}

fn naam_van(d: &Dictionary, k: &[u8]) -> Option<Vec<u8>> {
    d.get(k).ok().and_then(|o| o.as_name().ok()).map(|n| n.to_vec())
}

fn tekenreeks(d: &Dictionary, k: &[u8]) -> Option<Vec<u8>> {
    d.get(k).ok().and_then(|o| o.as_str().ok()).map(|b| b.to_vec())
}

/// De /CFM van het crypt filter dat `filter_sleutel` (/StmF of /StrF) noemt;
/// "Identity" (of geen) = geen versleuteling.
fn cfm(d: &Dictionary, filter_sleutel: &[u8]) -> Option<Vec<u8>> {
    let naam = naam_van(d, filter_sleutel).unwrap_or_else(|| b"Identity".to_vec());
    if naam == b"Identity" {
        return Some(b"None".to_vec());
    }
    let cf = d.get(b"CF").ok()?.as_dict().ok()?;
    let f = cf.get(&naam).ok()?.as_dict().ok()?;
    naam_van(f, b"CFM")
}

fn info_uit(d: &Dictionary) -> Info {
    let filter = naam_van(d, b"Filter").map(|n| String::from_utf8_lossy(&n).into_owned()).unwrap_or_default();
    let v = getal(d, b"V").unwrap_or(0);
    let r = getal(d, b"R").unwrap_or(0);
    // /P is een 32-bits getal; sommige schrijvers zetten het positief neer.
    let p = getal(d, b"P").unwrap_or(0) as i32;
    let mut lengte = getal(d, b"Length").unwrap_or(0);
    let methode = if filter != "Standard" {
        filter.clone()
    } else {
        match v {
            5 => {
                lengte = 256;
                "AES-256".to_string()
            }
            4 => match cfm(d, b"StmF").or_else(|| cfm(d, b"StrF")).as_deref() {
                Some(b"AESV2") => {
                    lengte = 128;
                    "AES-128".to_string()
                }
                Some(b"AESV3") => {
                    lengte = 256;
                    "AES-256".to_string()
                }
                _ => {
                    lengte = 128;
                    "RC4 128-bit".to_string()
                }
            },
            1 => {
                lengte = 40;
                "RC4 40-bit".to_string()
            }
            2 | 3 => {
                if lengte <= 0 {
                    lengte = 40;
                }
                format!("RC4 {lengte}-bit")
            }
            _ => format!("V {v}"),
        }
    };
    Info {
        methode,
        filter,
        v,
        r,
        lengte,
        p,
        rechten: Rechten::uit_bits(p),
        versleutelt_metadata: d.get(b"EncryptMetadata").ok().and_then(|o| o.as_bool().ok()).unwrap_or(true),
    }
}

/// De beveiliging van een PDF, of `None` als het bestand niet versleuteld is.
/// Leest alleen; een wachtwoord is niet nodig.
pub fn lees_info(bytes: &[u8]) -> Result<Option<Info>, OpenFout> {
    let doc = Document::load_mem(bytes).map_err(|e| OpenFout::Lezen(e.to_string()))?;
    Ok(encrypt_woordenboek_van(&doc).map(|d| info_uit(&d)))
}

/// De wachtwoordhash van revisie 5 (één SHA-256) of 6 (algoritme 2.B).
fn wachtwoord_hash(r: i64, wachtwoord: &[u8], zout: &[u8], udata: &[u8]) -> Zeroizing<[u8; 32]> {
    if r == 5 {
        let mut h = Sha256::new();
        h.update(wachtwoord);
        h.update(zout);
        h.update(udata);
        let mut uit = Zeroizing::new([0u8; 32]);
        uit.copy_from_slice(&h.finalize());
        uit
    } else {
        hash_r6(wachtwoord, zout, udata)
    }
}

/// Vergelijkt zonder vroeg te stoppen.
fn gelijk(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// /UE of /OE ontsleutelen: AES-256-CBC, iv nul, geen opvulling.
fn bestandssleutel_uit(tussensleutel: &[u8; 32], versleuteld: &[u8]) -> Result<Zeroizing<[u8; 32]>, OpenFout> {
    use cbc::cipher::BlockDecryptMut;
    let terug: Zeroizing<Vec<u8>> = Zeroizing::new(
        cbc::Decryptor::<aes::Aes256>::new_from_slices(tussensleutel, &[0u8; 16])
            .map_err(|e| OpenFout::Lezen(e.to_string()))?
            .decrypt_padded_vec_mut::<NoPadding>(versleuteld)
            .map_err(|_| OpenFout::Lezen("invalid /UE or /OE".into()))?,
    );
    if terug.len() != 32 {
        return Err(OpenFout::Lezen("invalid /UE or /OE".into()));
    }
    let mut uit = Zeroizing::new([0u8; 32]);
    uit.copy_from_slice(&terug);
    Ok(uit)
}

/// /Perms (ISO 32000-2, algoritme 10): P (4 bytes, little endian), 0xFFFFFFFF,
/// 'T' of 'F' (metadata versleuteld), "adb" en vier willekeurige bytes, met
/// AES-256-ECB onder de bestandssleutel.
fn maak_perms(sleutel: &[u8; 32], p: i32, metadata: bool, rng: &mut impl RngCore) -> Vec<u8> {
    let mut blok = Zeroizing::new([0u8; 16]);
    blok[0..4].copy_from_slice(&p.to_le_bytes());
    blok[4..8].copy_from_slice(&[0xFF; 4]);
    blok[8] = if metadata { b'T' } else { b'F' };
    blok[9..12].copy_from_slice(b"adb");
    rng.fill_bytes(&mut blok[12..16]);
    let aes = aes::Aes256::new_from_slice(sleutel).expect("sleutel is 32 bytes");
    let mut b = aes::cipher::generic_array::GenericArray::clone_from_slice(&blok[..]);
    aes.encrypt_block(&mut b);
    b.to_vec()
}

/// Een beveiliging die de app kan schrijven: de bestandssleutel en het
/// /Encrypt-woordenboek dat erbij hoort. Nieuw ([`Beveiliging::nieuw`]) of
/// overgenomen uit een bestaand bestand ([`Beveiliging::uit_bestand`]); dan
/// blijven beide wachtwoorden en de rechten van dat bestand gelden.
#[derive(Clone)]
pub struct Beveiliging {
    encrypt: Dictionary,
    sleutel: Zeroizing<[u8; 32]>,
    p: i32,
    r: i64,
    eigenaar: bool,
    open_wachtwoord: bool,
    versleutelt_metadata: bool,
}

impl std::fmt::Debug for Beveiliging {
    // Zonder de sleutel.
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Beveiliging")
            .field("r", &self.r)
            .field("p", &self.p)
            .field("eigenaar", &self.eigenaar)
            .field("open_wachtwoord", &self.open_wachtwoord)
            .finish_non_exhaustive()
    }
}

impl Beveiliging {
    /// Nieuwe wachtwoorden en rechten (revisie 6). Wie ze instelt, heeft
    /// eigenaarstoegang.
    pub fn nieuw(gebruikerswachtwoord: &str, eigenaarwachtwoord: &str, rechten: &Rechten) -> Result<Self, BeveiligFout> {
        if gebruikerswachtwoord.is_empty() && eigenaarwachtwoord.is_empty() {
            return Err(BeveiligFout::GeenWachtwoord);
        }
        let mut rng = rand::rngs::OsRng;
        let p = rechten.bits();
        let s = maak_sleutels(gebruikerswachtwoord, eigenaarwachtwoord, p, &mut rng);
        Ok(Beveiliging {
            encrypt: encrypt_woordenboek(&s, p),
            sleutel: Zeroizing::new(s.bestand),
            p,
            r: 6,
            eigenaar: true,
            open_wachtwoord: !bereid_wachtwoord(gebruikerswachtwoord).is_empty(),
            versleutelt_metadata: true,
        })
    }

    /// De beveiliging van een versleuteld bestand, ontgrendeld met
    /// `wachtwoord` (het open- of het rechtenwachtwoord; leeg als het bestand
    /// zonder wachtwoord opent). Alleen AES-256 (revisie 5 en 6).
    pub fn uit_bestand(bytes: &[u8], wachtwoord: &str) -> Result<Self, OpenFout> {
        let doc = Document::load_mem(bytes).map_err(|e| OpenFout::Lezen(e.to_string()))?;
        Self::uit_document(&doc, wachtwoord)
    }

    /// Zie [`Beveiliging::uit_bestand`].
    pub fn uit_document(doc: &Document, wachtwoord: &str) -> Result<Self, OpenFout> {
        let d = encrypt_woordenboek_van(doc).ok_or(OpenFout::NietVersleuteld)?;
        let info = info_uit(&d);
        let r = info.r;
        let ondersteund = info.filter == "Standard"
            && info.v == 5
            && (r == 5 || r == 6)
            && cfm(&d, b"StmF").as_deref() == Some(b"AESV3")
            && cfm(&d, b"StrF").as_deref() == Some(b"AESV3");
        if !ondersteund {
            return Err(OpenFout::NietOndersteund(info));
        }
        let ongeldig = || OpenFout::Lezen("invalid /Encrypt dictionary".into());
        let o = tekenreeks(&d, b"O").filter(|b| b.len() >= 48).ok_or_else(ongeldig)?;
        let u = tekenreeks(&d, b"U").filter(|b| b.len() >= 48).ok_or_else(ongeldig)?;
        let oe = tekenreeks(&d, b"OE").filter(|b| b.len() == 32).ok_or_else(ongeldig)?;
        let ue = tekenreeks(&d, b"UE").filter(|b| b.len() == 32).ok_or_else(ongeldig)?;
        let (o, u) = (&o[..48], &u[..48]);
        let open_wachtwoord = !gelijk(wachtwoord_hash(r, b"", &u[32..40], &[]).as_slice(), &u[..32]);

        for vorm in wachtwoord_vormen(wachtwoord) {
            // Eerst het rechtenwachtwoord: dat geeft volledige toegang.
            let (eigenaar, sleutel) = if gelijk(wachtwoord_hash(r, &vorm, &o[32..40], u).as_slice(), &o[..32]) {
                (true, bestandssleutel_uit(&wachtwoord_hash(r, &vorm, &o[40..48], u), &oe)?)
            } else if gelijk(wachtwoord_hash(r, &vorm, &u[32..40], &[]).as_slice(), &u[..32]) {
                (false, bestandssleutel_uit(&wachtwoord_hash(r, &vorm, &u[40..48], &[]), &ue)?)
            } else {
                continue;
            };
            return Ok(Beveiliging {
                p: info.p,
                r,
                eigenaar,
                open_wachtwoord,
                versleutelt_metadata: info.versleutelt_metadata,
                encrypt: d,
                sleutel,
            });
        }
        Err(OpenFout::VerkeerdWachtwoord)
    }

    /// Geeft eigenaarstoegang als `wachtwoord` het rechtenwachtwoord is.
    pub fn ontgrendel_eigenaar(&mut self, wachtwoord: &str) -> bool {
        let (Some(o), Some(u)) = (tekenreeks(&self.encrypt, b"O"), tekenreeks(&self.encrypt, b"U")) else {
            return false;
        };
        if o.len() < 48 || u.len() < 48 {
            return false;
        }
        let (o, u) = (&o[..48], &u[..48]);
        for vorm in wachtwoord_vormen(wachtwoord) {
            if gelijk(wachtwoord_hash(self.r, &vorm, &o[32..40], u).as_slice(), &o[..32]) {
                self.eigenaar = true;
                return true;
            }
        }
        false
    }

    /// Dezelfde sleutel en wachtwoorden met andere rechten: alleen /P en
    /// /Perms veranderen (bij revisie 5 en 6 hangen /O en /U niet van P af).
    pub fn met_rechten(&self, rechten: &Rechten) -> Beveiliging {
        let mut rng = rand::rngs::OsRng;
        let p = rechten.bits();
        let mut encrypt = self.encrypt.clone();
        encrypt.set("P", p as i64);
        let perms = maak_perms(&self.sleutel, p, self.versleutelt_metadata, &mut rng);
        encrypt.set("Perms", Object::String(perms, StringFormat::Hexadecimal));
        Beveiliging {
            encrypt,
            sleutel: self.sleutel.clone(),
            p,
            r: self.r,
            eigenaar: self.eigenaar,
            open_wachtwoord: self.open_wachtwoord,
            versleutelt_metadata: self.versleutelt_metadata,
        }
    }

    /// Ontgrendeld met het rechtenwachtwoord (of zelf ingesteld).
    pub fn eigenaar_toegang(&self) -> bool {
        self.eigenaar
    }

    /// Mag deze gebruiker de beveiliging wijzigen of verwijderen? Met het
    /// rechtenwachtwoord altijd; met alleen het openwachtwoord als het bestand
    /// geen enkele beperking heeft (dan beschermt het rechtenwachtwoord niets).
    pub fn mag_wijzigen(&self) -> bool {
        self.eigenaar || self.rechten().alles_toegestaan()
    }

    /// Opent het bestand alleen met een wachtwoord?
    pub fn open_wachtwoord(&self) -> bool {
        self.open_wachtwoord
    }

    pub fn p(&self) -> i32 {
        self.p
    }

    pub fn rechten(&self) -> Rechten {
        Rechten::uit_bits(self.p)
    }

    pub fn revisie(&self) -> i64 {
        self.r
    }

    pub fn info(&self) -> Info {
        info_uit(&self.encrypt)
    }

    /// Het /Encrypt-woordenboek zoals het in het bestand komt.
    pub fn encrypt_woordenboek(&self) -> &Dictionary {
        &self.encrypt
    }
}

// ─── Schrijven ─────────────────────────────────────────────────────────────

fn stream_type(obj: &Object, t: &[u8]) -> bool {
    matches!(obj, Object::Stream(s) if matches!(s.dict.get(b"Type").and_then(Object::as_name), Ok(n) if n == t))
}

fn is_metadata(obj: &Object) -> bool {
    stream_type(obj, b"Metadata")
}

/// Een xref-stream wordt nooit versleuteld (ISO 32000-2, 7.6.2).
fn is_xref(obj: &Object) -> bool {
    stream_type(obj, b"XRef")
}

/// Versleutelt `bytes` (een niet-beveiligde PDF) met `beveiliging`.
pub fn versleutel(bytes: &[u8], beveiliging: &Beveiliging) -> Result<Vec<u8>, BeveiligFout> {
    let mut doc = laad_volledig(bytes)?;
    // Ook een /Encrypt dat direct in de trailer staat: is_encrypted() van lopdf
    // ziet alleen een verwijzing, en dan zou het bestand dubbel versleuteld worden.
    if doc.trailer.get(b"Encrypt").is_ok() {
        return Err(BeveiligFout::AlBeveiligd);
    }
    let mut rng = rand::rngs::OsRng;

    let ids: Vec<ObjectId> = doc.objects.keys().copied().collect();
    for id in ids {
        if let Some(obj) = doc.objects.get_mut(&id) {
            // /EncryptMetadata false: de XMP-metadata blijft leesbaar.
            if is_xref(obj) || (!beveiliging.versleutelt_metadata && is_metadata(obj)) {
                continue;
            }
            versleutel_object(obj, &beveiliging.sleutel, &mut rng);
        }
    }

    let encrypt_id = doc.add_object(Object::Dictionary(beveiliging.encrypt.clone()));
    doc.trailer.set("Encrypt", Object::Reference(encrypt_id));
    if doc.trailer.get(b"ID").is_err() {
        let mut id = [0u8; 16];
        rng.fill_bytes(&mut id);
        let s = Object::String(id.to_vec(), StringFormat::Hexadecimal);
        doc.trailer.set("ID", Object::Array(vec![s.clone(), s]));
    }
    // Revisie 6 hoort bij PDF 2.0; revisie 5 bij een uitbreiding op 1.7.
    doc.version = if beveiliging.r == 6 { "2.0".into() } else { "1.7".into() };

    // lopdf schrijft het hele bestand in één doorsnede opnieuw. Een /Prev of
    // /XRefStm uit de trailer van de bron (incrementele update, gelineariseerd
    // bestand) wijst daarin naar een plek die niet meer bestaat.
    doc.trailer.remove(b"Prev");
    doc.trailer.remove(b"XRefStm");

    let mut uit = Vec::with_capacity(bytes.len() + 4096);
    doc.save_to(&mut uit).map_err(|e| BeveiligFout::Schrijven(e.to_string()))?;
    Ok(uit)
}

/// Versleutelt `bytes` (een niet-beveiligde PDF) met de gegeven wachtwoorden.
pub fn beveilig_pdf(
    bytes: &[u8],
    gebruikerswachtwoord: &str,
    eigenaarwachtwoord: &str,
    rechten: &Rechten,
) -> Result<Vec<u8>, BeveiligFout> {
    let beveiliging = Beveiliging::nieuw(gebruikerswachtwoord, eigenaarwachtwoord, rechten)?;
    versleutel(bytes, &beveiliging)
}

// ─── Ontsleutelen (AES-256) ────────────────────────────────────────────────

fn ontsleutel_bytes(sleutel: &[u8; 32], data: &[u8]) -> Result<Vec<u8>, OpenFout> {
    use cbc::cipher::BlockDecryptMut;
    // Korter dan een iv: leeg (ISO 32000-2, 7.6.3).
    if data.len() < 16 {
        return Ok(Vec::new());
    }
    let (iv, rest) = data.split_at(16);
    if rest.is_empty() {
        return Ok(Vec::new());
    }
    cbc::Decryptor::<aes::Aes256>::new_from_slices(sleutel, iv)
        .map_err(|e| OpenFout::Lezen(e.to_string()))?
        .decrypt_padded_vec_mut::<Pkcs7>(rest)
        .map_err(|_| OpenFout::Lezen("invalid AES padding".into()))
}

fn ontsleutel_object(obj: &mut Object, sleutel: &[u8; 32]) -> Result<(), OpenFout> {
    match obj {
        Object::String(bytes, _) => *bytes = ontsleutel_bytes(sleutel, bytes)?,
        Object::Array(items) => {
            for item in items.iter_mut() {
                ontsleutel_object(item, sleutel)?;
            }
        }
        Object::Dictionary(dict) => ontsleutel_woordenboek(dict, sleutel)?,
        Object::Stream(stream) => {
            ontsleutel_woordenboek(&mut stream.dict, sleutel)?;
            stream.content = ontsleutel_bytes(sleutel, &stream.content)?;
            let lengte = stream.content.len() as i64;
            stream.dict.set("Length", lengte);
        }
        _ => {}
    }
    Ok(())
}

fn ontsleutel_woordenboek(dict: &mut Dictionary, sleutel: &[u8; 32]) -> Result<(), OpenFout> {
    let handtekening = is_handtekening(dict);
    for (naam, waarde) in dict.iter_mut() {
        if handtekening && naam.as_slice() == b"Contents" {
            continue;
        }
        ontsleutel_object(waarde, sleutel)?;
    }
    Ok(())
}

/// Ontsleutelt een AES-256-bestand (revisie 5 of 6) met `wachtwoord` en geeft
/// het zonder beveiliging terug. De app ontsleutelt met PDFium; dit is voor de
/// proeven en de opdrachtregel. Objectstromen in de bron worden niet gelezen.
pub fn ontsleutel(bytes: &[u8], wachtwoord: &str) -> Result<Vec<u8>, OpenFout> {
    let mut doc = Document::load_mem(bytes).map_err(|e| OpenFout::Lezen(e.to_string()))?;
    let b = Beveiliging::uit_document(&doc, wachtwoord)?;
    let encrypt_id = doc.trailer.get(b"Encrypt").ok().and_then(|o| o.as_reference().ok());
    for (id, obj) in doc.objects.iter_mut() {
        if Some(*id) == encrypt_id {
            continue;
        }
        if is_xref(obj) || (!b.versleutelt_metadata && is_metadata(obj)) {
            continue;
        }
        ontsleutel_object(obj, &b.sleutel)?;
    }
    doc.trailer.remove(b"Encrypt");
    if let Some(id) = encrypt_id {
        doc.objects.remove(&id);
    }
    let mut uit = Vec::with_capacity(bytes.len());
    doc.save_to(&mut uit).map_err(|e| OpenFout::Lezen(e.to_string()))?;
    Ok(uit)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rechten_bits_alles_aan_is_de_standaardwaarde() {
        assert_eq!(Rechten::default().bits() as u32, 0xFFFF_FFFC);
    }

    #[test]
    fn rechten_bits_alleen_lezen() {
        let r = Rechten {
            print: false, print_hoge_kwaliteit: false, wijzigen: false, kopieren: false,
            annoteren: false, formulieren: false, samenstellen: false, toegankelijkheid: false,
        };
        assert_eq!(r.bits() as u32, 0xFFFF_F0C0);
        let alleen_print = Rechten { print: true, ..r };
        assert_eq!(alleen_print.bits() as u32 & 0x4, 0x4);
    }

    #[test]
    fn hash_r6_is_deterministisch_en_32_bytes() {
        let a = hash_r6(b"geheim", b"zoutzout", &[]);
        let b = hash_r6(b"geheim", b"zoutzout", &[]);
        let c = hash_r6(b"ander", b"zoutzout", &[]);
        assert_eq!(*a, *b);
        assert_ne!(*a, *c);
    }

    use cbc::cipher::BlockDecryptMut;
    use lopdf::dictionary;

    fn aes256_cbc_nul_iv_terug(sleutel: &[u8; 32], data: &[u8]) -> Vec<u8> {
        cbc::Decryptor::<aes::Aes256>::new_from_slices(sleutel, &[0u8; 16])
            .unwrap()
            .decrypt_padded_vec_mut::<NoPadding>(data)
            .unwrap()
    }

    #[test]
    fn gebruikers_en_eigenaarsleutel_geven_dezelfde_bestandssleutel_terug() {
        let mut rng = rand::rngs::OsRng;
        let s = maak_sleutels("open-ww", "rechten-ww", Rechten::default().bits(), &mut rng);
        // Gebruiker: U = hash(ww, validatiezout) + validatiezout + sleutelzout.
        let (u_hash, u_zouten) = s.u.split_at(32);
        assert_eq!(s.u.len(), 48);
        assert_eq!(hash_r6(b"open-ww", &u_zouten[..8], &[]).as_slice(), u_hash);
        let ue_sleutel = hash_r6(b"open-ww", &u_zouten[8..16], &[]);
        assert_eq!(aes256_cbc_nul_iv_terug(&ue_sleutel, &s.ue), s.bestand.to_vec());
        // Een verkeerd wachtwoord valideert niet.
        assert_ne!(hash_r6(b"fout", &u_zouten[..8], &[]).as_slice(), u_hash);
        // Eigenaar: dezelfde sleutel, met U als extra invoer.
        let (o_hash, o_zouten) = s.o.split_at(32);
        assert_eq!(hash_r6(b"rechten-ww", &o_zouten[..8], &s.u).as_slice(), o_hash);
        let oe_sleutel = hash_r6(b"rechten-ww", &o_zouten[8..16], &s.u);
        assert_eq!(aes256_cbc_nul_iv_terug(&oe_sleutel, &s.oe), s.bestand.to_vec());
    }

    #[test]
    fn perms_bevat_p_en_de_vaste_tekens() {
        use aes::cipher::BlockDecrypt;
        let mut rng = rand::rngs::OsRng;
        let p = Rechten { print: false, ..Rechten::default() }.bits();
        let s = maak_sleutels("a1b2c3", "", p, &mut rng);
        let aes = aes::Aes256::new_from_slice(&s.bestand).unwrap();
        let mut blok = aes::cipher::generic_array::GenericArray::clone_from_slice(&s.perms);
        aes.decrypt_block(&mut blok);
        assert_eq!(&blok[0..4], &p.to_le_bytes());
        assert_eq!(&blok[4..8], &[0xFF; 4]);
        assert_eq!(blok[8], b'T');
        assert_eq!(&blok[9..12], b"adb");
    }

    #[test]
    fn zonder_eigenaarwachtwoord_is_het_eigenaarwachtwoord_onbekend_maar_geldig() {
        let mut rng = rand::rngs::OsRng;
        let s = maak_sleutels("a1b2c3", "", Rechten::default().bits(), &mut rng);
        // Het lege wachtwoord opent de eigenaarssleutel niet.
        let (o_hash, o_zouten) = s.o.split_at(32);
        assert_ne!(hash_r6(b"", &o_zouten[..8], &s.u).as_slice(), o_hash);
    }

    #[test]
    fn voorbereiden_maakt_gecomponeerd_en_ontbonden_gelijk() {
        let gecomponeerd = bereid_wachtwoord("caf\u{e9}-ww");
        let ontbonden = bereid_wachtwoord("cafe\u{301}-ww");
        assert_eq!(*gecomponeerd, *ontbonden);
    }

    #[test]
    fn voorbereiden_wijst_toe_maar_weigert_niets() {
        // Bijzondere spatie wordt een spatie, een zacht afbreekstreepje vervalt.
        assert_eq!(bereid_wachtwoord("a\u{a0}b\u{ad}c").as_slice(), b"a bc");
        // Volle breedte en superscript: NFKC.
        assert_eq!(bereid_wachtwoord("\u{ff30}a\u{b2}").as_slice(), b"Pa2");
        // Wat de strenge SASLprep weigerde, blijft gewoon staan.
        assert_eq!(bereid_wachtwoord("slot\u{1F512}").as_slice(), "slot\u{1F512}".as_bytes());
        let rtl = "\u{5e1}\u{5d9}\u{5e1}\u{5de}\u{5d4}123";
        assert_eq!(bereid_wachtwoord(rtl).as_slice(), rtl.as_bytes());
    }

    #[test]
    fn wachtwoord_wordt_op_127_bytes_afgekapt() {
        assert_eq!(bereid_wachtwoord(&"x".repeat(300)).len(), 127);
    }

    #[test]
    fn openvormen_eerst_zoals_getypt_dan_voorbereid_dan_afgekapt() {
        let v = wachtwoord_vormen("geheim1");
        assert_eq!(v.len(), 1, "niets te voorbereiden: één vorm");
        let v = wachtwoord_vormen("\u{ff30}ass\u{b2}");
        assert_eq!(v[0].as_slice(), "\u{ff30}ass\u{b2}".as_bytes());
        assert_eq!(v[1].as_slice(), b"Pass2");
        let lang = "L".repeat(200);
        let v = wachtwoord_vormen(&lang);
        assert_eq!(v.len(), 2);
        assert_eq!(v[0].len(), 200);
        assert_eq!(v[1].len(), 127);
    }

    #[test]
    fn iv_is_per_aanroep_anders_en_de_lengte_klopt() {
        let mut rng = rand::rngs::OsRng;
        let sleutel = [7u8; 32];
        let a = versleutel_bytes(&sleutel, b"zelfde tekst", &mut rng);
        let b = versleutel_bytes(&sleutel, b"zelfde tekst", &mut rng);
        assert_ne!(a, b);
        assert_eq!(a.len(), 16 + 16);
        assert_eq!(versleutel_bytes(&sleutel, b"", &mut rng).len(), 32);
        assert_eq!(versleutel_bytes(&sleutel, &[0u8; 16], &mut rng).len(), 16 + 32);
    }

    fn kleine_pdf() -> Vec<u8> {
        let mut doc = Document::with_version("1.5");
        let pages_id = doc.new_object_id();
        let content = lopdf::Stream::new(Dictionary::new(), b"BT /F1 12 Tf 10 10 Td (geheime tekst) Tj ET".to_vec());
        let content_id = doc.add_object(content);
        let page_id = doc.add_object(dictionary! {
            "Type" => "Page", "Parent" => pages_id, "Contents" => content_id,
            "MediaBox" => vec![0.into(), 0.into(), 200.into(), 100.into()],
        });
        doc.objects.insert(pages_id, Object::Dictionary(dictionary! {
            "Type" => "Pages", "Kids" => vec![page_id.into()], "Count" => 1,
        }));
        let catalog_id = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages_id });
        let info_id = doc.add_object(dictionary! {
            "Title" => Object::string_literal("Mijn (titel)"),
        });
        doc.trailer.set("Root", catalog_id);
        doc.trailer.set("Info", info_id);
        let mut uit = Vec::new();
        doc.save_to(&mut uit).unwrap();
        uit
    }

    #[test]
    fn beveiligd_bestand_heeft_encrypt_woordenboek_en_geen_leesbare_tekst() {
        let bron = kleine_pdf();
        assert!(String::from_utf8_lossy(&bron).contains("geheime tekst"));
        let uit = beveilig_pdf(&bron, "open-ww", "rechten-ww", &Rechten::default()).unwrap();
        let tekst = String::from_utf8_lossy(&uit);
        assert!(!tekst.contains("geheime tekst"), "de inhoud staat nog leesbaar in het bestand");
        assert!(!tekst.contains("Mijn (titel)"), "de titel staat nog leesbaar in het bestand");
        assert!(tekst.starts_with("%PDF-2.0"));

        let doc = Document::load_mem(&uit).unwrap_or_else(|e| panic!("kan het resultaat niet lezen: {e}"));
        let enc_ref = doc.trailer.get(b"Encrypt").unwrap().as_reference().unwrap();
        let enc = doc.get_object(enc_ref).unwrap().as_dict().unwrap();
        assert_eq!(enc.get(b"V").unwrap().as_i64().unwrap(), 5);
        assert_eq!(enc.get(b"R").unwrap().as_i64().unwrap(), 6);
        assert_eq!(enc.get(b"CF").unwrap().as_dict().unwrap().get(b"StdCF").unwrap().as_dict().unwrap()
            .get(b"CFM").unwrap().as_name().unwrap(), b"AESV3");
        assert_eq!(enc.get(b"U").unwrap().as_str().unwrap().len(), 48);
        assert_eq!(enc.get(b"O").unwrap().as_str().unwrap().len(), 48);
        assert_eq!(enc.get(b"UE").unwrap().as_str().unwrap().len(), 32);
        assert_eq!(enc.get(b"OE").unwrap().as_str().unwrap().len(), 32);
        assert_eq!(enc.get(b"Perms").unwrap().as_str().unwrap().len(), 16);
        assert!(doc.trailer.get(b"ID").is_ok());
    }

    #[test]
    fn zonder_wachtwoorden_een_vaste_foutcode() {
        let f = beveilig_pdf(&kleine_pdf(), "", "", &Rechten::default()).unwrap_err();
        assert_eq!(f, BeveiligFout::GeenWachtwoord);
        assert_eq!(f.code(), "NEED_PASSWORD");
        assert_eq!(BeveiligFout::Onvolledig(vec![4, 9]).code(), "INCOMPLETE: 2");
        assert!(BeveiligFout::Lezen("x".into()).code().starts_with("READ_FAILED: "));
    }

    #[test]
    fn al_beveiligde_pdf_wordt_geweigerd_of_opnieuw_beveiligd_zonder_fout() {
        let eerste = beveilig_pdf(&kleine_pdf(), "open-ww", "", &Rechten::default()).unwrap();
        // lopdf leest een R6-bestand niet als ontsleuteld; het tweede beveiligen
        // mag het eerste nooit stilletjes dubbel versleutelen.
        let tweede = beveilig_pdf(&eerste, "ander-ww", "", &Rechten::default());
        assert_eq!(tweede.unwrap_err(), BeveiligFout::AlBeveiligd);
    }

    #[test]
    fn directe_encrypt_in_de_trailer_wordt_geweigerd() {
        // /Encrypt mag ook direct in de trailer staan; is_encrypted() van lopdf
        // ziet alleen een verwijzing. Zonder deze controle werd zo'n bestand
        // dubbel versleuteld en waren de pagina's daarna leeg.
        let mut doc = Document::load_mem(&kleine_pdf()).unwrap();
        doc.trailer.set("Encrypt", Object::Dictionary(dictionary! {
            "Filter" => "Standard", "V" => 5, "R" => 6,
        }));
        let mut bron = Vec::new();
        doc.save_to(&mut bron).unwrap();
        assert!(beveilig_pdf(&bron, "open-ww", "", &Rechten::default()).is_err());
    }

    #[test]
    fn incrementele_of_gelineariseerde_bron_houdt_geen_verouderde_prev() {
        // Een incrementele update (of een gelineariseerd bestand) heeft een
        // /Prev in de trailer. lopdf schrijft alles in één doorsnede opnieuw;
        // een overgenomen /Prev wijst dan naar een plek die niet meer bestaat.
        let bron = kleine_pdf();
        let vorig = Document::load_mem(&bron).unwrap();
        let mut inc = lopdf::IncrementalDocument::create_from(bron.clone(), vorig);
        inc.new_document.add_object(dictionary! { "Title" => Object::string_literal("bijgewerkt") });
        let mut bijgewerkt = Vec::new();
        inc.save_to(&mut bijgewerkt).unwrap();
        assert!(Document::load_mem(&bijgewerkt).unwrap().trailer.get(b"Prev").is_ok(), "testbestand zonder /Prev");

        let uit = beveilig_pdf(&bijgewerkt, "open-ww", "rechten-ww", &Rechten::default()).unwrap();
        let doc = Document::load_mem(&uit).unwrap_or_else(|e| panic!("resultaat niet leesbaar: {e}"));
        assert!(doc.trailer.get(b"Prev").is_err(), "verouderde /Prev in de trailer");
        assert!(doc.trailer.get(b"XRefStm").is_err(), "verouderde /XRefStm in de trailer");
    }

    /// `kleine_pdf` waarin vóór object 2 (de inhoudsstream) tekst is ingevoegd
    /// zonder de xref bij te werken: lopdf leest object 2 en volgende dan op de
    /// verkeerde plek en laat ze weg. Dat is wat een verkeerd gelezen
    /// xref-stream (PNG-voorspeller) ook doet.
    fn pdf_met_verschoven_objecten() -> (Vec<u8>, usize) {
        let bron = kleine_pdf();
        let s = String::from_utf8_lossy(&bron).to_string();
        let plek = s.find("\n2 0 obj").expect("object 2") + 1;
        let opvulling = b"% opvulling zonder xref-update\n";
        let mut kapot = bron[..plek].to_vec();
        kapot.extend_from_slice(opvulling);
        kapot.extend_from_slice(&bron[plek..]);
        // startxref verschuift mee, anders vindt lopdf de xref zelf niet.
        let t = String::from_utf8_lossy(&kapot).to_string();
        let sx = t.rfind("startxref").unwrap();
        let rest = &t[sx + "startxref".len()..];
        let getal: usize = rest.split_whitespace().next().unwrap().parse().unwrap();
        let nieuw = format!("startxref\n{}\n%%EOF\n", getal + opvulling.len());
        kapot.truncate(sx);
        kapot.extend_from_slice(nieuw.as_bytes());
        (kapot, opvulling.len())
    }

    #[test]
    fn objecten_op_een_verkeerde_xref_plek_gaan_niet_verloren() {
        let (kapot, _) = pdf_met_verschoven_objecten();
        let los = Document::load_mem(&kapot).unwrap();
        assert!(!ontbrekende_ids(&los).is_empty(), "testbestand mist geen objecten");
        // Alles behalve de oude xref-stream: die schrijft lopdf opnieuw.
        let verwacht: HashSet<u32> = Document::load_mem(&kleine_pdf()).unwrap().objects.iter()
            .filter(|(_, o)| o.type_name().map_or(true, |t| t != "XRef"))
            .map(|(k, _)| k.0)
            .collect();
        assert!(verwacht.contains(&2));

        let uit = beveilig_pdf(&kapot, "open-ww", "rechten-ww", &Rechten::default()).unwrap();
        let doc = Document::load_mem(&uit).unwrap();
        let aanwezig: HashSet<u32> = doc.objects.keys().map(|k| k.0).collect();
        for id in &verwacht {
            assert!(aanwezig.contains(id), "object {id} ontbreekt in de beveiligde kopie");
        }
        assert!(doc.trailer.get(b"Prev").is_err());
    }

    #[test]
    fn een_object_dat_nergens_te_vinden_is_geeft_onvolledig() {
        let bron = kleine_pdf();
        let s = String::from_utf8_lossy(&bron).to_string();
        let plek = s.find("\n2 0 obj").expect("object 2") + 1;
        let mut kapot = bron.clone();
        // De kopregel onleesbaar maken: lopdf leest het object niet, en op geen
        // enkele regel staat nog "2 0 obj".
        kapot[plek + 4..plek + 7].copy_from_slice(b"xbj");
        match beveilig_pdf(&kapot, "open-ww", "", &Rechten::default()) {
            Err(BeveiligFout::Onvolledig(ids)) => assert_eq!(ids, vec![2]),
            ander => panic!("verwacht Onvolledig, kreeg {ander:?}"),
        }
    }

    #[test]
    fn contents_van_een_handtekening_blijft_onversleuteld() {
        let mut doc = Document::load_mem(&kleine_pdf()).unwrap();
        let handtekening = vec![0x30u8, 0x82, 0x01, 0x02, 0, 0, 0, 0];
        let sig = doc.add_object(dictionary! {
            "Type" => "Sig", "Filter" => "Test.Handtekening", "SubFilter" => "ETSI.CAdES.detached",
            "ByteRange" => vec![0.into(), 10.into(), 20.into(), 30.into()],
            "Contents" => Object::String(handtekening.clone(), StringFormat::Hexadecimal),
            "M" => Object::string_literal("D:20261022120000Z"),
        });
        let stempel = doc.add_object(dictionary! {
            "Type" => "DocTimeStamp", "SubFilter" => "ETSI.RFC3161",
            "Contents" => Object::String(handtekening.clone(), StringFormat::Hexadecimal),
        });
        let mut bron = Vec::new();
        doc.save_to(&mut bron).unwrap();

        let uit = beveilig_pdf(&bron, "open-ww", "", &Rechten::default()).unwrap();
        let doc = Document::load_mem(&uit).unwrap();
        for id in [sig, stempel] {
            let d = doc.get_object(id).unwrap().as_dict().unwrap();
            assert_eq!(d.get(b"Contents").unwrap().as_str().unwrap(), handtekening.as_slice(), "/Contents is versleuteld");
        }
        // De andere tekenreeksen van het handtekeningwoordenboek wel.
        let m = doc.get_object(sig).unwrap().as_dict().unwrap().get(b"M").unwrap().as_str().unwrap();
        assert_ne!(m, b"D:20261022120000Z");
        assert_eq!(m.len() % 16, 0);
    }

    // ─── Bestaande beveiliging overnemen ───

    fn encrypt_van(bytes: &[u8]) -> Dictionary {
        encrypt_woordenboek_van(&Document::load_mem(bytes).unwrap()).unwrap()
    }

    /// Het eerste inhoudsobject van pagina 1, ontsleuteld gelezen.
    fn paginatekst(plat: &[u8]) -> String {
        let doc = Document::load_mem(plat).unwrap();
        let pagina = *doc.get_pages().get(&1).unwrap();
        String::from_utf8_lossy(&doc.get_page_content(pagina).unwrap()).into_owned()
    }

    #[test]
    fn rechten_uit_bits_is_het_omgekeerde_van_bits() {
        let alles_uit = Rechten {
            print: false, print_hoge_kwaliteit: false, wijzigen: false, kopieren: false,
            annoteren: false, formulieren: false, samenstellen: false, toegankelijkheid: false,
        };
        for r in [
            Rechten::default(),
            alles_uit,
            Rechten { print: true, ..alles_uit },
            Rechten { kopieren: true, toegankelijkheid: true, ..alles_uit },
            Rechten { annoteren: true, formulieren: true, ..alles_uit },
            Rechten { print: true, print_hoge_kwaliteit: true, samenstellen: true, wijzigen: true, ..alles_uit },
        ] {
            assert_eq!(Rechten::uit_bits(r.bits()), r);
        }
        assert!(Rechten::default().alles_toegestaan());
        assert!(!Rechten { kopieren: false, ..Rechten::default() }.alles_toegestaan());
    }

    #[test]
    fn info_beschrijft_methode_en_rechten() {
        assert_eq!(lees_info(&kleine_pdf()).unwrap(), None);
        let rechten = Rechten { kopieren: false, wijzigen: false, ..Rechten::default() };
        let uit = beveilig_pdf(&kleine_pdf(), "open-ww", "rechten-ww", &rechten).unwrap();
        let info = lees_info(&uit).unwrap().unwrap();
        assert_eq!(info.methode, "AES-256");
        assert_eq!((info.v, info.r, info.lengte), (5, 6, 256));
        assert_eq!(info.p, rechten.bits());
        assert_eq!(info.rechten, rechten);
        assert!(info.versleutelt_metadata);
    }

    #[test]
    fn info_van_oudere_methoden() {
        let mut d = Dictionary::new();
        d.set("Filter", Object::Name(b"Standard".to_vec()));
        d.set("V", 2i64);
        d.set("R", 3i64);
        d.set("Length", 128i64);
        d.set("P", -44i64);
        assert_eq!(info_uit(&d).methode, "RC4 128-bit");
        d.set("V", 1i64);
        assert_eq!(info_uit(&d).methode, "RC4 40-bit");
        let mut std_cf = Dictionary::new();
        std_cf.set("CFM", Object::Name(b"AESV2".to_vec()));
        let mut cf = Dictionary::new();
        cf.set("StdCF", Object::Dictionary(std_cf));
        d.set("V", 4i64);
        d.set("R", 4i64);
        d.set("CF", Object::Dictionary(cf));
        d.set("StmF", Object::Name(b"StdCF".to_vec()));
        d.set("StrF", Object::Name(b"StdCF".to_vec()));
        let info = info_uit(&d);
        assert_eq!((info.methode.as_str(), info.lengte), ("AES-128", 128));
        // P als positief 32-bits getal geschreven: hetzelfde als negatief.
        d.set("P", 0xFFFF_FFD4u32 as i64);
        assert_eq!(info_uit(&d).p, -44);
    }

    #[test]
    fn oudere_methode_wordt_beschreven_maar_niet_overgenomen() {
        let mut doc = Document::load_mem(&kleine_pdf()).unwrap();
        let mut d = Dictionary::new();
        d.set("Filter", Object::Name(b"Standard".to_vec()));
        d.set("V", 2i64);
        d.set("R", 3i64);
        d.set("Length", 128i64);
        d.set("P", -4i64);
        let id = doc.add_object(Object::Dictionary(d));
        doc.trailer.set("Encrypt", Object::Reference(id));
        match Beveiliging::uit_document(&doc, "") {
            Err(OpenFout::NietOndersteund(info)) => assert_eq!(info.methode, "RC4 128-bit"),
            ander => panic!("verwacht NietOndersteund, kreeg {ander:?}"),
        }
        assert_eq!(
            Beveiliging::uit_document(&Document::load_mem(&kleine_pdf()).unwrap(), "").unwrap_err(),
            OpenFout::NietVersleuteld
        );
    }

    #[test]
    fn openen_met_open_of_rechtenwachtwoord_en_verkeerd_wachtwoord() {
        let rechten = Rechten { print: false, ..Rechten::default() };
        let uit = beveilig_pdf(&kleine_pdf(), "open-ww", "rechten-ww", &rechten).unwrap();

        let gebruiker = Beveiliging::uit_bestand(&uit, "open-ww").unwrap();
        assert!(!gebruiker.eigenaar_toegang());
        assert!(!gebruiker.mag_wijzigen(), "met beperkingen is het openwachtwoord niet genoeg");
        assert!(gebruiker.open_wachtwoord());
        assert_eq!(gebruiker.p(), rechten.bits());
        assert_eq!(gebruiker.rechten(), Rechten::uit_bits(rechten.bits()));
        assert!(!gebruiker.rechten().print);

        let eigenaar = Beveiliging::uit_bestand(&uit, "rechten-ww").unwrap();
        assert!(eigenaar.eigenaar_toegang());
        assert!(eigenaar.mag_wijzigen());
        assert_eq!(*eigenaar.sleutel, *gebruiker.sleutel, "beide wachtwoorden geven dezelfde bestandssleutel");

        assert_eq!(Beveiliging::uit_bestand(&uit, "fout-ww").unwrap_err(), OpenFout::VerkeerdWachtwoord);
        assert_eq!(Beveiliging::uit_bestand(&uit, "").unwrap_err(), OpenFout::VerkeerdWachtwoord);
        assert_eq!(OpenFout::VerkeerdWachtwoord.code(), "WRONG_PASSWORD");
    }

    #[test]
    fn zonder_openwachtwoord_opent_het_lege_wachtwoord_met_de_rechten() {
        let rechten = Rechten { kopieren: false, ..Rechten::default() };
        let uit = beveilig_pdf(&kleine_pdf(), "", "rechten-ww", &rechten).unwrap();
        let b = Beveiliging::uit_bestand(&uit, "").unwrap();
        assert!(!b.open_wachtwoord());
        assert!(!b.eigenaar_toegang());
        assert!(!b.mag_wijzigen());

        // Zonder beperkingen mag ook wie het rechtenwachtwoord niet kent de
        // beveiliging wijzigen.
        let vrij = beveilig_pdf(&kleine_pdf(), "open-ww", "", &Rechten::default()).unwrap();
        assert!(Beveiliging::uit_bestand(&vrij, "open-ww").unwrap().mag_wijzigen());
    }

    #[test]
    fn rechtenwachtwoord_achteraf_ontgrendelen() {
        let uit = beveilig_pdf(&kleine_pdf(), "open-ww", "rechten-ww", &Rechten { print: false, ..Rechten::default() }).unwrap();
        let mut b = Beveiliging::uit_bestand(&uit, "open-ww").unwrap();
        assert!(!b.ontgrendel_eigenaar("open-ww"));
        assert!(!b.ontgrendel_eigenaar("fout"));
        assert!(!b.eigenaar_toegang());
        assert!(b.ontgrendel_eigenaar("rechten-ww"));
        assert!(b.eigenaar_toegang() && b.mag_wijzigen());
    }

    #[test]
    fn terugschrijven_houdt_wachtwoorden_rechten_en_nieuwe_inhoud() {
        let rechten = Rechten { print: false, kopieren: false, ..Rechten::default() };
        let origineel = beveilig_pdf(&kleine_pdf(), "open-ww", "rechten-ww", &rechten).unwrap();
        let oud = encrypt_van(&origineel);

        // Wat de app doet: ontsleutelen (hier met de eigen code), bewerken
        // (een annotatie met tekst), en terugschrijven met de overgenomen
        // beveiliging. Alleen het openwachtwoord is bekend.
        let plat = ontsleutel(&origineel, "open-ww").unwrap();
        assert!(paginatekst(&plat).contains("geheime tekst"));
        let mut doc = Document::load_mem(&plat).unwrap();
        let pagina = *doc.get_pages().get(&1).unwrap();
        let annot = doc.add_object(dictionary! {
            "Type" => "Annot", "Subtype" => "Text",
            "Rect" => vec![10.into(), 10.into(), 30.into(), 30.into()],
            "Contents" => Object::string_literal("mijn notitie"),
        });
        doc.get_object_mut(pagina).unwrap().as_dict_mut().unwrap().set("Annots", vec![annot.into()]);
        let mut bewerkt = Vec::new();
        doc.save_to(&mut bewerkt).unwrap();

        let b = Beveiliging::uit_bestand(&origineel, "open-ww").unwrap();
        let terug = versleutel(&bewerkt, &b).unwrap();
        let tekst = String::from_utf8_lossy(&terug);
        assert!(!tekst.contains("mijn notitie") && !tekst.contains("geheime tekst"));

        let nieuw = encrypt_van(&terug);
        for k in [&b"O"[..], b"U", b"OE", b"UE", b"P", b"Perms", b"V", b"R"] {
            assert_eq!(nieuw.get(k).unwrap(), oud.get(k).unwrap(), "/{} veranderde", String::from_utf8_lossy(k));
        }
        // Het rechtenwachtwoord, dat de app nooit zag, werkt nog.
        let weer = ontsleutel(&terug, "rechten-ww").unwrap();
        assert!(paginatekst(&weer).contains("geheime tekst"));
        let doc = Document::load_mem(&weer).unwrap();
        let a = doc.get_object(annot).unwrap().as_dict().unwrap();
        assert_eq!(a.get(b"Contents").unwrap().as_str().unwrap(), b"mijn notitie");
        assert_eq!(Beveiliging::uit_bestand(&terug, "open-ww").unwrap().rechten(), rechten);
        assert_eq!(ontsleutel(&terug, "fout").unwrap_err(), OpenFout::VerkeerdWachtwoord);
    }

    #[test]
    fn andere_rechten_met_dezelfde_wachtwoorden() {
        use aes::cipher::BlockDecrypt;
        let origineel = beveilig_pdf(&kleine_pdf(), "open-ww", "rechten-ww", &Rechten::default()).unwrap();
        let b = Beveiliging::uit_bestand(&origineel, "rechten-ww").unwrap();
        let rechten = Rechten { print: false, annoteren: false, ..Rechten::default() };
        let anders = b.met_rechten(&rechten);
        let plat = ontsleutel(&origineel, "open-ww").unwrap();
        let uit = versleutel(&plat, &anders).unwrap();
        let (oud, nieuw) = (encrypt_van(&origineel), encrypt_van(&uit));
        assert_eq!(nieuw.get(b"O").unwrap(), oud.get(b"O").unwrap());
        assert_eq!(nieuw.get(b"U").unwrap(), oud.get(b"U").unwrap());
        assert_eq!(nieuw.get(b"P").unwrap().as_i64().unwrap(), rechten.bits() as i64);
        // /Perms past bij de nieuwe P.
        let perms = nieuw.get(b"Perms").unwrap().as_str().unwrap();
        let aes = aes::Aes256::new_from_slice(&*anders.sleutel).unwrap();
        let mut blok = aes::cipher::generic_array::GenericArray::clone_from_slice(perms);
        aes.decrypt_block(&mut blok);
        assert_eq!(&blok[0..4], &rechten.bits().to_le_bytes());
        assert_eq!(&blok[9..12], b"adb");
        let terug = Beveiliging::uit_bestand(&uit, "open-ww").unwrap();
        assert_eq!(terug.rechten(), rechten);
    }

    #[test]
    fn metadata_blijft_leesbaar_als_encryptmetadata_onwaar_is() {
        let mut doc = Document::load_mem(&kleine_pdf()).unwrap();
        let xmp = doc.add_object(lopdf::Stream::new(
            dictionary! { "Type" => "Metadata", "Subtype" => "XML" },
            b"<x:xmpmeta>leesbare metadata</x:xmpmeta>".to_vec(),
        ));
        let mut bron = Vec::new();
        doc.save_to(&mut bron).unwrap();
        let mut b = Beveiliging::nieuw("open-ww", "rechten-ww", &Rechten::default()).unwrap();
        b.versleutelt_metadata = false;
        b.encrypt.set("EncryptMetadata", false);
        let uit = versleutel(&bron, &b).unwrap();
        assert!(String::from_utf8_lossy(&uit).contains("leesbare metadata"));
        assert!(!String::from_utf8_lossy(&uit).contains("geheime tekst"));
        let terug = ontsleutel(&uit, "open-ww").unwrap();
        let d = Document::load_mem(&terug).unwrap();
        assert_eq!(d.get_object(xmp).unwrap().as_stream().unwrap().content, b"<x:xmpmeta>leesbare metadata</x:xmpmeta>");
        assert!(paginatekst(&terug).contains("geheime tekst"));
    }

    #[test]
    fn revisie_5_wordt_ook_overgenomen() {
        // Revisie 5 (een uitbreiding op PDF 1.7) hasht met één SHA-256.
        let mut rng = rand::rngs::OsRng;
        let mut bestand = [0u8; 32];
        rng.fill_bytes(&mut bestand);
        let r5 = |w: &[u8], zout: &[u8], udata: &[u8]| -> [u8; 32] {
            let mut h = Sha256::new();
            h.update(w);
            h.update(zout);
            h.update(udata);
            h.finalize().into()
        };
        let mut u = r5(b"open-ww", b"uvalzout", &[]).to_vec();
        u.extend_from_slice(b"uvalzout");
        u.extend_from_slice(b"usleutel");
        let ue = aes256_cbc_nul_iv(&r5(b"open-ww", b"usleutel", &[]), &bestand);
        let mut o = r5(b"rechten-ww", b"ovalzout", &u).to_vec();
        o.extend_from_slice(b"ovalzout");
        o.extend_from_slice(b"osleutel");
        let oe = aes256_cbc_nul_iv(&r5(b"rechten-ww", b"osleutel", &u), &bestand);
        let s = Sleutels { bestand, u, ue, o, oe, perms: vec![0; 16] };
        let mut d = encrypt_woordenboek(&s, -4);
        d.set("R", 5i64);
        let mut doc = Document::load_mem(&kleine_pdf()).unwrap();
        let id = doc.add_object(Object::Dictionary(d));
        doc.trailer.set("Encrypt", Object::Reference(id));
        let b = Beveiliging::uit_document(&doc, "open-ww").unwrap();
        assert_eq!(*b.sleutel, bestand);
        assert_eq!(b.revisie(), 5);
        assert!(Beveiliging::uit_document(&doc, "rechten-ww").unwrap().eigenaar_toegang());
        assert_eq!(Beveiliging::uit_document(&doc, "fout").unwrap_err(), OpenFout::VerkeerdWachtwoord);
    }

    /// Handmatig: PDF_IN, PDF_OUT, PDF_USER en PDF_OWNER uit de omgeving; het
    /// resultaat wordt daarna met een ander programma (poppler, pdfium) gecontroleerd.
    #[test]
    #[ignore]
    fn beveilig_bestand_uit_omgeving() {
        let invoer = std::env::var("PDF_IN").expect("PDF_IN");
        let uitvoer = std::env::var("PDF_OUT").expect("PDF_OUT");
        let gebruiker = std::env::var("PDF_USER").unwrap_or_default();
        let eigenaar = std::env::var("PDF_OWNER").unwrap_or_default();
        let rechten = Rechten {
            print: std::env::var("PDF_NOPRINT").is_err(),
            kopieren: std::env::var("PDF_NOCOPY").is_err(),
            ..Rechten::default()
        };
        let bytes = std::fs::read(invoer).unwrap();
        let uit = beveilig_pdf(&bytes, &gebruiker, &eigenaar, &rechten).unwrap();
        std::fs::write(uitvoer, uit).unwrap();
    }
}
