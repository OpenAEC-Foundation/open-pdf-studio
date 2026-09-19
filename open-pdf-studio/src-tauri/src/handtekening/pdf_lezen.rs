//! Handtekeningvelden uit een PDF lezen (ISO 32000-1 §12.7.4.5 en §12.8.1).
//!
//! Via `lopdf`, met een leesfilter dat gewone streams terugbrengt tot hun
//! woordenboek: alleen objectstromen en xref-stromen houden hun inhoud. Weigert
//! `lopdf` het bestand, of blijft het resultaat onvolledig of leeg, dan bouwen we
//! de xref opnieuw op door objectkoppen `N G obj` te zoeken en objectstromen uit
//! te pakken; de nieuwste positie in het bestand wint. Van beide uitkomsten telt
//! die met de meeste velden.
//!
//! Objectstromen pakken we zelf uit, na het lezen door `lopdf` en begrensd:
//! hoogstens [`UITPAKGRENZEN`] (64 MiB per stroom, 256 MiB samen per leesronde).
//! Een stroom boven de grens, of met een filter dat niet begrensd uit te pakken
//! is (alles behalve geen filter of alleen `FlateDecode`), wordt overgeslagen en
//! het resultaat heet dan onvolledig.
//!
//! `lopdf` leest arrays en woordenboeken recursief. Een lineaire voorscan weigert
//! daarom elke plek waar een lezing dieper dan [`MAX_NESTDIEPTE`] zou nesten,
//! voordat `lopdf` iets leest.
//!
//! Staat het handtekeningwoordenboek meermaals in het bestand (zelfde
//! objectnummer), dan telt het exemplaar waarvan de objectkop binnen het eigen
//! bytebereik ligt: een later toegevoegd exemplaar kan reden of naam vervangen
//! zonder de handtekening te raken.
//!
//! Verwijzen meer velden naar hetzelfde handtekeningwoordenboek, dan telt het
//! één keer en wordt het één keer gelezen (geen kopie van `/Contents` per veld).
//! De veldnaam komt van het veld waarvan de objectkop binnen het bytebereik van
//! de handtekening ligt, anders van het eerste veld. Na
//! [`MAX_HANDTEKENINGVELDEN`] velden stopt het lezen en heet de lijst afgekapt.
//!
//! `/Contents` wordt nooit ontsleuteld (ISO 32000-1 §7.6.1, ISO 32000-2 §7.6.2);
//! tekstvelden in een versleuteld document wel, met het lege gebruikerswachtwoord.

use std::borrow::Cow;
use std::cell::OnceCell;
use std::collections::{HashMap, HashSet};
use std::panic::{catch_unwind, AssertUnwindSafe};

use lopdf::xref::{Xref, XrefEntry, XrefType};
use lopdf::{Dictionary, Document, Object, ObjectId, ObjectStream, Reader, Stream, StringFormat};

use super::ber::unix_tijd;

const MAX_VELDDIEPTE: usize = 32;
/// Hoogste nestdiepte van arrays en woordenboeken die we `lopdf` laten lezen.
const MAX_NESTDIEPTE: usize = 256;
/// Grens van `lopdf` voor geneste haakjes in een tekststring; dieper faalt de lezing.
const MAX_HAAKJES: usize = 100;
/// Grenzen voor het uitpakken van objectstromen (zie moduledocumentatie).
#[derive(Debug, Clone, Copy)]
struct Uitpakgrenzen {
    /// Hoogstens zoveel bytes uitgepakt per stroom.
    per_stroom: usize,
    /// Hoogstens zoveel bytes uitgepakt over alle stromen van één leesronde.
    totaal: usize,
}

const UITPAKGRENZEN: Uitpakgrenzen = Uitpakgrenzen { per_stroom: 64 << 20, totaal: 256 << 20 };
/// Hoogste aantal handtekeningvelden (lege meegeteld) dat we teruggeven.
pub const MAX_HANDTEKENINGVELDEN: usize = 1000;

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct SigWoordenboek {
    pub subfilter: Option<String>,
    /// `/Type`: `Sig` of `DocTimeStamp` (mag ontbreken).
    pub soort_type: Option<String>,
    /// Ruwe getallen uit `/ByteRange`; een niet-geheel getal wordt -1.
    pub bytebereik: Vec<i64>,
    /// Bytes van `/Contents` (hex-gedecodeerd, nooit ontsleuteld).
    pub contents: Vec<u8>,
    pub naam: Option<String>,
    pub reden: Option<String>,
    pub plaats: Option<String>,
    pub contact: Option<String>,
    /// `/M`, door de ondertekenaar opgegeven; geen bewijs.
    pub tijd_unix: Option<i64>,
    /// De objectkop van het gebruikte exemplaar ligt vóór het einde van het eigen
    /// bytebereik, dus het woordenboek valt onder de handtekening. Zo niet, dan
    /// zijn naam, reden, plaats, contact en `/M` niet mee ondertekend.
    pub woordenboek_ondertekend: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HandtekeningVeld {
    pub veldnaam: Option<String>,
    /// `None`: leeg handtekeningveld.
    pub waarde: Option<SigWoordenboek>,
}

/// De velden, en of het lezen op [`MAX_HANDTEKENINGVELDEN`] is afgebroken.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Veldenlijst {
    pub velden: Vec<HandtekeningVeld>,
    pub afgekapt: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PdfLeesFout {
    Onleesbaar(String),
}

enum Tekstsleutel {
    Geen,
    Sleutel(Vec<u8>),
    Onbekend,
}

/// De bestandsbytes met een lui opgebouwde index van objectkoppen.
struct Bron<'a> {
    bytes: &'a [u8],
    koppen: OnceCell<Vec<(u32, u16, usize)>>,
    per_object: OnceCell<HashMap<ObjectId, Vec<usize>>>,
}

impl<'a> Bron<'a> {
    fn new(bytes: &'a [u8]) -> Self {
        Bron { bytes, koppen: OnceCell::new(), per_object: OnceCell::new() }
    }

    /// Alle objectkoppen in bestandsvolgorde.
    fn koppen(&self) -> &[(u32, u16, usize)] {
        self.koppen.get_or_init(|| objectkoppen(self.bytes))
    }

    /// Posities van de koppen van `id`, oplopend.
    fn posities(&self, id: ObjectId) -> &[usize] {
        let index = self.per_object.get_or_init(|| {
            let mut index: HashMap<ObjectId, Vec<usize>> = HashMap::new();
            for &(nummer, generatie, positie) in self.koppen() {
                index.entry((nummer, generatie)).or_default().push(positie);
            }
            index
        });
        index.get(&id).map_or(&[], Vec::as_slice)
    }
}

/// Een handtekeningwoordenboek: als indirect object, of direct in een veld (dan
/// het adres van het object in het gelezen document, gedeeld via erfenis).
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
enum Waardesleutel {
    Object(ObjectId),
    Direct(usize),
}

struct Verzameling {
    uit: Vec<HandtekeningVeld>,
    bezocht: HashSet<ObjectId>,
    /// Handtekeningwoordenboeken die al bij een veld horen.
    waarden: HashSet<ObjectId>,
    /// Per handtekeningwoordenboek: positie in `uit`, en of de objectkop van het
    /// veld dat de naam levert binnen het bytebereik ligt.
    per_waarde: HashMap<Waardesleutel, (usize, bool)>,
    volledig: bool,
    afgekapt: bool,
}

impl Verzameling {
    /// Past er nog een veld bij? Zo niet, dan is de lijst afgekapt.
    fn plaats_over(&mut self) -> bool {
        if self.uit.len() >= MAX_HANDTEKENINGVELDEN {
            self.afgekapt = true;
        }
        !self.afgekapt
    }
}

/// Wat een veld van zijn voorouders erft (ISO 32000-1 §12.7.3.1, tabel 220).
#[derive(Clone, Copy, Default)]
struct Erfenis<'a> {
    ft: Option<&'a [u8]>,
    /// `/V` met het dichtstbijzijnde indirecte object dat het bevat.
    v: Option<(&'a Object, Option<ObjectId>)>,
    /// Dichtstbijzijnde indirecte object; nodig om strings te ontsleutelen.
    houder: Option<ObjectId>,
}

enum Opgelost<'a> {
    Gevonden(Option<ObjectId>, &'a Object),
    /// Verwijzing naar een vrij of onbekend object: null (ISO 32000-1 §7.3.10).
    Null,
    /// Het object hoort er te zijn maar is niet gelezen.
    Ontbreekt,
}

enum Herstel {
    Geen,
    TeDiep,
    Document(Document),
}

fn veilig<T>(f: impl FnOnce() -> T) -> Option<T> {
    catch_unwind(AssertUnwindSafe(f)).ok()
}

fn te_diep_fout() -> PdfLeesFout {
    PdfLeesFout::Onleesbaar(format!("te diep geneste PDF-structuur (meer dan {MAX_NESTDIEPTE} niveaus)"))
}

/// Alle handtekeningvelden, in de volgorde van het AcroForm; daarna velden die
/// alleen via de pagina-annotaties te vinden zijn.
#[cfg(test)]
pub fn lees_handtekeningvelden(bytes: &[u8]) -> Result<Vec<HandtekeningVeld>, PdfLeesFout> {
    lees_veldenlijst(bytes).map(|lijst| lijst.velden)
}

/// Alle handtekeningvelden (in de volgorde van het AcroForm, daarna velden die
/// alleen via de pagina-annotaties te vinden zijn), met de melding of de lijst
/// is afgekapt.
pub fn lees_veldenlijst(bytes: &[u8]) -> Result<Veldenlijst, PdfLeesFout> {
    lees_veldenlijst_binnen(bytes, UITPAKGRENZEN)
}

fn lees_veldenlijst_binnen(bytes: &[u8], grenzen: Uitpakgrenzen) -> Result<Veldenlijst, PdfLeesFout> {
    if te_diep_genest(bytes, &[]) {
        return Err(te_diep_fout());
    }
    let bron = Bron::new(bytes);
    let gewoon = veilig(|| Reader { buffer: bytes, document: Document::new() }.read(Some(zonder_streaminhoud)))
        .and_then(Result::ok);
    let mut beste: Option<Veldenlijst> = None;
    if let Some(mut doc) = gewoon {
        let stromen_volledig = match veilig(|| voeg_objectstromen_toe(&mut doc, bytes, grenzen)) {
            Some(Objectstromen::TeDiep) => return Err(te_diep_fout()),
            Some(Objectstromen::Gelezen { volledig }) => volledig,
            None => false,
        };
        match veilig(|| verzamel(&doc, &bron)) {
            // Afgekapt: het herstel vindt niet meer dan de grens.
            Some((lijst, _)) if lijst.afgekapt => return Ok(lijst),
            Some((lijst, true)) if stromen_volledig && !lijst.velden.is_empty() && doc.catalog().is_ok() => {
                return Ok(lijst)
            }
            Some((lijst, _)) => beste = Some(lijst),
            None => {}
        }
    }
    match veilig(|| herstel(&bron, grenzen)) {
        Some(Herstel::TeDiep) => return Err(te_diep_fout()),
        Some(Herstel::Document(doc)) => {
            if let Some((lijst, _)) = veilig(|| verzamel(&doc, &bron)) {
                if beste.as_ref().map_or(true, |b| lijst.velden.len() > b.velden.len()) {
                    beste = Some(lijst);
                }
            }
        }
        Some(Herstel::Geen) | None => {}
    }
    beste.ok_or_else(|| PdfLeesFout::Onleesbaar("geen PDF-structuur gevonden".to_string()))
}

/// Leesfilter voor `lopdf`: een gewone stream wordt zijn woordenboek, zonder
/// inhoud. Omdat het object daarna geen stream meer is, leest `lopdf` de inhoud
/// ook later niet alsnog in. Dat geldt ook voor een objectstroom: die pakt
/// [`voeg_objectstromen_toe`] daarna begrensd uit.
fn zonder_streaminhoud(id: ObjectId, object: &mut Object) -> Option<(ObjectId, Object)> {
    if let Object::Stream(stroom) = object {
        if stroom.dict.type_is(b"XRef") {
            return Some((id, Object::Null));
        }
        *object = Object::Dictionary(std::mem::take(&mut stroom.dict));
    }
    Some((id, object.clone()))
}

enum Objectstromen {
    /// `volledig`: geen stroom overgeslagen.
    Gelezen { volledig: bool },
    TeDiep,
}

/// Pakt de objectstromen van een door `lopdf` gelezen document begrensd uit en
/// voegt hun objecten toe, zoals `lopdf` dat zelf doet: een object op het
/// hoogste niveau gaat voor, en bij hetzelfde object in twee stromen wint de
/// stroom met het hoogste objectnummer.
fn voeg_objectstromen_toe(doc: &mut Document, bytes: &[u8], grenzen: Uitpakgrenzen) -> Objectstromen {
    let ids: Vec<ObjectId> = doc
        .objects
        .iter()
        .filter(|(_, o)| matches!(o, Object::Dictionary(d) if d.type_is(b"ObjStm")))
        .map(|(&id, _)| id)
        .collect();
    if ids.is_empty() {
        return Objectstromen::Gelezen { volledig: true };
    }
    let mut lezer = Reader { buffer: bytes, document: Document::new() };
    lezer.document.reference_table = doc.reference_table.clone();
    let mut over = grenzen.totaal;
    let mut volledig = true;
    let mut gevonden: std::collections::BTreeMap<ObjectId, Object> = std::collections::BTreeMap::new();
    for id in ids {
        let Ok(Object::Stream(mut stroom)) = lezer.get_object(id, &mut HashSet::new()) else {
            volledig = false;
            continue;
        };
        if !pak_begrensd_uit(&mut stroom, grenzen.per_stroom, &mut over) {
            volledig = false;
            continue;
        }
        if objectstroom_te_diep(&stroom) {
            return Objectstromen::TeDiep;
        }
        match veilig(|| ObjectStream::new(&mut stroom)) {
            Some(Ok(inhoud)) => gevonden.extend(inhoud.objects),
            _ => volledig = false,
        }
    }
    for (id, object) in gevonden {
        doc.objects.entry(id).or_insert(object);
    }
    Objectstromen::Gelezen { volledig }
}

/// Pakt de inhoud van een objectstroom begrensd uit: hoogstens `per_stroom`
/// bytes en niet meer dan er in `over` nog vrij is (dat wordt verlaagd). Zonder
/// filter is er niets uit te pakken. `false`: boven de grens, of een filter dat
/// niet begrensd uit te pakken is; de stroom is dan niet te gebruiken.
fn pak_begrensd_uit(stroom: &mut Stream, per_stroom: usize, over: &mut usize) -> bool {
    use std::io::Read;
    if stroom.dict.get(b"Filter").is_err() {
        return true;
    }
    match stroom.filters() {
        Ok(filters) if filters.len() == 1 && filters[0] == "FlateDecode" => {}
        _ => return false,
    }
    let grens = per_stroom.min(*over);
    let mut uit = Vec::new();
    let limiet = u64::try_from(grens).unwrap_or(u64::MAX).saturating_add(1);
    // Een leesfout telt als einde van de stroom, zoals in `lopdf`.
    let _ = flate2::read::ZlibDecoder::new(stroom.content.as_slice()).take(limiet).read_to_end(&mut uit);
    if uit.len() > grens {
        return false;
    }
    *over -= uit.len();
    if stroom.dict.get(b"DecodeParms").is_ok() {
        // Een voorspeller maakt de uitvoer niet groter; `lopdf` past hem toe en
        // pakt daarvoor dezelfde, nu gemeten invoer nog eens uit.
        stroom.decompress();
    } else {
        stroom.dict.remove(b"Filter");
        stroom.set_content(uit);
    }
    true
}

fn verzamel(doc: &Document, bron: &Bron) -> (Veldenlijst, bool) {
    let sleutel = veilig(|| tekstsleutel(doc)).unwrap_or(Tekstsleutel::Onbekend);
    let mut staat = Verzameling {
        uit: Vec::new(),
        bezocht: HashSet::new(),
        waarden: HashSet::new(),
        per_waarde: HashMap::new(),
        volledig: true,
        afgekapt: false,
    };
    let geen = Erfenis::default();
    if let Some(velden) = veldenlijst(doc) {
        for v in velden {
            loop_veld(doc, bron, &sleutel, v, None, geen, 0, &mut staat);
        }
    }
    for annotatie in pagina_annotaties(doc) {
        if let Some(wortel) = veldwortel(doc, annotatie) {
            loop_veld(doc, bron, &sleutel, wortel, None, geen, 0, &mut staat);
        }
    }
    if staat.uit.is_empty() {
        // Geen formulier te vinden: losse handtekeningvelden en -woordenboeken.
        for (&id, obj) in &doc.objects {
            let Ok(d) = obj.as_dict() else { continue };
            if d.get(b"FT").and_then(Object::as_name).ok() == Some(b"Sig".as_slice()) && !d.has(b"Parent") {
                loop_knoop(doc, bron, &sleutel, Some(id), obj, None, geen, 0, &mut staat);
            }
        }
        for (&id, obj) in &doc.objects {
            let Ok(d) = obj.as_dict() else { continue };
            if d.has(b"ByteRange") && d.has(b"Contents") && !staat.waarden.contains(&id) {
                if !staat.plaats_over() {
                    break;
                }
                let waarde = sig_woordenboek(doc, bron, &sleutel, d, Some(id), None);
                staat.uit.push(HandtekeningVeld { veldnaam: None, waarde: Some(waarde) });
            }
        }
    }
    (Veldenlijst { velden: staat.uit, afgekapt: staat.afgekapt }, staat.volledig)
}

fn veldenlijst(doc: &Document) -> Option<&Vec<Object>> {
    let acroform = doc.catalog().ok()?.get(b"AcroForm").ok()?;
    let (_, acroform) = doc.dereference(acroform).ok()?;
    let velden = acroform.as_dict().ok()?.get(b"Fields").ok()?;
    doc.dereference(velden).ok()?.1.as_array().ok()
}

/// `/Annots` van alle pagina's, in paginavolgorde.
fn pagina_annotaties(doc: &Document) -> Vec<&Object> {
    let mut uit = Vec::new();
    let Some(wortel) = doc.catalog().ok().and_then(|c| c.get(b"Pages").ok()) else {
        return uit;
    };
    let mut stapel = vec![(wortel, 0usize)];
    let mut gezien = HashSet::new();
    while let Some((knoop, diepte)) = stapel.pop() {
        if diepte > MAX_NESTDIEPTE {
            continue;
        }
        let Ok((id, obj)) = doc.dereference(knoop) else { continue };
        if id.is_some_and(|id| !gezien.insert(id)) {
            continue;
        }
        let Ok(d) = obj.as_dict() else { continue };
        let lijst = |sleutel: &[u8]| {
            d.get(sleutel).ok().and_then(|o| doc.dereference(o).ok()).and_then(|(_, o)| o.as_array().ok())
        };
        if let Some(annotaties) = lijst(b"Annots") {
            uit.extend(annotaties.iter());
        }
        if let Some(kinderen) = lijst(b"Kids") {
            stapel.extend(kinderen.iter().rev().map(|k| (k, diepte + 1)));
        }
    }
    uit
}

/// Het hoogste veld boven een annotatie die bij een formulierveld hoort.
fn veldwortel<'a>(doc: &'a Document, annotatie: &'a Object) -> Option<&'a Object> {
    let d = doc.dereference(annotatie).ok()?.1.as_dict().ok()?;
    if !(d.has(b"FT") || d.has(b"Parent") || d.has(b"T")) {
        return None;
    }
    let mut huidig = annotatie;
    for _ in 0..=MAX_VELDDIEPTE {
        match doc.dereference(huidig).ok()?.1.as_dict().ok()?.get(b"Parent") {
            Ok(ouder) => huidig = ouder,
            Err(_) => return Some(huidig),
        }
    }
    None
}

/// Vrij (null) of ontbrekend: een vrij object staat vrij in de xref, of
/// ontbreekt zowel in de xref als in het bestand.
fn los_op<'a>(doc: &'a Document, bron: &Bron, mut obj: &'a Object) -> Opgelost<'a> {
    let mut id = None;
    for _ in 0..=MAX_VELDDIEPTE {
        let Object::Reference(verwijzing) = obj else {
            return Opgelost::Gevonden(id, obj);
        };
        id = Some(*verwijzing);
        match doc.objects.get(verwijzing) {
            Some(o) => obj = o,
            None if is_vrij(doc, bron, *verwijzing) => return Opgelost::Null,
            None => return Opgelost::Ontbreekt,
        }
    }
    Opgelost::Ontbreekt
}

fn is_vrij(doc: &Document, bron: &Bron, id: ObjectId) -> bool {
    match doc.reference_table.get(id.0) {
        Some(XrefEntry::Free | XrefEntry::UnusableFree) => true,
        Some(XrefEntry::Normal { generation, .. }) => *generation != id.1,
        Some(XrefEntry::Compressed { .. }) => id.1 != 0,
        None => bron.posities(id).is_empty(),
    }
}

fn is_veldkind(doc: &Document, kind: &Object) -> bool {
    let Some(d) = doc.dereference(kind).ok().and_then(|(_, k)| k.as_dict().ok()) else {
        return false;
    };
    let widget = d.get(b"Subtype").and_then(Object::as_name).ok() == Some(b"Widget".as_slice());
    d.has(b"T") && !(widget && !d.has(b"FT") && !d.has(b"Kids"))
}

#[allow(clippy::too_many_arguments)]
fn loop_veld<'a>(
    doc: &'a Document,
    bron: &Bron,
    sleutel: &Tekstsleutel,
    obj: &'a Object,
    ouder_naam: Option<&str>,
    erfenis: Erfenis<'a>,
    diepte: usize,
    staat: &mut Verzameling,
) {
    if staat.afgekapt {
        return;
    }
    if diepte > MAX_VELDDIEPTE {
        staat.volledig = false;
        return;
    }
    match los_op(doc, bron, obj) {
        Opgelost::Gevonden(id, obj) => loop_knoop(doc, bron, sleutel, id, obj, ouder_naam, erfenis, diepte, staat),
        Opgelost::Null => {}
        Opgelost::Ontbreekt => staat.volledig = false,
    }
}

#[allow(clippy::too_many_arguments)]
fn loop_knoop<'a>(
    doc: &'a Document,
    bron: &Bron,
    sleutel: &Tekstsleutel,
    id: Option<ObjectId>,
    obj: &'a Object,
    ouder_naam: Option<&str>,
    erfenis: Erfenis<'a>,
    diepte: usize,
    staat: &mut Verzameling,
) {
    if staat.afgekapt || id.is_some_and(|id| !staat.bezocht.insert(id)) {
        return;
    }
    let Ok(d) = obj.as_dict() else { return };
    let houder = id.or(erfenis.houder);
    let deel = d.get(b"T").ok().and_then(|t| tekst(sleutel, t, houder));
    let naam = match (ouder_naam, deel) {
        (Some(o), Some(t)) => Some(format!("{o}.{t}")),
        (None, Some(t)) => Some(t),
        (o, None) => o.map(str::to_string),
    };
    let ft = d.get(b"FT").ok().and_then(|f| f.as_name().ok()).or(erfenis.ft);
    let v = d.get(b"V").ok().map(|v| (v, houder)).or(erfenis.v);
    if let Ok(kids) = d.get(b"Kids") {
        match los_op(doc, bron, kids) {
            Opgelost::Gevonden(_, Object::Array(kids)) => {
                let veldkinderen: Vec<&Object> = kids.iter().filter(|k| is_veldkind(doc, k)).collect();
                if !veldkinderen.is_empty() {
                    let erfenis = Erfenis { ft, v, houder };
                    for k in veldkinderen {
                        loop_veld(doc, bron, sleutel, k, naam.as_deref(), erfenis, diepte + 1, staat);
                    }
                    return;
                }
            }
            Opgelost::Ontbreekt => staat.volledig = false,
            _ => {}
        }
    }
    if ft != Some(b"Sig".as_slice()) {
        return;
    }
    let waarde = match v {
        None => None,
        Some((v, v_houder)) => match los_op(doc, bron, v) {
            Opgelost::Gevonden(vid, Object::Dictionary(vd)) => {
                let waardesleutel = match vid {
                    Some(vid) => Waardesleutel::Object(vid),
                    None => Waardesleutel::Direct(std::ptr::from_ref(vd) as usize),
                };
                if let Some(&(index, binnen)) = staat.per_waarde.get(&waardesleutel) {
                    // Zelfde handtekening bij een ander veld: niet opnieuw lezen.
                    if !binnen {
                        if let Some(eerder) = staat.uit.get_mut(index) {
                            let einde = eerder.waarde.as_ref().and_then(|w| einde_uit(&w.bytebereik));
                            if kop_binnen(doc, houder, einde) {
                                eerder.veldnaam = naam;
                                staat.per_waarde.insert(waardesleutel, (index, true));
                            }
                        }
                    }
                    return;
                }
                if !staat.plaats_over() {
                    return;
                }
                if let Some(vid) = vid {
                    staat.waarden.insert(vid);
                }
                let w = sig_woordenboek(doc, bron, sleutel, vd, vid, v_houder);
                let binnen = kop_binnen(doc, houder, einde_uit(&w.bytebereik));
                staat.per_waarde.insert(waardesleutel, (staat.uit.len(), binnen));
                Some(w)
            }
            Opgelost::Gevonden(..) | Opgelost::Null => None,
            Opgelost::Ontbreekt => {
                staat.volledig = false;
                None
            }
        },
    };
    if waarde.is_none() && !staat.plaats_over() {
        return;
    }
    staat.uit.push(HandtekeningVeld { veldnaam: naam, waarde });
}

/// Ligt de objectkop van `id` (zoals de xref hem aanwijst) vóór `einde`?
fn kop_binnen(doc: &Document, id: Option<ObjectId>, einde: Option<usize>) -> bool {
    id.and_then(|id| huidige_positie(doc, id)).zip(einde).is_some_and(|(p, einde)| p < einde)
}

fn bytebereik_getallen(doc: &Document, d: &Dictionary) -> Vec<i64> {
    d.get(b"ByteRange")
        .ok()
        .and_then(|o| doc.dereference(o).ok())
        .and_then(|(_, o)| o.as_array().ok())
        .map(|a| a.iter().map(|x| x.as_i64().unwrap_or(-1)).collect())
        .unwrap_or_default()
}

/// Eerste byte ná het bytebereik, als dat uit vier niet-negatieve getallen bestaat.
fn bereik_einde(doc: &Document, d: &Dictionary) -> Option<usize> {
    einde_uit(&bytebereik_getallen(doc, d))
}

fn einde_uit(getallen: &[i64]) -> Option<usize> {
    let [a, b, c, e] = <[i64; 4]>::try_from(getallen).ok()?;
    if a < 0 || b < 0 {
        return None;
    }
    usize::try_from(c).ok()?.checked_add(usize::try_from(e).ok()?)
}

/// Eén object lezen op een bekende positie in het bestand.
fn lees_object_op(bytes: &[u8], id: ObjectId, positie: usize) -> Option<Object> {
    let offset = u32::try_from(positie).ok()?;
    let mut lezer = Reader { buffer: bytes, document: Document::new() };
    lezer.document.reference_table.insert(id.0, XrefEntry::Normal { offset, generation: id.1 });
    veilig(|| lezer.get_object(id, &mut HashSet::new())).and_then(Result::ok)
}

/// Het exemplaar van handtekeningwoordenboek `id` dat binnen zijn eigen
/// bytebereik ligt (het nieuwste als er meer zijn); anders het huidige.
fn kies_exemplaar<'d>(doc: &Document, bron: &Bron, id: ObjectId, huidig: &'d Dictionary) -> (Cow<'d, Dictionary>, bool) {
    for &positie in bron.posities(id).iter().rev() {
        let Some(Object::Dictionary(kandidaat)) = lees_object_op(bron.bytes, id, positie) else {
            continue;
        };
        if bereik_einde(doc, &kandidaat).is_some_and(|einde| positie < einde) {
            return (Cow::Owned(kandidaat), true);
        }
    }
    (Cow::Borrowed(huidig), false)
}

/// Positie van de objectkop van het exemplaar van `id` dat de xref aanwijst.
fn huidige_positie(doc: &Document, id: ObjectId) -> Option<usize> {
    match doc.reference_table.get(id.0)? {
        XrefEntry::Normal { offset, generation } if *generation == id.1 => usize::try_from(*offset).ok(),
        _ => None,
    }
}

/// `vid`: het woordenboek als indirect object; `houder`: anders het indirecte
/// object waar het direct in staat.
fn sig_woordenboek(
    doc: &Document,
    bron: &Bron,
    sleutel: &Tekstsleutel,
    d: &Dictionary,
    vid: Option<ObjectId>,
    houder: Option<ObjectId>,
) -> SigWoordenboek {
    let (d, woordenboek_ondertekend) = match (vid, houder) {
        (Some(id), _) => kies_exemplaar(doc, bron, id, d),
        (None, Some(h)) => {
            let binnen = huidige_positie(doc, h).zip(bereik_einde(doc, d)).is_some_and(|(p, einde)| p < einde);
            (Cow::Borrowed(d), binnen)
        }
        (None, None) => (Cow::Borrowed(d), false),
    };
    let bron_id = vid.or(houder);
    let naam = |k: &[u8]| d.get(k).ok().and_then(|o| o.as_name().ok()).map(|n| String::from_utf8_lossy(n).into_owned());
    let tekstveld = |k: &[u8]| d.get(k).ok().and_then(|o| tekst(sleutel, o, bron_id));
    let contents = d.get(b"Contents").ok().and_then(|o| o.as_str().ok()).map(<[u8]>::to_vec).unwrap_or_default();
    SigWoordenboek {
        subfilter: naam(b"SubFilter"),
        soort_type: naam(b"Type"),
        bytebereik: bytebereik_getallen(doc, &d),
        contents,
        naam: tekstveld(b"Name"),
        reden: tekstveld(b"Reason"),
        plaats: tekstveld(b"Location"),
        contact: tekstveld(b"ContactInfo"),
        tijd_unix: tekstveld(b"M").and_then(|m| pdf_datum_unix(&m)),
        woordenboek_ondertekend,
    }
}

fn tekstsleutel(doc: &Document) -> Tekstsleutel {
    if doc.trailer.get(b"Encrypt").is_err() {
        return Tekstsleutel::Geen;
    }
    match lopdf::encryption::get_encryption_key(doc, "", true) {
        Ok(k) => Tekstsleutel::Sleutel(k),
        Err(_) => Tekstsleutel::Onbekend,
    }
}

fn tekst(sleutel: &Tekstsleutel, obj: &Object, bron: Option<ObjectId>) -> Option<String> {
    let ruw = obj.as_str().ok()?;
    let bytes = match (sleutel, bron) {
        (Tekstsleutel::Geen, _) => ruw.to_vec(),
        (Tekstsleutel::Sleutel(k), Some(id)) => lopdf::encryption::decrypt_object(k, id, obj).ok()?,
        _ => return None,
    };
    lopdf::decode_text_string(&Object::String(bytes, StringFormat::Literal)).ok()
}

fn is_wit(b: u8) -> bool {
    matches!(b, b' ' | b'\n' | b'\r' | b'\t' | b'\x0c' | b'\0')
}

fn is_scheiding(b: u8) -> bool {
    matches!(b, b'(' | b')' | b'<' | b'>' | b'[' | b']' | b'{' | b'}' | b'/' | b'%')
}

fn is_gewoon(b: u8) -> bool {
    !is_wit(b) && !is_scheiding(b)
}

/// Staat op `p` een objectkop `N G obj`?
fn is_kop(bytes: &[u8], p: usize) -> bool {
    bytes.get(p..).is_some_and(|r| r.starts_with(b"obj"))
        && bytes.get(p + 3).map_or(true, |b| !b.is_ascii_alphanumeric())
        && kop_voor(bytes, p).is_some()
}

/// Posities van `obj` in elke objectkop die de parser van `lopdf` vanaf een
/// willekeurige positie accepteert: `N S G S? obj`, met `S` een of meer
/// witruimtetekens of commentaren (`%` tot en met een regeleinde). Ruimer dan
/// [`objectkoppen`]: geen eisen aan wat vóór `N` of ná `obj` staat, en `N` mag
/// midden in een getal beginnen. Lineair, als verzameling toestanden.
fn kopposities(bytes: &[u8]) -> Vec<usize> {
    const GETAL1: u8 = 1;
    /// Scheiding na het eerste getal; daarna mag het tweede getal.
    const SCHEIDING: u8 = 2;
    const COMMENTAAR1: u8 = 4;
    const GETAL2: u8 = 8;
    /// Witruimte na het tweede getal.
    const NA_GETAL2: u8 = 16;
    const COMMENTAAR2: u8 = 32;
    const O: u8 = 64;
    const OB: u8 = 128;
    let mut uit = Vec::new();
    let mut staat = 0u8;
    for (p, &b) in bytes.iter().enumerate() {
        let mut nieuw = 0u8;
        let regeleinde = b == b'\r' || b == b'\n';
        if staat & COMMENTAAR1 != 0 {
            nieuw |= if regeleinde { SCHEIDING } else { COMMENTAAR1 };
        }
        if staat & COMMENTAAR2 != 0 {
            nieuw |= if regeleinde { NA_GETAL2 } else { COMMENTAAR2 };
        }
        if b.is_ascii_digit() {
            nieuw |= GETAL1;
            if staat & (SCHEIDING | GETAL2) != 0 {
                nieuw |= GETAL2;
            }
        } else if is_wit(b) {
            if staat & (GETAL1 | SCHEIDING) != 0 {
                nieuw |= SCHEIDING;
            }
            if staat & (GETAL2 | NA_GETAL2) != 0 {
                nieuw |= NA_GETAL2;
            }
        } else if b == b'%' {
            if staat & (GETAL1 | SCHEIDING) != 0 {
                nieuw |= COMMENTAAR1;
            }
            if staat & (GETAL2 | NA_GETAL2) != 0 {
                nieuw |= COMMENTAAR2;
            }
        } else if b == b'o' && staat & (GETAL2 | NA_GETAL2) != 0 {
            nieuw |= O;
        } else if b == b'b' && staat & O != 0 {
            nieuw |= OB;
        } else if b == b'j' && staat & OB != 0 {
            uit.push(p.saturating_sub(2));
        }
        staat = nieuw;
    }
    uit
}

/// Posities van alle objectkoppen `N G obj`: (nummer, generatie, begin van N).
fn objectkoppen(bytes: &[u8]) -> Vec<(u32, u16, usize)> {
    let mut uit = Vec::new();
    for (p, &b) in bytes.iter().enumerate() {
        if b == b'o' && is_kop(bytes, p) {
            if let Some(kop) = kop_voor(bytes, p) {
                uit.push(kop);
            }
        }
    }
    uit
}

fn kop_voor(bytes: &[u8], obj: usize) -> Option<(u32, u16, usize)> {
    let terug_zolang = |mut i: usize, f: fn(u8) -> bool| {
        while i > 0 && bytes.get(i - 1).is_some_and(|&b| f(b)) {
            i -= 1;
        }
        i
    };
    let wit1 = terug_zolang(obj, is_wit);
    let gen_begin = terug_zolang(wit1, |b| b.is_ascii_digit());
    let wit2 = terug_zolang(gen_begin, is_wit);
    let num_begin = terug_zolang(wit2, |b| b.is_ascii_digit());
    if wit1 == obj || gen_begin == wit1 || wit2 == gen_begin || num_begin == wit2 {
        return None;
    }
    if num_begin > 0 && bytes.get(num_begin - 1).is_some_and(|b| b.is_ascii_alphanumeric()) {
        return None;
    }
    let generatie = std::str::from_utf8(bytes.get(gen_begin..wit1)?).ok()?.parse().ok()?;
    let nummer = std::str::from_utf8(bytes.get(num_begin..wit2)?).ok()?.parse().ok()?;
    Some((nummer, generatie, num_begin))
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
enum Modus {
    Normaal,
    Naam,
    /// Binnen een tekststring, met het aantal open haakjes.
    Tekst(usize),
    Hex,
    Commentaar,
    Stroom,
}

/// Eén mogelijke lezing: hoe `lopdf` de bytes ziet vanaf een bepaald beginpunt.
#[derive(Clone, Copy, Debug)]
struct Lezing {
    modus: Modus,
    diepte: usize,
    /// Zoveel volgende bytes horen nog bij het huidige teken of woord.
    over: usize,
}

/// Kan een lezing ergens in `bytes` dieper dan [`MAX_NESTDIEPTE`] nesten?
///
/// Lineair. Tekststrings (met escapes en geneste haakjes), hex-strings, namen,
/// commentaar en stream-inhoud tellen niet mee. Omdat `lopdf` ook midden in zo'n
/// stuk kan beginnen (een objectkop of `xref` in een string of stream, bij het
/// herstel of via een xref-positie), start op elke objectkop die de parser van
/// `lopdf` zou accepteren ([`kopposities`]), op elke `xref` en op `beginpunten`
/// een extra lezing. Lezingen in dezelfde toestand vallen samen
/// op de grootste diepte, dus de uitkomst is een bovengrens.
fn te_diep_genest(bytes: &[u8], beginpunten: &[usize]) -> bool {
    let mut lezingen = vec![Lezing { modus: Modus::Normaal, diepte: 0, over: 0 }];
    let mut punten = kopposities(bytes);
    punten.extend_from_slice(beginpunten);
    punten.sort_unstable();
    punten.dedup();
    let mut beginpunten = punten.into_iter().peekable();
    let mut p = 0;
    while let Some(&b) = bytes.get(p) {
        // Alleen stream-inhoud: door naar het eerstvolgende byte dat ertoe doet
        // (`endstream`, `xref` of een beginpunt, waaronder elke objectkop).
        if let [Lezing { modus: Modus::Stroom, over: 0, .. }] = lezingen.as_slice() {
            let grens = beginpunten.peek().copied().unwrap_or(usize::MAX);
            let mut q = p;
            while q < grens {
                let telt = match bytes.get(q) {
                    None => true,
                    Some(b'e') => bytes.get(q..).is_some_and(|r| r.starts_with(b"endstream")),
                    Some(b'x') => bytes.get(q..).is_some_and(|r| r.starts_with(b"xref")),
                    Some(_) => false,
                };
                if telt {
                    break;
                }
                q += 1;
            }
            if q > p {
                p = q;
                continue;
            }
        }
        let mut nieuw = false;
        while beginpunten.next_if(|&s| s <= p).is_some() {
            nieuw = true;
        }
        if b == b'x' && bytes.get(p..).is_some_and(|r| r.starts_with(b"xref")) {
            nieuw = true;
        }
        if nieuw {
            lezingen.push(Lezing { modus: Modus::Normaal, diepte: 0, over: 0 });
        }
        lezingen.retain_mut(|l| stap(l, bytes, p, b));
        if lezingen.iter().any(|l| l.diepte > MAX_NESTDIEPTE) {
            return true;
        }
        if lezingen.len() > 1 {
            lezingen.sort_by(|x, y| (x.modus, x.over, y.diepte).cmp(&(y.modus, y.over, x.diepte)));
            lezingen.dedup_by(|x, y| x.modus == y.modus && x.over == y.over);
        }
        p += 1;
    }
    false
}

/// Verwerkt byte `b` op positie `p`; `false` als de lezing daar stopt.
fn stap(l: &mut Lezing, bytes: &[u8], p: usize, b: u8) -> bool {
    if l.over > 0 {
        l.over -= 1;
        return true;
    }
    match l.modus {
        Modus::Normaal => normaal(l, bytes, p, b),
        Modus::Naam if is_gewoon(b) => {}
        Modus::Naam => {
            l.modus = Modus::Normaal;
            normaal(l, bytes, p, b);
        }
        Modus::Tekst(n) => match b {
            b'\\' => l.over = 1,
            b'(' if n > MAX_HAAKJES => return false,
            b'(' => l.modus = Modus::Tekst(n + 1),
            b')' if n <= 1 => l.modus = Modus::Normaal,
            b')' => l.modus = Modus::Tekst(n - 1),
            _ => {}
        },
        Modus::Hex => {
            if b == b'>' {
                l.modus = Modus::Normaal;
            }
        }
        Modus::Commentaar => {
            if b == b'\r' || b == b'\n' {
                l.modus = Modus::Normaal;
            }
        }
        Modus::Stroom => {
            if b == b'e' && woord_op(bytes, p) == Some(b"endstream".as_slice()) {
                l.modus = Modus::Normaal;
                l.over = b"endstream".len() - 1;
            }
        }
    }
    true
}

/// Het woord (reeks gewone tekens) dat op `p` begint, als het daar begint.
fn woord_op(bytes: &[u8], p: usize) -> Option<&[u8]> {
    if p.checked_sub(1).and_then(|q| bytes.get(q)).is_some_and(|&v| is_gewoon(v)) {
        return None;
    }
    let rest = bytes.get(p..)?;
    let lengte = rest.iter().take_while(|&&x| is_gewoon(x)).count();
    rest.get(..lengte).filter(|w| !w.is_empty())
}

fn normaal(l: &mut Lezing, bytes: &[u8], p: usize, b: u8) {
    let volgende = bytes.get(p + 1).copied();
    match b {
        b'%' => l.modus = Modus::Commentaar,
        b'(' => l.modus = Modus::Tekst(1),
        b'/' => l.modus = Modus::Naam,
        b'[' => l.diepte += 1,
        b']' => l.diepte = l.diepte.saturating_sub(1),
        b'<' if volgende == Some(b'<') => {
            l.diepte += 1;
            l.over = 1;
        }
        b'<' => l.modus = Modus::Hex,
        b'>' if volgende == Some(b'>') => {
            l.diepte = l.diepte.saturating_sub(1);
            l.over = 1;
        }
        _ => {
            if let Some(woord) = woord_op(bytes, p) {
                match woord {
                    // Hier stopt elke lezing die al bezig was.
                    b"obj" | b"endobj" | b"xref" | b"trailer" | b"startxref" => l.diepte = 0,
                    b"stream" => l.modus = Modus::Stroom,
                    _ => {}
                }
                l.over = woord.len() - 1;
            }
        }
    }
}

/// Nestdiepte van een (uitgepakte) objectstroom: `lopdf` leest objecten vanaf
/// de posities in de index, die ook midden in een string kunnen wijzen.
fn objectstroom_te_diep(stroom: &Stream) -> bool {
    let inhoud = &stroom.content;
    let mut beginpunten = vec![0];
    let eerste = stroom.dict.get(b"First").and_then(Object::as_i64).ok().and_then(|f| usize::try_from(f).ok());
    if let Some(eerste) = eerste {
        let index = inhoud.get(..eerste).unwrap_or(inhoud);
        for getal in index.split(|&b| is_wit(b)) {
            let waarde = std::str::from_utf8(getal).ok().and_then(|g| g.parse::<usize>().ok());
            if let Some(begin) = waarde.and_then(|w| eerste.checked_add(w)) {
                beginpunten.push(begin);
            }
        }
    }
    beginpunten.sort_unstable();
    beginpunten.dedup();
    te_diep_genest(inhoud, &beginpunten)
}

/// Laatste `sleutel N G R` in het bestand, zoals `/Root 1 0 R` in de trailer.
fn laatste_verwijzing(bytes: &[u8], sleutel: &[u8]) -> Option<(u32, u16)> {
    laatste_na(bytes, sleutel, verwijzing_na)
}

/// Laatste `/ID [<…><…>]` in het bestand.
fn laatste_id(bytes: &[u8]) -> Option<Object> {
    laatste_na(bytes, b"/ID", id_na)
}

fn laatste_na<T>(bytes: &[u8], sleutel: &[u8], lees: fn(&[u8]) -> Option<T>) -> Option<T> {
    let mut p = bytes.len().checked_sub(sleutel.len())?;
    loop {
        if bytes.get(p..)?.starts_with(sleutel) {
            if let Some(v) = lees(bytes.get(p + sleutel.len()..)?) {
                return Some(v);
            }
        }
        if p == 0 {
            return None;
        }
        p -= 1;
    }
}

fn vooruit_zolang(b: &[u8], mut i: usize, f: fn(u8) -> bool) -> usize {
    while b.get(i).is_some_and(|&x| f(x)) {
        i += 1;
    }
    i
}

fn verwijzing_na(b: &[u8]) -> Option<(u32, u16)> {
    let n1 = vooruit_zolang(b, 0, is_wit);
    let n2 = vooruit_zolang(b, n1, |x| x.is_ascii_digit());
    let g1 = vooruit_zolang(b, n2, is_wit);
    let g2 = vooruit_zolang(b, g1, |x| x.is_ascii_digit());
    let r = vooruit_zolang(b, g2, is_wit);
    if n2 == n1 || g1 == n2 || g2 == g1 || b.get(r) != Some(&b'R') {
        return None;
    }
    let nummer = std::str::from_utf8(b.get(n1..n2)?).ok()?.parse().ok()?;
    let generatie = std::str::from_utf8(b.get(g1..g2)?).ok()?.parse().ok()?;
    Some((nummer, generatie))
}

/// `[<hex><hex>]` direct na `/ID`.
fn id_na(b: &[u8]) -> Option<Object> {
    let mut i = vooruit_zolang(b, 0, is_wit);
    if b.get(i) != Some(&b'[') {
        return None;
    }
    let mut delen = Vec::new();
    for _ in 0..2 {
        i = vooruit_zolang(b, i + 1, is_wit);
        if b.get(i) != Some(&b'<') {
            return None;
        }
        let begin = i + 1;
        i = begin + b.get(begin..)?.iter().position(|&x| x == b'>')?;
        delen.push(Object::String(hex_bytes(b.get(begin..i)?)?, StringFormat::Hexadecimal));
    }
    i = vooruit_zolang(b, i + 1, is_wit);
    (b.get(i) == Some(&b']')).then_some(Object::Array(delen))
}

/// Hex-cijfers (witruimte toegestaan) naar bytes; een oneven laatste cijfer krijgt een 0.
fn hex_bytes(hex: &[u8]) -> Option<Vec<u8>> {
    let mut cijfers = Vec::with_capacity(hex.len());
    for &c in hex {
        if is_wit(c) {
            continue;
        }
        cijfers.push(char::from(c).to_digit(16)? as u8);
    }
    Some(cijfers.chunks(2).map(|paar| (paar.first().copied().unwrap_or(0) << 4) | paar.get(1).copied().unwrap_or(0)).collect())
}

/// Document opbouwen uit gescande objectkoppen, zonder xref of trailer te
/// vertrouwen. Losse objecten en objecten uit objectstromen: de nieuwste positie
/// in het bestand wint (een objectstroom telt op de positie van haar kop).
fn herstel(bron: &Bron, grenzen: Uitpakgrenzen) -> Herstel {
    let bytes = bron.bytes;
    let koppen = bron.koppen();
    if koppen.is_empty() {
        return Herstel::Geen;
    }
    let mut xref = Xref::new(0, XrefType::CrossReferenceTable);
    for &(nummer, generatie, begin) in koppen {
        if let Ok(offset) = u32::try_from(begin) {
            xref.insert(nummer, XrefEntry::Normal { offset, generation: generatie });
        }
    }
    xref.size = xref.max_id() + 1;
    let mut lezer = Reader { buffer: bytes, document: Document::new() };
    lezer.document.reference_table = xref.clone();
    let mut doc = Document::new();
    let mut herkomst: HashMap<ObjectId, usize> = HashMap::new();
    let mut stromen: Vec<(usize, Stream)> = Vec::new();
    for (&nummer, entry) in &xref.entries {
        let XrefEntry::Normal { offset, generation } = *entry else { continue };
        let id = (nummer, generation);
        let Ok(obj) = lezer.get_object(id, &mut HashSet::new()) else { continue };
        let positie = offset as usize;
        let obj = match obj {
            Object::Stream(stroom) if stroom.dict.type_is(b"ObjStm") => {
                let dict = stroom.dict.clone();
                stromen.push((positie, stroom));
                Object::Dictionary(dict)
            }
            mut obj => {
                if let Object::Stream(stroom) = &mut obj {
                    if !stroom.dict.type_is(b"XRef") {
                        obj = Object::Dictionary(std::mem::take(&mut stroom.dict));
                    }
                }
                obj
            }
        };
        herkomst.insert(id, positie);
        doc.objects.insert(id, obj);
    }
    stromen.sort_by_key(|(positie, _)| std::cmp::Reverse(*positie));
    let mut over = grenzen.totaal;
    for (positie, mut stroom) in stromen {
        if !pak_begrensd_uit(&mut stroom, grenzen.per_stroom, &mut over) {
            continue;
        }
        if objectstroom_te_diep(&stroom) {
            return Herstel::TeDiep;
        }
        let Some(Ok(inhoud)) = veilig(|| ObjectStream::new(&mut stroom)) else { continue };
        for (id, obj) in inhoud.objects {
            if herkomst.get(&id).is_some_and(|&p| p > positie) {
                continue;
            }
            herkomst.insert(id, positie);
            doc.objects.insert(id, obj);
        }
    }
    doc.max_id = xref.max_id();
    doc.reference_table = xref;
    if let Some(root) = laatste_verwijzing(bytes, b"/Root") {
        doc.trailer.set("Root", Object::Reference(root));
    }
    if let Some(versleuteling) = laatste_verwijzing(bytes, b"/Encrypt") {
        doc.trailer.set("Encrypt", Object::Reference(versleuteling));
    }
    if let Some(id) = laatste_id(bytes) {
        doc.trailer.set("ID", id);
    }
    Herstel::Document(doc)
}

/// PDF-datum (ISO 32000-1 §7.9.4) naar Unix-tijd. Ontbrekende delen krijgen hun
/// laagste waarde; zonder tijdzone geldt UTC. Een aanwezig maar ongeldig deel
/// (zoals `D:2018xx01`) geeft `None`.
pub fn pdf_datum_unix(tekst: &str) -> Option<i64> {
    let s = tekst.strip_prefix("D:").unwrap_or(tekst).as_bytes();
    let getal = |van: usize, lengte: usize| -> Option<u32> {
        let deel = s.get(van..van + lengte)?;
        if !deel.iter().all(u8::is_ascii_digit) {
            return None;
        }
        std::str::from_utf8(deel).ok()?.parse().ok()
    };
    let jaar = getal(0, 4)?;
    // maand, dag, uur, minuut, seconde
    let mut delen = [1u32, 1, 0, 0, 0];
    let mut p = 4;
    for deel in &mut delen {
        match s.get(p) {
            None | Some(b'Z' | b'+' | b'-') => break,
            Some(_) => {
                *deel = getal(p, 2)?;
                p += 2;
            }
        }
    }
    let [maand, dag, uur, minuut, seconde] = delen;
    let basis = unix_tijd(i64::from(jaar), maand, dag, uur, minuut, seconde)?;
    let teken = match s.get(p) {
        Some(b'+') => -1,
        Some(b'-') => 1,
        _ => return Some(basis),
    };
    let cijfers: Vec<u8> = s.get(p + 1..)?.iter().copied().filter(u8::is_ascii_digit).collect();
    let tal = |van: usize| -> Option<i64> { std::str::from_utf8(cijfers.get(van..van + 2)?).ok()?.parse().ok() };
    let uren = tal(0)?;
    let minuten = tal(2).unwrap_or(0);
    Some(basis + teken * (uren * 3600 + minuten * 60))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    /// Minimale PDF met klassieke xref-tabel; objecten krijgen nummer 1, 2, 3, …
    fn bouw_pdf(objecten: &[&str], trailer_extra: &str) -> Vec<u8> {
        let mut pdf = b"%PDF-1.7\n".to_vec();
        let mut posities = Vec::new();
        for (i, o) in objecten.iter().enumerate() {
            posities.push(pdf.len());
            pdf.extend_from_slice(format!("{} 0 obj\n{}\nendobj\n", i + 1, o).as_bytes());
        }
        let xref = pdf.len();
        pdf.extend_from_slice(format!("xref\n0 {}\n0000000000 65535 f\r\n", objecten.len() + 1).as_bytes());
        for p in posities {
            pdf.extend_from_slice(format!("{p:010} 00000 n\r\n").as_bytes());
        }
        pdf.extend_from_slice(
            format!(
                "trailer\n<< /Size {} /Root 1 0 R{} >>\nstartxref\n{}\n%%EOF\n",
                objecten.len() + 1,
                trailer_extra,
                xref
            )
            .as_bytes(),
        );
        pdf
    }

    /// Incrementele revisie met de gegeven objecten (nummer, inhoud).
    fn voeg_revisie_toe(pdf: &[u8], objecten: &[(u32, &str)], grootte: u32) -> Vec<u8> {
        let tekst = String::from_utf8_lossy(pdf);
        let vorige: usize = tekst.rsplit("startxref").next().unwrap().split_whitespace().next().unwrap().parse().unwrap();
        let mut uit = pdf.to_vec();
        let mut posities = Vec::new();
        for (nummer, inhoud) in objecten {
            posities.push((*nummer, uit.len()));
            uit.extend_from_slice(format!("{nummer} 0 obj\n{inhoud}\nendobj\n").as_bytes());
        }
        let xref = uit.len();
        uit.extend_from_slice(b"xref\n");
        for (nummer, p) in posities {
            uit.extend_from_slice(format!("{nummer} 1\n{p:010} 00000 n\r\n").as_bytes());
        }
        uit.extend_from_slice(
            format!("trailer\n<< /Size {grootte} /Root 1 0 R /Prev {vorige} >>\nstartxref\n{xref}\n%%EOF\n").as_bytes(),
        );
        uit
    }

    fn vervang_alle(bytes: &[u8], van: &[u8], naar: &[u8]) -> Vec<u8> {
        assert_eq!(van.len(), naar.len());
        let mut uit = bytes.to_vec();
        let mut p = 0;
        while let Some(q) = uit[p..].windows(van.len()).position(|w| w == van) {
            uit[p + q..p + q + van.len()].copy_from_slice(naar);
            p += q + van.len();
        }
        uit
    }

    /// Op een nieuwe thread met de standaard (kleine) stack.
    fn op_eigen_thread<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> T {
        std::thread::spawn(f).join().unwrap()
    }

    const SIG: &str = "<< /Type /Sig /SubFilter /ETSI.CAdES.detached /ByteRange [0 10 20 30] /Contents <3082000A> /M (D:20180901162846+02'00') /Reason (Proef) /Name (Jan) /Location (Delft) >>";

    fn standaard(trailer_extra: &str) -> Vec<u8> {
        bouw_pdf(
            &[
                "<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [4 0 R 6 0 R] /SigFlags 3 >> >>",
                "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
                "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Annots [4 0 R 6 0 R] >>",
                "<< /FT /Sig /T (Handtekening1) /Type /Annot /Subtype /Widget /Rect [0 0 0 0] /P 3 0 R /V 5 0 R >>",
                SIG,
                "<< /FT /Sig /T (Leeg) /Type /Annot /Subtype /Widget /Rect [0 0 0 0] /P 3 0 R >>",
            ],
            trailer_extra,
        )
    }

    fn verwacht_standaard() -> Vec<HandtekeningVeld> {
        vec![
            HandtekeningVeld {
                veldnaam: Some("Handtekening1".into()),
                waarde: Some(SigWoordenboek {
                    subfilter: Some("ETSI.CAdES.detached".into()),
                    soort_type: Some("Sig".into()),
                    bytebereik: vec![0, 10, 20, 30],
                    contents: vec![0x30, 0x82, 0x00, 0x0A],
                    naam: Some("Jan".into()),
                    reden: Some("Proef".into()),
                    plaats: Some("Delft".into()),
                    contact: None,
                    tijd_unix: Some(1_535_812_126),
                    // Het bereik eindigt bij byte 50, vóór de objectkop.
                    woordenboek_ondertekend: false,
                }),
            },
            HandtekeningVeld { veldnaam: Some("Leeg".into()), waarde: None },
        ]
    }

    fn doc_en_verzameling(pdf: &[u8]) -> (Vec<HandtekeningVeld>, bool) {
        let doc = Document::load_mem(pdf).unwrap();
        let (lijst, volledig) = verzamel(&doc, &Bron::new(pdf));
        (lijst.velden, volledig)
    }

    #[test]
    fn veel_velden_met_dezelfde_waarde_worden_een_keer_gelezen() {
        const VELDEN: usize = 20_000;
        let contents = "AB".repeat(1 << 20);
        let refs: Vec<String> = (0..VELDEN).map(|i| format!("{} 0 R", i + 3)).collect();
        let mut objecten = vec![
            format!("<< /Type /Catalog /AcroForm << /Fields [{}] >> >>", refs.join(" ")),
            format!("<< /Type /Sig /SubFilter /ETSI.CAdES.detached /ByteRange [0 10 20 30] /Contents <{contents}> >>"),
        ];
        objecten.extend((0..VELDEN).map(|i| format!("<< /FT /Sig /T (V{i}) /V 2 0 R >>")));
        let pdf = bouw_pdf(&objecten.iter().map(String::as_str).collect::<Vec<_>>(), "");
        let begin = std::time::Instant::now();
        let lijst = lees_veldenlijst(&pdf).unwrap();
        let duur = begin.elapsed();
        assert_eq!(lijst.velden.len(), 1);
        assert!(!lijst.afgekapt);
        assert_eq!(lijst.velden[0].veldnaam.as_deref(), Some("V0"));
        assert_eq!(lijst.velden[0].waarde.as_ref().unwrap().contents.len(), 1 << 20);
        // Eén kopie van /Contents in plaats van twintigduizend (20 GiB).
        assert!(duur < std::time::Duration::from_secs(2), "{duur:?}");
    }

    #[test]
    fn na_duizend_velden_is_de_lijst_afgekapt() {
        let lijst_van = |n: usize| {
            let refs: Vec<String> = (0..n).map(|i| format!("{} 0 R", i + 2)).collect();
            let mut objecten = vec![format!("<< /Type /Catalog /AcroForm << /Fields [{}] >> >>", refs.join(" "))];
            objecten.extend((0..n).map(|i| format!("<< /FT /Sig /T (V{i}) >>")));
            lees_veldenlijst(&bouw_pdf(&objecten.iter().map(String::as_str).collect::<Vec<_>>(), "")).unwrap()
        };
        let precies = lijst_van(MAX_HANDTEKENINGVELDEN);
        assert_eq!((precies.velden.len(), precies.afgekapt), (MAX_HANDTEKENINGVELDEN, false));
        let te_veel = lijst_van(MAX_HANDTEKENINGVELDEN + 200);
        assert_eq!((te_veel.velden.len(), te_veel.afgekapt), (MAX_HANDTEKENINGVELDEN, true));
        assert_eq!(te_veel.velden.last().unwrap().veldnaam.as_deref(), Some("V999"));

        // Ook zonder formulier, bij losse handtekeningwoordenboeken.
        let mut objecten = vec!["<< /Type /Catalog >>".to_string()];
        objecten.extend((0..MAX_HANDTEKENINGVELDEN + 5).map(|i| format!("<< /ByteRange [0 1 2 {i}] /Contents <00> >>")));
        let los = lees_veldenlijst(&bouw_pdf(&objecten.iter().map(String::as_str).collect::<Vec<_>>(), "")).unwrap();
        assert_eq!((los.velden.len(), los.afgekapt), (MAX_HANDTEKENINGVELDEN, true));
    }

    #[test]
    fn gedeelde_waarde_krijgt_de_naam_van_het_ondertekende_veld() {
        // Later toegevoegd veld vooraan in /Fields, met de /V van het ondertekende veld.
        let (pdf, _) = ondertekende_pdf("Echt");
        let later = voeg_revisie_toe(
            &pdf,
            &[(1, "<< /Type /Catalog /AcroForm << /Fields [4 0 R 2 0 R] >> >>"), (4, "<< /FT /Sig /T (Later) /V 3 0 R >>")],
            5,
        );
        let velden = lees_handtekeningvelden(&later).unwrap();
        assert_eq!(velden.len(), 1);
        assert_eq!(velden[0].veldnaam.as_deref(), Some("H"));
        assert_eq!(velden[0].waarde.as_ref().unwrap().reden.as_deref(), Some("Echt"));

        // Geen van beide velden binnen het bereik: het eerste in formuliervolgorde.
        let buiten = bouw_pdf(
            &["<< /Type /Catalog /AcroForm << /Fields [3 0 R 2 0 R] >> >>", "<< /FT /Sig /T (Twee) /V 4 0 R >>", "<< /FT /Sig /T (Drie) /V 4 0 R >>", SIG],
            "",
        );
        let velden = lees_handtekeningvelden(&buiten).unwrap();
        assert_eq!(velden.iter().map(|v| v.veldnaam.as_deref()).collect::<Vec<_>>(), [Some("Drie")]);
    }

    #[test]
    fn velden_met_waarde_en_leeg_veld() {
        assert_eq!(lees_handtekeningvelden(&standaard("")).unwrap(), verwacht_standaard());
    }

    #[test]
    fn geerfd_veldtype_en_samengestelde_naam() {
        let pdf = bouw_pdf(
            &[
                "<< /Type /Catalog /AcroForm << /Fields [2 0 R] >> >>",
                "<< /FT /Sig /T (Groep) /Kids [3 0 R] >>",
                "<< /T (Kind) /Parent 2 0 R /V << /Type /Sig /SubFilter /adbe.pkcs7.detached /ByteRange [0 1 2 3] /Contents <00> >> >>",
            ],
            "",
        );
        let velden = lees_handtekeningvelden(&pdf).unwrap();
        assert_eq!(velden.len(), 1);
        assert_eq!(velden[0].veldnaam.as_deref(), Some("Groep.Kind"));
        let w = velden[0].waarde.as_ref().unwrap();
        assert_eq!(w.subfilter.as_deref(), Some("adbe.pkcs7.detached"));
        assert_eq!(w.bytebereik, vec![0, 1, 2, 3]);
        assert_eq!(w.contents, vec![0]);
    }

    #[test]
    fn widgets_als_kinderen_horen_bij_het_veld() {
        let pdf = bouw_pdf(
            &[
                "<< /Type /Catalog /AcroForm << /Fields [2 0 R] >> >>",
                "<< /FT /Sig /T (Veld) /V 3 0 R /Kids [4 0 R] >>",
                SIG,
                "<< /Type /Annot /Subtype /Widget /Parent 2 0 R /Rect [0 0 0 0] >>",
            ],
            "",
        );
        let velden = lees_handtekeningvelden(&pdf).unwrap();
        assert_eq!(velden.len(), 1);
        assert_eq!(velden[0].veldnaam.as_deref(), Some("Veld"));
        assert_eq!(velden[0].waarde.as_ref().unwrap().reden.as_deref(), Some("Proef"));
    }

    #[test]
    fn widgetkind_met_naam_is_geen_veld_en_waarde_is_erfbaar() {
        let widget = bouw_pdf(
            &[
                "<< /Type /Catalog /AcroForm << /Fields [2 0 R] >> >>",
                "<< /FT /Sig /T (Ouder) /V 3 0 R /Kids [4 0 R] >>",
                SIG,
                "<< /T (Widget) /Type /Annot /Subtype /Widget /Parent 2 0 R /Rect [0 0 0 0] >>",
            ],
            "",
        );
        let velden = lees_handtekeningvelden(&widget).unwrap();
        assert_eq!(velden.len(), 1);
        assert_eq!(velden[0].veldnaam.as_deref(), Some("Ouder"));
        assert_eq!(velden[0].waarde.as_ref().unwrap().reden.as_deref(), Some("Proef"));

        let geerfd = bouw_pdf(
            &[
                "<< /Type /Catalog /AcroForm << /Fields [2 0 R] >> >>",
                "<< /FT /Sig /T (Ouder) /V 3 0 R /Kids [4 0 R] >>",
                SIG,
                "<< /T (Kind) /Parent 2 0 R >>",
            ],
            "",
        );
        let velden = lees_handtekeningvelden(&geerfd).unwrap();
        assert_eq!(velden.len(), 1);
        assert_eq!(velden[0].veldnaam.as_deref(), Some("Ouder.Kind"));
        assert_eq!(velden[0].waarde.as_ref().unwrap().reden.as_deref(), Some("Proef"));
    }

    #[test]
    fn widget_buiten_het_formulier_via_pagina_annotaties() {
        let pdf = bouw_pdf(
            &[
                "<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [] >> >>",
                "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
                "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Annots [4 0 R 6 0 R] >>",
                "<< /FT /Sig /T (Los) /Type /Annot /Subtype /Widget /Rect [0 0 0 0] /P 3 0 R /V 5 0 R >>",
                SIG,
                "<< /Type /Annot /Subtype /Link /Rect [0 0 0 0] >>",
            ],
            "",
        );
        let velden = lees_handtekeningvelden(&pdf).unwrap();
        assert_eq!(velden.len(), 1);
        assert_eq!(velden[0].veldnaam.as_deref(), Some("Los"));
        assert_eq!(velden[0].waarde.as_ref().unwrap().reden.as_deref(), Some("Proef"));
        // Staat het veld ook in /Fields, dan telt het één keer.
        assert_eq!(lees_handtekeningvelden(&standaard("")).unwrap().len(), 2);
    }

    #[test]
    fn verwijzing_naar_vrij_object_is_null() {
        let pdf = bouw_pdf(
            &["<< /Type /Catalog /AcroForm << /Fields [2 0 R 9 0 R] >> >>", "<< /FT /Sig /T (Leeg) /V 8 0 R >>"],
            "",
        );
        let (velden, volledig) = doc_en_verzameling(&pdf);
        assert!(volledig);
        assert_eq!(velden, vec![HandtekeningVeld { veldnaam: Some("Leeg".into()), waarde: None }]);
    }

    #[test]
    fn velddiepte_boven_32_is_onvolledig() {
        let mut objecten = vec!["<< /Type /Catalog /AcroForm << /Fields [2 0 R] >> >>".to_string()];
        for n in 2..40 {
            objecten.push(format!("<< /T (d{n}) /FT /Sig /Parent {} 0 R /Kids [{} 0 R] >>", n - 1, n + 1));
        }
        objecten.push("<< /T (blad) /FT /Sig /Parent 39 0 R >>".to_string());
        let refs: Vec<&str> = objecten.iter().map(String::as_str).collect();
        let (velden, volledig) = doc_en_verzameling(&bouw_pdf(&refs, ""));
        assert!(velden.is_empty());
        assert!(!volledig);
    }

    #[test]
    fn herstel_bij_kapotte_prev_en_kopregel() {
        assert_eq!(lees_handtekeningvelden(&standaard(" /Prev 0")).unwrap(), verwacht_standaard());
        let mut kop = standaard("");
        kop[..5].copy_from_slice(b"#XYZ-");
        assert_eq!(lees_handtekeningvelden(&kop).unwrap(), verwacht_standaard());
    }

    #[test]
    fn zonder_velden_losse_woordenboeken_en_rommel() {
        let pdf = bouw_pdf(&["<< /Type /Catalog >>", SIG], "");
        let velden = lees_handtekeningvelden(&pdf).unwrap();
        assert_eq!(velden.len(), 1);
        assert_eq!(velden[0].veldnaam, None);
        assert_eq!(velden[0].waarde.as_ref().unwrap().reden.as_deref(), Some("Proef"));
        let zonder = bouw_pdf(&["<< /Type /Catalog >>"], "");
        assert_eq!(lees_handtekeningvelden(&zonder).unwrap(), vec![]);
        assert!(matches!(lees_handtekeningvelden(b"geen pdf"), Err(PdfLeesFout::Onleesbaar(_))));
    }

    #[test]
    fn onleesbare_versleuteling_geeft_geen_paniek() {
        let velden = lees_handtekeningvelden(&standaard(" /Encrypt 9 0 R")).unwrap();
        assert_eq!(velden.len(), 2);
        let w = velden[0].waarde.as_ref().unwrap();
        assert_eq!(w.subfilter.as_deref(), Some("ETSI.CAdES.detached"));
        assert_eq!(w.reden, None);
        assert_eq!(w.contents, vec![0x30, 0x82, 0x00, 0x0A]);
    }

    /// PDF met één handtekening waarvan het bytebereik tot het einde van het bestand reikt.
    fn ondertekende_pdf(reden: &str) -> (Vec<u8>, impl Fn(&str) -> String) {
        let sig = |reden: &str, einde: &str| {
            format!("<< /Type /Sig /SubFilter /ETSI.CAdES.detached /ByteRange [0 1 3 {einde}] /Contents <00> /Reason ({reden}) >>")
        };
        let mut pdf = bouw_pdf(
            &[
                "<< /Type /Catalog /AcroForm << /Fields [2 0 R] >> >>",
                "<< /FT /Sig /T (H) /V 3 0 R >>",
                &sig(reden, "LLLLLLLLLL"),
            ],
            "",
        );
        let lengte = format!("{:010}", pdf.len() - 3);
        let p = pdf.windows(10).position(|w| w == b"LLLLLLLLLL").unwrap();
        pdf[p..p + 10].copy_from_slice(lengte.as_bytes());
        (pdf, move |reden: &str| sig(reden, &lengte))
    }

    #[test]
    fn vervangen_handtekeningwoordenboek_telt_niet() {
        let (pdf, sig) = ondertekende_pdf("Echt");
        let w = lees_handtekeningvelden(&pdf).unwrap()[0].waarde.clone().unwrap();
        assert_eq!((w.reden.as_deref(), w.woordenboek_ondertekend), (Some("Echt"), true));

        let vervalst = voeg_revisie_toe(&pdf, &[(3, &sig("Vals"))], 4);
        let gewoon = Document::load_mem(&vervalst).unwrap();
        assert_eq!(gewoon.get_object((3, 0)).unwrap().as_dict().unwrap().get(b"Reason").unwrap().as_str().unwrap(), b"Vals");
        let w = lees_handtekeningvelden(&vervalst).unwrap()[0].waarde.clone().unwrap();
        assert_eq!((w.reden.as_deref(), w.woordenboek_ondertekend), (Some("Echt"), true));

        // Alleen een exemplaar buiten het eigen bereik: het nieuwste telt, niet ondertekend.
        let buiten = voeg_revisie_toe(&pdf, &[(2, "<< /FT /Sig /T (H) /V 4 0 R >>"), (4, &sig("Later"))], 5);
        let w = lees_handtekeningvelden(&buiten).unwrap()[0].waarde.clone().unwrap();
        assert_eq!((w.reden.as_deref(), w.woordenboek_ondertekend), (Some("Later"), false));
    }

    /// PDF met het handtekeningveld (object 5) en SIG (object 6) in een
    /// FlateDecode-objectstroom (object 2), met `opvulling` spaties erachter.
    fn pdf_met_objectstroom(opvulling: usize) -> Vec<u8> {
        use std::io::Write;
        let veld = "<< /FT /Sig /T (H) /V 6 0 R >>";
        let kop = format!("5 0 6 {} ", veld.len() + 1);
        let mut inhoud = format!("{kop}{veld} {SIG}").into_bytes();
        inhoud.resize(inhoud.len() + opvulling, b' ');
        let mut e = flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::default());
        e.write_all(&inhoud).unwrap();
        let ingepakt = e.finish().unwrap();
        let mut pdf = b"%PDF-1.7\n".to_vec();
        let p1 = pdf.len();
        pdf.extend_from_slice(b"1 0 obj\n<< /Type /Catalog /AcroForm << /Fields [5 0 R] >> >>\nendobj\n");
        let p2 = pdf.len();
        pdf.extend_from_slice(
            format!(
                "2 0 obj\n<< /Type /ObjStm /N 2 /First {} /Filter /FlateDecode /Length {} >>\nstream\n",
                kop.len(),
                ingepakt.len()
            )
            .as_bytes(),
        );
        pdf.extend_from_slice(&ingepakt);
        pdf.extend_from_slice(b"\nendstream\nendobj\n");
        let xref = pdf.len();
        pdf.extend_from_slice(
            format!(
                "xref\n0 3\n0000000000 65535 f\r\n{p1:010} 00000 n\r\n{p2:010} 00000 n\r\ntrailer\n<< /Size 3 /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n"
            )
            .as_bytes(),
        );
        pdf
    }

    #[test]
    fn objectstroom_wordt_begrensd_uitgepakt() {
        let pdf = pdf_met_objectstroom(2 << 20);
        let ruim = lees_veldenlijst(&pdf).unwrap();
        assert_eq!(ruim.velden.len(), 1);
        assert_eq!(ruim.velden[0].veldnaam.as_deref(), Some("H"));
        // Zip-bom-achtig: klein ingepakt, groot uitgepakt. Boven de grens telt
        // de stroom niet, zonder de hele stroom uit te pakken.
        let krap = Uitpakgrenzen { per_stroom: 1 << 20, totaal: 256 << 20 };
        assert!(lees_veldenlijst_binnen(&pdf, krap).map_or(true, |l| l.velden.is_empty()));
        let mut doc = Reader { buffer: &pdf, document: Document::new() }.read(Some(zonder_streaminhoud)).unwrap();
        assert!(matches!(voeg_objectstromen_toe(&mut doc, &pdf, krap), Objectstromen::Gelezen { volledig: false }));
        let mut doc = Reader { buffer: &pdf, document: Document::new() }.read(Some(zonder_streaminhoud)).unwrap();
        assert!(matches!(voeg_objectstromen_toe(&mut doc, &pdf, UITPAKGRENZEN), Objectstromen::Gelezen { volledig: true }));
        assert!(doc.objects.contains_key(&(6, 0)));
    }

    #[test]
    fn uitpakken_deelt_een_totaalbudget() {
        use std::io::Write;
        let stroom = |n: usize| {
            let mut e = flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::default());
            e.write_all(&vec![b'0'; n]).unwrap();
            let mut d = Dictionary::new();
            d.set("Filter", Object::Name(b"FlateDecode".to_vec()));
            Stream::new(d, e.finish().unwrap())
        };
        let mut over = 1000;
        let mut a = stroom(600);
        assert!(pak_begrensd_uit(&mut a, 700, &mut over));
        assert_eq!((a.content.len(), over), (600, 400));
        assert!(a.dict.get(b"Filter").is_err());
        // Past per stroom, maar niet meer in het totaal.
        assert!(!pak_begrensd_uit(&mut stroom(600), 700, &mut over));
        assert_eq!(over, 400);
        // Te groot per stroom.
        assert!(!pak_begrensd_uit(&mut stroom(800), 700, &mut 10_000));
        // Zonder filter: niets uit te pakken.
        assert!(pak_begrensd_uit(&mut Stream::new(Dictionary::new(), vec![b'x'; 5000]), 10, &mut 0));
        // Een ander filter is niet begrensd uit te pakken.
        let mut lzw = stroom(10);
        lzw.dict.set("Filter", Object::Name(b"LZWDecode".to_vec()));
        assert!(!pak_begrensd_uit(&mut lzw, 700, &mut 10_000));
    }

    fn diepe_pdf(object: &str) -> Vec<u8> {
        bouw_pdf(
            &["<< /Type /Catalog /AcroForm << /Fields [2 0 R] >> >>", "<< /FT /Sig /T (H) /V 3 0 R >>", SIG, object],
            "",
        )
    }

    fn te_diep(r: &Result<Vec<HandtekeningVeld>, PdfLeesFout>) -> bool {
        matches!(r, Err(PdfLeesFout::Onleesbaar(d)) if d.contains("genest"))
    }

    #[test]
    fn diepe_nesting_geeft_nette_uitkomst() {
        let pdf = diepe_pdf(&"[".repeat(200_000));
        let r = op_eigen_thread(move || lees_handtekeningvelden(&pdf));
        assert!(te_diep(&r), "{r:?}");

        let pdf = diepe_pdf(&"<< /A ".repeat(100_000));
        assert!(te_diep(&op_eigen_thread(move || lees_handtekeningvelden(&pdf))));

        // Verstopt in een string, met een objectkop die het herstel zou lezen.
        let mut pdf = diepe_pdf(&format!("<< /X (9 0 obj {}) >>", "[".repeat(200_000)));
        pdf[..5].copy_from_slice(b"#XYZ-");
        assert!(te_diep(&op_eigen_thread(move || lees_handtekeningvelden(&pdf))));

        // In een objectstroom, achter een index die midden in een string wijst.
        let inhoud = format!("5 1 ({})", "[".repeat(200_000));
        let stroom = format!("<< /Type /ObjStm /N 1 /First 4 /Length {} >>\nstream\n{inhoud}\nendstream", inhoud.len());
        let pdf = diepe_pdf(&stroom);
        assert!(te_diep(&op_eigen_thread(move || lees_handtekeningvelden(&pdf))));
    }

    /// PDF met een diep geneste array achter een objectkop `kop` (object 5) die in
    /// een string of stream van object 4 staat; de xref van object 5 wijst ernaar.
    fn verstopte_kop(kop: &str, in_stroom: bool) -> Vec<u8> {
        let diep = format!("{kop} {}", "[".repeat(200_000));
        let object4 = if in_stroom {
            format!("<< /Length {} >>\nstream\n{diep}\nendstream", diep.len())
        } else {
            format!("<< /X ({diep}) >>")
        };
        let mut pdf = bouw_pdf(
            &["<< /Type /Catalog /AcroForm << /Fields [2 0 R] >> >>", "<< /FT /Sig /T (H) /V 3 0 R >>", SIG, &object4, "null"],
            "",
        );
        let tekst = String::from_utf8_lossy(&pdf).into_owned();
        let doel = tekst.find(kop).unwrap();
        let xref = tekst.rfind("\nxref\n").unwrap() + 1;
        // Na `0 6` en de vrije regel volgen objecten 1 t/m 5; die van object 5 begint na het vijfde regeleinde.
        let regel = xref + tekst[xref..].match_indices("\r\n").nth(4).unwrap().0 + 2;
        pdf[regel..regel + 10].copy_from_slice(format!("{doel:010}").as_bytes());
        pdf
    }

    #[test]
    fn verstopte_kop_zonder_witruimte_of_met_commentaar_geeft_nette_uitkomst() {
        for kop in ["5 0obj", "5 0 %c\nobj", "5%c\r0%d\r\nobj"] {
            for in_stroom in [false, true] {
                let pdf = verstopte_kop(kop, in_stroom);
                let r = op_eigen_thread(move || lees_handtekeningvelden(&pdf));
                assert!(te_diep(&r), "{kop:?} in_stroom={in_stroom}: {r:?}");
            }
        }
    }

    #[test]
    fn kopposities_volgen_de_grammatica_van_de_parser() {
        let posities = |s: &str| kopposities(s.as_bytes());
        assert_eq!(posities("1 0 obj"), vec![4]);
        assert_eq!(posities("1 0obj"), vec![3]);
        assert_eq!(posities("1 0 %c\nobj"), vec![7]);
        assert_eq!(posities("1%a\r\n0\t%b\robj"), vec![10]);
        assert_eq!(posities("x1 0 objx"), vec![5]);
        assert_eq!(posities("12 0 obj"), vec![5]);
        // Zonder scheiding tussen de getallen, zonder regeleinde na commentaar of
        // zonder tweede getal: geen kop.
        assert!(posities("10obj").is_empty());
        assert!(posities("1 0 %c obj").is_empty());
        assert!(posities("1 obj").is_empty());
        assert!(posities("1 0 ob j").is_empty());
    }

    #[test]
    fn nesting_onder_de_grens_wordt_gelezen() {
        let n = MAX_NESTDIEPTE - 2;
        let pdf = diepe_pdf(&format!("<< /X {}{} /Y ([[[[) >>", "[".repeat(n), "]".repeat(n)));
        let velden = op_eigen_thread(move || lees_handtekeningvelden(&pdf)).unwrap();
        assert_eq!(velden.len(), 1);
        assert_eq!(velden[0].waarde.as_ref().unwrap().reden.as_deref(), Some("Proef"));
        // Haakjes in strings, commentaar en streams tellen niet mee.
        let mut veel = String::from("<< /Length 0 >>\nstream\n");
        veel.push_str(&"[".repeat(1000));
        veel.push_str("\nendstream");
        let pdf = diepe_pdf(&veel);
        assert!(!te_diep_genest(&pdf, &[]));
        let tekst = format!("<< /X ({}) /Y <{}> >> % {}\n", "[".repeat(1000), "AB".repeat(10), "<<".repeat(1000));
        assert!(!te_diep_genest(tekst.as_bytes(), &[]));
        assert!(te_diep_genest("[".repeat(MAX_NESTDIEPTE + 1).as_bytes(), &[]));
        assert!(!te_diep_genest("[".repeat(MAX_NESTDIEPTE).as_bytes(), &[]));
    }

    #[test]
    fn pdf_datum_varianten() {
        assert_eq!(pdf_datum_unix("D:20180901162846+02'00'"), Some(1_535_812_126));
        assert_eq!(pdf_datum_unix("D:20180901142846Z"), Some(1_535_812_126));
        assert_eq!(pdf_datum_unix("D:20180901142846"), Some(1_535_812_126));
        assert_eq!(pdf_datum_unix("D:20180901102846-04'00'"), Some(1_535_812_126));
        assert_eq!(pdf_datum_unix("20180901142846Z"), Some(1_535_812_126));
        assert_eq!(pdf_datum_unix("D:2018"), Some(1_514_764_800));
        assert_eq!(pdf_datum_unix("rommel"), None);
        assert_eq!(pdf_datum_unix("D:2018xx01"), None);
        assert_eq!(pdf_datum_unix("D:201809011"), None);
        assert_eq!(pdf_datum_unix("D:2018É"), None);
        assert_eq!(pdf_datum_unix("D:201809Z"), Some(1_535_760_000));
    }

    #[test]
    fn afgekapte_pdf_geeft_geen_paniek() {
        let pdf = standaard("");
        for n in (0..pdf.len()).step_by(7) {
            let _ = lees_handtekeningvelden(&pdf[..n]);
        }
    }

    fn corpusmap() -> Option<PathBuf> {
        crate::handtekening::corpusmap("pades")
    }

    /// Ruwe meting van piekwerkgeheugen en tijd, één meting per proces:
    /// `OPDS_METING=<bestand|groot>[:los] cargo test --lib meet_geheugen -- --ignored --nocapture --exact`.
    /// `groot` is een PDF met twintig streams van 5 MiB (de eerste run maakt hem
    /// aan in de tijdelijke map); `:los` meet alleen `Document::load_mem` (lezen
    /// zonder filter) ter vergelijking; met `OPDS_METING_DELEN` ook de losse stappen.
    #[test]
    #[ignore = "meting, geen controle"]
    fn meet_geheugen_en_tijd() {
        let keuze = std::env::var("OPDS_METING").unwrap_or_else(|_| "modified_after_signature.pdf".to_string());
        let (naam, alleen_lopdf) = match keuze.strip_suffix(":los") {
            Some(n) => (n.to_string(), true),
            None => (keuze.clone(), false),
        };
        let bytes = if naam == "groot" {
            let pad = std::env::temp_dir().join("opds-meting-groot.pdf");
            if !pad.exists() {
                // Tekstachtige inhoud met veel `e`, `o` en `x`: het ongunstigste geval voor de voorscan.
                let regel = "0 0 m 100 100 l S BT /F1 12 Tf (voorbeeld tekst ox) Tj ET
";
                let inhoud = regel.repeat((5 << 20) / regel.len());
                let stroom = format!("<< /Length {} >>
stream
{inhoud}
endstream", inhoud.len());
                let mut objecten = vec!["<< /Type /Catalog /AcroForm << /Fields [2 0 R] >> >>", "<< /FT /Sig /T (H) /V 3 0 R >>", SIG];
                objecten.extend(std::iter::repeat(stroom.as_str()).take(20));
                std::fs::write(&pad, bouw_pdf(&objecten, "")).unwrap();
                println!("aangemaakt: {}; meet opnieuw", pad.display());
                return;
            }
            std::fs::read(&pad).unwrap()
        } else {
            let Some(map) = corpusmap() else { return };
            std::fs::read(map.join(&naam)).unwrap()
        };
        let piek = || {
            let uit = std::process::Command::new("powershell")
                .args(["-NoProfile", "-Command", &format!("(Get-Process -Id {}).PeakWorkingSet64", std::process::id())])
                .output()
                .unwrap();
            String::from_utf8_lossy(&uit.stdout).trim().parse::<u64>().unwrap_or(0)
        };
        if std::env::var("OPDS_METING_DELEN").is_ok() {
            let t = std::time::Instant::now();
            let _ = te_diep_genest(&bytes, &[]);
            println!("voorscan {:?}", t.elapsed());
            let t = std::time::Instant::now();
            let _ = objectkoppen(&bytes);
            println!("objectkoppen {:?}", t.elapsed());
            let t = std::time::Instant::now();
            let _ = Reader { buffer: &bytes, document: Document::new() }.read(Some(zonder_streaminhoud));
            println!("lezen met filter {:?}", t.elapsed());
        }
        let voor = piek();
        let t = std::time::Instant::now();
        let velden = if alleen_lopdf {
            Document::load_mem(&bytes).map(|d| d.objects.len()).unwrap_or(0)
        } else {
            lees_handtekeningvelden(&bytes).unwrap().len()
        };
        let duur = t.elapsed();
        let na = piek();
        println!(
            "meting {keuze}: {} bytes, {velden} velden/objecten, {duur:?}, piek-werkgeheugen voor {} KiB, na {} KiB, verschil {} KiB",
            bytes.len(),
            voor / 1024,
            na / 1024,
            na.saturating_sub(voor) / 1024
        );
    }

    const CADES: &str = "ETSI.CAdES.detached";
    const PKCS7: &str = "adbe.pkcs7.detached";
    const RFC3161: &str = "ETSI.RFC3161";

    /// Per corpusbestand de velden in AcroForm-volgorde: SubFilter, of `None` voor een leeg veld.
    const CORPUS: &[(&str, &[Option<&str>])] = &[
        ("BadEncodedCMS.pdf", &[Some(CADES)]),
        ("doc-firmado-LT.pdf", &[Some(CADES)]),
        ("doc-firmado-T.pdf", &[Some(CADES)]),
        ("doc-firmado.pdf", &[Some(CADES), Some(RFC3161)]),
        ("encrypted.pdf", &[Some(PKCS7)]),
        ("hello_signed_INCSAVE_signed.pdf", &[Some(CADES), Some(CADES)]),
        ("hello_signed_INCSAVE_signed_EDITED.pdf", &[Some(CADES), Some(CADES)]),
        ("malformed-pades.pdf", &[Some(CADES)]),
        ("malformed-rsa-digestinfo.pdf", &[Some(CADES)]),
        ("modified_after_signature.pdf", &[Some(CADES)]),
        (
            "pades-5-signatures-and-1-document-timestamp.pdf",
            &[Some(CADES), Some(CADES), Some(CADES), Some(CADES), Some(CADES), Some(RFC3161)],
        ),
        ("pades-alter-signature-appearance-modify-stream.pdf", &[Some(PKCS7), Some(PKCS7)]),
        ("pades-bes-no-certificates.pdf", &[Some(CADES)]),
        ("pades-bes.pdf", &[Some(CADES)]),
        ("pades-signed-annot-added.pdf", &[None, Some(CADES)]),
        ("pades-spoofing-replaced-reason.pdf", &[Some(CADES)]),
        ("pades-unsupported-signature-algorithm.pdf", &[Some(CADES)]),
        ("pades3_Baseline_B.pdf", &[Some(CADES), Some(RFC3161), Some(RFC3161), Some(CADES)]),
    ];

    #[test]
    fn corpus_alle_velden_met_subfilter() {
        let Some(map) = corpusmap() else { return };
        assert_eq!(std::fs::read_dir(&map).unwrap().count(), CORPUS.len());
        for (naam, verwacht) in CORPUS {
            let bytes = std::fs::read(map.join(naam)).unwrap();
            let velden = lees_handtekeningvelden(&bytes).unwrap();
            let gevonden: Vec<Option<&str>> =
                velden.iter().map(|v| v.waarde.as_ref().map(|w| w.subfilter.as_deref().unwrap_or("?"))).collect();
            assert_eq!(&gevonden, verwacht, "{naam}");
            for (i, v) in velden.iter().enumerate() {
                let Some(w) = &v.waarde else { continue };
                assert_eq!(w.bytebereik.len(), 4, "{naam}");
                assert_eq!(w.contents.first(), Some(&0x30), "{naam}");
                // Alleen de bewerkte tweede handtekening ligt buiten haar (geleende) bereik.
                let bewerkt = *naam == "hello_signed_INCSAVE_signed_EDITED.pdf" && i == 1;
                assert_eq!(w.woordenboek_ondertekend, !bewerkt, "{naam} veld {i}");
            }
        }
    }

    #[test]
    fn corpus_bewerkt_bereik_versleuteld_en_hersteld() {
        let Some(map) = corpusmap() else { return };
        let lees = |naam: &str| lees_handtekeningvelden(&std::fs::read(map.join(naam)).unwrap()).unwrap();

        // Tweede handtekening met het bytebereik van de eerste, maar eigen /Contents.
        let bewerkt = lees("hello_signed_INCSAVE_signed_EDITED.pdf");
        let (een, twee) = (bewerkt[0].waarde.as_ref().unwrap(), bewerkt[1].waarde.as_ref().unwrap());
        assert_eq!(een.bytebereik, twee.bytebereik);
        assert_ne!(een.contents, twee.contents);
        assert!(een.woordenboek_ondertekend);
        assert!(!twee.woordenboek_ondertekend, "objectkop van de tweede ligt voorbij het geleende bereik");
        let origineel = lees("hello_signed_INCSAVE_signed.pdf");
        assert_eq!(origineel[0].waarde.as_ref().unwrap().bytebereik, een.bytebereik);
        assert_ne!(origineel[1].waarde.as_ref().unwrap().bytebereik, twee.bytebereik);

        let versleuteld = lees("encrypted.pdf");
        assert_eq!(versleuteld.len(), 1);
        let w = versleuteld[0].waarde.as_ref().unwrap();
        assert_eq!(w.subfilter.as_deref(), Some("adbe.pkcs7.detached"));
        assert_eq!(w.reden.as_deref(), Some("Výstup z informačního systému veřejné správy"));
        assert_eq!(w.plaats.as_deref(), Some("ČÚZK, Praha"));
        assert_eq!(w.contents.first(), Some(&0x30));
        let vijf = lees("pades-5-signatures-and-1-document-timestamp.pdf");
        assert_eq!(vijf.len(), 6);
        assert!(vijf.iter().all(|v| v.waarde.as_ref().is_some_and(|w| w.bytebereik.len() == 4)));
        let kapot = lees("malformed-pades.pdf");
        assert_eq!(kapot.len(), 1);
        assert_eq!(kapot[0].waarde.as_ref().unwrap().bytebereik, vec![0, 18801, 37747, 113379]);
        let aanvulling = lees("pades-signed-annot-added.pdf");
        assert_eq!(aanvulling.iter().filter(|v| v.waarde.is_none()).count(), 1);
    }

    #[test]
    fn corpus_vervangen_reden_telt_niet() {
        let Some(map) = corpusmap() else { return };
        let bytes = std::fs::read(map.join("pades-spoofing-replaced-reason.pdf")).unwrap();
        let velden = lees_handtekeningvelden(&bytes).unwrap();
        assert_eq!(velden.len(), 1);
        let w = velden[0].waarde.as_ref().unwrap();
        assert_eq!(w.reden.as_deref(), Some("DSS testing"));
        assert!(w.woordenboek_ondertekend);
    }

    #[test]
    fn corpus_herstel_met_objectstromen() {
        let Some(map) = corpusmap() else { return };
        for naam in ["modified_after_signature.pdf", "pades-signed-annot-added.pdf", "encrypted.pdf"] {
            let bytes = std::fs::read(map.join(naam)).unwrap();
            let gewoon = lees_handtekeningvelden(&bytes).unwrap();
            let kapot = vervang_alle(&bytes, b"startxref", b"startxrex");
            assert!(Document::load_mem(&kapot).is_err(), "{naam}");
            assert_eq!(lees_handtekeningvelden(&kapot).unwrap(), gewoon, "{naam}");

            // Zonder /Root geen formulier: de losse velden tellen, ook een los
            // veld dat niet in het formulier staat (encrypted.pdf heeft er een).
            let zonder_root = vervang_alle(&kapot, b"/Root", b"/Xoot");
            let los = lees_handtekeningvelden(&zonder_root).unwrap();
            for veld in &gewoon {
                assert!(los.contains(veld), "{naam} zonder /Root: {:?} ontbreekt", veld.veldnaam);
            }
        }

        // Veld Signature1 (object 76) staat in een objectstroom én los; zonder de
        // losse kop is het alleen via de objectstroom te vinden.
        let bytes = std::fs::read(map.join("pades-signed-annot-added.pdf")).unwrap();
        let gewoon = lees_handtekeningvelden(&bytes).unwrap();
        let kapot = vervang_alle(&vervang_alle(&bytes, b"startxref", b"startxrex"), b"
76 0 obj", b"
76 0 xbj");
        assert!(Bron::new(&kapot).posities((76, 0)).is_empty());
        assert_eq!(lees_handtekeningvelden(&kapot).unwrap(), gewoon);
        let zonder_root = vervang_alle(&kapot, b"/Root", b"/Xoot");
        let los = lees_handtekeningvelden(&zonder_root).unwrap();
        assert!(gewoon.iter().all(|v| los.contains(v)), "{los:?}");
    }
}
