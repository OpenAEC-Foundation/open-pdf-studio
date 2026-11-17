//! Het pad zoals Windows Verkenner het bij `/select,` wil hebben (#1117).
//!
//! Verkenner selecteert een bestand alleen als het pad omgekeerde schuine
//! strepen heeft en geen lang-pad-voorvoegsel; anders opent hij stil de
//! standaardmap. De app rekent intern ook met `C:/map/bestand.pdf`.
//! Pure regels, los te testen: `rustc --edition 2021 --test verkenner_pad.rs`.

const STREEP: char = '\u{5C}';

/// Het pad voor `explorer /select,"<pad>"`.
pub fn voor_verkenner(pad: &str) -> String {
    let streep = STREEP.to_string();
    let dubbel = format!("{0}{0}", streep);
    let lang_unc = format!("{0}{0}?{0}UNC{0}", streep);
    let lang = format!("{0}{0}?{0}", streep);
    let mut p = pad.trim().replace('/', &streep);
    if let Some(rest) = p.strip_prefix(&lang_unc) {
        p = format!("{}{}", dubbel, rest);
    } else if let Some(rest) = p.strip_prefix(&lang) {
        p = rest.to_string();
    }
    // Dubbele scheidingstekens midden in het pad weg; de twee aan het begin
    // van een netwerkpad blijven.
    let netwerk = p.starts_with(&dubbel);
    let staart = if netwerk { &p[2..] } else { p.as_str() };
    let mut uit = String::with_capacity(p.len());
    if netwerk { uit.push_str(&dubbel); }
    let mut vorige_streep = false;
    for c in staart.chars() {
        if c == STREEP {
            if !vorige_streep { uit.push(c); }
            vorige_streep = true;
        } else {
            uit.push(c);
            vorige_streep = false;
        }
    }
    uit
}

/// Het argument voor Verkenner. Een aanhalingsteken kan niet in een
/// Windows-pad staan; staat het er toch, dan geen opdracht.
pub fn select_argument(pad: &str) -> Option<String> {
    let p = voor_verkenner(pad);
    if p.is_empty() || p.contains('"') { return None; }
    Some(format!("/select,{0}{1}{0}", '"', p))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Schrijf een verwacht pad met `|` als scheidingsteken.
    fn w(pad: &str) -> String { pad.replace('|', &STREEP.to_string()) }

    #[test]
    fn schuine_strepen_vooruit_worden_omgekeerd() {
        assert_eq!(voor_verkenner("C:/Users/jan/Mijn documenten/a b.pdf"), w("C:|Users|jan|Mijn documenten|a b.pdf"));
        assert_eq!(voor_verkenner(&w("C:|Users|jan/Documents/x.pdf")), w("C:|Users|jan|Documents|x.pdf"));
    }

    #[test]
    fn een_gewoon_pad_blijft_gelijk() {
        assert_eq!(voor_verkenner(&w("C:|map|x.pdf")), w("C:|map|x.pdf"));
    }

    #[test]
    fn het_lange_pad_voorvoegsel_gaat_eraf() {
        assert_eq!(voor_verkenner(&w("||?|C:|map|x.pdf")), w("C:|map|x.pdf"));
        assert_eq!(voor_verkenner(&w("||?|UNC|server|deel|x.pdf")), w("||server|deel|x.pdf"));
        assert_eq!(voor_verkenner("//?/C:/map/x.pdf"), w("C:|map|x.pdf"));
    }

    #[test]
    fn netwerkpad_houdt_zijn_dubbele_streep_en_verliest_dubbele_in_het_midden() {
        assert_eq!(voor_verkenner("//server/deel//map/x.pdf"), w("||server|deel|map|x.pdf"));
        assert_eq!(voor_verkenner(&w("C:|map||x.pdf")), w("C:|map|x.pdf"));
    }

    #[test]
    fn het_argument_is_een_geheel_met_aanhalingstekens() {
        let verwacht = format!("/select,{0}{1}{0}", '"', w("C:|a b|x.pdf"));
        assert_eq!(select_argument("C:/a b/x.pdf"), Some(verwacht));
        assert_eq!(select_argument("C:/a\u{22}b/x.pdf"), None);
        assert_eq!(select_argument("   "), None);
    }
}
