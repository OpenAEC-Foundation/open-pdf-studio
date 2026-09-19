//! RFC 3161-tijdstempels controleren: documenttijdstempels (`ETSI.RFC3161`) en
//! handtekeningtijdstempels (`signatureTimeStampToken`).
//!
//! Bewuste beperkingen (spec §10):
//! - Alleen de eerste SignerInfo van het token telt; verdere worden genegeerd.
//! - Het ondertekende attribuut ESSCertID/ESSCertIDv2 (`signingCertificate`)
//!   wordt niet gecontroleerd. De binding met het certificaat van de dienst
//!   loopt via de sleutel: de handtekening moet kloppen met de publieke sleutel
//!   van het gevonden certificaat, en dat certificaat wordt als tijdstempeldienst
//!   beoordeeld (`vertrouwen::Rol::Tijdstempeldienst`).
//! - `accuracy`, `ordering`, `nonce`, `tsa` en extensies in TSTInfo worden
//!   gelezen noch gebruikt; genTime telt als exact tijdstip.
//! - De dienst wordt beoordeeld op de eigen genTime van het token. Wie de sleutel
//!   van een dienst heeft bemachtigd, kan dus een tijd binnen de geldigheid van
//!   diens certificaat opgeven; intrekking (OCSP, CRL) valt buiten scope.

use super::algoritme::Hashalg;
use super::ber::{kinderen, lees_tlv, tijd_unix};
use super::cms_lees::{alg_id, lees_signed_data, Certificaat, ID_TST_INFO};
use super::status::{signaal, Integriteit, OnleesbaarReden};
use super::verifieer::{controleer_ondertekenaar, zwak_algoritme};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TstInfo {
    pub imprint_alg: Hashalg,
    pub imprint: Vec<u8>,
    /// genTime; een eventuele fractie telt niet mee.
    pub tijd_unix: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TstFout {
    Onleesbaar(String),
    AlgoritmeNietOndersteund(String),
}

/// TSTInfo ::= SEQUENCE { version, policy, messageImprint, serialNumber, genTime, … }
///
/// Strikt volgens RFC 3161 §2.4.2: version 1, policy een OID, serialNumber een
/// INTEGER, messageImprint precies AlgorithmIdentifier en OCTET STRING, parameters
/// van het hashalgoritme afwezig of NULL, genTime in UTC eindigend op `Z` (een
/// fractie alleen met een punt). Velden na genTime worden niet gelezen.
pub fn lees_tst_info(der: &[u8]) -> Result<TstInfo, TstFout> {
    let onleesbaar = |tekst: String| TstFout::Onleesbaar(tekst);
    let (seq, _) = lees_tlv(der).map_err(|e| onleesbaar(e.to_string()))?;
    if seq.tag != 0x30 {
        return Err(onleesbaar("TSTInfo is geen SEQUENCE".to_string()));
    }
    let velden = kinderen(seq.inhoud).map_err(|e| onleesbaar(e.to_string()))?;
    let [versie, beleid, imprint, serie, tijd, ..] = velden.as_slice() else {
        return Err(onleesbaar("TSTInfo onvolledig".to_string()));
    };
    if versie.tag != 0x02 || versie.inhoud != [0x01] {
        return Err(onleesbaar("TSTInfo-versie is niet 1".to_string()));
    }
    if beleid.tag != 0x06 || serie.tag != 0x02 || imprint.tag != 0x30 || tijd.tag != 0x18 {
        return Err(onleesbaar("TSTInfo onverwacht opgebouwd".to_string()));
    }
    let delen = kinderen(imprint.inhoud).map_err(|e| onleesbaar(e.to_string()))?;
    let [alg, waarde] = delen.as_slice() else {
        return Err(onleesbaar("messageImprint heeft niet precies twee elementen".to_string()));
    };
    if waarde.tag != 0x04 {
        return Err(onleesbaar("messageImprint zonder hash".to_string()));
    }
    let alg_delen = match alg.tag {
        0x30 => kinderen(alg.inhoud).map_err(|e| onleesbaar(e.to_string()))?.len(),
        _ => 0,
    };
    let alg = alg_id(alg).map_err(|e| onleesbaar(e.0))?;
    // Parameters van het hashalgoritme: afwezig of NULL, niets anders.
    if alg_delen > 2 || alg.parameters.as_deref().is_some_and(|p| p != [0x05, 0x00]) {
        return Err(onleesbaar("hashAlgorithm met onverwachte parameters".to_string()));
    }
    let imprint_alg = Hashalg::uit_oid(alg.oid)
        .ok_or_else(|| TstFout::AlgoritmeNietOndersteund(format!("imprint-algoritme {}", alg.oid)))?;
    // RFC 3161 §2.4.2: genTime in UTC met `Z`, zonder tijdzoneverschuiving.
    if tijd.inhoud.last() != Some(&b'Z') || tijd.inhoud.iter().any(|b| matches!(b, b'+' | b'-')) {
        return Err(onleesbaar("genTime niet in UTC met Z".to_string()));
    }
    // RFC 3161 §2.4.2: een fractie van seconden met een punt, nooit een komma
    // (de algemene ASN.1-tijdlezer staat beide toe).
    if tijd.inhoud.contains(&b',') {
        return Err(onleesbaar("genTime met komma als decimaalteken".to_string()));
    }
    let seconden = tijd_unix(0x18, tijd.inhoud).ok_or_else(|| onleesbaar("genTime onleesbaar".to_string()))?;
    Ok(TstInfo { imprint_alg, imprint: waarde.inhoud.to_vec(), tijd_unix: seconden })
}

#[derive(Debug, Clone)]
pub struct TokenUitkomst {
    pub integriteit: Integriteit,
    pub detail: Option<String>,
    /// Vaste signalen ([`signaal`]) naast `detail`.
    pub signalen: Vec<&'static str>,
    /// Alleen bij een intact token.
    pub tijd_unix: Option<i64>,
    /// Certificaat van de tijdstempeldienst, als het gevonden is.
    pub tsa: Option<Certificaat>,
    pub certificaten: Vec<Certificaat>,
    /// Imprint-, digest- of handtekeningalgoritme van het token gebruikt een
    /// zwakke hash (SHA-1). Alleen een waarschuwing, zoals
    /// [`Ondertekening::zwak_algoritme`](super::verifieer::Ondertekening::zwak_algoritme).
    pub zwak_algoritme: bool,
}

fn niet(reden: OnleesbaarReden, signaal: &'static str, detail: String) -> TokenUitkomst {
    TokenUitkomst {
        integriteit: Integriteit::NietTeControleren { reden },
        detail: Some(detail),
        signalen: vec![signaal],
        tijd_unix: None,
        tsa: None,
        certificaten: Vec::new(),
        zwak_algoritme: false,
    }
}

/// Controleert een RFC 3161-token over `gegevens`.
pub fn controleer_token(token: &[u8], gegevens: &[&[u8]]) -> TokenUitkomst {
    let sd = match lees_signed_data(token) {
        Ok(sd) => sd,
        Err(e) => return niet(OnleesbaarReden::CmsOnleesbaar, signaal::CMS_STRUCTUUR_ONLEESBAAR, e.0),
    };
    let Some(inhoud) = sd.inhoud.as_ref().filter(|_| sd.inhoudstype == ID_TST_INFO) else {
        return niet(OnleesbaarReden::CmsOnleesbaar, signaal::TOKEN_ZONDER_TSTINFO, "token bevat geen TSTInfo".to_string());
    };
    let info = match lees_tst_info(inhoud) {
        Ok(info) => info,
        Err(TstFout::Onleesbaar(d)) => return niet(OnleesbaarReden::CmsOnleesbaar, signaal::TSTINFO_ONLEESBAAR, d),
        Err(TstFout::AlgoritmeNietOndersteund(d)) => {
            return niet(OnleesbaarReden::AlgoritmeNietOndersteund, signaal::IMPRINTALGORITME_NIET_ONDERSTEUND, d)
        }
    };
    let Some(o) = sd.ondertekenaars.first() else {
        return niet(OnleesbaarReden::CmsOnleesbaar, signaal::GEEN_ONDERTEKENAAR, "token zonder ondertekenaar".to_string());
    };
    let zwak = info.imprint_alg.is_zwak() || zwak_algoritme(o);
    if info.imprint_alg.hash(gegevens) != info.imprint {
        return TokenUitkomst {
            integriteit: Integriteit::Gewijzigd,
            detail: None,
            signalen: Vec::new(),
            tijd_unix: None,
            tsa: None,
            certificaten: Vec::new(),
            zwak_algoritme: zwak,
        };
    }
    let ondertekening = controleer_ondertekenaar(&sd, o, &[inhoud.as_slice()]);
    let integriteit = match ondertekening.integriteit {
        // TSTInfo en handtekening van de dienst passen niet bij elkaar; de
        // gestempelde bytes zelf zijn niet veranderd.
        Integriteit::Gewijzigd => Integriteit::Ongeldig,
        andere => andere,
    };
    TokenUitkomst {
        integriteit,
        detail: ondertekening.detail,
        signalen: ondertekening.signalen,
        tijd_unix: (integriteit == Integriteit::Intact).then_some(info.tijd_unix),
        tsa: ondertekening.certificaat,
        certificaten: ondertekening.certificaten,
        zwak_algoritme: zwak || ondertekening.zwak_algoritme,
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::handtekening::cms_lees::lees_certificaat;
    use std::path::PathBuf;

    fn fixture(naam: &str) -> Vec<u8> {
        std::fs::read(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/verifieer").join(naam)).unwrap()
    }

    /// TSTInfo met SHA-256-imprint van 32 nullen en genTime met fractie.
    fn tst_info(hash_oid_laatste_byte: u8) -> Vec<u8> {
        let mut b = vec![0x30, 0x51, 0x02, 0x01, 0x01, 0x06, 0x02, 0x2A, 0x03];
        b.extend([0x30, 0x31, 0x30, 0x0D, 0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02]);
        b.extend([hash_oid_laatste_byte, 0x05, 0x00, 0x04, 0x20]);
        b.extend([0u8; 32]);
        b.extend([0x02, 0x01, 0x05, 0x18, 0x12]);
        b.extend(b"20130508191615.82Z");
        b
    }

    #[test]
    fn tstinfo_met_fractie_en_onbekende_hash() {
        let info = lees_tst_info(&tst_info(0x01)).unwrap();
        assert_eq!(info, TstInfo { imprint_alg: Hashalg::Sha256, imprint: vec![0; 32], tijd_unix: 1_368_040_575 });
        assert!(matches!(lees_tst_info(&tst_info(0x09)), Err(TstFout::AlgoritmeNietOndersteund(_))));
        assert!(matches!(lees_tst_info(b"rommel"), Err(TstFout::Onleesbaar(_))));
    }

    fn tlv(tag: u8, inhoud: &[u8]) -> Vec<u8> {
        assert!(inhoud.len() < 0x80);
        let mut b = vec![tag, inhoud.len() as u8];
        b.extend_from_slice(inhoud);
        b
    }

    /// TSTInfo uit losse velden; `imprint` is de volledige messageImprint-TLV.
    fn tst_uit(velden: &[Vec<u8>]) -> Vec<u8> {
        tlv(0x30, &velden.concat())
    }

    struct Velden {
        versie: Vec<u8>,
        beleid: Vec<u8>,
        imprint: Vec<u8>,
        serie: Vec<u8>,
        tijd: Vec<u8>,
    }

    fn goede_velden() -> Velden {
        let sha256 = tlv(0x06, &[0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01]);
        Velden {
            versie: tlv(0x02, &[0x01]),
            beleid: tlv(0x06, &[0x2A, 0x03]),
            imprint: tlv(0x30, &[tlv(0x30, &[sha256, tlv(0x05, &[])].concat()), tlv(0x04, &[0u8; 32])].concat()),
            serie: tlv(0x02, &[0x05]),
            tijd: tlv(0x18, b"20130508191615Z"),
        }
    }

    fn bouw(v: &Velden) -> Vec<u8> {
        tst_uit(&[v.versie.clone(), v.beleid.clone(), v.imprint.clone(), v.serie.clone(), v.tijd.clone()])
    }

    #[test]
    fn tstinfo_strikt_volgens_rfc_3161() {
        assert_eq!(lees_tst_info(&bouw(&goede_velden())).unwrap().tijd_unix, 1_368_040_575);
        // Hash-parameters mogen ontbreken.
        let sha256 = tlv(0x06, &[0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01]);
        let mut v = goede_velden();
        v.imprint = tlv(0x30, &[tlv(0x30, &sha256), tlv(0x04, &[0u8; 32])].concat());
        assert!(lees_tst_info(&bouw(&v)).is_ok());

        let afwijkingen: Vec<(&str, Box<dyn Fn(&mut Velden)>)> = vec![
            ("versie 2", Box::new(|v| v.versie = tlv(0x02, &[0x02]))),
            ("versie als OCTET STRING", Box::new(|v| v.versie = tlv(0x04, &[0x01]))),
            ("beleid geen OID", Box::new(|v| v.beleid = tlv(0x02, &[0x01]))),
            ("serienummer geen INTEGER", Box::new(|v| v.serie = tlv(0x04, &[0x05]))),
            (
                "hash-parameters geen NULL",
                Box::new(|v| {
                    let sha256 = tlv(0x06, &[0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01]);
                    v.imprint =
                        tlv(0x30, &[tlv(0x30, &[sha256, tlv(0x04, &[])].concat()), tlv(0x04, &[0u8; 32])].concat());
                }),
            ),
            (
                "extra element in AlgorithmIdentifier",
                Box::new(|v| {
                    let sha256 = tlv(0x06, &[0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01]);
                    let alg = tlv(0x30, &[sha256, tlv(0x05, &[]), tlv(0x05, &[])].concat());
                    v.imprint = tlv(0x30, &[alg, tlv(0x04, &[0u8; 32])].concat());
                }),
            ),
            (
                "extra element in messageImprint",
                Box::new(|v| {
                    let mut inhoud = v.imprint[2..].to_vec();
                    inhoud.extend(tlv(0x04, &[]));
                    v.imprint = tlv(0x30, &inhoud);
                }),
            ),
            ("genTime met tijdzone", Box::new(|v| v.tijd = tlv(0x18, b"20130508211615+0200"))),
            ("genTime zonder Z", Box::new(|v| v.tijd = tlv(0x18, b"20130508191615"))),
            ("genTime met Z en tijdzone", Box::new(|v| v.tijd = tlv(0x18, b"20130508191615Z+0000"))),
            // RFC 3161 §2.4.2: een fractie alleen met een punt.
            ("genTime met komma als decimaalteken", Box::new(|v| v.tijd = tlv(0x18, b"20130508191615,5Z"))),
        ];
        for (naam, pas_aan) in afwijkingen {
            let mut v = goede_velden();
            pas_aan(&mut v);
            assert!(matches!(lees_tst_info(&bouw(&v)), Err(TstFout::Onleesbaar(_))), "{naam}");
        }
    }

    #[test]
    fn token_over_de_data_is_intact() {
        let data = fixture("data.bin");
        let u = controleer_token(&fixture("tst-data.der"), &[data.as_slice()]);
        assert_eq!(u.integriteit, Integriteit::Intact);
        assert!(u.signalen.is_empty());
        let tsa = lees_certificaat(&fixture("tsa.der")).unwrap();
        assert_eq!(u.tsa.as_ref().unwrap().onderwerp_der, tsa.onderwerp_der);
        assert_eq!(u.certificaten.len(), 2);
        assert!(!u.zwak_algoritme);
        let van = i64::try_from(tsa.x509.tbs_certificate.validity.not_before.to_unix_duration().as_secs()).unwrap();
        let tijd = u.tijd_unix.unwrap();
        assert!((tijd - van).abs() < 86_400, "tijd {tijd}, certificaat vanaf {van}");
    }

    #[test]
    fn token_over_andere_data_is_gewijzigd() {
        let u = controleer_token(&fixture("tst-data.der"), &[b"iets anders".as_slice()]);
        assert_eq!(u.integriteit, Integriteit::Gewijzigd);
        assert_eq!(u.tijd_unix, None);
    }

    #[test]
    fn token_dat_niet_met_zichzelf_klopt_is_ongeldig() {
        let data = fixture("data.bin");
        let mut token = fixture("tst-data.der");
        // genTime (GeneralizedTime, 15 tekens) in de TSTInfo: laatste secondecijfer wijzigen.
        let p = token.windows(2).position(|w| w == [0x18, 0x0F]).unwrap();
        let cijfer = p + 2 + 13;
        token[cijfer] = if token[cijfer] == b'0' { b'1' } else { b'0' };
        let u = controleer_token(&token, &[data.as_slice()]);
        assert_eq!(u.integriteit, Integriteit::Ongeldig);
        assert_eq!(u.tijd_unix, None);
    }

    #[test]
    fn geen_token_is_niet_te_controleren() {
        let data = fixture("data.bin");
        let cms_onleesbaar = Integriteit::NietTeControleren { reden: OnleesbaarReden::CmsOnleesbaar };
        let rommel = controleer_token(b"rommel", &[data.as_slice()]);
        assert_eq!(rommel.integriteit, cms_onleesbaar);
        assert_eq!(rommel.signalen, [signaal::CMS_STRUCTUUR_ONLEESBAAR]);
        let geen_tst = controleer_token(&fixture("cms-rsa-sha256.der"), &[data.as_slice()]);
        assert_eq!(geen_tst.integriteit, cms_onleesbaar);
        assert_eq!(geen_tst.signalen, [signaal::TOKEN_ZONDER_TSTINFO]);
    }

    #[test]
    fn afgekapt_token_geeft_geen_paniek() {
        let data = fixture("data.bin");
        let token = fixture("tst-data.der");
        for n in 0..token.len() {
            let u = controleer_token(&token[..n], &[data.as_slice()]);
            assert_ne!(u.integriteit, Integriteit::Intact, "afgekapt op {n}");
        }
    }

    #[test]
    fn delen_van_de_gegevens_tellen_als_geheel() {
        let data = fixture("data.bin");
        let u = controleer_token(&fixture("tst-data.der"), &[&data[..5], &data[5..]]);
        assert_eq!(u.integriteit, Integriteit::Intact);
    }
}
