//! Een PDF beveiligen met een wachtwoord: het standaard beveiligingsmechanisme
//! uit de PDF 2.0-norm (ISO 32000-2, Standard Security Handler, V 5 / R 6, AES-256).
//! Acrobat, Voorvertoning, Chrome en pdf.js openen zo'n bestand met het wachtwoord.
//!
//! - Gebruikerswachtwoord ("openen"): zonder dat opent het bestand niet. Leeg =
//!   het bestand opent vrij en alleen de rechten gelden.
//! - Eigenaarwachtwoord ("rechten"): met dit wachtwoord gelden de beperkingen
//!   niet. Leeg = het wordt een willekeurig wachtwoord dat niemand kent.
//!
//! lopdf leest het bestand in (ook objectstromen: die worden losse objecten) en
//! schrijft het weer weg; hier worden alleen de tekenreeksen en streams
//! versleuteld en het /Encrypt-woordenboek toegevoegd.

use aes::cipher::{BlockEncrypt, KeyInit as _};
use cbc::cipher::{block_padding::{NoPadding, Pkcs7}, BlockEncryptMut, KeyIvInit};
use lopdf::{Dictionary, Document, Object, ObjectId, StringFormat};
use rand::RngCore;
use sha2::{Digest, Sha256, Sha384, Sha512};
use zeroize::Zeroize;

type Aes256CbcEnc = cbc::Encryptor<aes::Aes256>;
type Aes128CbcEnc = cbc::Encryptor<aes::Aes128>;

/// Wat het ontvangende programma mag doen. Alles uit = alleen lezen.
#[derive(Debug, Clone, Copy, serde::Deserialize)]
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
}

/// Het wachtwoord zoals de norm het wil voor revisie 6: SASLprep (NFKC en
/// verboden tekens), daarna UTF-8, hoogstens 127 bytes. Zonder SASLprep opent
/// een wachtwoord met bijvoorbeeld een "é" in een andere viewer niet als het
/// daar anders (gecomponeerd of ontbonden) is getypt.
fn wachtwoord_bytes(w: &str) -> Result<Vec<u8>, String> {
    let genormaliseerd = stringprep::saslprep(w)
        .map_err(|_| "Het wachtwoord bevat tekens die in een PDF-wachtwoord niet zijn toegestaan.".to_string())?;
    let mut b = genormaliseerd.as_bytes().to_vec();
    b.truncate(127);
    Ok(b)
}

/// Algoritme 2.B (ISO 32000-2): de wachtwoordhash van revisie 6.
fn hash_r6(wachtwoord: &[u8], zout: &[u8], udata: &[u8]) -> [u8; 32] {
    let mut k: Vec<u8> = {
        let mut h = Sha256::new();
        h.update(wachtwoord);
        h.update(zout);
        h.update(udata);
        h.finalize().to_vec()
    };
    let mut i: usize = 0;
    loop {
        let mut k1 = Vec::with_capacity((wachtwoord.len() + k.len() + udata.len()) * 64);
        for _ in 0..64 {
            k1.extend_from_slice(wachtwoord);
            k1.extend_from_slice(&k);
            k1.extend_from_slice(udata);
        }
        let e = Aes128CbcEnc::new_from_slices(&k[0..16], &k[16..32])
            .expect("sleutel en iv zijn 16 bytes")
            .encrypt_padded_vec_mut::<NoPadding>(&k1);
        let modulo = e[..16].iter().map(|b| *b as u32).sum::<u32>() % 3;
        k = match modulo {
            0 => Sha256::digest(&e).to_vec(),
            1 => Sha384::digest(&e).to_vec(),
            _ => Sha512::digest(&e).to_vec(),
        };
        let laatste = *e.last().expect("e is niet leeg") as usize;
        i += 1;
        if i >= 64 && laatste <= i - 32 {
            break;
        }
    }
    let mut uit = [0u8; 32];
    uit.copy_from_slice(&k[..32]);
    uit
}

/// AES-256-CBC zonder opvulling, iv nul (voor UE en OE: één of twee blokken).
fn aes256_cbc_nul_iv(sleutel: &[u8; 32], data: &[u8]) -> Vec<u8> {
    Aes256CbcEnc::new_from_slices(sleutel, &[0u8; 16])
        .expect("sleutel is 32 bytes, iv 16")
        .encrypt_padded_vec_mut::<NoPadding>(data)
}

/// De bestandssleutel plus de waarden voor het /Encrypt-woordenboek.
struct Sleutels {
    bestand: [u8; 32],
    u: Vec<u8>,
    ue: Vec<u8>,
    o: Vec<u8>,
    oe: Vec<u8>,
    perms: Vec<u8>,
}

fn maak_sleutels(gebruiker: &str, eigenaar: &str, p: i32, rng: &mut impl RngCore) -> Result<Sleutels, String> {
    let mut bestand = [0u8; 32];
    rng.fill_bytes(&mut bestand);

    let mut gw = wachtwoord_bytes(gebruiker)?;
    let mut ew = wachtwoord_bytes(eigenaar)?;
    if ew.is_empty() {
        // Geen eigenaarwachtwoord: een willekeurig, onbekend wachtwoord, zodat
        // niemand de rechten met een leeg wachtwoord kan omzeilen. 32 willekeurige
        // bytes als hex (64 tekens, 256 bits).
        let mut w = [0u8; 32];
        rng.fill_bytes(&mut w);
        ew = w.iter().flat_map(|b| format!("{b:02x}").into_bytes()).collect();
        w.zeroize();
    }

    let mut u_val_zout = [0u8; 8];
    let mut u_sleutel_zout = [0u8; 8];
    rng.fill_bytes(&mut u_val_zout);
    rng.fill_bytes(&mut u_sleutel_zout);
    let mut u = hash_r6(&gw, &u_val_zout, &[]).to_vec();
    u.extend_from_slice(&u_val_zout);
    u.extend_from_slice(&u_sleutel_zout);
    let ue = aes256_cbc_nul_iv(&hash_r6(&gw, &u_sleutel_zout, &[]), &bestand);

    let mut o_val_zout = [0u8; 8];
    let mut o_sleutel_zout = [0u8; 8];
    rng.fill_bytes(&mut o_val_zout);
    rng.fill_bytes(&mut o_sleutel_zout);
    let mut o = hash_r6(&ew, &o_val_zout, &u).to_vec();
    o.extend_from_slice(&o_val_zout);
    o.extend_from_slice(&o_sleutel_zout);
    let oe = aes256_cbc_nul_iv(&hash_r6(&ew, &o_sleutel_zout, &u), &bestand);

    // /Perms: P (4 bytes, little endian), 0xFFFFFFFF, 'T' (metadata versleuteld),
    // "adb" en vier willekeurige bytes, met AES-256-ECB onder de bestandssleutel.
    let mut blok = [0u8; 16];
    blok[0..4].copy_from_slice(&p.to_le_bytes());
    blok[4..8].copy_from_slice(&[0xFF; 4]);
    blok[8] = b'T';
    blok[9..12].copy_from_slice(b"adb");
    rng.fill_bytes(&mut blok[12..16]);
    let aes = aes::Aes256::new_from_slice(&bestand).expect("sleutel is 32 bytes");
    let mut b = aes::cipher::generic_array::GenericArray::clone_from_slice(&blok);
    aes.encrypt_block(&mut b);
    let perms = b.to_vec();

    gw.zeroize();
    ew.zeroize();
    Ok(Sleutels { bestand, u, ue, o, oe, perms })
}

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

fn versleutel_woordenboek(dict: &mut Dictionary, sleutel: &[u8; 32], rng: &mut impl RngCore) {
    for (_, waarde) in dict.iter_mut() {
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

/// Versleutelt `bytes` (een niet-beveiligde PDF) met de gegeven wachtwoorden.
pub fn beveilig_pdf(
    bytes: &[u8],
    gebruikerswachtwoord: &str,
    eigenaarwachtwoord: &str,
    rechten: &Rechten,
) -> Result<Vec<u8>, String> {
    let mut doc = Document::load_mem(bytes).map_err(|e| format!("Kan de PDF niet lezen: {e}"))?;
    if doc.is_encrypted() {
        return Err("Deze PDF is al beveiligd.".into());
    }
    let mut rng = rand::rngs::OsRng;
    let p = rechten.bits();
    let mut sleutels = maak_sleutels(gebruikerswachtwoord, eigenaarwachtwoord, p, &mut rng)?;

    let ids: Vec<ObjectId> = doc.objects.keys().copied().collect();
    for id in ids {
        if let Some(obj) = doc.objects.get_mut(&id) {
            versleutel_object(obj, &sleutels.bestand, &mut rng);
        }
    }

    let encrypt_id = doc.add_object(Object::Dictionary(encrypt_woordenboek(&sleutels, p)));
    doc.trailer.set("Encrypt", Object::Reference(encrypt_id));
    if doc.trailer.get(b"ID").is_err() {
        let mut id = [0u8; 16];
        rng.fill_bytes(&mut id);
        let s = Object::String(id.to_vec(), StringFormat::Hexadecimal);
        doc.trailer.set("ID", Object::Array(vec![s.clone(), s]));
    }
    doc.version = "2.0".into();

    let mut uit = Vec::with_capacity(bytes.len() + 4096);
    doc.save_to(&mut uit).map_err(|e| format!("Kan de PDF niet schrijven: {e}"))?;
    sleutels.bestand.zeroize();
    Ok(uit)
}

/// Leest `bron`, beveiligt het en schrijft het naar `doel`.
#[tauri::command]
pub async fn protect_pdf_file(
    bron: String,
    doel: String,
    gebruikerswachtwoord: String,
    eigenaarwachtwoord: String,
    rechten: Rechten,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let mut gebruikerswachtwoord = gebruikerswachtwoord;
        let mut eigenaarwachtwoord = eigenaarwachtwoord;
        let resultaat = (|| {
            if gebruikerswachtwoord.is_empty() && eigenaarwachtwoord.is_empty() {
                return Err("Vul minstens één wachtwoord in.".to_string());
            }
            let bytes = std::fs::read(&bron).map_err(|e| format!("Kan {bron} niet lezen: {e}"))?;
            let uit = beveilig_pdf(&bytes, &gebruikerswachtwoord, &eigenaarwachtwoord, &rechten)?;
            std::fs::write(&doel, uit).map_err(|e| format!("Kan {doel} niet schrijven: {e}"))
        })();
        gebruikerswachtwoord.zeroize();
        eigenaarwachtwoord.zeroize();
        resultaat
    })
    .await
    .map_err(|e| e.to_string())?
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
        assert_eq!(a, b);
        assert_ne!(a, c);
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
        let s = maak_sleutels("open-ww", "rechten-ww", Rechten::default().bits(), &mut rng).unwrap();
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
        let s = maak_sleutels("a1b2c3", "", p, &mut rng).unwrap();
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
        let s = maak_sleutels("a1b2c3", "", Rechten::default().bits(), &mut rng).unwrap();
        // Het lege wachtwoord opent de eigenaarssleutel niet.
        let (o_hash, o_zouten) = s.o.split_at(32);
        assert_ne!(hash_r6(b"", &o_zouten[..8], &s.u).as_slice(), o_hash);
    }

    #[test]
    fn saslprep_maakt_gecomponeerd_en_ontbonden_gelijk() {
        let gecomponeerd = wachtwoord_bytes("caf\u{e9}-ww").unwrap();
        let ontbonden = wachtwoord_bytes("cafe\u{301}-ww").unwrap();
        assert_eq!(gecomponeerd, ontbonden);
        assert!(wachtwoord_bytes("a\u{0}b").is_err(), "stuurtekens zijn niet toegestaan");
    }

    #[test]
    fn wachtwoord_wordt_op_127_bytes_afgekapt() {
        assert_eq!(wachtwoord_bytes(&"x".repeat(300)).unwrap().len(), 127);
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
    fn al_beveiligde_pdf_wordt_geweigerd_of_opnieuw_beveiligd_zonder_fout() {
        let eerste = beveilig_pdf(&kleine_pdf(), "open-ww", "", &Rechten::default()).unwrap();
        // lopdf leest een R6-bestand niet als ontsleuteld; het tweede beveiligen
        // mag het eerste nooit stilletjes dubbel versleutelen.
        let tweede = beveilig_pdf(&eerste, "ander-ww", "", &Rechten::default());
        assert!(tweede.is_err(), "een al beveiligd bestand moet geweigerd worden");
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
