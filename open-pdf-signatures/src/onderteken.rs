//! Een PDF ondertekenen met een certificaat uit een .p12/.pfx (spec §6): een
//! incrementele toevoeging met een handtekeningveld, een `/Sig`-woordenboek met
//! een vast gat voor `/Contents`, het berekende `/ByteRange` en een CMS
//! SignedData (PAdES B-B, of `adbe.pkcs7.detached`) in het gat.
//!
//! De bronbytes blijven onveranderd: annotaties en eerdere handtekeningen in
//! het bestand blijven intact. Voor het afleveren controleert de eigen
//! verifier de uitkomst; een handtekening die niet klopt, komt nooit op schijf.

use std::io::Write;
use std::path::Path;

use base64::Engine;
use lopdf::{Dictionary, Document, Object, ObjectId};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::certificaat::certificaat_info;
use super::cms_bouw::{bouw_cms, CmsBouwFout, Ondertekenaar};
use super::pdf_schrijven::{schrijf_getal, schrijf_toevoeging, tekststring, NieuwObject, Trailergegevens, XrefVorm};
use super::pkcs12::{lees, ondertekenaar_index, Pkcs12Fout};
use super::status::Integriteit;
use super::verifieer::verifieer_document;
use super::vertrouwen::Vertrouwensarchief;

/// SubFilter van de handtekening (ISO 32000-2 §12.8.3).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize, Serialize)]
pub enum Subfilter {
    /// PAdES B-B (ETSI EN 319 142-1).
    #[default]
    #[serde(rename = "ETSI.CAdES.detached")]
    CadesDetached,
    #[serde(rename = "adbe.pkcs7.detached")]
    Pkcs7Detached,
}

impl Subfilter {
    fn naam(self) -> &'static str {
        match self {
            Subfilter::CadesDetached => "ETSI.CAdES.detached",
            Subfilter::Pkcs7Detached => "adbe.pkcs7.detached",
        }
    }
}

/// Een zichtbaar handtekeningveld.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ZichtbaarVeld {
    /// Paginanummer, vanaf 1.
    pub pagina: u32,
    /// `[x1, y1, x2, y2]` in de gebruikersruimte van de pagina (PDF-punten).
    pub rechthoek: [f64; 4],
    /// De weergave als PNG of JPEG (base64), getekend in de leesrichting van de
    /// pagina: bij `/Rotate 90` of `270` dus met breedte en hoogte verwisseld.
    /// Zonder afbeelding een leeg (onzichtbaar getekend) veld op die plek.
    #[serde(default)]
    pub weergave_base64: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Ondertekenopties {
    #[serde(default)]
    pub subfilter: Subfilter,
    /// `None`: onzichtbare handtekening.
    #[serde(default)]
    pub zichtbaar: Option<ZichtbaarVeld>,
    #[serde(default)]
    pub reden: Option<String>,
    #[serde(default)]
    pub plaats: Option<String>,
    #[serde(default)]
    pub contact: Option<String>,
    /// `/M` als PDF-datum (`D:JJJJMMDDUUmmSS+01'00'`), in de lokale tijd van
    /// de gebruiker. Ontbreekt of is hij ongeldig, dan de huidige tijd in UTC.
    #[serde(default)]
    pub tijdstip: Option<String>,
}

/// Foutcodes; de tekst voor de gebruiker vertaalt de JS-kant.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "code", rename_all = "kebab-case")]
pub enum OndertekenFout {
    VerkeerdWachtwoord,
    GeenPriveSleutel,
    GeenCertificaat,
    /// Alleen RSA-sleutels (spec §10).
    SleutelNietOndersteund { detail: String },
    /// Het certificaat mag niet ondertekenen (sleutelgebruik).
    SleutelgebruikOngeschikt,
    /// Versleutelde PDF's worden niet ondertekend (spec §6.1).
    Versleuteld,
    ZelfdeBestand,
    PaginaBestaatNiet,
    AfbeeldingOnleesbaar { detail: String },
    PdfOnleesbaar { detail: String },
    Tijdstempel { detail: String },
    Onleesbaar { detail: String },
    Schrijven { detail: String },
    Intern { detail: String },
}

impl From<Pkcs12Fout> for OndertekenFout {
    fn from(f: Pkcs12Fout) -> Self {
        match f {
            Pkcs12Fout::VerkeerdWachtwoord => OndertekenFout::VerkeerdWachtwoord,
            Pkcs12Fout::AlgoritmeNietOndersteund(detail) => OndertekenFout::SleutelNietOndersteund { detail },
            Pkcs12Fout::Onleesbaar(detail) => OndertekenFout::Onleesbaar { detail },
        }
    }
}

impl From<CmsBouwFout> for OndertekenFout {
    fn from(f: CmsBouwFout) -> Self {
        match f {
            CmsBouwFout::SleutelNietOndersteund(detail) => OndertekenFout::SleutelNietOndersteund { detail },
            CmsBouwFout::Tijdstempel(detail) => OndertekenFout::Tijdstempel { detail },
            andere => OndertekenFout::Intern { detail: andere.to_string() },
        }
    }
}

/// Haalt een tijdstempeltoken (DER) bij de handtekeningwaarde.
pub type Tijdstempelaar<'a> = &'a mut dyn FnMut(&[u8]) -> Result<Vec<u8>, String>;

/// Breedte van de plaatshouder voor de drie getallen na de 0: tot 10 cijfers,
/// dus bestanden tot bijna 10 GB.
const BEREIK_PLAATSHOUDER: &str = "/ByteRange [0 0000000000 0000000000 0000000000]";
/// Ruimte voor een RFC 3161-token (certificaat van de dienst plus handtekening).
const RUIMTE_TIJDSTEMPEL: usize = 12 * 1024;

/// Ondertekent `bron` (de bytes van een PDF) met sleutel en certificaat uit
/// het .p12 `p12` en geeft de ondertekende bytes: bron plus toevoeging.
pub fn onderteken(
    bron: &[u8],
    p12: &[u8],
    wachtwoord: &str,
    opties: &Ondertekenopties,
    mut tijdstempel: Option<Tijdstempelaar<'_>>,
) -> Result<Vec<u8>, OndertekenFout> {
    let ondertekenaar = open_ondertekenaar(p12, wachtwoord)?;
    let mut gat = ondertekenaar.geschatte_cms_grootte() + if tijdstempel.is_some() { RUIMTE_TIJDSTEMPEL } else { 0 };
    // Past de CMS niet in het gat, dan één nieuwe poging met een dubbel zo groot gat (spec §6.3).
    for _ in 0..2 {
        let ts: Option<&mut dyn FnMut(&[u8]) -> Result<Vec<u8>, String>> = match tijdstempel {
            Some(ref mut t) => Some(&mut **t),
            None => None,
        };
        match onderteken_met_gat(bron, &ondertekenaar, opties, ts, gat)? {
            Some(uit) => {
                controleer_uitkomst(&uit)?;
                return Ok(uit);
            }
            None => gat *= 2,
        }
    }
    Err(OndertekenFout::Intern { detail: "de handtekening past niet in de gereserveerde ruimte".to_string() })
}

/// Ondertekent het bestand `bron_pad` naar `doel_pad`. Het doel wordt eerst als
/// tijdelijk bestand in dezelfde map geschreven en dan hernoemd: een mislukte
/// ondertekening laat nooit een half bestand achter (spec §8).
pub fn onderteken_bestand(
    bron_pad: &Path,
    doel_pad: &Path,
    p12_pad: &Path,
    wachtwoord: &str,
    opties: &Ondertekenopties,
    tijdstempel: Option<Tijdstempelaar<'_>>,
) -> Result<(), OndertekenFout> {
    if zelfde_bestand(bron_pad, doel_pad) {
        return Err(OndertekenFout::ZelfdeBestand);
    }
    let onleesbaar = |e: std::io::Error| OndertekenFout::Onleesbaar { detail: e.to_string() };
    let bron = std::fs::read(bron_pad).map_err(onleesbaar)?;
    let p12 = std::fs::read(p12_pad).map_err(onleesbaar)?;
    let uit = onderteken(&bron, &p12, wachtwoord, opties, tijdstempel)?;
    schrijf_atomair(doel_pad, &uit)
}

fn zelfde_bestand(a: &Path, b: &Path) -> bool {
    if a == b {
        return true;
    }
    match (std::fs::canonicalize(a), std::fs::canonicalize(b)) {
        (Ok(x), Ok(y)) => x == y,
        _ => false,
    }
}

fn schrijf_atomair(doel: &Path, bytes: &[u8]) -> Result<(), OndertekenFout> {
    let schrijffout = |e: std::io::Error| OndertekenFout::Schrijven { detail: e.to_string() };
    let map = doel.parent().filter(|p| !p.as_os_str().is_empty()).unwrap_or_else(|| Path::new("."));
    let naam = doel.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "ondertekend.pdf".into());
    let tijdelijk = map.join(format!(".{naam}.{:08x}.tmp", rand::random::<u32>()));
    let resultaat = (|| {
        let mut f = std::fs::OpenOptions::new().write(true).create_new(true).open(&tijdelijk)?;
        f.write_all(bytes)?;
        f.sync_all()?;
        drop(f);
        std::fs::rename(&tijdelijk, doel)
    })();
    if let Err(e) = resultaat {
        let _ = std::fs::remove_file(&tijdelijk);
        return Err(schrijffout(e));
    }
    Ok(())
}

/// Opent het .p12 en controleert of de sleutel mag en kan ondertekenen.
fn open_ondertekenaar(p12: &[u8], wachtwoord: &str) -> Result<Ondertekenaar, OndertekenFout> {
    let inhoud = lees(p12, wachtwoord)?;
    let sleutel = inhoud.sleutel_pkcs8.as_ref().ok_or(OndertekenFout::GeenPriveSleutel)?;
    let index = ondertekenaar_index(&inhoud).ok_or(OndertekenFout::GeenCertificaat)?;
    let cert = &inhoud.certificaten[index];
    let info = certificaat_info(&cert.der).map_err(|_| OndertekenFout::GeenCertificaat)?;
    if !info.ondersteund {
        return Err(OndertekenFout::SleutelNietOndersteund { detail: info.sleuteltype });
    }
    if info.sleutelgebruik_ondertekenen == Some(false) {
        return Err(OndertekenFout::SleutelgebruikOngeschikt);
    }
    let keten: Vec<&[u8]> = inhoud
        .certificaten
        .iter()
        .enumerate()
        .filter(|(i, _)| *i != index)
        .map(|(_, c)| c.der.as_slice())
        .collect();
    Ok(Ondertekenaar::nieuw(sleutel, &cert.der, &keten)?)
}

/// De eigen verifier moet de nieuwe handtekening intact vinden, over het hele document.
fn controleer_uitkomst(uit: &[u8]) -> Result<(), OndertekenFout> {
    let lijst = verifieer_document(uit, &Vertrouwensarchief::leeg(), 0)
        .map_err(|e| OndertekenFout::Intern { detail: format!("eigen controle: {e:?}") })?;
    let laatste = lijst.iter().filter(|h| h.bereik_einde.is_some()).max_by_key(|h| h.bereik_einde);
    match laatste {
        Some(h) if h.integriteit == Some(Integriteit::Intact) && h.dekt_hele_document => Ok(()),
        Some(h) => Err(OndertekenFout::Intern {
            detail: format!("eigen controle: {:?} {}", h.integriteit, h.detail.clone().unwrap_or_default()),
        }),
        None => Err(OndertekenFout::Intern { detail: "eigen controle: handtekening niet gevonden".to_string() }),
    }
}

fn pdf_fout(e: impl std::fmt::Display) -> OndertekenFout {
    OndertekenFout::PdfOnleesbaar { detail: e.to_string() }
}

/// Leest de bron met lopdf, zonder paniek naar buiten.
fn laad(bron: &[u8]) -> Result<Document, OndertekenFout> {
    let geladen = std::panic::catch_unwind(|| Document::load_mem(bron))
        .map_err(|_| OndertekenFout::PdfOnleesbaar { detail: "PDF-structuur niet te lezen".to_string() })?;
    geladen.map_err(pdf_fout)
}

fn verwijzing(d: &Dictionary, sleutel: &[u8]) -> Option<ObjectId> {
    d.get(sleutel).ok().and_then(|o| o.as_reference().ok())
}

/// Een overerfbaar pagina-attribuut (ISO 32000-1 §7.7.3.4), via `/Parent`.
fn geerfd<'a>(doc: &'a Document, pagina: &'a Dictionary, sleutel: &[u8]) -> Option<&'a Object> {
    let mut huidig = pagina;
    for _ in 0..64 {
        if let Ok(o) = huidig.get(sleutel) {
            return doc.dereference(o).ok().map(|(_, o)| o);
        }
        huidig = doc.get_dictionary(verwijzing(huidig, b"Parent")?).ok()?;
    }
    None
}

/// Een unieke veldnaam: `Signature1`, `Signature2`, …
fn vrije_veldnaam(doc: &Document, velden: &[Object]) -> String {
    let namen: Vec<Vec<u8>> = velden
        .iter()
        .filter_map(|v| doc.dereference(v).ok())
        .filter_map(|(_, o)| o.as_dict().ok())
        .filter_map(|d| d.get(b"T").ok())
        .filter_map(|t| lopdf::decode_text_string(t).ok())
        .map(String::into_bytes)
        .collect();
    (1..)
        .map(|n| format!("Signature{n}"))
        .find(|kandidaat| !namen.iter().any(|n| n == kandidaat.as_bytes()))
        .unwrap_or_else(|| "Signature".to_string())
}

/// `None` als de CMS niet in het gat van `gat` bytes past.
fn onderteken_met_gat(
    bron: &[u8],
    ondertekenaar: &Ondertekenaar,
    opties: &Ondertekenopties,
    tijdstempel: Option<Tijdstempelaar<'_>>,
    gat: usize,
) -> Result<Option<Vec<u8>>, OndertekenFout> {
    let doc = laad(bron)?;
    if doc.trailer.get(b"Encrypt").is_ok() {
        return Err(OndertekenFout::Versleuteld);
    }
    let root = verwijzing(&doc.trailer, b"Root").ok_or_else(|| pdf_fout("trailer zonder /Root"))?;
    let catalogus = doc.get_dictionary(root).map_err(pdf_fout)?.clone();
    let grootte = doc
        .trailer
        .get(b"Size")
        .ok()
        .and_then(|s| s.as_i64().ok())
        .and_then(|s| u32::try_from(s).ok())
        .unwrap_or(0)
        .max(doc.max_id + 1);
    let trailer = Trailergegevens {
        vorm: match doc.reference_table.cross_reference_type {
            lopdf::xref::XrefType::CrossReferenceStream => XrefVorm::Stroom,
            lopdf::xref::XrefType::CrossReferenceTable => XrefVorm::Tabel,
        },
        vorige_xref: doc.xref_start,
        grootte,
        root,
        info: verwijzing(&doc.trailer, b"Info"),
        id: doc.trailer.get(b"ID").ok().cloned(),
    };

    let paginas = doc.get_pages();
    let paginanummer = opties.zichtbaar.as_ref().map_or(1, |z| z.pagina);
    let pagina_id = *paginas.get(&paginanummer).ok_or(OndertekenFout::PaginaBestaatNiet)?;
    let pagina = doc.get_dictionary(pagina_id).map_err(pdf_fout)?.clone();

    let mut volgende = grootte;
    let mut nieuw_id = || {
        let id = (volgende, 0);
        volgende += 1;
        id
    };
    let sig_id = nieuw_id();
    let widget_id = nieuw_id();
    let mut objecten: Vec<NieuwObject> = Vec::new();

    // AcroForm: velden en /SigFlags 3 (SignaturesExist | AppendOnly).
    let (acroform_id, mut acroform) = match catalogus.get(b"AcroForm") {
        Ok(Object::Reference(id)) => (Some(*id), doc.get_dictionary(*id).map_err(pdf_fout)?.clone()),
        Ok(Object::Dictionary(d)) => (None, d.clone()),
        _ => (None, Dictionary::new()),
    };
    let (velden_id, mut velden) = match acroform.get(b"Fields") {
        Ok(Object::Reference(id)) => (Some(*id), doc.get_object(*id).and_then(Object::as_array).map_err(pdf_fout)?.clone()),
        Ok(Object::Array(a)) => (None, a.clone()),
        _ => (None, Vec::new()),
    };
    let veldnaam = vrije_veldnaam(&doc, &velden);
    velden.push(Object::Reference(widget_id));
    match velden_id {
        Some(id) => objecten.push(NieuwObject::van(id, &Object::Array(velden))),
        None => acroform.set("Fields", Object::Array(velden)),
    }
    acroform.set("SigFlags", Object::Integer(3));
    match acroform_id {
        Some(id) => objecten.push(NieuwObject::van(id, &Object::Dictionary(acroform))),
        None => {
            let mut cat = catalogus.clone();
            cat.set("AcroForm", Object::Dictionary(acroform));
            objecten.push(NieuwObject::van(root, &Object::Dictionary(cat)));
        }
    }

    // De widget in /Annots van de pagina.
    let mut pagina_nieuw = pagina.clone();
    match pagina.get(b"Annots") {
        Ok(Object::Reference(id)) => {
            let mut annots = doc.get_object(*id).and_then(Object::as_array).map_err(pdf_fout)?.clone();
            annots.push(Object::Reference(widget_id));
            objecten.push(NieuwObject::van(*id, &Object::Array(annots)));
        }
        Ok(Object::Array(a)) => {
            let mut annots = a.clone();
            annots.push(Object::Reference(widget_id));
            pagina_nieuw.set("Annots", Object::Array(annots));
            objecten.push(NieuwObject::van(pagina_id, &Object::Dictionary(pagina_nieuw)));
        }
        _ => {
            pagina_nieuw.set("Annots", Object::Array(vec![Object::Reference(widget_id)]));
            objecten.push(NieuwObject::van(pagina_id, &Object::Dictionary(pagina_nieuw)));
        }
    }
    // De pagina kan ook de catalogus zijn in een kapotte PDF; dubbele nummers vermijden.
    dedupliceer(&mut objecten);

    // Widget + veld (samengevoegd), met weergave bij een zichtbare handtekening.
    let mut widget = Dictionary::new();
    widget.set("Type", Object::Name(b"Annot".to_vec()));
    widget.set("Subtype", Object::Name(b"Widget".to_vec()));
    widget.set("FT", Object::Name(b"Sig".to_vec()));
    // Veldnamen zijn ASCII (`SignatureN`): een letterlijke string leest overal.
    widget.set("T", Object::String(veldnaam.into_bytes(), lopdf::StringFormat::Literal));
    widget.set("V", Object::Reference(sig_id));
    // Print (4) + Locked (128).
    widget.set("F", Object::Integer(132));
    widget.set("P", Object::Reference(pagina_id));
    match &opties.zichtbaar {
        Some(z) => {
            let [x1, y1, x2, y2] = z.rechthoek;
            let (lx, rx) = (x1.min(x2), x1.max(x2));
            let (ly, ry) = (y1.min(y2), y1.max(y2));
            if !(rx - lx > 0.5 && ry - ly > 0.5) || ![lx, rx, ly, ry].iter().all(|v| v.is_finite()) {
                return Err(OndertekenFout::Intern { detail: "ongeldige rechthoek".to_string() });
            }
            widget.set(
                "Rect",
                Object::Array(vec![Object::Real(lx as f32), Object::Real(ly as f32), Object::Real(rx as f32), Object::Real(ry as f32)]),
            );
            let rotatie = geerfd(&doc, &pagina, b"Rotate").and_then(|o| o.as_i64().ok()).unwrap_or(0).rem_euclid(360);
            let ap_id = nieuw_id();
            let afbeelding = match &z.weergave_base64 {
                Some(b64) if !b64.is_empty() => {
                    let bytes = base64::engine::general_purpose::STANDARD
                        .decode(b64.trim())
                        .map_err(|e| OndertekenFout::AfbeeldingOnleesbaar { detail: e.to_string() })?;
                    Some(afbeelding_objecten(&bytes, &mut nieuw_id)?)
                }
                _ => None,
            };
            let (b, h) = if rotatie == 90 || rotatie == 270 { (ry - ly, rx - lx) } else { (rx - lx, ry - ly) };
            objecten.push(weergave_stroom(ap_id, b, h, rotatie, afbeelding.as_ref().map(|a| a.id)));
            if let Some(a) = afbeelding {
                objecten.extend(a.objecten);
            }
            let mut ap = Dictionary::new();
            ap.set("N", Object::Reference(ap_id));
            widget.set("AP", Object::Dictionary(ap));
        }
        None => widget.set(
            "Rect",
            Object::Array(vec![Object::Integer(0), Object::Integer(0), Object::Integer(0), Object::Integer(0)]),
        ),
    }
    objecten.push(NieuwObject::van(widget_id, &Object::Dictionary(widget)));

    // Het handtekeningwoordenboek: met de hand, voor een vast gat en plaatshouder.
    let naam = common_name_van(ondertekenaar);
    let tijdstip = opties.tijdstip.as_deref().filter(|t| is_pdf_datum(t)).map(str::to_string).unwrap_or_else(pdf_datum_utc);
    let mut sig = Vec::new();
    sig.extend_from_slice(b"<</Type /Sig/Filter /Adobe.PPKLite/SubFilter /");
    sig.extend_from_slice(opties.subfilter.naam().as_bytes());
    sig.extend_from_slice(BEREIK_PLAATSHOUDER.as_bytes());
    sig.extend_from_slice(b"/Contents <");
    let contents_begin = sig.len() - 1;
    sig.resize(sig.len() + 2 * gat, b'0');
    sig.push(b'>');
    let contents_einde = sig.len();
    let mut rest = Dictionary::new();
    rest.set("M", Object::String(tijdstip.into_bytes(), lopdf::StringFormat::Literal));
    if !naam.is_empty() {
        rest.set("Name", tekststring(&naam));
    }
    for (sleutel, waarde) in [("Reason", &opties.reden), ("Location", &opties.plaats), ("ContactInfo", &opties.contact)] {
        if let Some(w) = waarde.as_deref().map(str::trim).filter(|w| !w.is_empty()) {
            rest.set(sleutel, tekststring(w));
        }
    }
    let mut rest_bytes = Vec::new();
    super::pdf_schrijven::schrijf_woordenboek(&mut rest_bytes, &rest);
    // Zonder de buitenste << >> achter /Contents plakken.
    sig.extend_from_slice(&rest_bytes[2..rest_bytes.len() - 2]);
    sig.extend_from_slice(b">>");
    let bereik_in_sig = sig.windows(BEREIK_PLAATSHOUDER.len()).position(|w| w == BEREIK_PLAATSHOUDER.as_bytes());
    let bereik_in_sig = bereik_in_sig.ok_or_else(|| OndertekenFout::Intern { detail: "plaatshouder kwijt".into() })?;
    objecten.insert(0, NieuwObject { id: sig_id, inhoud: sig });

    let (mut uit, offsets) = schrijf_toevoeging(bron, &trailer, &objecten);
    // Offset van de inhoud van het sig-object: kop "n 0 obj\n".
    let kop = format!("{} {} obj\n", sig_id.0, sig_id.1).len();
    let sig_begin = offsets[0] + kop;
    let a = sig_begin + contents_begin;
    let b = sig_begin + contents_einde;
    let c = uit.len() - b;
    let bereik = format!("/ByteRange [0 {a} {b} {c}]");
    if bereik.len() > BEREIK_PLAATSHOUDER.len() {
        return Err(OndertekenFout::Intern { detail: "bestand te groot voor de plaatshouder".into() });
    }
    let bereik = format!("{bereik:<width$}", width = BEREIK_PLAATSHOUDER.len());
    let p = sig_begin + bereik_in_sig;
    uit[p..p + bereik.len()].copy_from_slice(bereik.as_bytes());

    let mut hasher = Sha256::new();
    hasher.update(&uit[..a]);
    hasher.update(&uit[b..]);
    let digest = hasher.finalize();
    let ondertekentijd = (opties.subfilter == Subfilter::Pkcs7Detached).then(std::time::SystemTime::now);
    let cms = bouw_cms(ondertekenaar, &digest, ondertekentijd, tijdstempel)?;
    if cms.len() > gat {
        return Ok(None);
    }
    let hex: Vec<u8> = cms.iter().flat_map(|byte| format!("{byte:02X}").into_bytes()).collect();
    uit[a + 1..a + 1 + hex.len()].copy_from_slice(&hex);
    Ok(Some(uit))
}

/// Houdt per objectnummer alleen de laatste versie.
fn dedupliceer(objecten: &mut Vec<NieuwObject>) {
    let mut gezien = std::collections::HashSet::new();
    let mut i = objecten.len();
    while i > 0 {
        i -= 1;
        if !gezien.insert(objecten[i].id) {
            objecten.remove(i);
        }
    }
}

fn common_name_van(o: &Ondertekenaar) -> String {
    super::certificaat::common_name(&o.certificaat.tbs_certificate.subject)
}

struct Afbeelding {
    id: ObjectId,
    objecten: Vec<NieuwObject>,
}

fn stroom(id: ObjectId, mut dict: Dictionary, inhoud: &[u8], comprimeer: bool) -> NieuwObject {
    let data = if comprimeer {
        let mut enc = flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::default());
        let _ = enc.write_all(inhoud);
        dict.set("Filter", Object::Name(b"FlateDecode".to_vec()));
        enc.finish().unwrap_or_default()
    } else {
        inhoud.to_vec()
    };
    dict.set("Length", Object::Integer(data.len() as i64));
    let mut bytes = Vec::with_capacity(data.len() + 128);
    super::pdf_schrijven::schrijf_woordenboek(&mut bytes, &dict);
    bytes.extend_from_slice(b"\nstream\n");
    bytes.extend_from_slice(&data);
    bytes.extend_from_slice(b"\nendstream");
    NieuwObject { id, inhoud: bytes }
}

/// Een PNG of JPEG als afbeelding-XObject (RGB, met /SMask voor doorzichtigheid).
fn afbeelding_objecten(bytes: &[u8], nieuw_id: &mut impl FnMut() -> ObjectId) -> Result<Afbeelding, OndertekenFout> {
    let beeld = image::load_from_memory(bytes).map_err(|e| OndertekenFout::AfbeeldingOnleesbaar { detail: e.to_string() })?;
    let rgba = beeld.to_rgba8();
    let (w, h) = rgba.dimensions();
    if w == 0 || h == 0 || u64::from(w) * u64::from(h) > 40_000_000 {
        return Err(OndertekenFout::AfbeeldingOnleesbaar { detail: format!("afmeting {w}x{h}") });
    }
    let mut rgb = Vec::with_capacity((w * h * 3) as usize);
    let mut alfa = Vec::with_capacity((w * h) as usize);
    for p in rgba.pixels() {
        rgb.extend_from_slice(&p.0[..3]);
        alfa.push(p.0[3]);
    }
    let id = nieuw_id();
    let basis = |kleur: &[u8]| {
        let mut d = Dictionary::new();
        d.set("Type", Object::Name(b"XObject".to_vec()));
        d.set("Subtype", Object::Name(b"Image".to_vec()));
        d.set("Width", Object::Integer(i64::from(w)));
        d.set("Height", Object::Integer(i64::from(h)));
        d.set("ColorSpace", Object::Name(kleur.to_vec()));
        d.set("BitsPerComponent", Object::Integer(8));
        d
    };
    let mut objecten = Vec::new();
    let mut d = basis(b"DeviceRGB");
    if alfa.iter().any(|&a| a != 255) {
        let masker_id = nieuw_id();
        objecten.push(stroom(masker_id, basis(b"DeviceGray"), &alfa, true));
        d.set("SMask", Object::Reference(masker_id));
    }
    objecten.insert(0, stroom(id, d, &rgb, true));
    Ok(Afbeelding { id, objecten })
}

/// De weergavestroom: breedte `b` en hoogte `h` in de leesrichting; bij een
/// gedraaide pagina draait `/Matrix` de weergave mee terug (ISO 32000-1 §12.5.5).
fn weergave_stroom(id: ObjectId, b: f64, h: f64, rotatie: i64, afbeelding: Option<ObjectId>) -> NieuwObject {
    let mut d = Dictionary::new();
    d.set("Type", Object::Name(b"XObject".to_vec()));
    d.set("Subtype", Object::Name(b"Form".to_vec()));
    d.set("BBox", Object::Array(vec![Object::Integer(0), Object::Integer(0), Object::Real(b as f32), Object::Real(h as f32)]));
    let matrix: [i64; 4] = match rotatie {
        90 => [0, 1, -1, 0],
        180 => [-1, 0, 0, -1],
        270 => [0, -1, 1, 0],
        _ => [1, 0, 0, 1],
    };
    if rotatie != 0 {
        let mut m: Vec<Object> = matrix.iter().map(|&v| Object::Integer(v)).collect();
        m.extend([Object::Integer(0), Object::Integer(0)]);
        d.set("Matrix", Object::Array(m));
    }
    let mut res = Dictionary::new();
    let mut inhoud = Vec::new();
    if let Some(img) = afbeelding {
        let mut xo = Dictionary::new();
        xo.set("Img", Object::Reference(img));
        res.set("XObject", Object::Dictionary(xo));
        inhoud.extend_from_slice(b"q ");
        schrijf_getal(&mut inhoud, b);
        inhoud.extend_from_slice(b" 0 0 ");
        schrijf_getal(&mut inhoud, h);
        inhoud.extend_from_slice(b" 0 0 cm /Img Do Q\n");
    }
    d.set("Resources", Object::Dictionary(res));
    stroom(id, d, &inhoud, false)
}

/// Eenvoudige vormcontrole van een PDF-datum: `D:` gevolgd door 4 tot 14
/// cijfers en eventueel een tijdzone (`Z`, `+01'00'`).
fn is_pdf_datum(t: &str) -> bool {
    let Some(rest) = t.strip_prefix("D:") else { return false };
    let cijfers = rest.bytes().take_while(u8::is_ascii_digit).count();
    let zone = &rest[cijfers..];
    (4..=14).contains(&cijfers)
        && zone.len() <= 7
        && zone.bytes().all(|c| c.is_ascii_digit() || matches!(c, b'Z' | b'+' | b'-' | b'\''))
}

/// De huidige tijd als PDF-datum in UTC.
fn pdf_datum_utc() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    pdf_datum_uit_unix(secs)
}

fn pdf_datum_uit_unix(secs: i64) -> String {
    let dagen = secs.div_euclid(86_400);
    let s = secs.rem_euclid(86_400);
    // Civiele datum uit dagen sinds 1970-01-01 (H. Hinnant).
    let z = dagen + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let dag = doy - (153 * mp + 2) / 5 + 1;
    let maand = if mp < 10 { mp + 3 } else { mp - 9 };
    let jaar = yoe + era * 400 + i64::from(maand <= 2);
    format!("D:{jaar:04}{maand:02}{dag:02}{:02}{:02}{:02}Z", s / 3600, (s / 60) % 60, s % 60)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pdf_datum_uit_unix_tijd() {
        assert_eq!(pdf_datum_uit_unix(0), "D:19700101000000Z");
        assert_eq!(pdf_datum_uit_unix(1_793_000_000), "D:20261026073320Z");
        assert!(is_pdf_datum("D:20261027213000+01'00'"));
        assert!(is_pdf_datum(&pdf_datum_utc()));
        assert!(!is_pdf_datum("D:2026) /Kwaad (x"));
        assert!(!is_pdf_datum("20261027"));
    }

    #[test]
    fn opties_uit_json() {
        let o: Ondertekenopties = serde_json::from_str(
            r#"{"subfilter":"adbe.pkcs7.detached","reden":"Akkoord","zichtbaar":{"pagina":2,"rechthoek":[1,2,3,4]}}"#,
        )
        .unwrap();
        assert_eq!(o.subfilter, Subfilter::Pkcs7Detached);
        assert_eq!(o.zichtbaar.unwrap().pagina, 2);
        let leeg: Ondertekenopties = serde_json::from_str("{}").unwrap();
        assert_eq!(leeg.subfilter, Subfilter::CadesDetached);
        assert!(leeg.zichtbaar.is_none());
    }

    #[test]
    fn fouten_serialiseren_als_code() {
        assert_eq!(serde_json::to_string(&OndertekenFout::VerkeerdWachtwoord).unwrap(), r#"{"code":"verkeerd-wachtwoord"}"#);
        assert_eq!(
            serde_json::to_string(&OndertekenFout::Tijdstempel { detail: "x".into() }).unwrap(),
            r#"{"code":"tijdstempel","detail":"x"}"#
        );
    }
}
