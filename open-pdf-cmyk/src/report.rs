//! Het verslag van een omzetting: per soort hoeveel is omgezet en wat niet,
//! met de reden. De interface meldt dit na de export; niets wordt stil
//! overgeslagen.

use serde::Serialize;
use std::collections::BTreeMap;

/// Telling voor één soort inhoud.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
pub struct Tally {
    /// Aantal omgezette onderdelen.
    pub converted: u64,
    /// Niet omgezet, per reden (code die de interface vertaalt).
    pub skipped: BTreeMap<String, u64>,
}

impl Tally {
    pub fn converted(&mut self) {
        self.converted += 1;
    }

    pub fn skipped(&mut self, reason: &str) {
        *self.skipped.entry(reason.to_string()).or_insert(0) += 1;
    }

    /// Totaal aantal niet omgezette onderdelen.
    pub fn skipped_total(&self) -> u64 {
        self.skipped.values().sum()
    }
}

/// Het hele verslag.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    /// Inhoudsstromen (pagina's, Form XObjects, uiterlijken, patronen) die
    /// veranderd zijn; niet te lezen stromen staan bij `skipped`.
    pub content_streams: Tally,
    /// Kleuroperatoren (`rg`, `RG`, `sc`, `scn`, `SC`, `SCN`, `cs`, `CS`).
    pub colour_operators: Tally,
    /// Benoemde kleurruimten in `/Resources /ColorSpace`.
    pub colour_spaces: Tally,
    /// Afbeeldingen (XObject).
    pub images: Tally,
    /// Afbeeldingen in de inhoudsstroom zelf (`BI … EI`).
    pub inline_images: Tally,
    /// Verlopen (shadings), ook die achter een patroon.
    pub shadings: Tally,
    /// Transparantiegroepen (`/Group /CS`).
    pub transparency_groups: Tally,
}

impl Report {
    /// Alle tellingen met hun naam, in vaste volgorde.
    pub fn tallies(&self) -> [(&'static str, &Tally); 7] {
        [
            ("contentStreams", &self.content_streams),
            ("colourOperators", &self.colour_operators),
            ("colourSpaces", &self.colour_spaces),
            ("images", &self.images),
            ("inlineImages", &self.inline_images),
            ("shadings", &self.shadings),
            ("transparencyGroups", &self.transparency_groups),
        ]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tally_counts_conversions_and_reasons() {
        let mut t = Tally::default();
        t.converted();
        t.converted();
        t.skipped("jpeg2000");
        t.skipped("jpeg2000");
        t.skipped("unsupportedFilter");
        assert_eq!(t.converted, 2);
        assert_eq!(t.skipped.get("jpeg2000"), Some(&2));
        assert_eq!(t.skipped_total(), 3);
    }

    #[test]
    fn report_serialises_with_camel_case_names() {
        let mut r = Report::default();
        r.images.converted();
        r.shadings.skipped("functionType");
        let json = serde_json::to_value(&r).unwrap();
        assert_eq!(json["images"]["converted"], 1);
        assert_eq!(json["shadings"]["skipped"]["functionType"], 1);
        assert!(json.get("transparencyGroups").is_some());
        assert!(json.get("inlineImages").is_some());
    }
}
