//! Digitale handtekeningen met certificaten (#374).
//! Ontwerp: docs/superpowers/specs/2026-09-16-digitale-handtekeningen-design.md

pub mod algoritme;
pub mod ber;
pub mod bytebereik;
pub mod certificaat;
pub mod cms_lees;
pub mod pdf_lezen;
pub mod pkcs12;
pub mod status;
pub mod tijdstempel;
pub mod verifieer;
pub mod vertrouwen;

/// Map `testdata/handtekeningen/<deel>` van het externe corpus
/// (`scripts/haal-handtekening-testdata.py`). Ontbreekt die, dan slaat een test
/// over met een melding; met `OPDS_CORPUS_VERPLICHT=1` faalt hij.
#[cfg(test)]
pub(crate) fn corpusmap(deel: &str) -> Option<std::path::PathBuf> {
    let map = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../testdata/handtekeningen").join(deel);
    corpusmap_in(map, std::env::var("OPDS_CORPUS_VERPLICHT").as_deref() == Ok("1"))
}

#[cfg(test)]
fn corpusmap_in(map: std::path::PathBuf, verplicht: bool) -> Option<std::path::PathBuf> {
    if map.is_dir() {
        return Some(map);
    }
    assert!(
        !verplicht,
        "corpus ontbreekt ({}) en OPDS_CORPUS_VERPLICHT=1; draai scripts/haal-handtekening-testdata.py",
        map.display()
    );
    eprintln!("corpus ontbreekt ({}); test overgeslagen, draai scripts/haal-handtekening-testdata.py", map.display());
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ontbrekend_corpus_slaat_over_of_faalt_als_het_verplicht_is() {
        let weg = std::env::temp_dir().join("opds-corpus-bestaat-niet");
        assert_eq!(corpusmap_in(weg.clone(), false), None);
        assert_eq!(corpusmap_in(std::env::temp_dir(), true), Some(std::env::temp_dir()));
        let verplicht = std::panic::catch_unwind(|| corpusmap_in(weg, true));
        assert!(verplicht.is_err(), "met OPDS_CORPUS_VERPLICHT=1 hoort een ontbrekend corpus te falen");
    }
}
