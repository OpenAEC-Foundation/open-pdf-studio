//! Hash- en handtekeningalgoritmen voor het verifiëren.
//!
//! SHA-1/-256/-384/-512; RSA PKCS#1 v1.5 (`rsaEncryption` en
//! `sha*WithRSAEncryption`), RSASSA-PSS met MGF1 over dezelfde hash, en ECDSA op
//! P-256 en P-384. SHA-1 blijft toegestaan: oude handtekeningen en ketens
//! gebruiken het nog; [`Hashalg::is_zwak`] en [`gebruikte_hash`] laten de
//! aanroeper het als zwak markeren. RSA-sleutels kleiner dan 1024 bits zijn
//! niet ondersteund; groter dan 4096 bits alleen bij certificaathandtekeningen
//! in een keten ([`controleer_certificaathandtekening`], tot 8192 bits: zulke
//! wortels bestaan), niet bij handtekeningen in een document.

use const_oid::ObjectIdentifier;

use super::ber::{kinderen, lees_tlv, BerFout};
use super::cms_lees::{alg_id, oid_uit, AlgId, CmsFout};

const SHA1: ObjectIdentifier = ObjectIdentifier::new_unwrap("1.3.14.3.2.26");
const SHA256: ObjectIdentifier = ObjectIdentifier::new_unwrap("2.16.840.1.101.3.4.2.1");
const SHA384: ObjectIdentifier = ObjectIdentifier::new_unwrap("2.16.840.1.101.3.4.2.2");
const SHA512: ObjectIdentifier = ObjectIdentifier::new_unwrap("2.16.840.1.101.3.4.2.3");
const RSA_ENCRYPTION: ObjectIdentifier = ObjectIdentifier::new_unwrap("1.2.840.113549.1.1.1");
const SHA1_RSA: ObjectIdentifier = ObjectIdentifier::new_unwrap("1.2.840.113549.1.1.5");
const SHA256_RSA: ObjectIdentifier = ObjectIdentifier::new_unwrap("1.2.840.113549.1.1.11");
const SHA384_RSA: ObjectIdentifier = ObjectIdentifier::new_unwrap("1.2.840.113549.1.1.12");
const SHA512_RSA: ObjectIdentifier = ObjectIdentifier::new_unwrap("1.2.840.113549.1.1.13");
const RSASSA_PSS: ObjectIdentifier = ObjectIdentifier::new_unwrap("1.2.840.113549.1.1.10");
const MGF1: ObjectIdentifier = ObjectIdentifier::new_unwrap("1.2.840.113549.1.1.8");
const EC_PUBLIC_KEY: ObjectIdentifier = ObjectIdentifier::new_unwrap("1.2.840.10045.2.1");
const ECDSA_SHA1: ObjectIdentifier = ObjectIdentifier::new_unwrap("1.2.840.10045.4.1");
const ECDSA_SHA256: ObjectIdentifier = ObjectIdentifier::new_unwrap("1.2.840.10045.4.3.2");
const ECDSA_SHA384: ObjectIdentifier = ObjectIdentifier::new_unwrap("1.2.840.10045.4.3.3");
const ECDSA_SHA512: ObjectIdentifier = ObjectIdentifier::new_unwrap("1.2.840.10045.4.3.4");
const P256: ObjectIdentifier = ObjectIdentifier::new_unwrap("1.2.840.10045.3.1.7");
const P384: ObjectIdentifier = ObjectIdentifier::new_unwrap("1.3.132.0.34");

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Hashalg {
    Sha1,
    Sha256,
    Sha384,
    Sha512,
}

impl Hashalg {
    pub fn uit_oid(oid: ObjectIdentifier) -> Option<Hashalg> {
        if oid == SHA1 {
            Some(Hashalg::Sha1)
        } else if oid == SHA256 {
            Some(Hashalg::Sha256)
        } else if oid == SHA384 {
            Some(Hashalg::Sha384)
        } else if oid == SHA512 {
            Some(Hashalg::Sha512)
        } else {
            None
        }
    }

    /// SHA-1 is gebroken voor botsingen: een handtekening ermee kan intact
    /// zijn, maar verdient een waarschuwing.
    pub fn is_zwak(self) -> bool {
        self == Hashalg::Sha1
    }

    /// Hash over de aaneengeschakelde delen, zonder ze eerst samen te voegen.
    pub fn hash(self, delen: &[&[u8]]) -> Vec<u8> {
        fn met<D: sha2::Digest>(delen: &[&[u8]]) -> Vec<u8> {
            let mut h = D::new();
            for deel in delen {
                h.update(deel);
            }
            h.finalize().to_vec()
        }
        match self {
            Hashalg::Sha1 => met::<sha1::Sha1>(delen),
            Hashalg::Sha256 => met::<sha2::Sha256>(delen),
            Hashalg::Sha384 => met::<sha2::Sha384>(delen),
            Hashalg::Sha512 => met::<sha2::Sha512>(delen),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WaardeFout {
    /// Algoritme, parameters of sleutel niet ondersteund of onleesbaar.
    NietOndersteund(String),
    /// De handtekeningwaarde klopt niet.
    KloptNiet,
}

impl From<BerFout> for WaardeFout {
    fn from(e: BerFout) -> Self {
        WaardeFout::NietOndersteund(format!("ASN.1: {e}"))
    }
}

impl From<CmsFout> for WaardeFout {
    fn from(e: CmsFout) -> Self {
        WaardeFout::NietOndersteund(e.0)
    }
}

fn niet(tekst: impl Into<String>) -> WaardeFout {
    WaardeFout::NietOndersteund(tekst.into())
}

/// De hash die `alg` gebruikt: vast bij `sha*WithRSAEncryption` en
/// `ecdsa-with-SHA*`, uit de parameters bij RSASSA-PSS, en `standaard_hash`
/// (het digestalgoritme) bij `rsaEncryption` en `id-ecPublicKey`. `None` bij
/// een onbekend algoritme of onleesbare parameters.
pub fn gebruikte_hash(alg: &AlgId, standaard_hash: Option<Hashalg>) -> Option<Hashalg> {
    let o = alg.oid;
    if o == RSA_ENCRYPTION || o == EC_PUBLIC_KEY {
        standaard_hash
    } else if o == RSASSA_PSS {
        pss_parameters(alg.parameters.as_deref()).ok().map(|(hash, _)| hash)
    } else {
        vaste_hash(o)
    }
}

fn vaste_hash(o: ObjectIdentifier) -> Option<Hashalg> {
    if o == SHA1_RSA || o == ECDSA_SHA1 {
        Some(Hashalg::Sha1)
    } else if o == SHA256_RSA || o == ECDSA_SHA256 {
        Some(Hashalg::Sha256)
    } else if o == SHA384_RSA || o == ECDSA_SHA384 {
        Some(Hashalg::Sha384)
    } else if o == SHA512_RSA || o == ECDSA_SHA512 {
        Some(Hashalg::Sha512)
    } else {
        None
    }
}

/// Een algoritme met een eigen hash moet passen bij het digestalgoritme van de
/// SignerInfo, als dat er is (bij certificaten is het er niet).
fn past_bij_digest(o: ObjectIdentifier, hash: Hashalg, standaard_hash: Option<Hashalg>) -> Result<Hashalg, WaardeFout> {
    match standaard_hash {
        Some(digest) if digest != hash => Err(niet(format!("{o} past niet bij digestalgoritme {digest:?}"))),
        _ => Ok(hash),
    }
}

/// Grootste RSA-modulus in bits voor handtekeningen in een document (de grens van `rsa` 0.9).
const MAX_RSA_BITS: usize = 4096;
/// Grootste RSA-modulus in bits voor certificaathandtekeningen in een keten.
const MAX_RSA_BITS_CERTIFICAAT: usize = 8192;

/// Controleert `handtekening` over de delen met de publieke sleutel uit `spki_der`.
pub fn controleer_handtekening(
    spki_der: &[u8],
    alg: &AlgId,
    standaard_hash: Option<Hashalg>,
    delen: &[&[u8]],
    handtekening: &[u8],
) -> Result<(), WaardeFout> {
    controleer_met_grens(spki_der, alg, standaard_hash, delen, handtekening, MAX_RSA_BITS)
}

/// Controleert de handtekening van een uitgever over een certificaat (`delen` =
/// de tbsCertificate). Als [`controleer_handtekening`] zonder digestalgoritme,
/// maar met RSA-sleutels tot 8192 bits.
pub fn controleer_certificaathandtekening(
    spki_der: &[u8],
    alg: &AlgId,
    delen: &[&[u8]],
    handtekening: &[u8],
) -> Result<(), WaardeFout> {
    controleer_met_grens(spki_der, alg, None, delen, handtekening, MAX_RSA_BITS_CERTIFICAAT)
}

fn controleer_met_grens(
    spki_der: &[u8],
    alg: &AlgId,
    standaard_hash: Option<Hashalg>,
    delen: &[&[u8]],
    handtekening: &[u8],
    max_rsa_bits: usize,
) -> Result<(), WaardeFout> {
    let o = alg.oid;
    let standaard = || standaard_hash.ok_or_else(|| niet(format!("{o} zonder digestalgoritme")));
    if o == RSA_ENCRYPTION {
        rsa_pkcs1(spki_der, max_rsa_bits, standaard()?, delen, handtekening)
    } else if o == SHA1_RSA || o == SHA256_RSA || o == SHA384_RSA || o == SHA512_RSA {
        let hash = vaste_hash(o).ok_or_else(|| niet(format!("handtekeningalgoritme {o}")))?;
        rsa_pkcs1(spki_der, max_rsa_bits, past_bij_digest(o, hash, standaard_hash)?, delen, handtekening)
    } else if o == RSASSA_PSS {
        let (hash, zout) = pss_parameters(alg.parameters.as_deref())?;
        // RFC 4056 §3.1: dezelfde hash voor het digestalgoritme en de PSS-parameters.
        rsa_pss(spki_der, max_rsa_bits, past_bij_digest(o, hash, standaard_hash)?, zout, delen, handtekening)
    } else if o == ECDSA_SHA1 || o == ECDSA_SHA256 || o == ECDSA_SHA384 || o == ECDSA_SHA512 {
        let hash = vaste_hash(o).ok_or_else(|| niet(format!("handtekeningalgoritme {o}")))?;
        ecdsa(spki_der, past_bij_digest(o, hash, standaard_hash)?, delen, handtekening)
    } else if o == EC_PUBLIC_KEY {
        ecdsa(spki_der, standaard()?, delen, handtekening)
    } else {
        Err(niet(format!("handtekeningalgoritme {o}")))
    }
}

impl Hashalg {
    fn oid(self) -> ObjectIdentifier {
        match self {
            Hashalg::Sha1 => SHA1,
            Hashalg::Sha256 => SHA256,
            Hashalg::Sha384 => SHA384,
            Hashalg::Sha512 => SHA512,
        }
    }

    fn lengte(self) -> usize {
        match self {
            Hashalg::Sha1 => 20,
            Hashalg::Sha256 => 32,
            Hashalg::Sha384 => 48,
            Hashalg::Sha512 => 64,
        }
    }
}

/// RSA PKCS#1 v1.5 (RFC 8017 §8.2.2 en §9.2): de digest uit de handtekeningwaarde
/// terughalen met de publieke sleutel (s^e mod n). Zo is zonder ondertekende
/// attributen te onderscheiden of de inhoud gewijzigd is (geldige codering met een
/// andere digest) of de waarde ongeldig is (geen geldige codering).
///
/// `Ok(None)`: geen geldige EMSA-PKCS1-v1_5-codering met een DigestInfo voor de
/// verwachte hash. `Err`: geen PKCS#1 v1.5-algoritme, of sleutel niet ondersteund.
pub fn pkcs1_digest(
    spki_der: &[u8],
    alg: &AlgId,
    standaard_hash: Option<Hashalg>,
    handtekening: &[u8],
) -> Result<Option<Vec<u8>>, WaardeFout> {
    use rsa::traits::PublicKeyParts;
    let o = alg.oid;
    let hash = if o == RSA_ENCRYPTION {
        standaard_hash.ok_or_else(|| niet(format!("{o} zonder digestalgoritme")))?
    } else if o == SHA1_RSA || o == SHA256_RSA || o == SHA384_RSA || o == SHA512_RSA {
        let hash = vaste_hash(o).ok_or_else(|| niet(format!("handtekeningalgoritme {o}")))?;
        past_bij_digest(o, hash, standaard_hash)?
    } else {
        return Err(niet(format!("{o} is geen RSA PKCS#1 v1.5")));
    };
    let sleutel = rsa_sleutel(spki_der, MAX_RSA_BITS)?;
    let k = sleutel.size();
    if handtekening.len() != k {
        return Ok(None);
    }
    let s = rsa::BigUint::from_bytes_be(handtekening);
    if &s >= sleutel.n() {
        return Ok(None);
    }
    let m = s.modpow(sleutel.e(), sleutel.n()).to_bytes_be();
    let Some(opvulling) = k.checked_sub(m.len()) else {
        return Ok(None);
    };
    let mut em = vec![0u8; opvulling];
    em.extend(m);
    // 0x00 0x01 PS (minstens acht keer 0xFF) 0x00 DigestInfo
    let Some(rest) = em.strip_prefix(&[0x00, 0x01]) else {
        return Ok(None);
    };
    let ps = rest.iter().take_while(|&&b| b == 0xFF).count();
    let Some(digest_info) = rest.get(ps..).and_then(|r| r.strip_prefix(&[0x00])) else {
        return Ok(None);
    };
    if ps < 8 {
        return Ok(None);
    }
    Ok(lees_digest_info(digest_info, hash))
}

/// DigestInfo ::= SEQUENCE { AlgorithmIdentifier, OCTET STRING }, strikt en zonder restbytes.
fn lees_digest_info(b: &[u8], hash: Hashalg) -> Option<Vec<u8>> {
    let (seq, rest) = lees_tlv(b).ok()?;
    if seq.tag != 0x30 || !rest.is_empty() {
        return None;
    }
    let k = kinderen(seq.inhoud).ok()?;
    let [alg, digest] = k.as_slice() else {
        return None;
    };
    let alg = alg_id(alg).ok()?;
    let parameters_ok = matches!(alg.parameters.as_deref(), None | Some([0x05, 0x00]));
    if alg.oid != hash.oid() || !parameters_ok || digest.tag != 0x04 || digest.inhoud.len() != hash.lengte() {
        return None;
    }
    Some(digest.inhoud.to_vec())
}

/// SubjectPublicKeyInfo: algoritme en de sleutelbytes uit de BIT STRING.
fn spki_delen(spki_der: &[u8]) -> Result<(AlgId, Vec<u8>), WaardeFout> {
    let (buiten, _) = lees_tlv(spki_der)?;
    let k = kinderen(buiten.inhoud)?;
    let (Some(alg), Some(bits)) = (k.first(), k.get(1)) else {
        return Err(niet("publieke sleutel onleesbaar"));
    };
    if buiten.tag != 0x30 || bits.tag != 0x03 {
        return Err(niet("publieke sleutel onleesbaar"));
    }
    match bits.inhoud.split_first() {
        Some((&0, sleutel)) => Ok((alg_id(alg)?, sleutel.to_vec())),
        _ => Err(niet("publieke sleutel onleesbaar")),
    }
}

/// Kleinste ondersteunde RSA-modulus in bits.
const MIN_RSA_BITS: usize = 1024;

fn rsa_sleutel(spki_der: &[u8], max_bits: usize) -> Result<rsa::RsaPublicKey, WaardeFout> {
    use der::Decode;
    use rsa::traits::PublicKeyParts;
    let (alg, sleutel) = spki_delen(spki_der)?;
    if alg.oid != RSA_ENCRYPTION && alg.oid != RSASSA_PSS {
        return Err(niet("sleutel is geen RSA-sleutel"));
    }
    let delen = rsa::pkcs1::RsaPublicKey::from_der(&sleutel).map_err(|e| niet(format!("RSA-sleutel: {e}")))?;
    let n = rsa::BigUint::from_bytes_be(delen.modulus.as_bytes());
    let e = rsa::BigUint::from_bytes_be(delen.public_exponent.as_bytes());
    let sleutel = rsa::RsaPublicKey::new_with_max_size(n, e, max_bits).map_err(|e| niet(format!("RSA-sleutel: {e}")))?;
    let bits = sleutel.n().bits();
    if bits < MIN_RSA_BITS {
        return Err(niet(format!("RSA-sleutel van {bits} bits is kleiner dan {MIN_RSA_BITS}")));
    }
    Ok(sleutel)
}

fn rsa_pkcs1(
    spki_der: &[u8],
    max_bits: usize,
    hash: Hashalg,
    delen: &[&[u8]],
    handtekening: &[u8],
) -> Result<(), WaardeFout> {
    use rsa::Pkcs1v15Sign;
    let sleutel = rsa_sleutel(spki_der, max_bits)?;
    let schema = match hash {
        Hashalg::Sha1 => Pkcs1v15Sign::new::<sha1::Sha1>(),
        Hashalg::Sha256 => Pkcs1v15Sign::new::<sha2::Sha256>(),
        Hashalg::Sha384 => Pkcs1v15Sign::new::<sha2::Sha384>(),
        Hashalg::Sha512 => Pkcs1v15Sign::new::<sha2::Sha512>(),
    };
    sleutel.verify(schema, &hash.hash(delen), handtekening).map_err(|_| WaardeFout::KloptNiet)
}

fn rsa_pss(
    spki_der: &[u8],
    max_bits: usize,
    hash: Hashalg,
    zout: usize,
    delen: &[&[u8]],
    handtekening: &[u8],
) -> Result<(), WaardeFout> {
    use rsa::Pss;
    let sleutel = rsa_sleutel(spki_der, max_bits)?;
    let schema = match hash {
        Hashalg::Sha1 => Pss::new_with_salt::<sha1::Sha1>(zout),
        Hashalg::Sha256 => Pss::new_with_salt::<sha2::Sha256>(zout),
        Hashalg::Sha384 => Pss::new_with_salt::<sha2::Sha384>(zout),
        Hashalg::Sha512 => Pss::new_with_salt::<sha2::Sha512>(zout),
    };
    sleutel.verify(schema, &hash.hash(delen), handtekening).map_err(|_| WaardeFout::KloptNiet)
}

/// Grootste geaccepteerde PSS-zoutlengte in bytes (ruim boven wat een
/// RSA-4096-sleutel toelaat).
const MAX_PSS_ZOUT: usize = 1024;

/// Een niet-negatieve, minimaal gecodeerde INTEGER-inhoud van hoogstens vier bytes.
fn klein_getal(b: &[u8]) -> Option<usize> {
    match b {
        [] => return None,
        [eerste, ..] if eerste & 0x80 != 0 => return None,
        [0x00, tweede, ..] if tweede & 0x80 == 0 => return None,
        _ if b.len() > 4 => return None,
        _ => {}
    }
    Some(b.iter().fold(0usize, |acc, &x| (acc << 8) | usize::from(x)))
}

/// RSASSA-PSS-params (RFC 4055): hash, MGF1-hash en zoutlengte. Alleen MGF1
/// over dezelfde hash en trailerField 1.
fn pss_parameters(params: Option<&[u8]>) -> Result<(Hashalg, usize), WaardeFout> {
    let (mut hash, mut mgf_hash, mut zout) = (Hashalg::Sha1, Hashalg::Sha1, 20usize);
    if let Some(p) = params {
        let (seq, _) = lees_tlv(p)?;
        if seq.tag != 0x30 {
            return Err(niet("RSASSA-PSS-parameters onleesbaar"));
        }
        for veld in kinderen(seq.inhoud)? {
            let (binnen, _) = lees_tlv(veld.inhoud)?;
            match veld.tag {
                0xA0 => {
                    hash = Hashalg::uit_oid(alg_id(&binnen)?.oid).ok_or_else(|| niet("PSS-hash niet ondersteund"))?;
                }
                0xA1 => {
                    let mgf = alg_id(&binnen)?;
                    if mgf.oid != MGF1 {
                        return Err(niet("PSS-maskerfunctie niet ondersteund"));
                    }
                    let hash_param = mgf.parameters.ok_or_else(|| niet("MGF1 zonder hash"))?;
                    let (h, _) = lees_tlv(&hash_param)?;
                    mgf_hash = Hashalg::uit_oid(alg_id(&h)?.oid).ok_or_else(|| niet("MGF1-hash niet ondersteund"))?;
                }
                0xA2 if binnen.tag == 0x02 => {
                    zout = klein_getal(binnen.inhoud).ok_or_else(|| niet("PSS-zoutlengte onleesbaar"))?;
                    if zout > MAX_PSS_ZOUT {
                        return Err(niet(format!("PSS-zoutlengte {zout} groter dan {MAX_PSS_ZOUT}")));
                    }
                }
                0xA3 if binnen.tag == 0x02 && binnen.inhoud == [1u8] => {}
                _ => return Err(niet("RSASSA-PSS-parameters onleesbaar")),
            }
        }
    }
    if hash != mgf_hash {
        return Err(niet("PSS met MGF1 over een andere hash"));
    }
    Ok((hash, zout))
}

fn ecdsa(spki_der: &[u8], hash: Hashalg, delen: &[&[u8]], handtekening: &[u8]) -> Result<(), WaardeFout> {
    use p256::ecdsa::signature::hazmat::PrehashVerifier;
    let (alg, punt) = spki_delen(spki_der)?;
    if alg.oid != EC_PUBLIC_KEY {
        return Err(niet("sleutel is geen EC-sleutel"));
    }
    let curve_der = alg.parameters.ok_or_else(|| niet("EC-sleutel zonder curve"))?;
    let (curve_tlv, _) = lees_tlv(&curve_der)?;
    let curve = oid_uit(&curve_tlv)?;
    let digest = hash.hash(delen);
    if curve == P256 {
        let sleutel = p256::ecdsa::VerifyingKey::from_sec1_bytes(&punt).map_err(|_| niet("P-256-sleutel onleesbaar"))?;
        let waarde = p256::ecdsa::Signature::from_der(handtekening).map_err(|_| niet("ECDSA-handtekeningwaarde onleesbaar"))?;
        sleutel.verify_prehash(&digest, &waarde).map_err(|_| WaardeFout::KloptNiet)
    } else if curve == P384 {
        if hash == Hashalg::Sha1 {
            return Err(niet("SHA-1 is te kort voor P-384"));
        }
        let sleutel = p384::ecdsa::VerifyingKey::from_sec1_bytes(&punt).map_err(|_| niet("P-384-sleutel onleesbaar"))?;
        let waarde = p384::ecdsa::Signature::from_der(handtekening).map_err(|_| niet("ECDSA-handtekeningwaarde onleesbaar"))?;
        sleutel.verify_prehash(&digest, &waarde).map_err(|_| WaardeFout::KloptNiet)
    } else {
        Err(niet(format!("curve {curve}")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::handtekening::cms_lees::{lees_certificaat, lees_signed_data, zoek_ondertekenaar, Certificaat, SignedData};
    use std::path::PathBuf;

    fn fixture(naam: &str) -> Vec<u8> {
        std::fs::read(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/verifieer").join(naam)).unwrap()
    }

    fn hex(s: &str) -> Vec<u8> {
        (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap()).collect()
    }

    fn ondertekenaar(naam: &str) -> (SignedData, Certificaat) {
        let sd = lees_signed_data(&fixture(naam)).unwrap();
        let certificaten: Vec<Certificaat> = sd.certificaten.iter().filter_map(|c| lees_certificaat(c)).collect();
        let cert = zoek_ondertekenaar(&certificaten, &sd.ondertekenaars[0].sid).unwrap().clone();
        (sd, cert)
    }

    #[test]
    fn hash_over_delen_is_hash_over_het_geheel() {
        let data = fixture("data.bin");
        for alg in [Hashalg::Sha1, Hashalg::Sha256, Hashalg::Sha384, Hashalg::Sha512] {
            assert_eq!(alg.hash(&[&data[..10], &data[10..]]), alg.hash(&[data.as_slice()]));
        }
        assert_eq!(&Hashalg::Sha256.hash(&[b"abc".as_slice()])[..4], &[0xba, 0x78, 0x16, 0xbf]);
        assert_eq!(&Hashalg::Sha1.hash(&[b"abc".as_slice()])[..4], &[0xa9, 0x99, 0x3e, 0x36]);
        assert_eq!(Hashalg::Sha384.hash(&[b"abc".as_slice()]).len(), 48);
        assert_eq!(Hashalg::Sha512.hash(&[b"abc".as_slice()]).len(), 64);
    }

    #[test]
    fn hashalgoritme_uit_oid() {
        assert_eq!(Hashalg::uit_oid(ObjectIdentifier::new_unwrap("1.3.14.3.2.26")), Some(Hashalg::Sha1));
        assert_eq!(Hashalg::uit_oid(ObjectIdentifier::new_unwrap("2.16.840.1.101.3.4.2.1")), Some(Hashalg::Sha256));
        assert_eq!(Hashalg::uit_oid(ObjectIdentifier::new_unwrap("2.16.840.1.101.3.4.2.2")), Some(Hashalg::Sha384));
        assert_eq!(Hashalg::uit_oid(ObjectIdentifier::new_unwrap("2.16.840.1.101.3.4.2.3")), Some(Hashalg::Sha512));
        assert_eq!(Hashalg::uit_oid(ObjectIdentifier::new_unwrap("1.2.840.113549.2.5")), None);
    }

    #[test]
    fn rsa_pkcs1_klopt_en_klopt_niet() {
        let (sd, cert) = ondertekenaar("cms-rsa-sha256.der");
        let o = &sd.ondertekenaars[0];
        let attrs = o.ondertekende_attributen_der.as_ref().unwrap().as_slice();
        let controleer = |hash, waarde: &[u8]| {
            controleer_handtekening(&cert.spki_der, &o.handtekeningalgoritme, Some(hash), &[attrs], waarde)
        };
        assert_eq!(controleer(Hashalg::Sha256, &o.handtekening), Ok(()));
        assert_eq!(controleer(Hashalg::Sha512, &o.handtekening), Err(WaardeFout::KloptNiet));
        let mut kapot = o.handtekening.clone();
        let laatste = kapot.len() - 1;
        kapot[laatste] ^= 1;
        assert_eq!(controleer(Hashalg::Sha256, &kapot), Err(WaardeFout::KloptNiet));
    }

    #[test]
    fn rsa_pss_klopt() {
        let (sd, cert) = ondertekenaar("cms-rsa-pss.der");
        let o = &sd.ondertekenaars[0];
        let attrs = o.ondertekende_attributen_der.as_ref().unwrap().as_slice();
        assert_eq!(
            controleer_handtekening(&cert.spki_der, &o.handtekeningalgoritme, Some(Hashalg::Sha256), &[attrs], &o.handtekening),
            Ok(())
        );
        let zonder_parameters = AlgId { oid: o.handtekeningalgoritme.oid, parameters: None };
        assert_eq!(
            controleer_handtekening(&cert.spki_der, &zonder_parameters, None, &[attrs], &o.handtekening),
            Err(WaardeFout::KloptNiet)
        );
    }

    #[test]
    fn ecdsa_p256_met_sha384_klopt_en_klopt_niet() {
        let (sd, cert) = ondertekenaar("cms-ec-p256-sha384.der");
        let o = &sd.ondertekenaars[0];
        let attrs = o.ondertekende_attributen_der.as_ref().unwrap().as_slice();
        assert_eq!(
            controleer_handtekening(&cert.spki_der, &o.handtekeningalgoritme, Some(Hashalg::Sha384), &[attrs], &o.handtekening),
            Ok(())
        );
        let mut kapot = o.handtekening.clone();
        let laatste = kapot.len() - 1;
        kapot[laatste] ^= 1;
        assert_eq!(
            controleer_handtekening(&cert.spki_der, &o.handtekeningalgoritme, Some(Hashalg::Sha384), &[attrs], &kapot),
            Err(WaardeFout::KloptNiet)
        );
    }

    #[test]
    fn certificaathandtekeningen_rsa_en_ecdsa() {
        let paren = [("blad.der", "tussen.der"), ("tussen.der", "root.der"), ("blad-onder-ec-root.der", "ec-root.der")];
        for (kind, ouder) in paren {
            let kind = lees_certificaat(&fixture(kind)).unwrap();
            let ouder = lees_certificaat(&fixture(ouder)).unwrap();
            assert_eq!(
                controleer_handtekening(&ouder.spki_der, &kind.handtekeningalgoritme, None, &[kind.tbs_der.as_slice()], &kind.handtekening),
                Ok(())
            );
        }
        let blad = lees_certificaat(&fixture("blad.der")).unwrap();
        let root = lees_certificaat(&fixture("root.der")).unwrap();
        assert_eq!(
            controleer_handtekening(&root.spki_der, &blad.handtekeningalgoritme, None, &[blad.tbs_der.as_slice()], &blad.handtekening),
            Err(WaardeFout::KloptNiet)
        );
    }

    #[test]
    fn onbekend_algoritme_en_verkeerd_sleuteltype_zijn_niet_ondersteund() {
        let blad = lees_certificaat(&fixture("blad.der")).unwrap();
        let ec = lees_certificaat(&fixture("ec.der")).unwrap();
        let data: &[&[u8]] = &[b"x".as_slice()];
        let alg = |oid: &str| AlgId { oid: ObjectIdentifier::new_unwrap(oid), parameters: None };
        let niet = |r: Result<(), WaardeFout>| matches!(r, Err(WaardeFout::NietOndersteund(_)));
        // De curve-OID als handtekeningalgoritme, zoals in het corpus.
        assert!(niet(controleer_handtekening(&blad.spki_der, &alg("1.2.840.10045.3.1.7"), Some(Hashalg::Sha256), data, &[0; 256])));
        assert!(niet(controleer_handtekening(&blad.spki_der, &alg("1.2.840.10045.4.3.2"), None, data, &[0; 64])));
        assert!(niet(controleer_handtekening(&ec.spki_der, &alg("1.2.840.113549.1.1.11"), None, data, &[0; 64])));
        assert!(niet(controleer_handtekening(&blad.spki_der, &alg("1.2.840.113549.1.1.1"), None, data, &[0; 256])));
        assert!(niet(controleer_handtekening(b"rommel", &alg("1.2.840.113549.1.1.11"), None, data, &[0; 256])));
    }

    #[test]
    fn pss_parameters_varianten() {
        assert_eq!(pss_parameters(None), Ok((Hashalg::Sha1, 20)));
        let sha256 = hex("3034a00f300d06096086480165030402010500a11c301a06092a864886f70d010108300d06096086480165030402010500a203020120");
        assert_eq!(pss_parameters(Some(&sha256)), Ok((Hashalg::Sha256, 32)));
        let mgf_sha1 = hex("3030a00f300d06096086480165030402010500a118301606092a864886f70d010108300906052b0e03021a0500a203020120");
        assert!(matches!(pss_parameters(Some(&mgf_sha1)), Err(WaardeFout::NietOndersteund(_))));
        assert!(matches!(pss_parameters(Some(b"rommel")), Err(WaardeFout::NietOndersteund(_))));
    }

    fn pss_met_zout(zout_tlv: &[u8]) -> Vec<u8> {
        let mut inhoud = hex("a00f300d06096086480165030402010500a11c301a06092a864886f70d010108300d06096086480165030402010500");
        inhoud.push(0xA2);
        inhoud.push(zout_tlv.len() as u8);
        inhoud.extend_from_slice(zout_tlv);
        let mut uit = vec![0x30, inhoud.len() as u8];
        uit.extend(inhoud);
        uit
    }

    #[test]
    fn pss_zoutlengte_begrensd_en_integer_strikt() {
        assert_eq!(pss_parameters(Some(&pss_met_zout(&[0x02, 0x01, 0x20]))), Ok((Hashalg::Sha256, 32)));
        assert_eq!(pss_parameters(Some(&pss_met_zout(&[0x02, 0x01, 0x00]))), Ok((Hashalg::Sha256, 0)));
        assert_eq!(pss_parameters(Some(&pss_met_zout(&[0x02, 0x02, 0x04, 0x00]))), Ok((Hashalg::Sha256, 1024)));
        let niet = |zout: &[u8]| matches!(pss_parameters(Some(&pss_met_zout(zout))), Err(WaardeFout::NietOndersteund(_)));
        assert!(niet(&[0x02, 0x02, 0x04, 0x01]), "1025 bytes zout");
        assert!(niet(&[0x02, 0x04, 0x7F, 0xFF, 0xFF, 0xFF]), "absurd groot zout");
        assert!(niet(&[0x02, 0x01, 0x80]), "negatief");
        assert!(niet(&[0x02, 0x02, 0xFF, 0xE0]), "negatief, twee bytes");
        assert!(niet(&[0x02, 0x02, 0x00, 0x20]), "niet-minimaal");
        assert!(niet(&[0x02, 0x00]), "lege INTEGER");
        assert!(niet(&[0x04, 0x01, 0x20]), "geen INTEGER");
    }

    #[test]
    fn rsa_sleutel_kleiner_dan_1024_bits_niet_ondersteund() {
        use rsa::pkcs8::EncodePublicKey;
        let mut modulus = vec![0xC5u8; 64];
        modulus[63] = 0xC7;
        let n = rsa::BigUint::from_bytes_be(&modulus);
        let sleutel = rsa::RsaPublicKey::new(n, rsa::BigUint::from(65_537u32)).unwrap();
        let spki = sleutel.to_public_key_der().unwrap();
        let alg = AlgId { oid: SHA256_RSA, parameters: None };
        let data: &[&[u8]] = &[b"x".as_slice()];
        let uitkomst = controleer_handtekening(spki.as_bytes(), &alg, None, data, &[1; 64]);
        assert!(matches!(&uitkomst, Err(WaardeFout::NietOndersteund(d)) if d.contains("512")), "{uitkomst:?}");
        let pss = AlgId { oid: RSASSA_PSS, parameters: None };
        assert!(matches!(controleer_handtekening(spki.as_bytes(), &pss, None, data, &[1; 64]), Err(WaardeFout::NietOndersteund(_))));
    }

    #[test]
    fn hash_van_het_algoritme_moet_bij_het_digestalgoritme_passen() {
        let (sd, cert) = ondertekenaar("cms-rsa-sha256.der");
        let o = &sd.ondertekenaars[0];
        let attrs = o.ondertekende_attributen_der.as_ref().unwrap().as_slice();
        let sha256_rsa = AlgId { oid: SHA256_RSA, parameters: None };
        // sha256WithRSAEncryption geeft dezelfde PKCS#1-waarde als rsaEncryption + SHA-256.
        assert_eq!(controleer_handtekening(&cert.spki_der, &sha256_rsa, Some(Hashalg::Sha256), &[attrs], &o.handtekening), Ok(()));
        assert_eq!(controleer_handtekening(&cert.spki_der, &sha256_rsa, None, &[attrs], &o.handtekening), Ok(()));
        assert!(matches!(
            controleer_handtekening(&cert.spki_der, &sha256_rsa, Some(Hashalg::Sha512), &[attrs], &o.handtekening),
            Err(WaardeFout::NietOndersteund(_))
        ));

        let (sd, cert) = ondertekenaar("cms-ec-p256-sha384.der");
        let o = &sd.ondertekenaars[0];
        assert_eq!(o.handtekeningalgoritme.oid, ECDSA_SHA384);
        let attrs = o.ondertekende_attributen_der.as_ref().unwrap().as_slice();
        assert!(matches!(
            controleer_handtekening(&cert.spki_der, &o.handtekeningalgoritme, Some(Hashalg::Sha256), &[attrs], &o.handtekening),
            Err(WaardeFout::NietOndersteund(_))
        ));
    }

    #[test]
    fn onleesbare_ecdsa_waarde_is_niet_ondersteund() {
        let (sd, cert) = ondertekenaar("cms-ec-p256-sha384.der");
        let o = &sd.ondertekenaars[0];
        let attrs = o.ondertekende_attributen_der.as_ref().unwrap().as_slice();
        let rommels: [&[u8]; 3] = [b"rommel", &[], &[0x30, 0x02, 0x02, 0x00]];
        for rommel in rommels {
            assert!(
                matches!(
                    controleer_handtekening(&cert.spki_der, &o.handtekeningalgoritme, Some(Hashalg::Sha384), &[attrs], rommel),
                    Err(WaardeFout::NietOndersteund(_))
                ),
                "{rommel:?}"
            );
        }
        let ec_root = lees_certificaat(&fixture("ec-root.der")).unwrap();
        let alg = AlgId { oid: ECDSA_SHA384, parameters: None };
        assert!(matches!(
            controleer_handtekening(&ec_root.spki_der, &alg, None, &[attrs], b"rommel"),
            Err(WaardeFout::NietOndersteund(_))
        ));
    }

    #[test]
    fn sha1_is_zwak() {
        assert!(Hashalg::Sha1.is_zwak());
        for h in [Hashalg::Sha256, Hashalg::Sha384, Hashalg::Sha512] {
            assert!(!h.is_zwak());
        }
        let alg = |oid| AlgId { oid, parameters: None };
        assert_eq!(gebruikte_hash(&alg(SHA1_RSA), None), Some(Hashalg::Sha1));
        assert_eq!(gebruikte_hash(&alg(ECDSA_SHA1), None), Some(Hashalg::Sha1));
        assert_eq!(gebruikte_hash(&alg(RSA_ENCRYPTION), Some(Hashalg::Sha1)), Some(Hashalg::Sha1));
        assert_eq!(gebruikte_hash(&alg(RSA_ENCRYPTION), None), None);
        assert_eq!(gebruikte_hash(&alg(SHA256_RSA), Some(Hashalg::Sha256)), Some(Hashalg::Sha256));
        let (sd, _) = ondertekenaar("cms-rsa-pss.der");
        assert_eq!(gebruikte_hash(&sd.ondertekenaars[0].handtekeningalgoritme, None), Some(Hashalg::Sha256));
        assert_eq!(gebruikte_hash(&alg(P256), Some(Hashalg::Sha256)), None);
    }
    #[test]
    fn pss_hash_moet_bij_het_digestalgoritme_passen() {
        let (sd, cert) = ondertekenaar("cms-rsa-pss.der");
        let o = &sd.ondertekenaars[0];
        let attrs = o.ondertekende_attributen_der.as_ref().unwrap().as_slice();
        assert!(matches!(
            controleer_handtekening(&cert.spki_der, &o.handtekeningalgoritme, Some(Hashalg::Sha384), &[attrs], &o.handtekening),
            Err(WaardeFout::NietOndersteund(_))
        ));
        assert_eq!(controleer_handtekening(&cert.spki_der, &o.handtekeningalgoritme, None, &[attrs], &o.handtekening), Ok(()));
    }

    #[test]
    fn pkcs1_digest_uit_de_handtekeningwaarde() {
        let data = fixture("data.bin");
        let (sd, cert) = ondertekenaar("cms-zonder-attributen.der");
        let o = &sd.ondertekenaars[0];
        assert_eq!(o.handtekeningalgoritme.oid, RSA_ENCRYPTION);
        let terug = |alg: &AlgId, hash, waarde: &[u8]| pkcs1_digest(&cert.spki_der, alg, hash, waarde);
        let verwacht = Hashalg::Sha256.hash(&[data.as_slice()]);
        assert_eq!(terug(&o.handtekeningalgoritme, Some(Hashalg::Sha256), &o.handtekening), Ok(Some(verwacht.clone())));
        let sha256_rsa = AlgId { oid: SHA256_RSA, parameters: None };
        assert_eq!(terug(&sha256_rsa, None, &o.handtekening), Ok(Some(verwacht)));
        // DigestInfo met SHA-256, terwijl SHA-512 verwacht wordt: geen bruikbare digest.
        assert_eq!(terug(&o.handtekeningalgoritme, Some(Hashalg::Sha512), &o.handtekening), Ok(None));
        let mut kapot = o.handtekening.clone();
        let laatste = kapot.len() - 1;
        kapot[laatste] ^= 1;
        assert_eq!(terug(&o.handtekeningalgoritme, Some(Hashalg::Sha256), &kapot), Ok(None));
        assert_eq!(terug(&o.handtekeningalgoritme, Some(Hashalg::Sha256), &o.handtekening[1..]), Ok(None));
        assert_eq!(terug(&o.handtekeningalgoritme, Some(Hashalg::Sha256), &[0xFF; 256]), Ok(None));
        let pss = AlgId { oid: RSASSA_PSS, parameters: None };
        assert!(matches!(terug(&pss, Some(Hashalg::Sha256), &o.handtekening), Err(WaardeFout::NietOndersteund(_))));
        assert!(matches!(terug(&o.handtekeningalgoritme, None, &o.handtekening), Err(WaardeFout::NietOndersteund(_))));
    }

    #[test]
    fn rsa_8192_alleen_voor_certificaathandtekeningen() {
        let root = lees_certificaat(&fixture("root-rsa8192.der")).unwrap();
        let blad = lees_certificaat(&fixture("blad-onder-rsa8192.der")).unwrap();
        let tbs = [blad.tbs_der.as_slice()];
        assert_eq!(
            controleer_certificaathandtekening(&root.spki_der, &blad.handtekeningalgoritme, &tbs, &blad.handtekening),
            Ok(())
        );
        let mut beschadigd = blad.handtekening.clone();
        beschadigd[0] ^= 1;
        assert_eq!(
            controleer_certificaathandtekening(&root.spki_der, &blad.handtekeningalgoritme, &tbs, &beschadigd),
            Err(WaardeFout::KloptNiet)
        );
        // Voor handtekeningen in een document blijft de grens 4096 bits.
        assert!(matches!(
            controleer_handtekening(&root.spki_der, &blad.handtekeningalgoritme, None, &tbs, &blad.handtekening),
            Err(WaardeFout::NietOndersteund(_))
        ));
    }
}
