//! Wat is er na een handtekening aan het bestand toegevoegd? Vergelijkt de
//! ondertekende versie (de bytes tot het einde van het bytebereik) met het hele
//! bestand, object voor object.
//!
//! Twee soorten, als hulp bij "het document is daarna nog gewijzigd" (spec
//! §7.2): alleen *toevoegingen* die de ondertekende inhoud laten staan
//! (annotaties, formuliervelden, nog een handtekening, LTV-gegevens,
//! documentgegevens), of een wijziging van de *inhoud*: paginastromen,
//! lettertypen, de paginaboom, of een al ondertekend veld of zijn weergave.
//! Een heuristiek, geen DocMDP-beoordeling: bij twijfel telt het als inhoud.

use std::collections::HashSet;

use lopdf::{Dictionary, Document, Object, ObjectId};
use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum LatereWijziging {
    /// Alleen annotaties, velden, handtekeningen, LTV-gegevens of documentgegevens erbij of gewijzigd.
    Toevoegingen,
    /// Ondertekende inhoud is vervangen of gewijzigd.
    Inhoud,
    /// Niet te bepalen (een van beide versies niet te lezen).
    Onbekend,
}

fn laad(bytes: &[u8]) -> Option<Document> {
    std::panic::catch_unwind(|| Document::load_mem(bytes)).ok()?.ok()
}

/// Het hele document, eenmaal geladen voor alle handtekeningen.
pub struct Vergelijker<'a> {
    bytes: &'a [u8],
    geheel: Option<Option<Document>>,
}

impl<'a> Vergelijker<'a> {
    pub fn nieuw(bytes: &'a [u8]) -> Vergelijker<'a> {
        Vergelijker { bytes, geheel: None }
    }

    /// De soort wijziging na de versie die op `einde` eindigt.
    pub fn na(&mut self, einde: usize) -> LatereWijziging {
        let bytes = self.bytes;
        let Some(oud) = bytes.get(..einde).and_then(laad) else { return LatereWijziging::Onbekend };
        let Some(nieuw) = self.geheel.get_or_insert_with(|| laad(bytes)).as_ref() else {
            return LatereWijziging::Onbekend;
        };
        vergelijk(&oud, nieuw)
    }
}

fn verwijzing(d: &Dictionary, sleutel: &[u8]) -> Option<ObjectId> {
    d.get(sleutel).ok().and_then(|o| o.as_reference().ok())
}

fn naam_is(d: &Dictionary, sleutel: &[u8], waarde: &[u8]) -> bool {
    d.get(sleutel).ok().and_then(|o| o.as_name().ok()) == Some(waarde)
}

/// Is `d` een al ondertekend handtekeningveld (of een widget daarvan)?
fn is_ondertekend_veld(doc: &Document, d: &Dictionary) -> bool {
    let heeft_waarde = |d: &Dictionary| naam_is(d, b"FT", b"Sig") && d.get(b"V").is_ok();
    if heeft_waarde(d) {
        return true;
    }
    // Een widget onder een veld (FT en V staan dan bij de ouder).
    verwijzing(d, b"Parent")
        .and_then(|p| doc.get_dictionary(p).ok())
        .is_some_and(|ouder| heeft_waarde(ouder))
}

/// Woordenboeken gelijk, behalve de sleutels in `mag`?
fn gelijk_behalve(a: &Dictionary, b: &Dictionary, mag: &[&[u8]]) -> bool {
    let sleutels: HashSet<&[u8]> = a.iter().chain(b.iter()).map(|(k, _)| k.as_slice()).collect();
    sleutels.into_iter().filter(|k| !mag.contains(k)).all(|k| a.get(k).ok() == b.get(k).ok())
}

/// Objecten die bij annotaties, formulieren en LTV-gegevens horen en dus mogen
/// veranderen: `/Annots`-arrays, het AcroForm met zijn `/Fields`, `/DSS`,
/// `/Info` en `/Metadata`.
fn toegestane_containers(doc: &Document) -> HashSet<ObjectId> {
    let mut ids = HashSet::new();
    for (_, pagina) in doc.get_pages() {
        if let Some(a) = doc.get_dictionary(pagina).ok().and_then(|p| verwijzing(p, b"Annots")) {
            ids.insert(a);
        }
    }
    if let Some(info) = verwijzing(&doc.trailer, b"Info") {
        ids.insert(info);
    }
    if let Ok(cat) = doc.catalog() {
        for sleutel in [b"AcroForm".as_slice(), b"DSS", b"Metadata"] {
            if let Some(id) = verwijzing(cat, sleutel) {
                ids.insert(id);
            }
        }
        let acroform = match cat.get(b"AcroForm") {
            Ok(Object::Reference(id)) => doc.get_dictionary(*id).ok(),
            Ok(Object::Dictionary(d)) => Some(d),
            _ => None,
        };
        if let Some(f) = acroform.and_then(|a| verwijzing(a, b"Fields")) {
            ids.insert(f);
        }
        // Alles onder /DSS (VRI, certificaten, OCSP, CRL) is LTV-materiaal.
        if let Some(dss) = verwijzing(cat, b"DSS").and_then(|id| doc.get_dictionary(id).ok()).or_else(|| cat.get(b"DSS").ok().and_then(|o| o.as_dict().ok())) {
            for (_, w) in dss.iter() {
                if let Ok(id) = w.as_reference() {
                    ids.insert(id);
                }
            }
        }
    }
    ids
}

fn vergelijk(oud: &Document, nieuw: &Document) -> LatereWijziging {
    let mag_oud = toegestane_containers(oud);
    let mag_nieuw = toegestane_containers(nieuw);
    let oude_root = verwijzing(&oud.trailer, b"Root");
    let pagina_ids: HashSet<ObjectId> = oud.get_pages().into_values().collect();
    for (id, was) in &oud.objects {
        let Some(is) = nieuw.objects.get(id) else {
            // Weggehaald of vrijgegeven: alleen onschuldig bij containers.
            if mag_oud.contains(id) {
                continue;
            }
            return LatereWijziging::Inhoud;
        };
        if was == is {
            continue;
        }
        let toegestaan = match (was, is) {
            (Object::Stream(a), _) if a.dict.type_is(b"XRef") || a.dict.type_is(b"ObjStm") => true,
            _ if mag_oud.contains(id) || mag_nieuw.contains(id) => true,
            (Object::Dictionary(a), Object::Dictionary(b)) => {
                if Some(*id) == oude_root {
                    gelijk_behalve(a, b, &[b"AcroForm", b"DSS", b"Extensions", b"Metadata"])
                } else if pagina_ids.contains(id) {
                    gelijk_behalve(a, b, &[b"Annots"])
                } else if a.type_is(b"Annot") || a.has(b"Subtype") && a.has(b"Rect") {
                    // Annotaties mogen veranderen, behalve al ondertekende velden.
                    !is_ondertekend_veld(oud, a)
                } else {
                    false
                }
            }
            _ => false,
        };
        if !toegestaan {
            return LatereWijziging::Inhoud;
        }
    }
    LatereWijziging::Toevoegingen
}

#[cfg(test)]
mod tests {
    use super::*;

    fn met_toevoeging(bron: &[u8], objecten: &[(ObjectId, &str)]) -> Vec<u8> {
        let doc = Document::load_mem(bron).unwrap();
        let trailer = crate::pdf_schrijven::Trailergegevens {
            vorm: crate::pdf_schrijven::XrefVorm::Tabel,
            vorige_xref: doc.xref_start,
            grootte: doc.max_id + 1,
            root: (1, 0),
            info: None,
            id: None,
        };
        let nieuw: Vec<_> = objecten
            .iter()
            .map(|(id, tekst)| crate::pdf_schrijven::NieuwObject { id: *id, inhoud: tekst.as_bytes().to_vec() })
            .collect();
        crate::pdf_schrijven::schrijf_toevoeging(bron, &trailer, &nieuw).0
    }

    #[test]
    fn annotatie_erbij_is_een_toevoeging() {
        let bron = crate::pdf_schrijven::tests::minimale_pdf();
        let uit = met_toevoeging(
            &bron,
            &[
                ((3, 0), "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Annots [4 0 R] >>"),
                ((4, 0), "<< /Type /Annot /Subtype /Square /Rect [0 0 10 10] >>"),
            ],
        );
        assert_eq!(Vergelijker::nieuw(&uit).na(bron.len()), LatereWijziging::Toevoegingen);
        assert_eq!(Vergelijker::nieuw(&uit).na(uit.len()), LatereWijziging::Toevoegingen);
    }

    #[test]
    fn andere_mediabox_of_inhoud_is_een_inhoudswijziging() {
        let bron = crate::pdf_schrijven::tests::minimale_pdf();
        let uit = met_toevoeging(&bron, &[((3, 0), "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] >>")]);
        assert_eq!(Vergelijker::nieuw(&uit).na(bron.len()), LatereWijziging::Inhoud);
        let uit = met_toevoeging(
            &bron,
            &[
                ((3, 0), "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R >>"),
                ((4, 0), "<< /Length 0 >>\nstream\n\nendstream"),
            ],
        );
        assert_eq!(Vergelijker::nieuw(&uit).na(bron.len()), LatereWijziging::Inhoud);
    }

    #[test]
    fn onleesbare_versie_is_onbekend() {
        let bron = crate::pdf_schrijven::tests::minimale_pdf();
        assert_eq!(Vergelijker::nieuw(&bron).na(20), LatereWijziging::Onbekend);
    }
}
