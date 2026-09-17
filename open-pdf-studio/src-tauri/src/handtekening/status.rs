//! Getoonde status van een handtekening, puur afgeleid uit de losse controles
//! (spec §7.1 en §7.2). Geen I/O en geen cryptografie: de andere modules leveren
//! de drie assen, deze module beslist wat de gebruiker ziet.

use serde::Serialize;

/// Waarom een handtekening niet te controleren is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum OnleesbaarReden {
    /// `/ByteRange` ontbreekt of is ongeldig, of het gat is geen hex-string.
    BytebereikOngeldig,
    /// De CMS-structuur is niet te lezen.
    CmsOnleesbaar,
    /// Het certificaat van de ondertekenaar ontbreekt of is niet leesbaar.
    GeenCertificaat,
    /// Een hash- of handtekeningalgoritme dat niet ondersteund wordt.
    AlgoritmeNietOndersteund,
    /// Een SubFilter buiten CAdES, PKCS#7 detached en RFC 3161.
    VerouderdFormaat,
}

/// Vaste, machineleesbare signalen bij een handtekening (`signalen` in
/// `HandtekeningInfo` en `TijdstempelInfo`). De UI vertaalt ze; `detail` blijft
/// een Nederlandse technische tekst voor wie het precies wil weten.
/// `js/pdf/handtekeningen/i18n-sleutels.test.mjs` leest deze lijst en eist een
/// vertaling per code.
pub mod signaal {
    pub const DIGESTALGORITME_NIET_ONDERSTEUND: &str = "digestalgoritme-niet-ondersteund";
    pub const HANDTEKENINGALGORITME_NIET_ONDERSTEUND: &str = "handtekeningalgoritme-niet-ondersteund";
    pub const IMPRINTALGORITME_NIET_ONDERSTEUND: &str = "imprintalgoritme-niet-ondersteund";
    pub const CONTENTTYPE_ONTBREEKT_OF_MEERVOUDIG: &str = "contenttype-ontbreekt-of-meervoudig";
    pub const CONTENTTYPE_WIJKT_AF: &str = "contenttype-wijkt-af";
    pub const MESSAGEDIGEST_ONTBREEKT_OF_MEERVOUDIG: &str = "messagedigest-ontbreekt-of-meervoudig";
    pub const CERTIFICAAT_ONDERTEKENAAR_ONTBREEKT: &str = "certificaat-ondertekenaar-ontbreekt";
    pub const ZONDER_ATTRIBUTEN_NIET_TE_ONDERSCHEIDEN: &str = "zonder-attributen-niet-te-onderscheiden";
    pub const CMS_STRUCTUUR_ONLEESBAAR: &str = "cms-structuur-onleesbaar";
    pub const ECONTENT_BIJ_LOSSE_HANDTEKENING: &str = "econtent-bij-losse-handtekening";
    pub const ECONTENTTYPE_GEEN_ID_DATA: &str = "econtenttype-geen-id-data";
    pub const GEEN_ONDERTEKENAAR: &str = "geen-ondertekenaar";
    pub const TOKEN_ZONDER_TSTINFO: &str = "token-zonder-tstinfo";
    pub const TSTINFO_ONLEESBAAR: &str = "tstinfo-onleesbaar";
    pub const BYTEBEREIK_GEEN_VIER_GETALLEN: &str = "bytebereik-geen-vier-getallen";
    pub const BYTEBEREIK_NEGATIEF: &str = "bytebereik-negatief";
    pub const BYTEBEREIK_BEGINT_NIET_BIJ_NUL: &str = "bytebereik-begint-niet-bij-nul";
    pub const BYTEBEREIK_GAT_TE_KLEIN: &str = "bytebereik-gat-te-klein";
    pub const BYTEBEREIK_VOORBIJ_EINDE: &str = "bytebereik-voorbij-einde";
    pub const BYTEBEREIK_GAT_GEEN_HEX_STRING: &str = "bytebereik-gat-geen-hex-string";
    pub const SUBFILTER_NIET_ONDERSTEUND: &str = "subfilter-niet-ondersteund";
    /// De ketenzoektocht stopte op een budget (per keten of per document).
    pub const ZOEKBUDGET_OP: &str = "zoekbudget-op";
    /// De hex-string in het gat van het bytebereik is niet de `/Contents`.
    pub const GAT_WIJKT_AF_VAN_CONTENTS: &str = "gat-wijkt-af-van-contents";
    pub const INTERNE_FOUT: &str = "interne-fout";

    /// Alle codes, voor tests.
    #[cfg(test)]
    pub const ALLE: [&str; 24] = [
        DIGESTALGORITME_NIET_ONDERSTEUND,
        HANDTEKENINGALGORITME_NIET_ONDERSTEUND,
        IMPRINTALGORITME_NIET_ONDERSTEUND,
        CONTENTTYPE_ONTBREEKT_OF_MEERVOUDIG,
        CONTENTTYPE_WIJKT_AF,
        MESSAGEDIGEST_ONTBREEKT_OF_MEERVOUDIG,
        CERTIFICAAT_ONDERTEKENAAR_ONTBREEKT,
        ZONDER_ATTRIBUTEN_NIET_TE_ONDERSCHEIDEN,
        CMS_STRUCTUUR_ONLEESBAAR,
        ECONTENT_BIJ_LOSSE_HANDTEKENING,
        ECONTENTTYPE_GEEN_ID_DATA,
        GEEN_ONDERTEKENAAR,
        TOKEN_ZONDER_TSTINFO,
        TSTINFO_ONLEESBAAR,
        BYTEBEREIK_GEEN_VIER_GETALLEN,
        BYTEBEREIK_NEGATIEF,
        BYTEBEREIK_BEGINT_NIET_BIJ_NUL,
        BYTEBEREIK_GAT_TE_KLEIN,
        BYTEBEREIK_VOORBIJ_EINDE,
        BYTEBEREIK_GAT_GEEN_HEX_STRING,
        SUBFILTER_NIET_ONDERSTEUND,
        ZOEKBUDGET_OP,
        GAT_WIJKT_AF_VAN_CONTENTS,
        INTERNE_FOUT,
    ];
}

/// Integriteit: vier uitkomsten (spec §7.1).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(tag = "uitkomst", rename_all = "kebab-case")]
pub enum Integriteit {
    /// Digest en handtekeningwaarde kloppen.
    Intact,
    /// De digest wijkt af: de ondertekende bytes zijn veranderd.
    Gewijzigd,
    /// De digest klopt, de handtekeningwaarde niet.
    Ongeldig,
    NietTeControleren { reden: OnleesbaarReden },
}

/// Waarom een intacte handtekening niet vertrouwd wordt.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum WantrouwenReden {
    GeenKeten,
    Verlopen,
    Sleutelgebruik,
    AlgoritmeNietOndersteund,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(tag = "uitkomst", rename_all = "kebab-case")]
pub enum Vertrouwen {
    Vertrouwd,
    NietVertrouwd { reden: WantrouwenReden },
    /// Niet beoordeeld: alleen een intacte handtekening krijgt een vertrouwensoordeel.
    NietBepaald,
}

/// De status zoals de balk en het detailvenster hem tonen (spec §7.2).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(tag = "code", rename_all = "kebab-case")]
pub enum Status {
    Geldig,
    OnbekendCertificaat { reden: WantrouwenReden },
    GewijzigdNaOndertekenen,
    OngeldigeHandtekening,
    NietTeControleren { reden: OnleesbaarReden },
    NietOndertekendVeld,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Getoond {
    pub status: Status,
    /// "— het document is daarna nog gewijzigd": bij elke intacte handtekening
    /// waarvan het bytebereik niet tot het einde van het bestand reikt, ook bij
    /// "Onbekend certificaat".
    pub daarna_gewijzigd: bool,
}

/// Leidt de getoonde status af uit integriteit, vertrouwen en dekking.
pub fn leid_af(integriteit: Integriteit, vertrouwen: Vertrouwen, dekt_hele_document: bool) -> Getoond {
    let status = match integriteit {
        Integriteit::Intact => match vertrouwen {
            Vertrouwen::Vertrouwd => Status::Geldig,
            Vertrouwen::NietVertrouwd { reden } => Status::OnbekendCertificaat { reden },
            // Een intacte handtekening zonder oordeel is nooit "Geldig".
            Vertrouwen::NietBepaald => Status::OnbekendCertificaat { reden: WantrouwenReden::GeenKeten },
        },
        Integriteit::Gewijzigd => Status::GewijzigdNaOndertekenen,
        Integriteit::Ongeldig => Status::OngeldigeHandtekening,
        Integriteit::NietTeControleren { reden } => Status::NietTeControleren { reden },
    };
    Getoond {
        status,
        daarna_gewijzigd: integriteit == Integriteit::Intact && !dekt_hele_document,
    }
}

/// Een handtekeningveld zonder waarde (spec §8).
pub fn leeg_veld() -> Getoond {
    Getoond { status: Status::NietOndertekendVeld, daarna_gewijzigd: false }
}

#[cfg(test)]
mod tests {
    use super::*;

    const REDENEN: [WantrouwenReden; 4] = [
        WantrouwenReden::GeenKeten,
        WantrouwenReden::Verlopen,
        WantrouwenReden::Sleutelgebruik,
        WantrouwenReden::AlgoritmeNietOndersteund,
    ];

    fn alle_vertrouwen() -> Vec<Vertrouwen> {
        let mut v = vec![Vertrouwen::Vertrouwd, Vertrouwen::NietBepaald];
        v.extend(REDENEN.iter().map(|&reden| Vertrouwen::NietVertrouwd { reden }));
        v
    }

    #[test]
    fn intact_en_vertrouwd_is_geldig() {
        let g = leid_af(Integriteit::Intact, Vertrouwen::Vertrouwd, true);
        assert_eq!(g, Getoond { status: Status::Geldig, daarna_gewijzigd: false });
    }

    #[test]
    fn intact_niet_vertrouwd_is_onbekend_certificaat_met_reden() {
        for reden in REDENEN {
            let g = leid_af(Integriteit::Intact, Vertrouwen::NietVertrouwd { reden }, true);
            assert_eq!(g.status, Status::OnbekendCertificaat { reden });
        }
    }

    #[test]
    fn gewijzigd_ongeldig_en_niet_te_controleren_negeren_vertrouwen() {
        for v in alle_vertrouwen() {
            for dekt in [true, false] {
                assert_eq!(
                    leid_af(Integriteit::Gewijzigd, v, dekt),
                    Getoond { status: Status::GewijzigdNaOndertekenen, daarna_gewijzigd: false }
                );
                assert_eq!(
                    leid_af(Integriteit::Ongeldig, v, dekt),
                    Getoond { status: Status::OngeldigeHandtekening, daarna_gewijzigd: false }
                );
                let reden = OnleesbaarReden::GeenCertificaat;
                assert_eq!(
                    leid_af(Integriteit::NietTeControleren { reden }, v, dekt),
                    Getoond { status: Status::NietTeControleren { reden }, daarna_gewijzigd: false }
                );
            }
        }
    }

    #[test]
    fn daarna_gewijzigd_bij_elke_intacte_handtekening_zonder_volledige_dekking() {
        for v in alle_vertrouwen() {
            assert!(leid_af(Integriteit::Intact, v, false).daarna_gewijzigd, "{v:?}");
            assert!(!leid_af(Integriteit::Intact, v, true).daarna_gewijzigd, "{v:?}");
        }
    }

    #[test]
    fn niet_bepaald_vertrouwen_wordt_nooit_geldig() {
        let g = leid_af(Integriteit::Intact, Vertrouwen::NietBepaald, true);
        assert_eq!(g.status, Status::OnbekendCertificaat { reden: WantrouwenReden::GeenKeten });
    }

    #[test]
    fn leeg_veld_is_niet_ondertekend_veld() {
        assert_eq!(leeg_veld(), Getoond { status: Status::NietOndertekendVeld, daarna_gewijzigd: false });
    }

    #[test]
    fn signalen_zijn_uniek_en_kebab_case() {
        let uniek: std::collections::HashSet<_> = signaal::ALLE.iter().collect();
        assert_eq!(uniek.len(), signaal::ALLE.len());
        for code in signaal::ALLE {
            assert!(code.chars().all(|c| c.is_ascii_lowercase() || c == '-'), "{code}");
        }
    }

    #[test]
    fn serialisatie_voor_de_js_kant() {
        let g = leid_af(
            Integriteit::Intact,
            Vertrouwen::NietVertrouwd { reden: WantrouwenReden::GeenKeten },
            false,
        );
        assert_eq!(
            serde_json::to_string(&g).unwrap(),
            r#"{"status":{"code":"onbekend-certificaat","reden":"geen-keten"},"daarnaGewijzigd":true}"#
        );
        assert_eq!(serde_json::to_string(&Integriteit::Intact).unwrap(), r#"{"uitkomst":"intact"}"#);
        assert_eq!(
            serde_json::to_string(&Integriteit::NietTeControleren { reden: OnleesbaarReden::AlgoritmeNietOndersteund })
                .unwrap(),
            r#"{"uitkomst":"niet-te-controleren","reden":"algoritme-niet-ondersteund"}"#
        );
        assert_eq!(serde_json::to_string(&Vertrouwen::NietBepaald).unwrap(), r#"{"uitkomst":"niet-bepaald"}"#);
        assert_eq!(serde_json::to_string(&Status::NietOndertekendVeld).unwrap(), r#"{"code":"niet-ondertekend-veld"}"#);
    }
}
