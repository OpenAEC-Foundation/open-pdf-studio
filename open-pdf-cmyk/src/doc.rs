//! Het hele document omzetten.
//!
//! Loopt alle pagina's langs met hun inhoudsstromen, resources (ook
//! geërfde), annotatie-uiterlijken en miniaturen; vanuit de resources de Form
//! XObjects (recursief, elk één keer), afbeeldingen, patronen, verlopen,
//! grafische toestanden met zachte maskers en Type 3-lettertypen.
//!
//! Alles wordt gelezen uit het ORIGINELE document; wijzigingen gaan naar een
//! kopie per object en worden aan het eind als incrementele update achter de
//! oorspronkelijke bytes geschreven. Objecten die niet veranderen blijven dus
//! byte voor byte staan.

use crate::content::{inline_get, rewrite, ColourState, ContentEnv, InlineImage, InlineOutcome};
use crate::images::{self, fmt_obj};
use crate::report::Report;
use crate::space::{RgbSource, Space};
use crate::transform::CmykTransform;
use lopdf::{Dictionary, Document, Object, ObjectId, Stream, StringFormat};
use std::collections::{BTreeMap, HashMap, HashSet};

/// Waarom het document niet omgezet kon worden.
#[derive(Debug, PartialEq, Eq)]
pub enum ConvertError {
    /// Versleuteld; PDF/X staat dat ook niet toe.
    Encrypted,
    /// Niet als PDF te lezen.
    Unreadable(String),
}

impl ConvertError {
    /// Code voor de interface.
    pub fn code(&self) -> &'static str {
        match self {
            ConvertError::Encrypted => "encrypted",
            ConvertError::Unreadable(_) => "unreadable",
        }
    }
}

impl std::fmt::Display for ConvertError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ConvertError::Encrypted => f.write_str("encrypted"),
            ConvertError::Unreadable(e) => write!(f, "unreadable: {e}"),
        }
    }
}

impl std::error::Error for ConvertError {}

/// Het omgezette document met zijn verslag.
#[derive(Debug)]
pub struct Converted {
    pub pdf: Vec<u8>,
    pub report: Report,
}

/// Zet alle RGB-kleur in het document om naar CMYK.
pub fn convert_document(pdf: &[u8], t: &dyn CmykTransform) -> Result<Converted, ConvertError> {
    let doc = Document::load_mem(pdf).map_err(|e| ConvertError::Unreadable(e.to_string()))?;
    if doc.is_encrypted() {
        return Err(ConvertError::Encrypted);
    }
    let mut w = Walker::new(&doc, t);
    for page in doc.page_iter() {
        w.page(page);
    }
    let Walker { edits, report, .. } = w;
    let pdf = if edits.is_empty() { pdf.to_vec() } else { write_incremental(pdf, &doc, &edits) };
    Ok(Converted { pdf, report })
}

/// Eén stap in een pad naar een woordenboek binnen een object.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
enum Step {
    Key(Vec<u8>),
    Index(usize),
}

/// Waar een woordenboek staat: in object `owner` (bij een stroom: het
/// stroomwoordenboek), via directe (niet-verwezen) waarden langs `path`.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
struct Place {
    owner: ObjectId,
    path: Vec<Step>,
}

impl Place {
    fn root(owner: ObjectId) -> Self {
        Place { owner, path: Vec::new() }
    }

    fn with(&self, step: Step) -> Self {
        let mut path = self.path.clone();
        path.push(step);
        Place { owner: self.owner, path }
    }
}

static NULL: Object = Object::Null;

fn dict_of(o: &Object) -> Option<&Dictionary> {
    match o {
        Object::Dictionary(d) => Some(d),
        Object::Stream(s) => Some(&s.dict),
        _ => None,
    }
}

fn floats(o: &Object) -> Option<Vec<f32>> {
    o.as_array().ok()?.iter().map(|v| v.as_float().ok()).collect()
}

fn nums(v: &[f32]) -> Object {
    Object::Array(v.iter().map(|&x| Object::Real(x)).collect())
}

fn name(n: &str) -> Object {
    Object::Name(n.as_bytes().to_vec())
}

struct Walker<'a> {
    doc: &'a Document,
    t: &'a dyn CmykTransform,
    /// Transformatie per ingebed RGB-bronprofiel (`None`: niet bruikbaar).
    sources: HashMap<ObjectId, Option<Box<dyn CmykTransform>>>,
    colours: HashMap<(RgbSource, [u32; 3]), [f32; 4]>,
    /// Gewijzigde objecten (volledige kopie), geschreven als update.
    edits: BTreeMap<ObjectId, Object>,
    report: Report,
    /// Stromen (inhoud, formulieren, afbeeldingen) die al gedaan zijn.
    seen: HashSet<ObjectId>,
    /// Resources, verlopen en groepen die al gedaan zijn.
    seen_places: HashSet<Place>,
    /// Functies (verlopen) die al zijn omgezet.
    functions: HashSet<ObjectId>,
}

impl<'a> Walker<'a> {
    fn new(doc: &'a Document, t: &'a dyn CmykTransform) -> Self {
        Walker {
            doc,
            t,
            sources: HashMap::new(),
            colours: HashMap::new(),
            edits: BTreeMap::new(),
            report: Report::default(),
            seen: HashSet::new(),
            seen_places: HashSet::new(),
            functions: HashSet::new(),
        }
    }

    // ── Lezen uit het originele document ────────────────────────────────

    fn deref(&self, o: &'a Object) -> &'a Object {
        self.doc.dereference(o).map(|(_, o)| o).unwrap_or(&NULL)
    }

    /// Waarde onder `key`, opgelost, met de plek waar hij zelf staat.
    fn entry(&self, dict: &'a Dictionary, place: &Place, key: &[u8]) -> Option<(&'a Object, Place)> {
        let raw = dict.get(key).ok()?;
        let (id, obj) = self.doc.dereference(raw).ok()?;
        Some((obj, id.map(Place::root).unwrap_or_else(|| place.with(Step::Key(key.to_vec())))))
    }

    fn item(&self, arr: &'a [Object], place: &Place, index: usize) -> Option<(&'a Object, Place)> {
        let (id, obj) = self.doc.dereference(arr.get(index)?).ok()?;
        Some((obj, id.map(Place::root).unwrap_or_else(|| place.with(Step::Index(index)))))
    }

    fn int(&self, dict: &'a Dictionary, key: &[u8]) -> Option<i64> {
        self.deref(dict.get(key).ok()?).as_i64().ok()
    }

    /// Gedecodeerde inhoud van een stroom (niet voor afbeeldingen).
    fn plain(&self, s: &Stream) -> Result<Vec<u8>, &'static str> {
        let mut dict = s.dict.clone();
        for key in [&b"Filter"[..], b"DecodeParms"] {
            if let Ok(v) = s.dict.get(key) {
                dict.set(key.to_vec(), self.resolve_shallow(v));
            }
        }
        let (filters, parms) = images::filters_of(&dict, false);
        if filters.is_empty() {
            return Ok(s.content.clone());
        }
        match images::decode_filters(&s.content, &filters, &parms) {
            Ok(images::Decoded::Raw(data)) => Ok(data),
            Ok(images::Decoded::Jpeg(_)) => Err("decodeFailed"),
            // Wat hier ontbreekt (LZW) kan lopdf wel.
            Err(_) => {
                let mut copy = s.clone();
                copy.dict = dict;
                copy.dict.remove(b"Subtype");
                copy.decompressed_content().map_err(|_| "decodeFailed")
            }
        }
    }

    /// Verwijzingen één laag diep oplossen (ook in arrays en woordenboeken).
    fn resolve_shallow(&self, o: &Object) -> Object {
        let o = match o {
            Object::Reference(_) => self.doc.dereference(o).map(|(_, v)| v.clone()).unwrap_or(Object::Null),
            other => other.clone(),
        };
        match o {
            Object::Array(a) => Object::Array(
                a.iter()
                    .map(|v| self.doc.dereference(v).map(|(_, v)| v.clone()).unwrap_or(Object::Null))
                    .collect(),
            ),
            Object::Dictionary(d) => {
                let mut out = Dictionary::new();
                for (k, v) in d.iter() {
                    out.set(k.clone(), self.doc.dereference(v).map(|(_, v)| v.clone()).unwrap_or(Object::Null));
                }
                Object::Dictionary(out)
            }
            other => other,
        }
    }

    /// Hoe de omzetting een kleurruimte ziet.
    fn classify(&self, o: &Object) -> Space {
        let o = match self.doc.dereference(o) {
            Ok((_, o)) => o,
            Err(_) => return Space::Other,
        };
        match o {
            Object::Name(n) => match n.as_slice() {
                b"DeviceRGB" | b"RGB" => Space::Rgb(RgbSource::Srgb),
                b"DeviceGray" | b"G" => Space::Gray,
                b"DeviceCMYK" | b"CMYK" => Space::Cmyk,
                b"Pattern" => Space::Pattern(None),
                _ => Space::Other,
            },
            Object::Array(a) => {
                let Some(family) = a.first().and_then(|f| f.as_name().ok()) else { return Space::Other };
                match family {
                    b"ICCBased" => match a.get(1) {
                        Some(Object::Reference(id)) => match self.icc_components(*id) {
                            Some(3) => Space::Rgb(RgbSource::Icc(*id)),
                            Some(1) => Space::Gray,
                            Some(4) => Space::Cmyk,
                            _ => Space::Other,
                        },
                        _ => Space::Other,
                    },
                    b"CalRGB" => Space::Rgb(RgbSource::Srgb),
                    b"CalGray" => Space::Gray,
                    b"Indexed" | b"I" => match a.get(1).map(|b| self.classify(b)) {
                        Some(Space::Rgb(_)) => Space::IndexedRgb,
                        _ => Space::Other,
                    },
                    b"Pattern" => match a.get(1).map(|b| self.classify(b)) {
                        Some(Space::Rgb(s)) => Space::Pattern(Some(s)),
                        _ => Space::Pattern(None),
                    },
                    b"Separation" | b"DeviceN" => match a.get(2).map(|b| self.classify(b)) {
                        Some(Space::Rgb(_)) => Space::SpotOnRgb,
                        _ => Space::Other,
                    },
                    _ if a.len() == 1 => self.classify(&a[0]),
                    _ => Space::Other,
                }
            }
            _ => Space::Other,
        }
    }

    /// `/N` van een ICC-stroom, anders de kleurruimte uit het kopblok.
    fn icc_components(&self, id: ObjectId) -> Option<i64> {
        let Ok(Object::Stream(s)) = self.doc.get_object(id) else { return None };
        if let Some(n) = self.int(&s.dict, b"N") {
            return Some(n);
        }
        let bytes = self.plain(s).ok()?;
        match bytes.get(16..20)? {
            b"RGB " => Some(3),
            b"GRAY" => Some(1),
            b"CMYK" => Some(4),
            _ => None,
        }
    }

    // ── Kleur ───────────────────────────────────────────────────────────

    fn transform_for(&mut self, source: RgbSource) -> &dyn CmykTransform {
        let RgbSource::Icc(id) = source else { return self.t };
        if !self.sources.contains_key(&id) {
            let bytes = match self.doc.get_object(id) {
                Ok(Object::Stream(s)) => self.plain(s).ok(),
                _ => None,
            };
            let own = bytes.and_then(|b| self.t.with_source_profile(&b));
            self.sources.insert(id, own);
        }
        match self.sources.get(&id) {
            Some(Some(own)) => own.as_ref(),
            _ => self.t,
        }
    }

    fn convert_colour(&mut self, source: RgbSource, rgb: [f32; 3]) -> [f32; 4] {
        let rgb = rgb.map(|v| v.clamp(0.0, 1.0));
        let key = (source, rgb.map(f32::to_bits));
        if let Some(c) = self.colours.get(&key) {
            return *c;
        }
        let c = self.transform_for(source).rgb_to_cmyk(rgb).map(|v| v.clamp(0.0, 1.0));
        self.colours.insert(key, c);
        c
    }

    /// Drie getallen (0..=1) omgezet naar vier, of `None` als het er geen drie zijn.
    fn convert_array(&mut self, source: RgbSource, o: &Object) -> Option<Object> {
        let v = floats(o)?;
        let [r, g, b] = v[..] else { return None };
        Some(nums(&self.convert_colour(source, [r, g, b])))
    }

    /// De CMYK-vervanger van een RGB-achtige kleurruimte.
    fn cmyk_space_for(&mut self, cs: &'a Object) -> Result<Object, &'static str> {
        match self.classify(cs) {
            Space::Rgb(_) => Ok(name("DeviceCMYK")),
            Space::Pattern(Some(_)) => Ok(Object::Array(vec![name("Pattern"), name("DeviceCMYK")])),
            Space::IndexedRgb => {
                let a = self.deref(cs).as_array().map_err(|_| "malformed")?;
                let Space::Rgb(source) = self.classify(a.get(1).ok_or("malformed")?) else { return Err("malformed") };
                let hival = a.get(2).map(|h| self.deref(h)).and_then(|h| h.as_i64().ok()).ok_or("malformed")?;
                let lookup = match a.get(3).map(|l| self.deref(l)) {
                    Some(Object::String(bytes, _)) => bytes.clone(),
                    Some(Object::Stream(s)) => self.plain(s)?,
                    _ => return Err("malformed"),
                };
                let hival = hival.clamp(0, 255) as usize;
                let palette = images::convert_palette(&lookup, hival, self.transform_for(source));
                Ok(Object::Array(vec![
                    name("Indexed"),
                    name("DeviceCMYK"),
                    Object::Integer(hival as i64),
                    Object::String(palette, StringFormat::Hexadecimal),
                ]))
            }
            Space::SpotOnRgb => Err("separationRgbAlternate"),
            _ => Err("malformed"),
        }
    }

    // ── Schrijven naar de kopieën ───────────────────────────────────────

    fn edit_obj(&mut self, id: ObjectId) -> Option<&mut Object> {
        if !self.edits.contains_key(&id) {
            let original = self.doc.get_object(id).ok()?.clone();
            self.edits.insert(id, original);
        }
        self.edits.get_mut(&id)
    }

    fn edit_dict(&mut self, place: &Place) -> Option<&mut Dictionary> {
        descend(self.edit_obj(place.owner)?, &place.path)
    }

    fn set(&mut self, place: &Place, key: &str, value: Object) {
        if let Some(d) = self.edit_dict(place) {
            d.set(key, value);
        }
    }

    fn set_stream_content(&mut self, id: ObjectId, content: &[u8]) {
        let compressed = images::deflate(content);
        if let Some(Object::Stream(s)) = self.edit_obj(id) {
            s.dict.set("Filter", name("FlateDecode"));
            s.dict.remove(b"DecodeParms");
            s.dict.remove(b"DL");
            s.set_content(compressed);
        }
    }

    // ── De boom doorlopen ───────────────────────────────────────────────

    fn page(&mut self, page_id: ObjectId) {
        let Ok(page) = self.doc.get_dictionary(page_id) else { return };
        let page_place = Place::root(page_id);
        let res = self.inherited_resources(page_id);
        if let Some((r, p)) = &res {
            self.resources(r, p.clone());
        }
        let mut state = ColourState::default();
        for id in self.doc.get_page_contents(page_id) {
            if self.seen.insert(id) {
                self.content(id, res.as_ref().map(|r| r.0), &mut state);
            }
        }
        self.group(page, &page_place);
        if let Some((Object::Array(annots), _)) = self.entry(page, &page_place, b"Annots") {
            for annot in annots {
                let Some(annot) = dict_of(self.deref(annot)) else { continue };
                let Some(ap) = annot.get(b"AP").ok().map(|o| self.deref(o)).and_then(dict_of) else { continue };
                for (_, appearance) in ap.iter() {
                    match self.doc.dereference(appearance) {
                        Ok((Some(id), Object::Stream(_))) => self.form(id, None),
                        Ok((_, Object::Dictionary(states))) => {
                            for (_, state) in states.iter() {
                                if let Ok((Some(id), Object::Stream(_))) = self.doc.dereference(state) {
                                    self.form(id, None);
                                }
                            }
                        }
                        _ => {}
                    }
                }
            }
        }
        if let Ok(Object::Reference(thumb)) = page.get(b"Thumb") {
            self.image(*thumb);
        }
    }

    /// Resources van de pagina, of geërfd van een Pages-knoop.
    fn inherited_resources(&self, page_id: ObjectId) -> Option<(&'a Dictionary, Place)> {
        let mut node = page_id;
        for _ in 0..64 {
            let dict = self.doc.get_dictionary(node).ok()?;
            if let Some((obj, place)) = self.entry(dict, &Place::root(node), b"Resources") {
                return dict_of(obj).map(|d| (d, place));
            }
            node = dict.get(b"Parent").ok()?.as_reference().ok()?;
        }
        None
    }

    /// Eén inhoudsstroom herschrijven (al gemarkeerd als gezien).
    fn content(&mut self, id: ObjectId, res: Option<&'a Dictionary>, state: &mut ColourState) {
        let Ok(Object::Stream(s)) = self.doc.get_object(id) else { return };
        let data = match self.plain(s) {
            Ok(d) => d,
            Err(reason) => {
                self.report.content_streams.skipped(reason);
                return;
            }
        };
        let mut report = std::mem::take(&mut self.report);
        let out = rewrite(&data, state, &mut Env { w: self, res }, &mut report);
        self.report = report;
        if let Some(new) = out {
            self.set_stream_content(id, &new);
            self.report.content_streams.converted();
        }
    }

    /// Form XObject, tiling-patroon, uiterlijk of Type 3-glyph: eigen
    /// resources, anders die van de ouder.
    fn form(&mut self, id: ObjectId, parent: Option<(&'a Dictionary, Place)>) {
        if !self.seen.insert(id) {
            return;
        }
        let Ok(Object::Stream(s)) = self.doc.get_object(id) else { return };
        let place = Place::root(id);
        let own = self.entry(&s.dict, &place, b"Resources").and_then(|(o, p)| dict_of(o).map(|d| (d, p)));
        if let Some((r, p)) = &own {
            self.resources(r, p.clone());
        }
        let res = own.or(parent).map(|(d, _)| d);
        self.content(id, res, &mut ColourState::default());
        self.group(&s.dict, &place);
    }

    fn resources(&mut self, res: &'a Dictionary, place: Place) {
        if !self.seen_places.insert(place.clone()) {
            return;
        }
        if let Some((Object::Dictionary(spaces), cs_place)) = self.entry(res, &place, b"ColorSpace") {
            if self.seen_places.insert(cs_place.clone()) {
                for (key, value) in spaces.iter() {
                    if matches!(key.as_slice(), b"DefaultRGB" | b"DefaultGray" | b"DefaultCMYK") {
                        continue;
                    }
                    match self.classify(value) {
                        Space::Rgb(_) | Space::IndexedRgb | Space::Pattern(Some(_)) => match self.cmyk_space_for(value) {
                            Ok(new) => {
                                if let Some(d) = self.edit_dict(&cs_place) {
                                    d.set(key.clone(), new);
                                }
                                self.report.colour_spaces.converted();
                            }
                            Err(reason) => self.report.colour_spaces.skipped(reason),
                        },
                        Space::SpotOnRgb => self.report.colour_spaces.skipped("separationRgbAlternate"),
                        _ => {}
                    }
                }
            }
        }
        if let Some((Object::Dictionary(xobjects), _)) = self.entry(res, &place, b"XObject") {
            for (_, value) in xobjects.iter() {
                let Ok((Some(id), Object::Stream(s))) = self.doc.dereference(value) else { continue };
                match s.dict.get(b"Subtype").and_then(|o| o.as_name()) {
                    Ok(b"Form") => self.form(id, Some((res, place.clone()))),
                    Ok(b"Image") => self.image(id),
                    _ => {}
                }
            }
        }
        if let Some((Object::Dictionary(patterns), pats_place)) = self.entry(res, &place, b"Pattern") {
            for (key, _) in patterns.iter() {
                let Some((pattern, pat_place)) = self.entry(patterns, &pats_place, key) else { continue };
                match pattern {
                    Object::Stream(_) if pat_place.path.is_empty() => self.form(pat_place.owner, Some((res, place.clone()))),
                    Object::Dictionary(d) => {
                        if let Some((shading, sh_place)) = self.entry(d, &pat_place, b"Shading") {
                            self.shading(shading, sh_place);
                        }
                    }
                    _ => {}
                }
            }
        }
        if let Some((Object::Dictionary(shadings), sh_place)) = self.entry(res, &place, b"Shading") {
            for (key, _) in shadings.iter() {
                if let Some((shading, p)) = self.entry(shadings, &sh_place, key) {
                    self.shading(shading, p);
                }
            }
        }
        if let Some((Object::Dictionary(states), gs_place)) = self.entry(res, &place, b"ExtGState") {
            for (key, _) in states.iter() {
                let Some((Object::Dictionary(gs), p)) = self.entry(states, &gs_place, key) else { continue };
                if let Some((Object::Dictionary(mask), mask_place)) = self.entry(gs, &p, b"SMask") {
                    self.soft_mask(mask, mask_place);
                }
            }
        }
        if let Some((Object::Dictionary(fonts), _)) = self.entry(res, &place, b"Font") {
            for (_, font) in fonts.iter() {
                let Ok((Some(font_id), Object::Dictionary(f))) = self.doc.dereference(font) else { continue };
                if f.get(b"Subtype").and_then(|o| o.as_name()).ok() != Some(b"Type3") {
                    continue;
                }
                let font_place = Place::root(font_id);
                let own = self.entry(f, &font_place, b"Resources").and_then(|(o, p)| dict_of(o).map(|d| (d, p)));
                if let Some((r, p)) = &own {
                    self.resources(r, p.clone());
                }
                let glyph_res = own.unwrap_or((res, place.clone()));
                if let Some((Object::Dictionary(procs), _)) = self.entry(f, &font_place, b"CharProcs") {
                    for (_, glyph) in procs.iter() {
                        if let Ok((Some(id), Object::Stream(_))) = self.doc.dereference(glyph) {
                            self.form(id, Some(glyph_res.clone()));
                        }
                    }
                }
            }
        }
    }

    fn image(&mut self, id: ObjectId) {
        if !self.seen.insert(id) {
            return;
        }
        let Ok(Object::Stream(s)) = self.doc.get_object(id) else { return };
        if matches!(s.dict.get(b"ImageMask").map(|o| self.deref(o)), Ok(Object::Boolean(true))) {
            return;
        }
        let Ok(cs) = s.dict.get(b"ColorSpace") else {
            // JPEG 2000 zonder /ColorSpace draagt zijn eigen kleurruimte mee.
            let (filters, _) = images::filters_of(&s.dict, false);
            if filters.iter().any(|f| f == b"JPXDecode") {
                self.report.images.skipped("jpeg2000");
            }
            return;
        };
        match self.classify(cs) {
            Space::Rgb(source) => {
                let mut dict = s.dict.clone();
                for key in [&b"Width"[..], b"Height", b"BitsPerComponent", b"Filter", b"DecodeParms", b"Decode", b"Mask"] {
                    if let Ok(v) = s.dict.get(key) {
                        dict.set(key.to_vec(), self.resolve_shallow(v));
                    }
                }
                let result = images::convert_rgb_image(&dict, &s.content, self.transform_for(source));
                match result {
                    Ok((mut new_dict, content)) => {
                        // Alleen de opgeloste sleutels die de omzetting zelf zet
                        // horen in het nieuwe woordenboek; de rest blijft zoals
                        // hij stond (ook als verwijzing).
                        for key in [&b"Width"[..], b"Height", b"Mask"] {
                            if let Ok(v) = s.dict.get(key) {
                                new_dict.set(key.to_vec(), v.clone());
                            }
                        }
                        self.edits.insert(id, Object::Stream(Stream::new(new_dict, content)));
                        self.matte(s, source);
                        self.report.images.converted();
                    }
                    Err(reason) => self.report.images.skipped(reason),
                }
            }
            Space::IndexedRgb => match self.cmyk_space_for(cs) {
                Ok(new) => {
                    self.set(&Place::root(id), "ColorSpace", new);
                    self.report.images.converted();
                }
                Err(reason) => self.report.images.skipped(reason),
            },
            Space::SpotOnRgb => self.report.images.skipped("separationRgbAlternate"),
            _ => {}
        }
    }

    /// `/Matte` van het zachte masker telt de componenten van de ouder.
    fn matte(&mut self, image: &'a Stream, source: RgbSource) {
        let Ok(Object::Reference(mask)) = image.dict.get(b"SMask") else { return };
        let Ok(Object::Stream(m)) = self.doc.get_object(*mask) else { return };
        let Ok(matte) = m.dict.get(b"Matte") else { return };
        if let Some(new) = self.convert_array(source, self.deref(matte)) {
            self.set(&Place::root(*mask), "Matte", new);
        }
    }

    fn soft_mask(&mut self, mask: &'a Dictionary, place: Place) {
        let Some((Object::Stream(g), g_place)) = self.entry(mask, &place, b"G") else { return };
        if !g_place.path.is_empty() {
            return;
        }
        // De achtergrondkleur telt de componenten van de groepsruimte.
        let group_space = self
            .entry(&g.dict, &g_place, b"Group")
            .and_then(|(o, _)| dict_of(o))
            .and_then(|d| d.get(b"CS").ok())
            .map(|cs| self.classify(cs));
        self.form(g_place.owner, None);
        if let (Some(Space::Rgb(source)), Ok(bc)) = (group_space, mask.get(b"BC")) {
            if let Some(new) = self.convert_array(source, self.deref(bc)) {
                self.set(&place, "BC", new);
            }
        }
    }

    fn group(&mut self, holder: &'a Dictionary, holder_place: &Place) {
        let Some((Object::Dictionary(g), place)) = self.entry(holder, holder_place, b"Group") else { return };
        if !self.seen_places.insert(place.clone()) {
            return;
        }
        if g.get(b"S").and_then(|o| o.as_name()).ok() != Some(b"Transparency") {
            return;
        }
        let Ok(cs) = g.get(b"CS") else { return };
        match self.classify(cs) {
            Space::Rgb(_) => {
                self.set(&place, "CS", name("DeviceCMYK"));
                self.report.transparency_groups.converted();
            }
            Space::SpotOnRgb => self.report.transparency_groups.skipped("separationRgbAlternate"),
            _ => {}
        }
    }

    fn shading(&mut self, shading: &'a Object, place: Place) {
        if !self.seen_places.insert(place.clone()) {
            return;
        }
        let Some(sd) = dict_of(shading) else { return };
        let Ok(cs) = sd.get(b"ColorSpace") else { return };
        let source = match self.classify(cs) {
            Space::Rgb(source) => source,
            Space::IndexedRgb => {
                match self.cmyk_space_for(cs) {
                    Ok(new) => {
                        self.set(&place, "ColorSpace", new);
                        self.report.shadings.converted();
                    }
                    Err(reason) => self.report.shadings.skipped(reason),
                }
                return;
            }
            Space::SpotOnRgb => {
                self.report.shadings.skipped("separationRgbAlternate");
                return;
            }
            _ => return,
        };
        if !matches!(self.int(sd, b"ShadingType"), Some(2) | Some(3)) {
            self.report.shadings.skipped("shadingType");
            return;
        }
        let Some((function, f_place)) = self.entry(sd, &place, b"Function") else {
            self.report.shadings.skipped("malformed");
            return;
        };
        let plan = match function {
            Object::Array(parts) => self.merge_plan(parts, source).map(|f| vec![FnEdit::Replace(f)]),
            _ => self.function_plan(function, &f_place, source),
        };
        let plan = match plan {
            Ok(plan) => plan,
            Err(reason) => {
                self.report.shadings.skipped(reason);
                return;
            }
        };
        for edit in plan {
            match edit {
                FnEdit::Replace(f) => self.set(&place, "Function", f),
                FnEdit::SetC { place: fp, c0, c1, range } => {
                    // Een gedeelde functie maar één keer omzetten.
                    if fp.path.is_empty() && !self.functions.insert(fp.owner) {
                        continue;
                    }
                    self.set(&fp, "C0", nums(&c0));
                    self.set(&fp, "C1", nums(&c1));
                    if range {
                        self.set(&fp, "Range", nums(&[0.0, 1.0, 0.0, 1.0, 0.0, 1.0, 0.0, 1.0]));
                    }
                }
            }
        }
        if let Some(bg) = sd.get(b"Background").ok().map(|o| self.deref(o)) {
            if let Some(new) = self.convert_array(source, bg) {
                self.set(&place, "Background", new);
            }
        }
        self.set(&place, "ColorSpace", name("DeviceCMYK"));
        self.report.shadings.converted();
    }

    /// Exponentiële functie (type 2) met drie uitgangen, of een stitching-
    /// functie (type 3) die alleen uit zulke functies bestaat. Eerst alles
    /// controleren, dan pas iets wijzigen.
    fn function_plan(&mut self, f: &'a Object, place: &Place, source: RgbSource) -> Result<Vec<FnEdit>, &'static str> {
        let d = dict_of(f).ok_or("malformed")?;
        match self.int(d, b"FunctionType") {
            Some(2) => {
                let c0 = d.get(b"C0").ok().map(|o| self.deref(o)).and_then(floats).ok_or("malformed")?;
                let c1 = d.get(b"C1").ok().map(|o| self.deref(o)).and_then(floats).ok_or("malformed")?;
                let ([r0, g0, b0], [r1, g1, b1]) = (c0[..].try_into().map_err(|_| "malformed")?, c1[..].try_into().map_err(|_| "malformed")?);
                Ok(vec![FnEdit::SetC {
                    place: place.clone(),
                    c0: self.convert_colour(source, [r0, g0, b0]),
                    c1: self.convert_colour(source, [r1, g1, b1]),
                    range: d.get(b"Range").is_ok(),
                }])
            }
            Some(3) => {
                let (parts, parts_place) = self.entry(d, place, b"Functions").ok_or("malformed")?;
                let parts = parts.as_array().map_err(|_| "malformed")?;
                let mut plan = Vec::new();
                for i in 0..parts.len() {
                    let (part, part_place) = self.item(parts, &parts_place, i).ok_or("malformed")?;
                    plan.extend(self.function_plan(part, &part_place, source)?);
                }
                Ok(plan)
            }
            _ => Err("functionType"),
        }
    }

    /// Drie functies met één uitgang (één per component) worden één
    /// exponentiële functie met vier uitgangen.
    fn merge_plan(&mut self, parts: &'a [Object], source: RgbSource) -> Result<Object, &'static str> {
        if parts.len() != 3 {
            return Err("functionType");
        }
        let mut c0 = [0f32; 3];
        let mut c1 = [0f32; 3];
        let mut shared: Option<(Option<Vec<f32>>, f32)> = None;
        for (i, part) in parts.iter().enumerate() {
            let d = dict_of(self.deref(part)).ok_or("malformed")?;
            if self.int(d, b"FunctionType") != Some(2) {
                return Err("functionType");
            }
            let one = |key: &[u8], default: f32| -> Result<f32, &'static str> {
                match d.get(key).ok().map(|o| self.deref(o)).and_then(floats) {
                    None => Ok(default),
                    Some(v) if v.len() == 1 => Ok(v[0]),
                    Some(_) => Err("malformed"),
                }
            };
            c0[i] = one(b"C0", 0.0)?;
            c1[i] = one(b"C1", 1.0)?;
            let domain = d.get(b"Domain").ok().map(|o| self.deref(o)).and_then(floats);
            let n = d.get(b"N").ok().map(|o| self.deref(o)).and_then(|o| o.as_float().ok()).unwrap_or(1.0);
            match &shared {
                None => shared = Some((domain, n)),
                Some(s) if *s == (domain.clone(), n) => {}
                Some(_) => return Err("functionType"),
            }
        }
        let (domain, n) = shared.ok_or("malformed")?;
        let mut f = Dictionary::new();
        f.set("FunctionType", 2);
        f.set("Domain", nums(&domain.unwrap_or_else(|| vec![0.0, 1.0])));
        f.set("C0", nums(&self.convert_colour(source, c0)));
        f.set("C1", nums(&self.convert_colour(source, c1)));
        f.set("N", Object::Real(n));
        Ok(Object::Dictionary(f))
    }

    fn inline_image(&mut self, image: &InlineImage, res: Option<&'a Dictionary>) -> InlineOutcome {
        let Some(cs) = inline_get(&image.dict, b"ColorSpace", b"CS") else { return InlineOutcome::Keep };
        let source = match cs {
            Object::Name(n) => match n.as_slice() {
                b"RGB" | b"DeviceRGB" => RgbSource::Srgb,
                b"G" | b"DeviceGray" | b"CMYK" | b"DeviceCMYK" => return InlineOutcome::Keep,
                other => match self.named_space(res, other) {
                    Space::Rgb(source) => source,
                    _ => return InlineOutcome::Keep,
                },
            },
            Object::Array(a) if matches!(a.first().and_then(|f| f.as_name().ok()), Some(b"I") | Some(b"Indexed")) => {
                let base = match a.get(1) {
                    Some(Object::Name(n)) if n == b"RGB" || n == b"DeviceRGB" => Space::Rgb(RgbSource::Srgb),
                    Some(Object::Name(n)) => self.named_space(res, n),
                    _ => Space::Other,
                };
                let Space::Rgb(source) = base else { return InlineOutcome::Keep };
                let (Some(hival), Some(Object::String(lookup, _))) = (a.get(2).and_then(|h| h.as_i64().ok()), a.get(3)) else {
                    return InlineOutcome::Skip("malformed");
                };
                let hival = hival.clamp(0, 255) as usize;
                let palette = images::convert_palette(lookup, hival, self.transform_for(source));
                let space = Object::Array(vec![
                    name("I"),
                    name("CMYK"),
                    Object::Integer(hival as i64),
                    Object::String(palette, StringFormat::Hexadecimal),
                ]);
                return InlineOutcome::Replace(images::inline_with_space(&image.dict, space, image.data));
            }
            _ => return InlineOutcome::Keep,
        };
        match images::convert_inline_rgb(&image.dict, image.data, self.transform_for(source)) {
            Ok(bytes) => InlineOutcome::Replace(bytes),
            Err(reason) => InlineOutcome::Skip(reason),
        }
    }

    fn named_space(&self, res: Option<&'a Dictionary>, key: &[u8]) -> Space {
        let Some(res) = res else { return Space::Other };
        let Some(spaces) = res.get(b"ColorSpace").ok().map(|o| self.deref(o)).and_then(dict_of) else {
            return Space::Other;
        };
        spaces.get(key).map(|v| self.classify(v)).unwrap_or(Space::Other)
    }
}

/// Het woordenboek aan het eind van `path`, binnen een (gekopieerd) object.
fn descend<'x>(o: &'x mut Object, path: &[Step]) -> Option<&'x mut Dictionary> {
    match path.split_first() {
        None => match o {
            Object::Dictionary(d) => Some(d),
            Object::Stream(s) => Some(&mut s.dict),
            _ => None,
        },
        Some((Step::Key(k), rest)) => {
            let d = match o {
                Object::Dictionary(d) => d,
                Object::Stream(s) => &mut s.dict,
                _ => return None,
            };
            descend(d.get_mut(k).ok()?, rest)
        }
        Some((Step::Index(i), rest)) => match o {
            Object::Array(a) => descend(a.get_mut(*i)?, rest),
            _ => None,
        },
    }
}

enum FnEdit {
    /// Nieuwe `C0`/`C1` (en eventueel `Range`) voor een exponentiële functie.
    SetC { place: Place, c0: [f32; 4], c1: [f32; 4], range: bool },
    /// Een nieuwe functie op de plek van `/Function` van het verloop.
    Replace(Object),
}

/// De omgeving van de herschrijver: resources van de stroom en de walker.
struct Env<'w, 'a> {
    w: &'w mut Walker<'a>,
    res: Option<&'a Dictionary>,
}

impl ContentEnv for Env<'_, '_> {
    fn named_space(&mut self, name: &[u8]) -> Space {
        self.w.named_space(self.res, name)
    }

    fn convert(&mut self, source: RgbSource, rgb: [f32; 3]) -> [f32; 4] {
        self.w.convert_colour(source, rgb)
    }

    fn inline_image(&mut self, image: &InlineImage) -> InlineOutcome {
        self.w.inline_image(image, self.res)
    }
}

/// Een object als PDF, met stromen.
fn write_object(out: &mut Vec<u8>, o: &Object) {
    match o {
        Object::Stream(s) => {
            let mut dict = s.dict.clone();
            dict.set("Length", s.content.len() as i64);
            out.extend_from_slice(fmt_obj(&Object::Dictionary(dict)).as_bytes());
            out.extend_from_slice(b"\nstream\n");
            out.extend_from_slice(&s.content);
            out.extend_from_slice(b"\nendstream");
        }
        other => out.extend_from_slice(fmt_obj(other).as_bytes()),
    }
}

/// Schrijft de gewijzigde objecten als incrementele update achter het
/// origineel: objecten, een xref-sectie en een trailer met `/Prev`.
fn write_incremental(original: &[u8], doc: &Document, edits: &BTreeMap<ObjectId, Object>) -> Vec<u8> {
    let mut out = Vec::with_capacity(original.len() + edits.len() * 1024);
    out.extend_from_slice(original);
    if !matches!(out.last(), Some(b'\n') | Some(b'\r')) {
        out.push(b'\n');
    }
    let mut entries: Vec<(u32, u16, usize)> = Vec::with_capacity(edits.len());
    for (&(id, gen), obj) in edits {
        entries.push((id, gen, out.len()));
        out.extend_from_slice(format!("{id} {gen} obj\n").as_bytes());
        write_object(&mut out, obj);
        out.extend_from_slice(b"\nendobj\n");
    }
    let xref_at = out.len();
    out.extend_from_slice(b"xref\n");
    let mut i = 0;
    while i < entries.len() {
        let mut j = i;
        while j + 1 < entries.len() && entries[j + 1].0 == entries[j].0 + 1 {
            j += 1;
        }
        out.extend_from_slice(format!("{} {}\n", entries[i].0, j - i + 1).as_bytes());
        for (_, gen, offset) in &entries[i..=j] {
            out.extend_from_slice(format!("{offset:010} {gen:05} n\r\n").as_bytes());
        }
        i = j + 1;
    }
    let max_edit = entries.iter().map(|e| e.0).max().unwrap_or(0);
    let old_size = doc.trailer.get(b"Size").and_then(|o| o.as_i64()).unwrap_or(0);
    let size = (doc.max_id as i64 + 1).max(old_size).max(max_edit as i64 + 1);
    let mut trailer = Dictionary::new();
    trailer.set("Size", size);
    for key in [&b"Root"[..], b"Info", b"ID"] {
        if let Ok(v) = doc.trailer.get(key) {
            trailer.set(key.to_vec(), v.clone());
        }
    }
    trailer.set("Prev", doc.xref_start as i64);
    out.extend_from_slice(b"trailer\n");
    out.extend_from_slice(fmt_obj(&Object::Dictionary(trailer)).as_bytes());
    out.extend_from_slice(format!("\nstartxref\n{xref_at}\n%%EOF\n").as_bytes());
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::transform::NaiveCmyk;
    use lopdf::{dictionary, Dictionary, Document, Object, ObjectId, Stream, StringFormat};

    /// Een document met één pagina en een inline resources-woordenboek.
    struct Fx {
        doc: Document,
        page: ObjectId,
    }

    fn name(n: &str) -> Object {
        Object::Name(n.as_bytes().to_vec())
    }

    fn nums(v: &[f32]) -> Object {
        Object::Array(v.iter().map(|&x| Object::Real(x)).collect())
    }

    impl Fx {
        fn new(content: &str) -> Fx {
            let mut doc = Document::with_version("1.7");
            let pages = doc.new_object_id();
            let contents = doc.add_object(Stream::new(dictionary! {}, content.as_bytes().to_vec()));
            let page = doc.add_object(dictionary! {
                "Type" => "Page",
                "Parent" => pages,
                "MediaBox" => vec![0.into(), 0.into(), 100.into(), 100.into()],
                "Contents" => contents,
                "Resources" => dictionary! {},
            });
            doc.objects.insert(pages, Object::Dictionary(dictionary! {
                "Type" => "Pages", "Kids" => vec![page.into()], "Count" => 1,
            }));
            let catalog = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages });
            doc.trailer.set("Root", catalog);
            Fx { doc, page }
        }

        fn page(&mut self) -> &mut Dictionary {
            self.doc.get_object_mut(self.page).unwrap().as_dict_mut().unwrap()
        }

        fn res(&mut self, kind: &str, key: &str, value: impl Into<Object>) {
            let res = self.page().get_mut(b"Resources").unwrap().as_dict_mut().unwrap();
            if res.get(kind.as_bytes()).is_err() {
                res.set(kind, Dictionary::new());
            }
            res.get_mut(kind.as_bytes()).unwrap().as_dict_mut().unwrap().set(key, value);
        }

        fn add(&mut self, o: impl Into<Object>) -> ObjectId {
            self.doc.add_object(o)
        }

        fn bytes(mut self) -> Vec<u8> {
            let mut out = Vec::new();
            self.doc.save_to(&mut out).unwrap();
            out
        }
    }

    fn convert(input: &[u8]) -> (Document, Report, Vec<u8>) {
        let out = convert_document(input, &NaiveCmyk).unwrap();
        let doc = Document::load_mem(&out.pdf).expect("uitvoer moet weer te lezen zijn");
        (doc, out.report, out.pdf)
    }

    fn page_content(doc: &Document) -> String {
        let page = *doc.get_pages().get(&1).unwrap();
        String::from_utf8(doc.get_page_content(page).unwrap()).unwrap()
    }

    fn stream_of(doc: &Document, id: ObjectId) -> &Stream {
        doc.get_object(id).unwrap().as_stream().unwrap()
    }

    fn plain(s: &Stream) -> Vec<u8> {
        if s.dict.get(b"Filter").is_ok() {
            let mut s = s.clone();
            s.dict.remove(b"Subtype");
            s.decompressed_content().unwrap()
        } else {
            s.content.clone()
        }
    }

    #[test]
    fn page_content_is_rewritten_as_an_incremental_update() {
        let input = Fx::new("1 0 0 rg 0 0 10 10 re f").bytes();
        let (doc, report, out) = convert(&input);
        assert_eq!(page_content(&doc), "0 1 1 0 k 0 0 10 10 re f");
        assert!(out.starts_with(&input), "de oorspronkelijke bytes blijven vooraan staan");
        assert!(out.len() > input.len());
        assert_eq!(report.content_streams.converted, 1);
        assert_eq!(report.colour_operators.converted, 1);
    }

    #[test]
    fn nothing_to_convert_returns_the_input_unchanged() {
        let input = Fx::new("0.5 g 0 0 10 10 re f").bytes();
        let out = convert_document(&input, &NaiveCmyk).unwrap();
        assert_eq!(out.pdf, input);
        assert_eq!(out.report, Report::default());
    }

    #[test]
    fn encrypted_documents_are_refused() {
        let mut fx = Fx::new("");
        let enc = fx.add(dictionary! { "Filter" => "Standard", "V" => 1, "R" => 2 });
        fx.doc.trailer.set("Encrypt", enc);
        assert_eq!(convert_document(&fx.bytes(), &NaiveCmyk).err(), Some(ConvertError::Encrypted));
        assert!(matches!(convert_document(b"not a pdf", &NaiveCmyk), Err(ConvertError::Unreadable(_))));
    }

    #[test]
    fn colour_space_state_runs_across_the_streams_of_one_page() {
        let mut fx = Fx::new("/DeviceRGB cs\n");
        let second = fx.add(Stream::new(dictionary! {}, b"1 0 0 sc".to_vec()));
        let first = fx.page().get(b"Contents").unwrap().clone();
        fx.page().set("Contents", vec![first, second.into()]);
        let (doc, _, _) = convert(&fx.bytes());
        assert_eq!(page_content(&doc), "/DeviceCMYK cs\n0 1 1 0 sc");
    }

    #[test]
    fn rgb_image_becomes_cmyk_and_keeps_its_soft_mask() {
        let mut fx = Fx::new("q 10 0 0 10 0 0 cm /Im0 Do Q");
        let smask = fx.add(Stream::new(
            dictionary! { "Type" => "XObject", "Subtype" => "Image", "Width" => 1, "Height" => 1,
                "ColorSpace" => "DeviceGray", "BitsPerComponent" => 8, "Matte" => nums(&[1.0, 0.0, 0.0]) },
            vec![128],
        ));
        let img = fx.add(Stream::new(
            dictionary! { "Type" => "XObject", "Subtype" => "Image", "Width" => 1, "Height" => 1,
                "ColorSpace" => "DeviceRGB", "BitsPerComponent" => 8, "SMask" => smask },
            vec![255, 0, 0],
        ));
        fx.res("XObject", "Im0", img);
        let (doc, report, _) = convert(&fx.bytes());
        let s = stream_of(&doc, img);
        assert_eq!(s.dict.get(b"ColorSpace").unwrap(), &name("DeviceCMYK"));
        assert_eq!(s.dict.get(b"SMask").unwrap(), &Object::Reference(smask));
        assert_eq!(plain(s), vec![0, 255, 255, 0]);
        // De Matte hoort bij de kleurruimte van de ouder: nu vier componenten.
        let matte = stream_of(&doc, smask).dict.get(b"Matte").unwrap().as_array().unwrap().len();
        assert_eq!(matte, 4);
        assert_eq!(report.images.converted, 1);
    }

    #[test]
    fn indexed_image_only_gets_a_new_palette() {
        let mut fx = Fx::new("/Im0 Do");
        let img = fx.add(Stream::new(
            dictionary! { "Type" => "XObject", "Subtype" => "Image", "Width" => 2, "Height" => 1, "BitsPerComponent" => 8,
                "ColorSpace" => vec![name("Indexed"), name("DeviceRGB"), 1.into(),
                    Object::String(vec![255, 0, 0, 0, 0, 255], StringFormat::Hexadecimal)] },
            vec![0, 1],
        ));
        fx.res("XObject", "Im0", img);
        let (doc, report, _) = convert(&fx.bytes());
        let s = stream_of(&doc, img);
        let cs = s.dict.get(b"ColorSpace").unwrap().as_array().unwrap();
        assert_eq!(cs[1], name("DeviceCMYK"));
        assert_eq!(cs[3].as_str().unwrap(), &[0, 255, 255, 0, 255, 255, 0, 0]);
        assert_eq!(s.content, vec![0, 1]);
        assert_eq!(report.images.converted, 1);
    }

    #[test]
    fn named_icc_rgb_space_is_replaced_in_the_resources() {
        let mut fx = Fx::new("/CS0 cs 1 0 0 scn 0 0 5 5 re f");
        let icc = fx.add(Stream::new(dictionary! { "N" => 3 }, vec![0; 8]));
        fx.res("ColorSpace", "CS0", vec![name("ICCBased"), icc.into()]);
        let (doc, report, _) = convert(&fx.bytes());
        assert_eq!(page_content(&doc), "/CS0 cs 0 1 1 0 scn 0 0 5 5 re f");
        let page = doc.get_dictionary(*doc.get_pages().get(&1).unwrap()).unwrap();
        let cs = page.get(b"Resources").unwrap().as_dict().unwrap().get(b"ColorSpace").unwrap();
        assert_eq!(cs.as_dict().unwrap().get(b"CS0").unwrap(), &name("DeviceCMYK"));
        assert_eq!(report.colour_spaces.converted, 1);
    }

    /// Transformatie die voor een ingebed bronprofiel iets herkenbaars geeft.
    struct WithSource;
    struct FromIcc;
    impl CmykTransform for WithSource {
        fn rgb_to_cmyk(&self, rgb: [f32; 3]) -> [f32; 4] {
            NaiveCmyk.rgb_to_cmyk(rgb)
        }
        fn with_source_profile(&self, icc: &[u8]) -> Option<Box<dyn CmykTransform>> {
            (icc == b"profile").then(|| Box::new(FromIcc) as Box<dyn CmykTransform>)
        }
    }
    impl CmykTransform for FromIcc {
        fn rgb_to_cmyk(&self, _: [f32; 3]) -> [f32; 4] {
            [0.1, 0.2, 0.3, 0.4]
        }
    }

    #[test]
    fn icc_based_colours_use_their_embedded_profile_as_source() {
        let mut fx = Fx::new("/CS0 cs 1 0 0 scn 1 0 0 rg");
        let icc = fx.add(Stream::new(dictionary! { "N" => 3 }, b"profile".to_vec()));
        fx.res("ColorSpace", "CS0", vec![name("ICCBased"), icc.into()]);
        let out = convert_document(&fx.bytes(), &WithSource).unwrap();
        let doc = Document::load_mem(&out.pdf).unwrap();
        assert_eq!(page_content(&doc), "/CS0 cs 0.1 0.2 0.3 0.4 scn 0 1 1 0 k");
    }

    #[test]
    fn nested_forms_are_converted_once_and_annotation_appearances_too() {
        let mut fx = Fx::new("/Fm0 Do /Fm0 Do");
        let inner = fx.add(Stream::new(
            dictionary! { "Type" => "XObject", "Subtype" => "Form", "BBox" => vec![0.into(), 0.into(), 1.into(), 1.into()] },
            b"0 0 1 RG".to_vec(),
        ));
        let outer = fx.add(Stream::new(
            dictionary! { "Type" => "XObject", "Subtype" => "Form", "BBox" => vec![0.into(), 0.into(), 1.into(), 1.into()],
                "Resources" => dictionary! { "XObject" => dictionary! { "In" => inner } } },
            b"1 1 1 rg /In Do".to_vec(),
        ));
        fx.res("XObject", "Fm0", outer);
        let ap = fx.add(Stream::new(
            dictionary! { "Type" => "XObject", "Subtype" => "Form", "BBox" => vec![0.into(), 0.into(), 1.into(), 1.into()] },
            b"1 0 0 RG 0 0 m 1 1 l S".to_vec(),
        ));
        let annot = fx.add(dictionary! { "Type" => "Annot", "Subtype" => "Square",
            "Rect" => vec![0.into(), 0.into(), 1.into(), 1.into()], "AP" => dictionary! { "N" => ap } });
        fx.page().set("Annots", vec![annot.into()]);
        let (doc, report, _) = convert(&fx.bytes());
        assert_eq!(plain(stream_of(&doc, outer)), b"0 0 0 0 k /In Do");
        assert_eq!(plain(stream_of(&doc, inner)), b"1 1 0 0 K");
        assert_eq!(plain(stream_of(&doc, ap)), b"0 1 1 0 K 0 0 m 1 1 l S");
        assert_eq!(report.content_streams.converted, 3);
    }

    #[test]
    fn form_without_resources_uses_the_page_resources() {
        let mut fx = Fx::new("/Fm0 Do");
        let form = fx.add(Stream::new(
            dictionary! { "Type" => "XObject", "Subtype" => "Form", "BBox" => vec![0.into(), 0.into(), 1.into(), 1.into()] },
            b"/CS0 cs 0 1 0 sc".to_vec(),
        ));
        fx.res("XObject", "Fm0", form);
        fx.res("ColorSpace", "CS0", vec![name("CalRGB"), dictionary! {}.into()]);
        let (doc, _, _) = convert(&fx.bytes());
        assert_eq!(plain(stream_of(&doc, form)), b"/CS0 cs 1 0 1 0 sc");
    }

    #[test]
    fn tiling_pattern_content_and_inherited_resources_are_converted() {
        let mut fx = Fx::new("/Pattern cs /P0 scn 0 0 9 9 re f");
        let pat = fx.add(Stream::new(
            dictionary! { "PatternType" => 1, "PaintType" => 1, "TilingType" => 1,
                "BBox" => vec![0.into(), 0.into(), 1.into(), 1.into()], "XStep" => 1, "YStep" => 1,
                "Resources" => dictionary! {} },
            b"1 0 0 rg 0 0 1 1 re f".to_vec(),
        ));
        fx.res("Pattern", "P0", pat);
        let (doc, report, _) = convert(&fx.bytes());
        assert_eq!(plain(stream_of(&doc, pat)), b"0 1 1 0 k 0 0 1 1 re f");
        assert_eq!(report.content_streams.converted, 1);
    }

    #[test]
    fn inherited_page_resources_are_found() {
        let mut fx = Fx::new("/Im0 Do");
        let img = fx.add(Stream::new(
            dictionary! { "Type" => "XObject", "Subtype" => "Image", "Width" => 1, "Height" => 1,
                "ColorSpace" => "DeviceRGB", "BitsPerComponent" => 8 },
            vec![0, 0, 0],
        ));
        fx.page().remove(b"Resources");
        let pages = fx.page().get(b"Parent").unwrap().as_reference().unwrap();
        fx.doc.get_dictionary_mut(pages).unwrap().set("Resources", dictionary! { "XObject" => dictionary! { "Im0" => img } });
        let (doc, report, _) = convert(&fx.bytes());
        assert_eq!(plain(stream_of(&doc, img)), vec![0, 0, 0, 255]);
        assert_eq!(report.images.converted, 1);
    }

    fn axial(function: Object) -> Dictionary {
        dictionary! { "ShadingType" => 2, "ColorSpace" => "DeviceRGB",
            "Coords" => vec![0.into(), 0.into(), 1.into(), 0.into()], "Function" => function,
            "Background" => nums(&[1.0, 1.0, 1.0]) }
    }

    fn exp_fn(c0: &[f32], c1: &[f32]) -> Dictionary {
        dictionary! { "FunctionType" => 2, "Domain" => nums(&[0.0, 1.0]), "C0" => nums(c0), "C1" => nums(c1), "N" => 1 }
    }

    #[test]
    fn axial_shading_with_an_exponential_function_is_converted() {
        let mut fx = Fx::new("/Sh0 sh");
        let f = fx.add(exp_fn(&[1.0, 0.0, 0.0], &[0.0, 0.0, 1.0]));
        let sh = fx.add(axial(f.into()));
        fx.res("Shading", "Sh0", sh);
        let (doc, report, _) = convert(&fx.bytes());
        let s = doc.get_dictionary(sh).unwrap();
        assert_eq!(s.get(b"ColorSpace").unwrap(), &name("DeviceCMYK"));
        assert_eq!(s.get(b"Background").unwrap().as_array().unwrap().len(), 4);
        let func = doc.get_dictionary(f).unwrap();
        let c0: Vec<f32> = func.get(b"C0").unwrap().as_array().unwrap().iter().map(|o| o.as_float().unwrap()).collect();
        assert_eq!(c0, vec![0.0, 1.0, 1.0, 0.0]);
        assert_eq!(report.shadings.converted, 1);
    }

    #[test]
    fn stitching_function_and_shading_pattern_are_converted() {
        let mut fx = Fx::new("/Pattern cs /P0 scn 0 0 9 9 re f");
        let a = fx.add(exp_fn(&[1.0, 0.0, 0.0], &[0.0, 1.0, 0.0]));
        let stitch = dictionary! { "FunctionType" => 3, "Domain" => nums(&[0.0, 1.0]),
            "Functions" => vec![a.into(), exp_fn(&[0.0, 1.0, 0.0], &[0.0, 0.0, 1.0]).into()],
            "Bounds" => nums(&[0.5]), "Encode" => nums(&[0.0, 1.0, 0.0, 1.0]) };
        let mut sh = axial(stitch.into());
        sh.set("ShadingType", 3);
        let pat = fx.add(dictionary! { "PatternType" => 2, "Shading" => sh });
        fx.res("Pattern", "P0", pat);
        let (doc, report, _) = convert(&fx.bytes());
        let sh = doc.get_dictionary(pat).unwrap().get(b"Shading").unwrap().as_dict().unwrap();
        assert_eq!(sh.get(b"ColorSpace").unwrap(), &name("DeviceCMYK"));
        let inline = sh.get(b"Function").unwrap().as_dict().unwrap().get(b"Functions").unwrap().as_array().unwrap()[1]
            .as_dict()
            .unwrap()
            .get(b"C1")
            .unwrap()
            .as_array()
            .unwrap()
            .len();
        assert_eq!(inline, 4);
        assert_eq!(doc.get_dictionary(a).unwrap().get(b"C0").unwrap().as_array().unwrap().len(), 4);
        assert_eq!(report.shadings.converted, 1);
    }

    #[test]
    fn three_single_output_functions_are_merged_into_one() {
        let mut fx = Fx::new("/Sh0 sh");
        let parts: Vec<Object> = [(1.0, 0.0), (0.0, 0.0), (0.0, 1.0)]
            .iter()
            .map(|&(a, b)| exp_fn(&[a], &[b]).into())
            .collect();
        let sh = fx.add(axial(Object::Array(parts)));
        fx.res("Shading", "Sh0", sh);
        let (doc, report, _) = convert(&fx.bytes());
        let f = doc.get_dictionary(sh).unwrap().get(b"Function").unwrap().as_dict().unwrap();
        let c0: Vec<f32> = f.get(b"C0").unwrap().as_array().unwrap().iter().map(|o| o.as_float().unwrap()).collect();
        let c1: Vec<f32> = f.get(b"C1").unwrap().as_array().unwrap().iter().map(|o| o.as_float().unwrap()).collect();
        assert_eq!(c0, vec![0.0, 1.0, 1.0, 0.0]);
        assert_eq!(c1, vec![1.0, 1.0, 0.0, 0.0]);
        assert_eq!(report.shadings.converted, 1);
    }

    #[test]
    fn other_shadings_are_left_and_reported() {
        let mut fx = Fx::new("/Sh0 sh /Sh1 sh");
        let sampled = fx.add(Stream::new(
            dictionary! { "FunctionType" => 0, "Domain" => nums(&[0.0, 1.0]), "Range" => nums(&[0.0, 1.0, 0.0, 1.0, 0.0, 1.0]),
                "Size" => vec![2.into()], "BitsPerSample" => 8 },
            vec![255, 0, 0, 0, 0, 255],
        ));
        let sh0 = fx.add(axial(sampled.into()));
        let mesh = fx.add(Stream::new(
            dictionary! { "ShadingType" => 4, "ColorSpace" => "DeviceRGB", "BitsPerCoordinate" => 8,
                "BitsPerComponent" => 8, "BitsPerFlag" => 8, "Decode" => nums(&[0.0, 1.0, 0.0, 1.0, 0.0, 1.0, 0.0, 1.0, 0.0, 1.0]) },
            vec![],
        ));
        fx.res("Shading", "Sh0", sh0);
        fx.res("Shading", "Sh1", mesh);
        let (doc, report, _) = convert(&fx.bytes());
        assert_eq!(doc.get_dictionary(sh0).unwrap().get(b"ColorSpace").unwrap(), &name("DeviceRGB"));
        assert_eq!(report.shadings.skipped.get("functionType"), Some(&1));
        assert_eq!(report.shadings.skipped.get("shadingType"), Some(&1));
        assert_eq!(report.shadings.converted, 0);
    }

    #[test]
    fn transparency_group_and_soft_mask_backdrop_are_converted() {
        let mut fx = Fx::new("/GS0 gs 1 0 0 rg 0 0 5 5 re f");
        fx.page().set("Group", dictionary! { "Type" => "Group", "S" => "Transparency", "CS" => "DeviceRGB" });
        let mask = fx.add(Stream::new(
            dictionary! { "Type" => "XObject", "Subtype" => "Form", "BBox" => vec![0.into(), 0.into(), 1.into(), 1.into()],
                "Group" => dictionary! { "S" => "Transparency", "CS" => "DeviceRGB" } },
            b"0.5 0.5 0.5 rg 0 0 1 1 re f".to_vec(),
        ));
        fx.res("ExtGState", "GS0", dictionary! { "SMask" => dictionary! { "S" => "Luminosity", "G" => mask, "BC" => nums(&[1.0, 1.0, 1.0]) } });
        let (doc, report, _) = convert(&fx.bytes());
        let page = doc.get_dictionary(*doc.get_pages().get(&1).unwrap()).unwrap();
        assert_eq!(page.get(b"Group").unwrap().as_dict().unwrap().get(b"CS").unwrap(), &name("DeviceCMYK"));
        let form = stream_of(&doc, mask);
        assert_eq!(form.dict.get(b"Group").unwrap().as_dict().unwrap().get(b"CS").unwrap(), &name("DeviceCMYK"));
        assert_eq!(plain(form), b"0 0 0 0.5 k 0 0 1 1 re f");
        let gs = page.get(b"Resources").unwrap().as_dict().unwrap().get(b"ExtGState").unwrap().as_dict().unwrap();
        let bc = gs.get(b"GS0").unwrap().as_dict().unwrap().get(b"SMask").unwrap().as_dict().unwrap().get(b"BC").unwrap();
        assert_eq!(bc.as_array().unwrap().len(), 4);
        assert_eq!(report.transparency_groups.converted, 2);
    }

    #[test]
    fn separation_on_an_rgb_alternate_is_reported_not_converted() {
        let mut fx = Fx::new("/CS0 cs 1 sc");
        let tint = fx.add(exp_fn(&[1.0, 1.0, 1.0], &[1.0, 0.0, 0.0]));
        fx.res("ColorSpace", "CS0", vec![name("Separation"), name("Spot"), name("DeviceRGB"), tint.into()]);
        let (_, report, _) = convert(&fx.bytes());
        assert_eq!(report.colour_spaces.skipped.get("separationRgbAlternate"), Some(&1));
        assert_eq!(report.colour_spaces.converted, 0);
    }

    #[test]
    fn inline_rgb_image_in_the_page_is_converted() {
        let input = Fx::new("q BI /W 1 /H 1 /BPC 8 /CS /RGB ID \u{0}\u{0}\u{0} EI Q").bytes();
        let (doc, report, _) = convert(&input);
        let content = page_content(&doc);
        assert!(content.starts_with("q BI /W 1 /H 1 /BPC 8 /CS /CMYK /F [/AHx /Fl] ID\n"), "{content}");
        assert!(content.ends_with(">\nEI Q"), "{content}");
        assert_eq!(report.inline_images.converted, 1);
    }

    #[test]
    fn shared_page_content_is_converted_once() {
        let mut fx = Fx::new("1 0 0 rg");
        let contents = fx.page().get(b"Contents").unwrap().clone();
        let pages = fx.page().get(b"Parent").unwrap().as_reference().unwrap();
        let second = fx.add(dictionary! { "Type" => "Page", "Parent" => pages,
            "MediaBox" => vec![0.into(), 0.into(), 100.into(), 100.into()], "Contents" => contents, "Resources" => dictionary! {} });
        let kids = fx.doc.get_dictionary_mut(pages).unwrap();
        kids.get_mut(b"Kids").unwrap().as_array_mut().unwrap().push(second.into());
        kids.set("Count", 2);
        let (_, report, _) = convert(&fx.bytes());
        assert_eq!(report.content_streams.converted, 1);
        assert_eq!(report.colour_operators.converted, 1);
    }

    #[test]
    fn content_stream_with_an_unknown_filter_is_reported() {
        let mut fx = Fx::new("");
        let odd = fx.add(Stream::new(dictionary! { "Filter" => "JBIG2Decode" }, b"xx".to_vec()));
        fx.page().set("Contents", odd);
        let (_, report, _) = convert(&fx.bytes());
        assert_eq!(report.content_streams.skipped.get("decodeFailed"), Some(&1));
    }
}
