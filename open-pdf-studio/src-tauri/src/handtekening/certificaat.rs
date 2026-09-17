//! Certificaatgegevens uit een .p12, voor de ondertekendialoog (spec §3.1 stap 3)
//! en als Tauri-commando `pdf_certificate_info`.

use const_oid::ObjectIdentifier;
use const_oid::db::rfc5912::{ID_EC_PUBLIC_KEY, RSA_ENCRYPTION};
use der::{Decode, Tagged};
use serde::Serialize;

use super::pkcs12::{lees, ondertekenaar_index, Pkcs12Fout};

const CN: ObjectIdentifier = ObjectIdentifier::new_unwrap("2.5.4.3");
const SLEUTELGEBRUIK: ObjectIdentifier = ObjectIdentifier::new_unwrap("2.5.29.15");
const ORGANISATIE: ObjectIdentifier = ObjectIdentifier::new_unwrap("2.5.4.10");

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CertificaatInfo {
    pub naam: String,
    pub uitgever: String,
    pub geldig_van_unix: u64,
    pub geldig_tot_unix: u64,
    /// `Some(true)` als digitalSignature of nonRepudiation gezet is; `None` zonder
    /// extensie (X.509: dan is het gebruik onbeperkt).
    pub sleutelgebruik_ondertekenen: Option<bool>,
    /// "RSA", "EC" of de OID van een ander sleuteltype.
    pub sleuteltype: String,
    pub rsa_bits: Option<usize>,
    /// Alleen RSA kan ondertekenen (spec §10). `false` is de nette melding voor
    /// andere sleuteltypen: de gegevens zijn wel leesbaar.
    pub ondersteund: bool,
}

/// Foutcodes voor de dialoog; de tekst voor de gebruiker vertaalt de JS-kant.
#[derive(Debug, Serialize)]
#[serde(tag = "code", rename_all = "kebab-case")]
pub enum InfoFout {
    VerkeerdWachtwoord,
    GeenPriveSleutel,
    GeenCertificaat,
    AlgoritmeNietOndersteund { detail: String },
    Onleesbaar { detail: String },
}

impl From<Pkcs12Fout> for InfoFout {
    fn from(f: Pkcs12Fout) -> Self {
        match f {
            Pkcs12Fout::VerkeerdWachtwoord => InfoFout::VerkeerdWachtwoord,
            Pkcs12Fout::AlgoritmeNietOndersteund(detail) => InfoFout::AlgoritmeNietOndersteund { detail },
            Pkcs12Fout::Onleesbaar(detail) => InfoFout::Onleesbaar { detail },
        }
    }
}

fn onleesbaar(e: impl std::fmt::Display) -> InfoFout {
    InfoFout::Onleesbaar { detail: e.to_string() }
}

/// Tekst van een attribuutwaarde in een X.509-naam, voor de stringtypen die in
/// de praktijk voorkomen. TeletexString lezen we als Latin-1, zoals de meeste
/// uitgevers hem feitelijk gebruiken.
fn attribuut_tekst(waarde: &der::Any) -> Option<String> {
    use der::asn1::{BmpString, Ia5StringRef, PrintableStringRef, Utf8StringRef};
    match waarde.tag() {
        der::Tag::Utf8String => waarde.decode_as::<Utf8StringRef>().ok().map(|s| s.as_str().to_string()),
        der::Tag::PrintableString => waarde.decode_as::<PrintableStringRef>().ok().map(|s| s.as_str().to_string()),
        der::Tag::Ia5String => waarde.decode_as::<Ia5StringRef>().ok().map(|s| s.as_str().to_string()),
        der::Tag::BmpString => waarde.decode_as::<BmpString>().ok().map(|s| s.to_string()),
        der::Tag::TeletexString => Some(waarde.value().iter().map(|&b| char::from(b)).collect()),
        _ => None,
    }
}

fn eerste_attribuut(naam: &x509_cert::name::Name, oid: ObjectIdentifier) -> Option<String> {
    naam.0
        .iter()
        .flat_map(|rdn| rdn.0.iter())
        .filter(|atv| atv.oid == oid)
        .find_map(|atv| attribuut_tekst(&atv.value))
}

/// Leesbare naam uit een X.509-naam: de common name, anders de organisatie,
/// anders de volledige naam als tekst.
pub(crate) fn common_name(naam: &x509_cert::name::Name) -> String {
    eerste_attribuut(naam, CN)
        .or_else(|| eerste_attribuut(naam, ORGANISATIE))
        .unwrap_or_else(|| naam.to_string())
}

/// `Some(true)` als digitalSignature of nonRepudiation gezet is, `Some(false)` als
/// de extensie er is maar dat niet toestaat of niet leesbaar is, `None` zonder extensie.
fn sleutelgebruik(extensies: Option<&x509_cert::ext::Extensions>) -> Option<bool> {
    let extensie = extensies?.iter().find(|e| e.extn_id == SLEUTELGEBRUIK)?;
    Some(
        x509_cert::ext::pkix::KeyUsage::from_der(extensie.extn_value.as_bytes())
            .map(|ku| ku.digital_signature() || ku.non_repudiation())
            .unwrap_or(false),
    )
}

/// Sleuteltype en, voor RSA, de exacte bitlengte van de modulus (zonder bovengrens).
fn sleutelgegevens(spki: &spki::SubjectPublicKeyInfoOwned) -> (String, Option<usize>) {
    if spki.algorithm.oid == RSA_ENCRYPTION {
        let bits = rsa::pkcs1::RsaPublicKey::from_der(spki.subject_public_key.raw_bytes())
            .ok()
            .and_then(|k| {
                let bytes = k.modulus.as_bytes();
                let begin = bytes.iter().position(|&b| b != 0)?;
                let eerste = bytes[begin];
                Some((bytes.len() - begin - 1) * 8 + (8 - eerste.leading_zeros() as usize))
            });
        ("RSA".to_string(), bits)
    } else if spki.algorithm.oid == ID_EC_PUBLIC_KEY {
        ("EC".to_string(), None)
    } else {
        (spki.algorithm.oid.to_string(), None)
    }
}

/// Gegevens uit een X.509-certificaat in DER.
///
/// Certificaten met een geldigheidsdatum vóór 1970 weigert de `der`-crate bij het
/// decoderen; die geven `InfoFout::Onleesbaar`.
pub fn certificaat_info(der_bytes: &[u8]) -> Result<CertificaatInfo, InfoFout> {
    let cert = x509_cert::Certificate::from_der(der_bytes).map_err(onleesbaar)?;
    let tbs = &cert.tbs_certificate;
    let (sleuteltype, rsa_bits) = sleutelgegevens(&tbs.subject_public_key_info);
    Ok(CertificaatInfo {
        naam: common_name(&tbs.subject),
        uitgever: common_name(&tbs.issuer),
        geldig_van_unix: tbs.validity.not_before.to_unix_duration().as_secs(),
        geldig_tot_unix: tbs.validity.not_after.to_unix_duration().as_secs(),
        sleutelgebruik_ondertekenen: sleutelgebruik(tbs.extensions.as_ref()),
        ondersteund: rsa_bits.is_some(),
        sleuteltype,
        rsa_bits,
    })
}

pub fn info_uit_p12(bytes: &[u8], wachtwoord: &str) -> Result<CertificaatInfo, InfoFout> {
    let inhoud = lees(bytes, wachtwoord)?;
    if inhoud.sleutel_pkcs8.is_none() {
        return Err(InfoFout::GeenPriveSleutel);
    }
    let i = ondertekenaar_index(&inhoud).ok_or(InfoFout::GeenCertificaat)?;
    certificaat_info(&inhoud.certificaten[i].der)
}

/// Gegevens van het ondertekencertificaat in een .p12, zonder iets te ondertekenen.
/// Lezen en sleutelafleiding (tot miljoenen iteraties) lopen via `spawn_blocking`,
/// zodat de hoofdthread niet blokkeert.
#[tauri::command]
pub async fn pdf_certificate_info(pad: String, wachtwoord: String) -> Result<CertificaatInfo, InfoFout> {
    let wachtwoord = zeroize::Zeroizing::new(wachtwoord);
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = std::fs::read(&pad).map_err(onleesbaar)?;
        info_uit_p12(&bytes, &wachtwoord)
    })
    .await
    .map_err(onleesbaar)?
}

#[cfg(test)]
mod tests {
    use super::*;
    use der::Encode;
    use std::path::PathBuf;

    fn fixture(naam: &str) -> Vec<u8> {
        std::fs::read(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/pkcs12").join(naam)).unwrap()
    }

    fn corpus(naam: &str) -> Option<Vec<u8>> {
        let pad = crate::handtekening::corpusmap("pkcs12")?.join(naam);
        Some(std::fs::read(&pad).unwrap_or_else(|e| panic!("corpusbestand {} onleesbaar: {e}", pad.display())))
    }

    #[test]
    fn rsa_fixture_geeft_volledige_gegevens() {
        let info = info_uit_p12(&fixture("openssl3-aes256.p12"), "proef123").unwrap();
        assert_eq!(info.naam, "OPDS Test Ondertekenaar");
        assert_eq!(info.uitgever, "OPDS Test Ondertekenaar");
        assert_eq!(info.sleuteltype, "RSA");
        assert_eq!(info.rsa_bits, Some(2048));
        assert!(info.ondersteund);
        assert_eq!(info.sleutelgebruik_ondertekenen, Some(true));
        let negen_jaar = 9 * 365 * 24 * 3600;
        assert!(info.geldig_tot_unix - info.geldig_van_unix > negen_jaar);
    }

    #[test]
    fn verkeerd_wachtwoord_heeft_eigen_code() {
        assert!(matches!(info_uit_p12(&fixture("certutil-3des.p12"), "fout"), Err(InfoFout::VerkeerdWachtwoord)));
    }

    #[test]
    fn zonder_wachtwoord_geeft_gegevens_met_lege_invoer() {
        let info = info_uit_p12(&fixture("zonder-wachtwoord.p12"), "").unwrap();
        assert_eq!(info.naam, "OPDS Test Ondertekenaar");
        assert!(info.ondersteund);
    }

    #[test]
    fn foutcodes_serialiseren_als_kebab_case() {
        let json = serde_json::to_string(&InfoFout::GeenPriveSleutel).unwrap();
        assert_eq!(json, r#"{"code":"geen-prive-sleutel"}"#);
        let json = serde_json::to_string(&InfoFout::Onleesbaar { detail: "x".into() }).unwrap();
        assert_eq!(json, r#"{"code":"onleesbaar","detail":"x"}"#);
    }

    #[test]
    fn corpus_ecdsa_niet_ondersteund_zonder_sleutel_zonder_certificaat() {
        let (Some(ec), Some(geen_sleutel), Some(geen_cert)) = (
            corpus("cert-key-aes256cbc.p12"),
            corpus("cert-aes256cbc-no-key.p12"),
            corpus("no-cert-key-aes256cbc.p12"),
        ) else {
            return;
        };
        let info = info_uit_p12(&ec, "cryptography").unwrap();
        assert_eq!(info.naam, "cryptography CA");
        assert_eq!(info.sleuteltype, "EC");
        assert_eq!(info.rsa_bits, None);
        assert!(!info.ondersteund);
        assert!(matches!(info_uit_p12(&geen_sleutel, "cryptography"), Err(InfoFout::GeenPriveSleutel)));
        assert!(matches!(info_uit_p12(&geen_cert, "cryptography"), Err(InfoFout::GeenCertificaat)));
    }

    #[test]
    fn commando_leest_van_schijf_en_meldt_ontbrekend_bestand() {
        let pad = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/pkcs12/windows-export-3des.p12");
        let info = tauri::async_runtime::block_on(pdf_certificate_info(
            pad.to_string_lossy().into_owned(),
            "proef123".into(),
        ))
        .unwrap();
        assert_eq!(info.naam, "OPDS Test Ondertekenaar");
        assert!(matches!(
            tauri::async_runtime::block_on(pdf_certificate_info("Z:/bestaat/niet.p12".into(), "x".into())),
            Err(InfoFout::Onleesbaar { .. })
        ));
    }

    fn naam_met(attributen: &[(ObjectIdentifier, der::Tag, &[u8])]) -> x509_cert::name::Name {
        let rdns = attributen
            .iter()
            .map(|(oid, tag, waarde)| {
                let atv = x509_cert::attr::AttributeTypeAndValue {
                    oid: *oid,
                    value: der::Any::new(*tag, *waarde).unwrap(),
                };
                x509_cert::name::RelativeDistinguishedName(der::asn1::SetOfVec::try_from(vec![atv]).unwrap())
            })
            .collect();
        x509_cert::name::RdnSequence(rdns)
    }

    const OU: ObjectIdentifier = ObjectIdentifier::new_unwrap("2.5.4.11");

    #[test]
    fn common_name_in_alle_stringtypen() {
        let bmp: Vec<u8> = "Jörg Ω".encode_utf16().flat_map(|c| c.to_be_bytes()).collect();
        assert_eq!(common_name(&naam_met(&[(CN, der::Tag::BmpString, &bmp)])), "Jörg Ω");
        // Teletex als Latin-1: 0xFC is ü.
        assert_eq!(common_name(&naam_met(&[(CN, der::Tag::TeletexString, b"M\xFCller")])), "Müller");
        assert_eq!(common_name(&naam_met(&[(CN, der::Tag::TeletexString, b"Muller")])), "Muller");
        assert_eq!(common_name(&naam_met(&[(CN, der::Tag::Ia5String, b"ia5 naam")])), "ia5 naam");
        assert_eq!(common_name(&naam_met(&[(CN, der::Tag::Utf8String, "é".as_bytes())])), "é");
        assert_eq!(common_name(&naam_met(&[(CN, der::Tag::PrintableString, b"Printable")])), "Printable");
    }

    #[test]
    fn zonder_leesbare_cn_eerst_organisatie_dan_dn() {
        let bmp: Vec<u8> = "Org BV".encode_utf16().flat_map(|c| c.to_be_bytes()).collect();
        let naam = naam_met(&[(OU, der::Tag::Utf8String, b"afdeling"), (ORGANISATIE, der::Tag::BmpString, &bmp)]);
        assert_eq!(common_name(&naam), "Org BV");
        let naam = naam_met(&[(OU, der::Tag::Utf8String, b"afdeling")]);
        assert_eq!(common_name(&naam), naam.to_string());
    }

    fn rsa_spki(modulus: &[u8]) -> spki::SubjectPublicKeyInfoOwned {
        let pkcs1 = rsa::pkcs1::RsaPublicKey {
            modulus: der::asn1::UintRef::new(modulus).unwrap(),
            public_exponent: der::asn1::UintRef::new(&[1, 0, 1]).unwrap(),
        }
        .to_der()
        .unwrap();
        spki::SubjectPublicKeyInfoOwned {
            algorithm: spki::AlgorithmIdentifierOwned { oid: RSA_ENCRYPTION, parameters: Some(der::Any::null()) },
            subject_public_key: der::asn1::BitString::from_bytes(&pkcs1).unwrap(),
        }
    }

    #[test]
    fn rsa_grootte_zonder_bovengrens_en_exact_in_bits() {
        assert_eq!(sleutelgegevens(&rsa_spki(&[0xFF; 1024])), ("RSA".to_string(), Some(8192)));
        let mut m = vec![0xFF; 256];
        m[0] = 0x7F;
        assert_eq!(sleutelgegevens(&rsa_spki(&m)), ("RSA".to_string(), Some(2047)));
        let mut spki = rsa_spki(&m);
        spki.subject_public_key = der::asn1::BitString::from_bytes(&[0x05, 0x00]).unwrap();
        assert_eq!(sleutelgegevens(&spki), ("RSA".to_string(), None));
    }

    fn extensie(oid: ObjectIdentifier, waarde: &[u8]) -> x509_cert::ext::Extension {
        x509_cert::ext::Extension {
            extn_id: oid,
            critical: true,
            extn_value: der::asn1::OctetString::new(waarde).unwrap(),
        }
    }

    #[test]
    fn sleutelgebruik_ontbrekend_onleesbaar_of_zonder_ondertekenen() {
        use x509_cert::ext::pkix::{KeyUsage, KeyUsages};
        assert_eq!(sleutelgebruik(None), None);
        let andere = vec![extensie(ObjectIdentifier::new_unwrap("2.5.29.19"), &[0x30, 0x00])];
        assert_eq!(sleutelgebruik(Some(&andere)), None);
        assert_eq!(sleutelgebruik(Some(&vec![extensie(SLEUTELGEBRUIK, &[0x05, 0x00])])), Some(false));
        let alleen_versleutelen = KeyUsage(KeyUsages::KeyEncipherment.into()).to_der().unwrap();
        assert_eq!(sleutelgebruik(Some(&vec![extensie(SLEUTELGEBRUIK, &alleen_versleutelen)])), Some(false));
        let nr = KeyUsage(KeyUsages::NonRepudiation.into()).to_der().unwrap();
        assert_eq!(sleutelgebruik(Some(&vec![extensie(SLEUTELGEBRUIK, &nr)])), Some(true));
    }

    #[test]
    fn ed25519_zonder_keyusage_is_onbekend_en_niet_ondersteund() {
        let der = std::fs::read(
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/certificaten/ed25519-zonder-keyusage.der"),
        )
        .unwrap();
        let info = certificaat_info(&der).unwrap();
        assert_eq!(info.naam, "OPDS Ed25519 Test");
        assert_eq!(info.sleuteltype, "1.3.101.112");
        assert_eq!(info.rsa_bits, None);
        assert_eq!(info.sleutelgebruik_ondertekenen, None);
        assert!(!info.ondersteund);
    }

    #[test]
    fn eigen_fixtures_zonder_sleutel_of_zonder_certificaat() {
        assert!(matches!(
            info_uit_p12(&fixture("alleen-certificaat.p12"), "proef123"),
            Err(InfoFout::GeenPriveSleutel)
        ));
        assert!(matches!(
            info_uit_p12(&fixture("sleutel-zonder-certificaat.p12"), "proef123"),
            Err(InfoFout::GeenCertificaat)
        ));
    }
}
