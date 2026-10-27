//! CMS SignedData bouwen voor een PDF-handtekening (RFC 5652, ETSI EN 319 122-1
//! CAdES-BES / PAdES B-B): detached, met de ondertekende attributen
//! `contentType`, `messageDigest` en `signingCertificateV2`, de certificaatketen
//! uit het .p12 en optioneel een RFC 3161-tijdstempel als onondertekend
//! attribuut `signatureTimeStampToken`.
//!
//! PAdES (ETSI EN 319 142-1 §5.2.1, `ETSI.CAdES.detached`): geen `signingTime`
//! in de CMS; het tijdstip staat in `/M` van het handtekeningwoordenboek. Bij
//! `adbe.pkcs7.detached` komt `signingTime` er wel in, zoals lezers verwachten.

use const_oid::ObjectIdentifier;
use der::asn1::{OctetString, SetOfVec, UtcTime};
use der::{Any, Decode, Encode, Sequence};
use rsa::pkcs8::DecodePrivateKey;
use rsa::{Pkcs1v15Sign, RsaPrivateKey};
use sha2::{Digest, Sha256};
use spki::AlgorithmIdentifierOwned;
use x509_cert::attr::Attribute;
use x509_cert::ext::pkix::name::GeneralName;
use x509_cert::serial_number::SerialNumber;
use x509_cert::Certificate;

use cms::cert::{CertificateChoices, IssuerAndSerialNumber};
use cms::content_info::{CmsVersion, ContentInfo};
use cms::signed_data::{
    CertificateSet, EncapsulatedContentInfo, SignedData, SignerIdentifier, SignerInfo, SignerInfos,
};

pub const ID_DATA: ObjectIdentifier = ObjectIdentifier::new_unwrap("1.2.840.113549.1.7.1");
pub const ID_SIGNED_DATA: ObjectIdentifier = ObjectIdentifier::new_unwrap("1.2.840.113549.1.7.2");
pub const ID_SHA256: ObjectIdentifier = ObjectIdentifier::new_unwrap("2.16.840.1.101.3.4.2.1");
pub const RSA_ENCRYPTION: ObjectIdentifier = ObjectIdentifier::new_unwrap("1.2.840.113549.1.1.1");
const ID_CONTENT_TYPE: ObjectIdentifier = ObjectIdentifier::new_unwrap("1.2.840.113549.1.9.3");
const ID_MESSAGE_DIGEST: ObjectIdentifier = ObjectIdentifier::new_unwrap("1.2.840.113549.1.9.4");
const ID_SIGNING_TIME: ObjectIdentifier = ObjectIdentifier::new_unwrap("1.2.840.113549.1.9.5");
const ID_SIGNING_CERTIFICATE_V2: ObjectIdentifier = ObjectIdentifier::new_unwrap("1.2.840.113549.1.9.16.2.47");
const ID_SIGNATURE_TIME_STAMP_TOKEN: ObjectIdentifier = ObjectIdentifier::new_unwrap("1.2.840.113549.1.9.16.2.14");

/// IssuerSerial ::= SEQUENCE { issuer GeneralNames, serialNumber CertificateSerialNumber }
#[derive(Clone, Debug, Eq, PartialEq, Sequence)]
struct IssuerSerial {
    issuer: Vec<GeneralName>,
    serial_number: SerialNumber,
}

/// ESSCertIDv2 (RFC 5035): hashAlgorithm DEFAULT sha256, dus weggelaten.
#[derive(Clone, Debug, Eq, PartialEq, Sequence)]
struct EssCertIdV2 {
    cert_hash: OctetString,
    issuer_serial: IssuerSerial,
}

/// SigningCertificateV2 ::= SEQUENCE { certs SEQUENCE OF ESSCertIDv2, policies … OPTIONAL }
#[derive(Clone, Debug, Eq, PartialEq, Sequence)]
struct SigningCertificateV2 {
    certs: Vec<EssCertIdV2>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CmsBouwFout {
    /// De privésleutel is geen (leesbare) RSA-sleutel.
    SleutelNietOndersteund(String),
    /// Een certificaat uit het .p12 is niet te decoderen.
    Certificaat(String),
    Ondertekenen(String),
    Tijdstempel(String),
}

impl std::fmt::Display for CmsBouwFout {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CmsBouwFout::SleutelNietOndersteund(d) => write!(f, "sleutel niet ondersteund: {d}"),
            CmsBouwFout::Certificaat(d) => write!(f, "certificaat onleesbaar: {d}"),
            CmsBouwFout::Ondertekenen(d) => write!(f, "ondertekenen mislukt: {d}"),
            CmsBouwFout::Tijdstempel(d) => write!(f, "tijdstempel mislukt: {d}"),
        }
    }
}

/// Sleutel en certificaten van de ondertekenaar. Geen `Debug`: de sleutel hoort
/// nooit in een log.
pub struct Ondertekenaar {
    sleutel: RsaPrivateKey,
    pub certificaat: Certificate,
    /// De andere certificaten uit het .p12 (keten), zonder de ondertekenaar.
    pub keten: Vec<Certificate>,
}

impl Ondertekenaar {
    pub fn nieuw(sleutel_pkcs8: &[u8], certificaat_der: &[u8], keten_der: &[&[u8]]) -> Result<Ondertekenaar, CmsBouwFout> {
        let sleutel = RsaPrivateKey::from_pkcs8_der(sleutel_pkcs8)
            .map_err(|e| CmsBouwFout::SleutelNietOndersteund(e.to_string()))?;
        let certificaat =
            Certificate::from_der(certificaat_der).map_err(|e| CmsBouwFout::Certificaat(e.to_string()))?;
        let keten = keten_der
            .iter()
            .map(|d| Certificate::from_der(d).map_err(|e| CmsBouwFout::Certificaat(e.to_string())))
            .collect::<Result<Vec<_>, _>>()?;
        Ok(Ondertekenaar { sleutel, certificaat, keten })
    }

    /// Lengte van de handtekeningwaarde in bytes (modulus van de sleutel).
    pub fn handtekeninglengte(&self) -> usize {
        use rsa::traits::PublicKeyParts;
        self.sleutel.size()
    }

    /// Geschatte grootte van de CMS zonder tijdstempel, ruim genomen.
    pub fn geschatte_cms_grootte(&self) -> usize {
        let certs: usize = std::iter::once(&self.certificaat)
            .chain(&self.keten)
            .map(|c| c.to_der().map(|d| d.len()).unwrap_or(4096))
            .sum();
        certs + 2 * self.handtekeninglengte() + 1500
    }
}

fn alg(oid: ObjectIdentifier, null_parameters: bool) -> AlgorithmIdentifierOwned {
    AlgorithmIdentifierOwned { oid, parameters: null_parameters.then(|| Any::from(der::asn1::Null)) }
}

fn attribuut(oid: ObjectIdentifier, waarde: Any) -> Result<Attribute, CmsBouwFout> {
    let mut values = SetOfVec::new();
    values.insert(waarde).map_err(|e| CmsBouwFout::Ondertekenen(e.to_string()))?;
    Ok(Attribute { oid, values })
}

fn als_any(waarde: &impl Encode) -> Result<Any, CmsBouwFout> {
    let der = waarde.to_der().map_err(|e| CmsBouwFout::Ondertekenen(e.to_string()))?;
    Any::from_der(&der).map_err(|e| CmsBouwFout::Ondertekenen(e.to_string()))
}

/// Bouwt de CMS (ContentInfo met SignedData, DER) over de SHA-256-`digest` van
/// het bytebereik. `ondertekentijd`: alleen voor `adbe.pkcs7.detached`.
/// `tijdstempel` krijgt de handtekeningwaarde en geeft een TimeStampToken (DER).
pub fn bouw_cms(
    o: &Ondertekenaar,
    digest: &[u8],
    ondertekentijd: Option<std::time::SystemTime>,
    tijdstempel: Option<&mut dyn FnMut(&[u8]) -> Result<Vec<u8>, String>>,
) -> Result<Vec<u8>, CmsBouwFout> {
    let fout = |e: der::Error| CmsBouwFout::Ondertekenen(e.to_string());
    let cert_der = o.certificaat.to_der().map_err(fout)?;
    let tbs = &o.certificaat.tbs_certificate;

    let ess = SigningCertificateV2 {
        certs: vec![EssCertIdV2 {
            cert_hash: OctetString::new(Sha256::digest(&cert_der).to_vec()).map_err(fout)?,
            issuer_serial: IssuerSerial {
                issuer: vec![GeneralName::DirectoryName(tbs.issuer.clone())],
                serial_number: tbs.serial_number.clone(),
            },
        }],
    };

    let mut attrs = SetOfVec::new();
    let insert = |attrs: &mut SetOfVec<Attribute>, a: Attribute| attrs.insert(a).map_err(fout);
    insert(&mut attrs, attribuut(ID_CONTENT_TYPE, als_any(&ID_DATA)?)?)?;
    insert(&mut attrs, attribuut(ID_MESSAGE_DIGEST, als_any(&OctetString::new(digest.to_vec()).map_err(fout)?)?)?)?;
    insert(&mut attrs, attribuut(ID_SIGNING_CERTIFICATE_V2, als_any(&ess)?)?)?;
    if let Some(tijd) = ondertekentijd {
        let utc = UtcTime::from_system_time(tijd).map_err(fout)?;
        insert(&mut attrs, attribuut(ID_SIGNING_TIME, als_any(&utc)?)?)?;
    }

    // De handtekening gaat over de DER van de attributen als SET OF (RFC 5652 §5.4).
    let te_ondertekenen = attrs.to_der().map_err(fout)?;
    let hash = Sha256::digest(&te_ondertekenen);
    let handtekening = o
        .sleutel
        .sign_with_rng(&mut rand::thread_rng(), Pkcs1v15Sign::new::<Sha256>(), &hash)
        .map_err(|e| CmsBouwFout::Ondertekenen(e.to_string()))?;

    let unsigned_attrs = match tijdstempel {
        Some(haal) => {
            let token = haal(&handtekening).map_err(CmsBouwFout::Tijdstempel)?;
            let token = Any::from_der(&token).map_err(|e| CmsBouwFout::Tijdstempel(e.to_string()))?;
            let mut u = SetOfVec::new();
            u.insert(attribuut(ID_SIGNATURE_TIME_STAMP_TOKEN, token)?).map_err(fout)?;
            Some(u)
        }
        None => None,
    };

    let signer = SignerInfo {
        version: CmsVersion::V1,
        sid: SignerIdentifier::IssuerAndSerialNumber(IssuerAndSerialNumber {
            issuer: tbs.issuer.clone(),
            serial_number: tbs.serial_number.clone(),
        }),
        digest_alg: alg(ID_SHA256, false),
        signed_attrs: Some(attrs),
        signature_algorithm: alg(RSA_ENCRYPTION, true),
        signature: OctetString::new(handtekening).map_err(fout)?,
        unsigned_attrs,
    };

    let mut digest_algs = SetOfVec::new();
    digest_algs.insert(alg(ID_SHA256, false)).map_err(fout)?;
    let certificaten: Vec<CertificateChoices> = std::iter::once(&o.certificaat)
        .chain(&o.keten)
        .map(|c| CertificateChoices::Certificate(c.clone()))
        .collect();
    let signed_data = SignedData {
        version: CmsVersion::V1,
        digest_algorithms: digest_algs,
        encap_content_info: EncapsulatedContentInfo { econtent_type: ID_DATA, econtent: None },
        certificates: Some(CertificateSet(SetOfVec::try_from(certificaten).map_err(fout)?)),
        crls: None,
        signer_infos: SignerInfos(SetOfVec::try_from(vec![signer]).map_err(fout)?),
    };
    let info = ContentInfo { content_type: ID_SIGNED_DATA, content: als_any(&signed_data)? };
    info.to_der().map_err(fout)
}
