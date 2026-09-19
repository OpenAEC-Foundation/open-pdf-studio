//! Een .p12/.pfx openen: MAC controleren, ontsleutelen, sleutel en certificaten eruit.
//!
//! Bestaande crates schieten tekort (spec §5.1): RustCrypto `pkcs12` 0.1 levert
//! typen en de sleutelafleiding maar ontsleutelt niet. PBES2 ontsleutelt `pkcs5`;
//! de oude PKCS#12-PBE (3DES, RC2-40) en de MAC doen we hier zelf.
//!
//! De module heet zelf `pkcs12`; paden naar de crate staan daarom als `::pkcs12::`.
//!
//! Wissen van sleutelmateriaal: wachtwoordbytes, afgeleide sleutels en IV's,
//! ontsleutelde SafeContents en de PKCS#8-sleutel zitten in `Zeroizing`; de
//! blokcijfers wissen hun sleutelschema (feature `zeroize`); de per-bag kopie
//! (`SafeBag::bag_value`) wordt na verwerking gewist. Niet gewist: tussenbuffers
//! binnen `pkcs5` (PBKDF2-sleutel) en de `pkcs12`-sleutelafleiding. Staat een
//! privésleutel in een onversleutelde KeyBag, dan blijven bovendien kopieën van
//! die klare sleutel achter die we niet wissen: de invoerbytes zelf, de
//! `Pfx`-decodering (`auth_safe.content` als `Any` plus de DER- en
//! `OctetString`-kopie daarvan) en per `AuthenticatedSafe`-deel opnieuw de
//! `Any`-, DER- en `OctetString`-kopie vóór het decoderen van de bags.

use cbc::cipher::{block_padding::Pkcs7, BlockDecryptMut, InnerIvInit, KeyIvInit};
use cms::encrypted_data::EncryptedData;
use const_oid::db::rfc5911::{ID_DATA, ID_ENCRYPTED_DATA};
use const_oid::db::rfc5912::{ID_EC_PUBLIC_KEY, ID_SHA_1, ID_SHA_256, RSA_ENCRYPTION};
use const_oid::ObjectIdentifier;
use der::asn1::{BmpString, ContextSpecific, OctetString};
use der::{Decode, Encode, Reader};
use hmac::{Hmac, Mac};
use rsa::pkcs8::PrivateKeyInfo;
use spki::AlgorithmIdentifierOwned;
use zeroize::{Zeroize, Zeroizing};

use ::pkcs12::authenticated_safe::AuthenticatedSafe;
use ::pkcs12::cert_type::CertBag;
use ::pkcs12::kdf::{derive_key, Pkcs12KeyType};
use ::pkcs12::mac_data::MacData;
use ::pkcs12::pbe_params::{EncryptedPrivateKeyInfo, Pkcs12PbeParams};
use ::pkcs12::pfx::Pfx;
use ::pkcs12::safe_bag::{SafeBag, SafeContents};

const PBES2: ObjectIdentifier = ObjectIdentifier::new_unwrap("1.2.840.113549.1.5.13");
const PBE_SHA1_3DES: ObjectIdentifier = ObjectIdentifier::new_unwrap("1.2.840.113549.1.12.1.3");
const PBE_SHA1_RC2_40: ObjectIdentifier = ObjectIdentifier::new_unwrap("1.2.840.113549.1.12.1.6");
const LOCAL_KEY_ID: ObjectIdentifier = ObjectIdentifier::new_unwrap("1.2.840.113549.1.9.21");
const FRIENDLY_NAME: ObjectIdentifier = ObjectIdentifier::new_unwrap("1.2.840.113549.1.9.20");

/// Bovengrens voor iteratiegetallen (MAC, PKCS#12-PBE, PBKDF2). Gangbare
/// bestanden zitten rond 2000 tot 600 000; een hoger getal is een bestand dat
/// de app bewust of per ongeluk minutenlang laat rekenen.
const MAX_ITERATIES: u32 = 10_000_000;

/// Bovengrens voor de som van alle iteraties over alle sleutelafleidingen in één
/// `lees`-aanroep (MAC, PBE-sleutel en -IV, PBKDF2-blokken, ook herhaalde
/// pogingen per wachtwoordvorm). Houdt een bestand met veel versleutelde delen
/// die elk net onder `MAX_ITERATIES` blijven toch binnen seconden.
const MAX_ITERATIES_TOTAAL: u64 = 20_000_000;

/// `ECPrivateKey` (RFC 5915), alleen om de optionele publieke sleutel te lezen.
#[derive(der::Sequence)]
struct EcPrivateKey<'a> {
    version: u8,
    private_key: der::asn1::OctetStringRef<'a>,
    #[asn1(context_specific = "0", tag_mode = "EXPLICIT", optional = "true")]
    parameters: Option<der::asn1::AnyRef<'a>>,
    #[asn1(context_specific = "1", tag_mode = "EXPLICIT", optional = "true")]
    public_key: Option<der::asn1::BitStringRef<'a>>,
}

/// Waarom een .p12 niet te openen is.
#[derive(Debug)]
pub enum Pkcs12Fout {
    /// De MAC klopt niet, of (zonder MAC) ontsleutelen levert geen geldige opvulling of structuur op.
    VerkeerdWachtwoord,
    /// Niet ondersteund: een versleuteling, MAC, sleutelafleiding of inhoudstype
    /// (OID of naam), of een structuur buiten onze grenzen, zoals meerdere
    /// privésleutels of een te hoog iteratiegetal (per afleiding of in totaal).
    AlgoritmeNietOndersteund(String),
    /// Geen geldige PKCS#12-structuur.
    Onleesbaar(String),
}

impl std::fmt::Display for Pkcs12Fout {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Pkcs12Fout::VerkeerdWachtwoord => write!(f, "verkeerd wachtwoord"),
            Pkcs12Fout::AlgoritmeNietOndersteund(a) => write!(f, "niet-ondersteund algoritme: {a}"),
            Pkcs12Fout::Onleesbaar(d) => write!(f, "onleesbaar PKCS#12-bestand: {d}"),
        }
    }
}

// Bewust géén impl van std::error::Error: dan zou deze algemene From botsen met
// `impl<T> From<T> for T`. Zo kan `?` elke decodeer- of ontsleutelfout omzetten.
impl<E: std::error::Error> From<E> for Pkcs12Fout {
    fn from(e: E) -> Self {
        Pkcs12Fout::Onleesbaar(e.to_string())
    }
}

/// Met welke wachtwoordvorm het bestand geopend is. Met een MAC is dat de vorm
/// die de MAC bevestigde. Zonder MAC is het de eerste vorm waarmee alle
/// versleutelde delen ontsleutelen en decoderen; bevat zo'n bestand niets
/// versleutelds, dan is het simpelweg de eerste vorm en zegt het niets.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Wachtwoordvorm {
    Gewoon,
    /// Leeg wachtwoord: BMP-string met alleen de afsluitende `00 00`.
    Leeg,
    /// Geen wachtwoord: lege bytes, zonder afsluiter.
    Afwezig,
}

pub struct Certificaat {
    /// Het X.509-certificaat in DER.
    pub der: Vec<u8>,
    pub local_key_id: Option<Vec<u8>>,
    /// Vriendelijke naam uit het bestand (kan Unicode bevatten).
    pub naam: Option<String>,
}

/// Inhoud van een geopend .p12. Geen `Debug`: de privésleutel mag nooit in een log belanden.
pub struct Pkcs12Inhoud {
    /// Privésleutel als PKCS#8 (DER); gewist uit het geheugen zodra dit vrijkomt.
    pub sleutel_pkcs8: Option<Zeroizing<Vec<u8>>>,
    pub sleutel_local_key_id: Option<Vec<u8>>,
    pub certificaten: Vec<Certificaat>,
    pub wachtwoordvorm: Wachtwoordvorm,
}

/// PKCS#12 onderscheidt een leeg wachtwoord (BMP `00 00`) van géén wachtwoord.
///
/// De "BMP"-vorm is UTF-16BE met afsluiter; tekens buiten het BMP worden, net
/// als bij OpenSSL, een surrogaatpaar. Zo levert zo'n wachtwoord nooit een
/// leesfout op: het past of het is een verkeerd wachtwoord.
fn wachtwoordvormen(wachtwoord: &str) -> Vec<(Wachtwoordvorm, Zeroizing<Vec<u8>>)> {
    // Elke UTF-16-eenheid komt uit minstens één UTF-8-byte: geen herallocatie.
    let mut bmp = Zeroizing::new(Vec::with_capacity(2 * wachtwoord.len() + 2));
    for eenheid in wachtwoord.encode_utf16() {
        bmp.extend_from_slice(&eenheid.to_be_bytes());
    }
    bmp.extend_from_slice(&[0, 0]);
    if wachtwoord.is_empty() {
        vec![(Wachtwoordvorm::Leeg, bmp), (Wachtwoordvorm::Afwezig, Zeroizing::new(Vec::new()))]
    } else {
        vec![(Wachtwoordvorm::Gewoon, bmp)]
    }
}

fn controleer_iteraties(n: i64) -> Result<(), Pkcs12Fout> {
    if n <= 0 || n > i64::from(MAX_ITERATIES) {
        return Err(Pkcs12Fout::AlgoritmeNietOndersteund(format!("iteratiegetal {n}")));
    }
    Ok(())
}

/// Telt de iteraties van alle sleutelafleidingen binnen één `lees`-aanroep.
struct Rekenbudget {
    gebruikt: u64,
}

impl Rekenbudget {
    fn nieuw() -> Self {
        Rekenbudget { gebruikt: 0 }
    }

    /// Boekt `afleidingen` keer `iteraties`, vóórdat er gerekend wordt.
    fn boek(&mut self, iteraties: i64, afleidingen: u64) -> Result<(), Pkcs12Fout> {
        controleer_iteraties(iteraties)?;
        let totaal = self.gebruikt.saturating_add(iteraties.unsigned_abs().saturating_mul(afleidingen));
        if totaal > MAX_ITERATIES_TOTAAL {
            return Err(Pkcs12Fout::AlgoritmeNietOndersteund(format!("iteratiegetal totaal {totaal}")));
        }
        self.gebruikt = totaal;
        Ok(())
    }
}

/// Aantal PBKDF2-blokken (elk een volle ronde iteraties) voor de sleutel van dit schema.
fn pbkdf2_blokken(params: &pkcs5::pbes2::Parameters<'_>, p: &pkcs5::pbes2::Pbkdf2Params<'_>) -> u64 {
    use pkcs5::pbes2::Pbkdf2Prf;
    let uitvoer: usize = match p.prf {
        Pbkdf2Prf::HmacWithSha1 => 20,
        Pbkdf2Prf::HmacWithSha224 => 28,
        Pbkdf2Prf::HmacWithSha256 => 32,
        Pbkdf2Prf::HmacWithSha384 => 48,
        Pbkdf2Prf::HmacWithSha512 => 64,
        #[allow(unreachable_patterns)]
        _ => 20,
    };
    let sleutel = p.key_length.map(usize::from).unwrap_or_else(|| params.encryption.key_size());
    sleutel.div_ceil(uitvoer).max(1) as u64
}

/// Boekt de afleidingen die ontsleutelen met `alg` kost. Onleesbare parameters
/// boeken niets: `ontsleutel` meldt die fout zelf.
fn boek_ontsleuteling(alg: &AlgorithmIdentifierOwned, budget: &mut Rekenbudget) -> Result<(), Pkcs12Fout> {
    let Some(params_der) = alg.parameters.as_ref().and_then(|p| p.to_der().ok()) else { return Ok(()) };
    if alg.oid == PBES2 {
        if let Ok(params) = pkcs5::pbes2::Parameters::from_der(&params_der) {
            if let pkcs5::pbes2::Kdf::Pbkdf2(p) = &params.kdf {
                budget.boek(p.iteration_count.into(), pbkdf2_blokken(&params, p))?;
            }
        }
    } else if alg.oid == PBE_SHA1_3DES || alg.oid == PBE_SHA1_RC2_40 {
        if let Ok(p) = Pkcs12PbeParams::from_der(&params_der) {
            // Sleutel en IV zijn twee afzonderlijke afleidingen.
            budget.boek(p.iterations.into(), 2)?;
        }
    }
    Ok(())
}

/// Raming vóór er iets gerekend wordt: MAC plus alle versleutelde delen die zonder
/// ontsleutelen zichtbaar zijn. Een ondergrens van het echte werk, dus weigeren op
/// deze raming weigert nooit een bestand dat binnen het budget zou blijven.
fn raam_rekenwerk(inhoud: &[u8], mac: Option<&MacData>) -> Result<(), Pkcs12Fout> {
    let mut raming = Rekenbudget::nieuw();
    if let Some(md) = mac {
        raming.boek(md.iterations.into(), 1)?;
    }
    let Ok(delen) = AuthenticatedSafe::from_der(inhoud) else { return Ok(()) };
    for ci in delen {
        let Ok(ci_der) = ci.content.to_der() else { continue };
        if ci.content_type == ID_ENCRYPTED_DATA {
            if let Ok(ed) = EncryptedData::from_der(&ci_der) {
                boek_ontsleuteling(&ed.enc_content_info.content_enc_alg, &mut raming)?;
            }
        } else if ci.content_type == ID_DATA {
            let Ok(os) = OctetString::from_der(&ci_der) else { continue };
            let Ok(mut bags) = SafeContents::from_der(os.as_bytes()) else { continue };
            let mut uitkomst = Ok(());
            for bag in &bags {
                if bag.bag_id != ::pkcs12::PKCS_12_PKCS8_KEY_BAG_OID {
                    continue;
                }
                if let Ok(cs) = ContextSpecific::<EncryptedPrivateKeyInfo>::from_der(&bag.bag_value) {
                    uitkomst = boek_ontsleuteling(&cs.value.encryption_algorithm, &mut raming);
                    if uitkomst.is_err() {
                        break;
                    }
                }
            }
            for bag in bags.iter_mut() {
                bag.bag_value.zeroize();
            }
            uitkomst?;
        }
    }
    Ok(())
}

fn mac_klopt(md: &MacData, inhoud: &[u8], pass: &[u8], budget: &mut Rekenbudget) -> Result<bool, Pkcs12Fout> {
    budget.boek(md.iterations.into(), 1)?;
    let salt = md.mac_salt.as_bytes();
    let verwacht = md.mac.digest.as_bytes();
    let alg = md.mac.algorithm.oid;
    if alg == ID_SHA_1 {
        let sleutel = Zeroizing::new(derive_key::<sha1::Sha1>(pass, salt, Pkcs12KeyType::Mac, md.iterations, 20));
        let mut m = Hmac::<sha1::Sha1>::new_from_slice(&sleutel)
            .map_err(|e| Pkcs12Fout::Onleesbaar(e.to_string()))?;
        m.update(inhoud);
        Ok(m.verify_slice(verwacht).is_ok())
    } else if alg == ID_SHA_256 {
        let sleutel = Zeroizing::new(derive_key::<sha2::Sha256>(pass, salt, Pkcs12KeyType::Mac, md.iterations, 32));
        let mut m = Hmac::<sha2::Sha256>::new_from_slice(&sleutel)
            .map_err(|e| Pkcs12Fout::Onleesbaar(e.to_string()))?;
        m.update(inhoud);
        Ok(m.verify_slice(verwacht).is_ok())
    } else {
        Err(Pkcs12Fout::AlgoritmeNietOndersteund(format!("MAC {alg}")))
    }
}

/// Ontsleutelt met PBES2 (wachtwoord als UTF-8) of PKCS#12-PBE (wachtwoord als BMP).
fn ontsleutel(
    alg: &AlgorithmIdentifierOwned,
    data: &[u8],
    bmp: &[u8],
    utf8: &str,
    budget: &mut Rekenbudget,
) -> Result<Zeroizing<Vec<u8>>, Pkcs12Fout> {
    let params_der = alg
        .parameters
        .as_ref()
        .ok_or_else(|| Pkcs12Fout::Onleesbaar("versleutelingsparameters ontbreken".into()))?
        .to_der()?;
    if alg.oid == PBES2 {
        let params = pkcs5::pbes2::Parameters::from_der(&params_der)?;
        match &params.kdf {
            pkcs5::pbes2::Kdf::Pbkdf2(p) => budget.boek(p.iteration_count.into(), pbkdf2_blokken(&params, p))?,
            pkcs5::pbes2::Kdf::Scrypt(_) => return Err(Pkcs12Fout::AlgoritmeNietOndersteund("scrypt".into())),
            _ => return Err(Pkcs12Fout::AlgoritmeNietOndersteund("PBES2-sleutelafleiding".into())),
        }
        let schema = pkcs5::EncryptionScheme::from(params);
        let mut buf = Zeroizing::new(data.to_vec());
        let lengte = match schema.decrypt_in_place(utf8, &mut buf) {
            Ok(klaar) => klaar.len(),
            Err(pkcs5::Error::DecryptFailed) => return Err(Pkcs12Fout::VerkeerdWachtwoord),
            Err(e) => return Err(Pkcs12Fout::AlgoritmeNietOndersteund(e.to_string())),
        };
        buf.truncate(lengte);
        return Ok(buf);
    }
    let p = Pkcs12PbeParams::from_der(&params_der)?;
    let salt = p.salt.as_bytes();
    if alg.oid == PBE_SHA1_3DES {
        budget.boek(p.iterations.into(), 2)?;
        let sleutel = Zeroizing::new(derive_key::<sha1::Sha1>(bmp, salt, Pkcs12KeyType::EncryptionKey, p.iterations, 24));
        let iv = Zeroizing::new(derive_key::<sha1::Sha1>(bmp, salt, Pkcs12KeyType::Iv, p.iterations, 8));
        let dec = cbc::Decryptor::<des::TdesEde3>::new_from_slices(&sleutel, &iv)
            .map_err(|e| Pkcs12Fout::Onleesbaar(e.to_string()))?;
        return dec
            .decrypt_padded_vec_mut::<Pkcs7>(data)
            .map(Zeroizing::new)
            .map_err(|_| Pkcs12Fout::VerkeerdWachtwoord);
    }
    if alg.oid == PBE_SHA1_RC2_40 {
        budget.boek(p.iterations.into(), 2)?;
        let sleutel = Zeroizing::new(derive_key::<sha1::Sha1>(bmp, salt, Pkcs12KeyType::EncryptionKey, p.iterations, 5));
        let iv = Zeroizing::new(derive_key::<sha1::Sha1>(bmp, salt, Pkcs12KeyType::Iv, p.iterations, 8));
        let cipher = rc2::Rc2::new_with_eff_key_len(&sleutel, 40);
        let dec = cbc::Decryptor::<rc2::Rc2>::inner_iv_slice_init(cipher, &iv)
            .map_err(|e| Pkcs12Fout::Onleesbaar(e.to_string()))?;
        return dec
            .decrypt_padded_vec_mut::<Pkcs7>(data)
            .map(Zeroizing::new)
            .map_err(|_| Pkcs12Fout::VerkeerdWachtwoord);
    }
    Err(Pkcs12Fout::AlgoritmeNietOndersteund(alg.oid.to_string()))
}

fn attribuut_bytes(bag: &SafeBag, oid: ObjectIdentifier) -> Option<Vec<u8>> {
    let attr = bag.bag_attributes.as_ref()?.iter().find(|a| a.oid == oid)?;
    attr.values.iter().next()?.decode_as::<OctetString>().ok().map(|o| o.as_bytes().to_vec())
}

fn attribuut_naam(bag: &SafeBag) -> Option<String> {
    let attr = bag.bag_attributes.as_ref()?.iter().find(|a| a.oid == FRIENDLY_NAME)?;
    attr.values.iter().next()?.decode_as::<BmpString>().ok().map(|b| b.to_string())
}

/// De inhoud van een `[0] EXPLICIT`-omhulling, zonder tussenkopie.
fn expliciete_inhoud(omhuld: &[u8]) -> Result<&[u8], Pkcs12Fout> {
    let mut r = der::SliceReader::new(omhuld)?;
    let kop = der::Header::decode(&mut r)?;
    if kop.tag != (der::Tag::ContextSpecific { constructed: true, number: der::TagNumber::N0 }) {
        return Err(Pkcs12Fout::Onleesbaar(format!("bag-waarde met tag {}", kop.tag)));
    }
    let inhoud = r.read_slice(kop.length)?;
    Ok(r.finish(inhoud)?)
}

fn zet_sleutel(uit: &mut Pkcs12Inhoud, pkcs8: Zeroizing<Vec<u8>>, bag: &SafeBag) -> Result<(), Pkcs12Fout> {
    if uit.sleutel_pkcs8.is_some() {
        return Err(Pkcs12Fout::AlgoritmeNietOndersteund("meerdere privésleutels".into()));
    }
    uit.sleutel_pkcs8 = Some(pkcs8);
    uit.sleutel_local_key_id = attribuut_bytes(bag, LOCAL_KEY_ID);
    Ok(())
}

/// Verwerkt de bags en wist daarna (ook bij een fout) de kopie van elke bag-waarde.
///
/// `mac_bevestigd`: zonder MAC is een ontsleutelde sleutel die geen PKCS#8 is een
/// teken van een verkeerd wachtwoord; met bevestigde MAC is het bestand stuk.
fn verwerk(
    mut bags: SafeContents,
    bmp: &[u8],
    utf8: &str,
    mac_bevestigd: bool,
    uit: &mut Pkcs12Inhoud,
    budget: &mut Rekenbudget,
) -> Result<(), Pkcs12Fout> {
    let uitkomst = verwerk_bags(&bags, bmp, utf8, mac_bevestigd, uit, budget);
    for bag in bags.iter_mut() {
        bag.bag_value.zeroize();
    }
    uitkomst
}

fn verwerk_bags(
    bags: &[SafeBag],
    bmp: &[u8],
    utf8: &str,
    mac_bevestigd: bool,
    uit: &mut Pkcs12Inhoud,
    budget: &mut Rekenbudget,
) -> Result<(), Pkcs12Fout> {
    for bag in bags {
        if bag.bag_id == ::pkcs12::PKCS_12_CERT_BAG_OID {
            let cs = ContextSpecific::<CertBag>::from_der(&bag.bag_value)?;
            uit.certificaten.push(Certificaat {
                der: cs.value.cert_value.as_bytes().to_vec(),
                local_key_id: attribuut_bytes(bag, LOCAL_KEY_ID),
                naam: attribuut_naam(bag),
            });
        } else if bag.bag_id == ::pkcs12::PKCS_12_PKCS8_KEY_BAG_OID {
            let cs = ContextSpecific::<EncryptedPrivateKeyInfo>::from_der(&bag.bag_value)?;
            let pkcs8 = ontsleutel(&cs.value.encryption_algorithm, cs.value.encrypted_data.as_bytes(), bmp, utf8, budget)?;
            if PrivateKeyInfo::from_der(&pkcs8).is_err() {
                return Err(if mac_bevestigd {
                    Pkcs12Fout::Onleesbaar("ontsleutelde privésleutel is geen PKCS#8".into())
                } else {
                    Pkcs12Fout::VerkeerdWachtwoord
                });
            }
            zet_sleutel(uit, pkcs8, bag)?;
        } else if bag.bag_id == ::pkcs12::PKCS_12_KEY_BAG_OID {
            let pkcs8 = Zeroizing::new(expliciete_inhoud(&bag.bag_value)?.to_vec());
            if let Err(e) = PrivateKeyInfo::from_der(&pkcs8) {
                return Err(Pkcs12Fout::Onleesbaar(format!("privésleutel: {e}")));
            }
            zet_sleutel(uit, pkcs8, bag)?;
        }
    }
    Ok(())
}

/// Het hele verwerk-pad voor één wachtwoordvorm.
fn verwerk_inhoud(
    inhoud: &[u8],
    vorm: Wachtwoordvorm,
    bmp: &[u8],
    wachtwoord: &str,
    mac_bevestigd: bool,
    budget: &mut Rekenbudget,
) -> Result<Pkcs12Inhoud, Pkcs12Fout> {
    let mut uit = Pkcs12Inhoud {
        sleutel_pkcs8: None,
        sleutel_local_key_id: None,
        certificaten: Vec::new(),
        wachtwoordvorm: vorm,
    };
    for ci in AuthenticatedSafe::from_der(inhoud)? {
        if ci.content_type == ID_DATA {
            let os = OctetString::from_der(&ci.content.to_der()?)?;
            verwerk(SafeContents::from_der(os.as_bytes())?, bmp, wachtwoord, mac_bevestigd, &mut uit, budget)?;
        } else if ci.content_type == ID_ENCRYPTED_DATA {
            let ed = EncryptedData::from_der(&ci.content.to_der()?)?;
            let ct = ed
                .enc_content_info
                .encrypted_content
                .as_ref()
                .ok_or_else(|| Pkcs12Fout::Onleesbaar("versleutelde inhoud ontbreekt".into()))?;
            let klaar = ontsleutel(&ed.enc_content_info.content_enc_alg, ct.as_bytes(), bmp, wachtwoord, budget)?;
            let bags = SafeContents::from_der(&klaar).map_err(|e| {
                if mac_bevestigd {
                    Pkcs12Fout::Onleesbaar(e.to_string())
                } else {
                    Pkcs12Fout::VerkeerdWachtwoord
                }
            })?;
            verwerk(bags, bmp, wachtwoord, mac_bevestigd, &mut uit, budget)?;
        } else {
            return Err(Pkcs12Fout::AlgoritmeNietOndersteund(format!("inhoud {}", ci.content_type)));
        }
    }
    Ok(uit)
}

/// Opent een .p12/.pfx. Bij een leeg `wachtwoord` worden leeg en afwezig beide geprobeerd.
///
/// Met MAC kiest de MAC de wachtwoordvorm. Zonder MAC wordt per vorm het hele
/// verwerk-pad geprobeerd; de eerste vorm waarvoor alles slaagt wint. Slaagt geen
/// enkele, dan wint de eerste fout die geen `VerkeerdWachtwoord` is (zodat bv.
/// "meerdere privésleutels" bij de juiste vorm zichtbaar blijft), anders
/// `VerkeerdWachtwoord`. Alle afleidingen samen vallen onder één rekenbudget.
pub fn lees(bytes: &[u8], wachtwoord: &str) -> Result<Pkcs12Inhoud, Pkcs12Fout> {
    let pfx = Pfx::from_der(bytes)?;
    if pfx.auth_safe.content_type != ID_DATA {
        return Err(Pkcs12Fout::AlgoritmeNietOndersteund(format!(
            "authSafe {}",
            pfx.auth_safe.content_type
        )));
    }
    let os = OctetString::from_der(&pfx.auth_safe.content.to_der()?)?;
    let inhoud = os.as_bytes();
    raam_rekenwerk(inhoud, pfx.mac_data.as_ref())?;
    let vormen = wachtwoordvormen(wachtwoord);
    let mut budget = Rekenbudget::nieuw();

    if let Some(md) = &pfx.mac_data {
        for (vorm, pass) in &vormen {
            if mac_klopt(md, inhoud, pass, &mut budget)? {
                return verwerk_inhoud(inhoud, *vorm, pass, wachtwoord, true, &mut budget);
            }
        }
        return Err(Pkcs12Fout::VerkeerdWachtwoord);
    }

    let mut andere_fout = None;
    for (vorm, pass) in &vormen {
        match verwerk_inhoud(inhoud, *vorm, pass, wachtwoord, false, &mut budget) {
            Ok(uit) => return Ok(uit),
            Err(Pkcs12Fout::VerkeerdWachtwoord) => {}
            Err(e) => {
                if andere_fout.is_none() {
                    andere_fout = Some(e);
                }
            }
        }
    }
    Err(andere_fout.unwrap_or(Pkcs12Fout::VerkeerdWachtwoord))
}

/// De publieke sleutel (inhoud van de BIT STRING in de SPKI) af te leiden uit PKCS#8.
fn publieke_sleutel(pki: &PrivateKeyInfo<'_>) -> Option<Vec<u8>> {
    if let Some(pk) = pki.public_key {
        return Some(pk.to_vec());
    }
    if pki.algorithm.oid == RSA_ENCRYPTION {
        let prive = rsa::pkcs1::RsaPrivateKey::from_der(pki.private_key).ok()?;
        let publiek = rsa::pkcs1::RsaPublicKey {
            modulus: prive.modulus,
            public_exponent: prive.public_exponent,
        };
        return publiek.to_der().ok();
    }
    if pki.algorithm.oid == ID_EC_PUBLIC_KEY {
        let ec = EcPrivateKey::from_der(pki.private_key).ok()?;
        return ec.public_key.map(|b| b.raw_bytes().to_vec());
    }
    None
}

/// Het certificaat dat bij de privésleutel hoort: eerst via `localKeyId`,
/// anders door algoritme en publieke sleutel te vergelijken. Is er geen publieke
/// sleutel af te leiden, dan het enige certificaat met hetzelfde algoritme.
/// `None` zonder sleutel of zonder eenduidig passend certificaat.
pub fn ondertekenaar_index(inhoud: &Pkcs12Inhoud) -> Option<usize> {
    let sleutel = inhoud.sleutel_pkcs8.as_ref()?;
    if let Some(id) = &inhoud.sleutel_local_key_id {
        if let Some(i) = inhoud.certificaten.iter().position(|c| c.local_key_id.as_ref() == Some(id)) {
            return Some(i);
        }
    }
    let pki = PrivateKeyInfo::from_der(sleutel).ok()?;
    let sleutel_params = pki.algorithm.parameters.and_then(|p| p.to_der().ok());
    let spkis: Vec<Option<spki::SubjectPublicKeyInfoOwned>> = inhoud
        .certificaten
        .iter()
        .map(|c| x509_cert::Certificate::from_der(&c.der).ok().map(|x| x.tbs_certificate.subject_public_key_info))
        .collect();
    let zelfde_algoritme = |s: &spki::SubjectPublicKeyInfoOwned| {
        s.algorithm.oid == pki.algorithm.oid
            && match (&sleutel_params, &s.algorithm.parameters) {
                (Some(a), Some(b)) => b.to_der().ok().as_ref() == Some(a),
                _ => true,
            }
    };
    match publieke_sleutel(&pki) {
        Some(publiek) => spkis.iter().position(|s| {
            s.as_ref()
                .is_some_and(|s| zelfde_algoritme(s) && s.subject_public_key.raw_bytes() == publiek.as_slice())
        }),
        None => {
            let mut kandidaten = spkis
                .iter()
                .enumerate()
                .filter(|(_, s)| s.as_ref().is_some_and(&zelfde_algoritme))
                .map(|(i, _)| i);
            let eerste = kandidaten.next()?;
            kandidaten.next().is_none().then_some(eerste)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn fixture(naam: &str) -> Vec<u8> {
        let pad = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/pkcs12")
            .join(naam);
        std::fs::read(&pad).unwrap_or_else(|e| panic!("fixture {}: {e}", pad.display()))
    }

    #[test]
    fn eigen_fixtures_openen_in_alle_drie_de_formaten() {
        for naam in ["windows-export-3des.p12", "certutil-3des.p12", "openssl3-aes256.p12"] {
            let inh = lees(&fixture(naam), "proef123").unwrap_or_else(|e| panic!("{naam}: {e}"));
            assert!(inh.sleutel_pkcs8.is_some(), "{naam}: sleutel");
            assert_eq!(inh.certificaten.len(), 1, "{naam}: certificaten");
            assert_eq!(ondertekenaar_index(&inh), Some(0), "{naam}: ondertekenaar");
            assert_eq!(inh.wachtwoordvorm, Wachtwoordvorm::Gewoon, "{naam}");
        }
    }

    #[test]
    fn alle_drie_de_formaten_bevatten_dezelfde_sleutel() {
        let a = lees(&fixture("windows-export-3des.p12"), "proef123").unwrap();
        let b = lees(&fixture("certutil-3des.p12"), "proef123").unwrap();
        let c = lees(&fixture("openssl3-aes256.p12"), "proef123").unwrap();
        assert_eq!(a.certificaten[0].der, b.certificaten[0].der);
        assert_eq!(a.certificaten[0].der, c.certificaten[0].der);
        let modulus = |i: &Pkcs12Inhoud| {
            use rsa::pkcs8::DecodePrivateKey;
            use rsa::traits::PublicKeyParts;
            rsa::RsaPrivateKey::from_pkcs8_der(i.sleutel_pkcs8.as_ref().unwrap()).unwrap().n().clone()
        };
        assert_eq!(modulus(&a), modulus(&b));
        assert_eq!(modulus(&a), modulus(&c));
    }

    #[test]
    fn verkeerd_wachtwoord_geeft_nette_fout() {
        for naam in ["windows-export-3des.p12", "certutil-3des.p12", "openssl3-aes256.p12"] {
            match lees(&fixture(naam), "fout") {
                Err(Pkcs12Fout::VerkeerdWachtwoord) => {}
                Err(e) => panic!("{naam}: andere fout {e}"),
                Ok(_) => panic!("{naam}: gelezen met verkeerd wachtwoord"),
            }
        }
    }

    #[test]
    fn rommel_is_onleesbaar_geen_paniek() {
        assert!(matches!(lees(b"geen pkcs12", ""), Err(Pkcs12Fout::Onleesbaar(_))));
        assert!(matches!(lees(&[], "x"), Err(Pkcs12Fout::Onleesbaar(_))));
        let mut half = fixture("openssl3-aes256.p12");
        half.truncate(half.len() / 2);
        assert!(lees(&half, "proef123").is_err());
    }

    /// Het externe corpus (scripts/haal-handtekening-testdata.py). Ontbreekt het,
    /// dan slaat deze test over met een melding in plaats van te falen.
    #[test]
    fn corpus_volgens_manifest() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
        let Some(map) = crate::handtekening::corpusmap("pkcs12") else { return };
        let manifest: serde_json::Value = serde_json::from_slice(
            &std::fs::read(root.join("scripts/handtekening-testdata.json")).unwrap(),
        )
        .unwrap();
        let bestanden = manifest["bronnen"]["pkcs12"]["bestanden"].as_array().unwrap();
        assert_eq!(bestanden.len(), 31);
        let mut fouten = Vec::new();
        for f in bestanden {
            let naam = f["bestand"].as_str().unwrap();
            let bytes = std::fs::read(map.join(naam)).unwrap();
            let inh = match lees(&bytes, f["wachtwoord"].as_str().unwrap()) {
                Ok(i) => i,
                Err(e) => {
                    fouten.push(format!("{naam}: {e}"));
                    continue;
                }
            };
            let namen: Vec<String> = inh.certificaten.iter().filter_map(|c| c.naam.clone()).collect();
            let verwachte_namen: Vec<String> = f["namen"]
                .as_array()
                .unwrap()
                .iter()
                .map(|v| v.as_str().unwrap().to_string())
                .collect();
            if inh.sleutel_pkcs8.is_some() != f["sleutel"].as_bool().unwrap()
                || inh.certificaten.len() as u64 != f["certificaten"].as_u64().unwrap()
                || namen != verwachte_namen
                || ondertekenaar_index(&inh).is_some() != f["ondertekenaar"].as_bool().unwrap()
            {
                fouten.push(format!(
                    "{naam}: sleutel={} certificaten={} namen={namen:?} ondertekenaar={:?}",
                    inh.sleutel_pkcs8.is_some(),
                    inh.certificaten.len(),
                    ondertekenaar_index(&inh)
                ));
            }
            // Een verkeerd wachtwoord mag nooit tot een geslaagde lezing leiden.
            if !matches!(lees(&bytes, "helemaal-fout-123"), Err(Pkcs12Fout::VerkeerdWachtwoord)) {
                fouten.push(format!("{naam}: verkeerd wachtwoord niet netjes geweigerd"));
            }
        }
        assert!(fouten.is_empty(), "{}", fouten.join("\n"));
    }

    #[test]
    fn leeg_en_afwezig_wachtwoord_worden_onderscheiden() {
        let Some(root) = crate::handtekening::corpusmap("pkcs12") else { return };
        let truststore = lees(&std::fs::read(root.join("java-truststore.p12")).unwrap(), "").unwrap();
        assert_eq!(truststore.wachtwoordvorm, Wachtwoordvorm::Leeg);
        let zonder = lees(&std::fs::read(root.join("no-password.p12")).unwrap(), "").unwrap();
        assert_eq!(zonder.wachtwoordvorm, Wachtwoordvorm::Afwezig);
    }

    fn corpus(naam: &str) -> Option<Vec<u8>> {
        let pad = crate::handtekening::corpusmap("pkcs12")?.join(naam);
        Some(std::fs::read(&pad).unwrap_or_else(|e| panic!("corpusbestand {} onleesbaar: {e}", pad.display())))
    }

    /// Hetzelfde bestand zonder MacData: alle versleuteling blijft, alleen de MAC verdwijnt.
    fn zonder_mac(bytes: &[u8]) -> Vec<u8> {
        let mut pfx = Pfx::from_der(bytes).unwrap();
        pfx.mac_data = None;
        pfx.to_der().unwrap()
    }

    fn met_mac_iteraties(bytes: &[u8], n: i32) -> Vec<u8> {
        let mut pfx = Pfx::from_der(bytes).unwrap();
        pfx.mac_data.as_mut().unwrap().iterations = n;
        pfx.to_der().unwrap()
    }

    fn verkeerde_wachtwoorden() -> impl Iterator<Item = String> {
        (0..300).map(|i| format!("fout-{i}"))
    }

    #[test]
    fn zonder_mac_opent_met_juist_wachtwoord() {
        let gestript = zonder_mac(&fixture("windows-export-3des.p12"));
        for (naam, bytes) in [("zonder-mac-3des.p12", fixture("zonder-mac-3des.p12")), ("gestript", gestript)] {
            let inh = lees(&bytes, "proef123").unwrap_or_else(|e| panic!("{naam}: {e}"));
            assert!(inh.sleutel_pkcs8.is_some(), "{naam}: sleutel");
            assert_eq!(inh.certificaten.len(), 1, "{naam}: certificaten");
            assert_eq!(ondertekenaar_index(&inh), Some(0), "{naam}: ondertekenaar");
            assert_eq!(inh.wachtwoordvorm, Wachtwoordvorm::Gewoon, "{naam}");
        }
    }

    #[test]
    fn zonder_mac_slaagt_een_verkeerd_wachtwoord_nooit() {
        let gestript = zonder_mac(&fixture("windows-export-3des.p12"));
        for (naam, bytes) in [("zonder-mac-3des.p12", fixture("zonder-mac-3des.p12")), ("gestript", gestript)] {
            for pw in verkeerde_wachtwoorden() {
                match lees(&bytes, &pw) {
                    Err(Pkcs12Fout::VerkeerdWachtwoord) => {}
                    Err(e) => panic!("{naam} met {pw:?}: andere fout {e}"),
                    Ok(_) => panic!("{naam}: geopend met verkeerd wachtwoord {pw:?}"),
                }
            }
        }
    }

    #[test]
    fn zonder_wachtwoord_opent_met_lege_invoer() {
        let bytes = fixture("zonder-wachtwoord.p12");
        let inh = lees(&bytes, "").unwrap_or_else(|e| panic!("{e}"));
        assert!(inh.sleutel_pkcs8.is_some());
        assert_eq!(inh.certificaten.len(), 1);
        assert_eq!(ondertekenaar_index(&inh), Some(0));
        assert_eq!(inh.wachtwoordvorm, Wachtwoordvorm::Leeg);
        assert!(matches!(lees(&bytes, "proef123"), Err(Pkcs12Fout::VerkeerdWachtwoord)));
    }

    #[test]
    fn zonder_mac_wordt_ook_afwezig_geprobeerd() {
        let Some(bytes) = corpus("no-password.p12") else { return };
        let inh = lees(&zonder_mac(&bytes), "").unwrap_or_else(|e| panic!("{e}"));
        assert_eq!(inh.wachtwoordvorm, Wachtwoordvorm::Afwezig);
        assert!(inh.sleutel_pkcs8.is_some());
    }

    #[test]
    fn mac_iteratiegetal_buiten_grens_wordt_geweigerd() {
        let bytes = fixture("windows-export-3des.p12");
        for n in [0, -1, 10_000_001, i32::MAX] {
            let start = std::time::Instant::now();
            match lees(&met_mac_iteraties(&bytes, n), "proef123") {
                Err(Pkcs12Fout::AlgoritmeNietOndersteund(m)) => assert_eq!(m, format!("iteratiegetal {n}")),
                Err(e) => panic!("{n}: andere fout {e}"),
                Ok(_) => panic!("{n}: geopend"),
            }
            assert!(start.elapsed() < std::time::Duration::from_secs(1), "{n}: te traag");
        }
        // Op de grens zelf blijft het gewone gedrag: MAC klopt niet → verkeerd wachtwoord.
        assert!(matches!(lees(&met_mac_iteraties(&bytes, 1), "proef123"), Err(Pkcs12Fout::VerkeerdWachtwoord)));
    }

    #[test]
    fn wachtwoord_buiten_bmp_is_verkeerd_wachtwoord() {
        for naam in ["windows-export-3des.p12", "certutil-3des.p12", "openssl3-aes256.p12", "zonder-mac-3des.p12"] {
            match lees(&fixture(naam), "proef\u{1F511}123") {
                Err(Pkcs12Fout::VerkeerdWachtwoord) => {}
                Err(e) => panic!("{naam}: andere fout {e}"),
                Ok(_) => panic!("{naam}: geopend"),
            }
        }
    }

    fn zonder_ids(mut inh: Pkcs12Inhoud) -> Pkcs12Inhoud {
        inh.sleutel_local_key_id = None;
        for c in &mut inh.certificaten {
            c.local_key_id = None;
        }
        inh
    }

    #[test]
    fn ondertekenaar_zonder_local_key_id_via_publieke_sleutel() {
        let rsa = zonder_ids(lees(&fixture("windows-export-3des.p12"), "proef123").unwrap());
        assert_eq!(ondertekenaar_index(&rsa), Some(0));
        for (naam, pw) in [("name-all-pwd.p12", "password"), ("cert-key-aes256cbc.p12", "cryptography")] {
            let Some(bytes) = corpus(naam) else { return };
            let met = lees(&bytes, pw).unwrap();
            let verwacht = ondertekenaar_index(&met);
            assert!(verwacht.is_some(), "{naam}");
            assert_eq!(ondertekenaar_index(&zonder_ids(met)), verwacht, "{naam}: EC zonder localKeyId");
        }
    }

    #[test]
    fn ondertekenaar_zonder_publieke_sleutel_via_enig_certificaat_met_zelfde_algoritme() {
        let Some(bytes) = corpus("cert-key-aes256cbc.p12") else { return };
        let mut inh = zonder_ids(lees(&bytes, "cryptography").unwrap());
        let origineel = inh.sleutel_pkcs8.take().unwrap();
        let pki = rsa::pkcs8::PrivateKeyInfo::from_der(&origineel).unwrap();
        assert!(pki.public_key.is_none());
        let mut ec = EcPrivateKey::from_der(pki.private_key).unwrap();
        assert!(ec.public_key.is_some(), "corpus-EC-sleutel hoort een publieke sleutel te hebben");
        ec.public_key = None;
        let ec_der = Zeroizing::new(ec.to_der().unwrap());
        let kaal = rsa::pkcs8::PrivateKeyInfo { algorithm: pki.algorithm, private_key: &ec_der, public_key: None };
        inh.sleutel_pkcs8 = Some(Zeroizing::new(kaal.to_der().unwrap()));
        assert_eq!(ondertekenaar_index(&inh), Some(0));
        let kopie = Certificaat { der: inh.certificaten[0].der.clone(), local_key_id: None, naam: None };
        inh.certificaten.push(kopie);
        assert_eq!(ondertekenaar_index(&inh), None, "twee kandidaten: geen gok");
    }

    /// De bags uit de eerste onversleutelde ContentInfo (daar zit de ShroudedKeyBag).
    fn onversleutelde_bags(bytes: &[u8]) -> SafeContents {
        let pfx = Pfx::from_der(bytes).unwrap();
        let os = OctetString::from_der(&pfx.auth_safe.content.to_der().unwrap()).unwrap();
        let ci = AuthenticatedSafe::from_der(os.as_bytes())
            .unwrap()
            .into_iter()
            .find(|ci| ci.content_type == ID_DATA)
            .unwrap();
        let inner = OctetString::from_der(&ci.content.to_der().unwrap()).unwrap();
        SafeContents::from_der(inner.as_bytes()).unwrap()
    }

    fn leeg_resultaat() -> Pkcs12Inhoud {
        Pkcs12Inhoud {
            sleutel_pkcs8: None,
            sleutel_local_key_id: None,
            certificaten: Vec::new(),
            wachtwoordvorm: Wachtwoordvorm::Gewoon,
        }
    }

    #[test]
    fn ontsleutelde_rommel_wordt_nooit_als_sleutel_aangenomen() {
        let bytes = fixture("windows-export-3des.p12");
        let bags = onversleutelde_bags(&bytes);
        let bag = bags.iter().find(|b| b.bag_id == ::pkcs12::PKCS_12_PKCS8_KEY_BAG_OID).unwrap();
        let epki = ContextSpecific::<EncryptedPrivateKeyInfo>::from_der(&bag.bag_value).unwrap().value;
        let mut door_opvulling = 0;
        for i in 0..1000 {
            let pw = format!("fout-{i}");
            let bmp = wachtwoordvormen(&pw).remove(0).1;
            if let Ok(rommel) = ontsleutel(&epki.encryption_algorithm, epki.encrypted_data.as_bytes(), &bmp, &pw, &mut Rekenbudget::nieuw()) {
                door_opvulling += 1;
                assert!(PrivateKeyInfo::from_der(&rommel).is_err());
            }
            let mut uit = leeg_resultaat();
            match verwerk(onversleutelde_bags(&bytes), &bmp, &pw, false, &mut uit, &mut Rekenbudget::nieuw()) {
                Err(Pkcs12Fout::VerkeerdWachtwoord) => {}
                Err(e) => panic!("{pw}: andere fout {e}"),
                Ok(()) => panic!("{pw}: rommel als sleutel aangenomen"),
            }
        }
        assert!(door_opvulling > 0, "geen enkel wachtwoord kwam door de opvulling; test bewijst niets");
    }

    fn pbe_alg(oid: ObjectIdentifier, params: &impl Encode) -> AlgorithmIdentifierOwned {
        AlgorithmIdentifierOwned { oid, parameters: Some(der::Any::from_der(&params.to_der().unwrap()).unwrap()) }
    }

    fn verwacht_iteratiefout(alg: &AlgorithmIdentifierOwned, verwacht: &str) {
        let start = std::time::Instant::now();
        match ontsleutel(alg, &[0u8; 16], b"\0p\0w\0\0", "pw", &mut Rekenbudget::nieuw()) {
            Err(Pkcs12Fout::AlgoritmeNietOndersteund(m)) => assert_eq!(m, verwacht),
            Err(e) => panic!("{verwacht}: andere fout {e}"),
            Ok(_) => panic!("{verwacht}: ontsleuteld"),
        }
        assert!(start.elapsed() < std::time::Duration::from_secs(1), "{verwacht}: te traag");
    }

    #[test]
    fn pbe_iteratiegetal_buiten_grens_wordt_geweigerd() {
        for oid in [PBE_SHA1_3DES, PBE_SHA1_RC2_40] {
            for n in [0, -5, 10_000_001, i32::MAX] {
                let params = Pkcs12PbeParams { salt: OctetString::new(vec![1u8; 8]).unwrap(), iterations: n };
                verwacht_iteratiefout(&pbe_alg(oid, &params), &format!("iteratiegetal {n}"));
            }
        }
    }

    #[test]
    fn pbes2_iteratiegetal_buiten_grens_en_scrypt_worden_geweigerd() {
        let iv = [0u8; 16];
        let salt = [1u8; 8];
        // Rechtstreeks opgebouwd: de constructor van pkcs5 weigert zelf al boven zijn eigen grens.
        for n in [0u32, 10_000_001, 100_000_000, u32::MAX] {
            let params = pkcs5::pbes2::Parameters {
                kdf: pkcs5::pbes2::Kdf::Pbkdf2(pkcs5::pbes2::Pbkdf2Params {
                    salt: &salt,
                    iteration_count: n,
                    key_length: None,
                    prf: pkcs5::pbes2::Pbkdf2Prf::HmacWithSha256,
                }),
                encryption: pkcs5::pbes2::EncryptionScheme::Aes256Cbc { iv: &iv },
            };
            verwacht_iteratiefout(&pbe_alg(PBES2, &params), &format!("iteratiegetal {n}"));
        }
        let scrypt = pkcs5::pbes2::Parameters {
            kdf: pkcs5::pbes2::Kdf::Scrypt(pkcs5::pbes2::ScryptParams {
                salt: &salt,
                cost_parameter: 1 << 40,
                block_size: 8,
                parallelization: 1,
                key_length: Some(32),
            }),
            encryption: pkcs5::pbes2::EncryptionScheme::Aes256Cbc { iv: &iv },
        };
        verwacht_iteratiefout(&pbe_alg(PBES2, &scrypt), "scrypt");
    }

    #[test]
    fn meerdere_privesleutels_worden_geweigerd() {
        let pkcs8 = lees(&fixture("windows-export-3des.p12"), "proef123").unwrap().sleutel_pkcs8.unwrap();
        let keybag = || SafeBag {
            bag_id: ::pkcs12::PKCS_12_KEY_BAG_OID,
            bag_value: ContextSpecific {
                tag_number: der::TagNumber::N0,
                tag_mode: der::TagMode::Explicit,
                value: der::Any::from_der(&pkcs8).unwrap(),
            }
            .to_der()
            .unwrap(),
            bag_attributes: None,
        };
        let mut een = leeg_resultaat();
        verwerk(vec![keybag()], b"", "", true, &mut een, &mut Rekenbudget::nieuw()).unwrap_or_else(|e| panic!("{e}"));
        assert_eq!(een.sleutel_pkcs8.as_deref(), Some(&*pkcs8));
        let mut twee = leeg_resultaat();
        match verwerk(vec![keybag(), keybag()], b"", "", true, &mut twee, &mut Rekenbudget::nieuw()) {
            Err(Pkcs12Fout::AlgoritmeNietOndersteund(m)) => assert_eq!(m, "meerdere privésleutels"),
            Err(e) => panic!("andere fout {e}"),
            Ok(()) => panic!("twee sleutels aangenomen"),
        }
    }

    /// Een Pfx zonder MAC met precies deze `AuthenticatedSafe`-delen.
    fn bouw_pfx(delen: &[cms::content_info::ContentInfo]) -> Vec<u8> {
        let mut pfx = Pfx::from_der(&fixture("windows-export-3des.p12")).unwrap();
        let safe = delen.to_vec().to_der().unwrap();
        pfx.auth_safe.content = der::Any::from_der(&OctetString::new(safe).unwrap().to_der().unwrap()).unwrap();
        pfx.mac_data = None;
        pfx.to_der().unwrap()
    }

    fn fixture_delen() -> Vec<cms::content_info::ContentInfo> {
        let pfx = Pfx::from_der(&fixture("windows-export-3des.p12")).unwrap();
        let os = OctetString::from_der(&pfx.auth_safe.content.to_der().unwrap()).unwrap();
        AuthenticatedSafe::from_der(os.as_bytes()).unwrap()
    }

    #[test]
    fn rekenbudget_geldt_voor_het_hele_bestand() {
        let mut deel = fixture_delen().into_iter().find(|ci| ci.content_type == ID_ENCRYPTED_DATA).unwrap();
        let mut ed = EncryptedData::from_der(&deel.content.to_der().unwrap()).unwrap();
        let alg = &mut ed.enc_content_info.content_enc_alg;
        let mut p = Pkcs12PbeParams::from_der(&alg.parameters.as_ref().unwrap().to_der().unwrap()).unwrap();
        // Elk deel ruim onder MAX_ITERATIES (sleutel + IV = 8 miljoen), samen 24 miljoen.
        p.iterations = 4_000_000;
        alg.parameters = Some(der::Any::from_der(&p.to_der().unwrap()).unwrap());
        deel.content = der::Any::from_der(&ed.to_der().unwrap()).unwrap();
        let bytes = bouw_pfx(&[deel.clone(), deel.clone(), deel]);
        let start = std::time::Instant::now();
        match lees(&bytes, "proef123") {
            Err(Pkcs12Fout::AlgoritmeNietOndersteund(m)) => assert_eq!(m, "iteratiegetal totaal 24000000"),
            Err(e) => panic!("andere fout {e}"),
            Ok(_) => panic!("geopend"),
        }
        assert!(start.elapsed() < std::time::Duration::from_secs(1), "te traag: {:?}", start.elapsed());
    }

    #[test]
    fn zonder_mac_verdwijnt_een_structuurfout_niet_achter_verkeerd_wachtwoord() {
        use cbc::cipher::BlockEncryptMut;
        // Deel 1: lege SafeContents, versleuteld met het lege wachtwoord (BMP 00 00).
        // Vorm Leeg ontsleutelt dit; vorm Afwezig niet (verkeerd wachtwoord).
        let salt = [7u8; 8];
        let leeg = [0u8, 0u8];
        let sleutel = derive_key::<sha1::Sha1>(&leeg, &salt, Pkcs12KeyType::EncryptionKey, 1, 24);
        let iv = derive_key::<sha1::Sha1>(&leeg, &salt, Pkcs12KeyType::Iv, 1, 8);
        let ct = cbc::Encryptor::<des::TdesEde3>::new_from_slices(&sleutel, &iv)
            .unwrap()
            .encrypt_padded_vec_mut::<Pkcs7>(&[0x30, 0x00]);
        let ed = EncryptedData {
            version: cms::content_info::CmsVersion::V0,
            enc_content_info: cms::enveloped_data::EncryptedContentInfo {
                content_type: ID_DATA,
                content_enc_alg: pbe_alg(
                    PBE_SHA1_3DES,
                    &Pkcs12PbeParams { salt: OctetString::new(salt.to_vec()).unwrap(), iterations: 1 },
                ),
                encrypted_content: Some(OctetString::new(ct).unwrap()),
            },
            unprotected_attrs: None,
        };
        let versleuteld = cms::content_info::ContentInfo {
            content_type: ID_ENCRYPTED_DATA,
            content: der::Any::from_der(&ed.to_der().unwrap()).unwrap(),
        };
        // Deel 2: twee onversleutelde KeyBags (met de hand gecodeerd).
        let pkcs8 = lees(&fixture("windows-export-3des.p12"), "proef123").unwrap().sleutel_pkcs8.unwrap();
        let mut bag = ::pkcs12::PKCS_12_KEY_BAG_OID.to_der().unwrap();
        bag.extend(
            ContextSpecific {
                tag_number: der::TagNumber::N0,
                tag_mode: der::TagMode::Explicit,
                value: der::Any::from_der(&pkcs8).unwrap(),
            }
            .to_der()
            .unwrap(),
        );
        let bag = der::asn1::AnyRef::new(der::Tag::Sequence, &bag).unwrap().to_der().unwrap();
        let twee = [bag.clone(), bag].concat();
        let safe_contents = der::asn1::AnyRef::new(der::Tag::Sequence, &twee).unwrap().to_der().unwrap();
        let onversleuteld = cms::content_info::ContentInfo {
            content_type: ID_DATA,
            content: der::Any::from_der(&OctetString::new(safe_contents).unwrap().to_der().unwrap()).unwrap(),
        };
        let bytes = bouw_pfx(&[versleuteld, onversleuteld]);
        match lees(&bytes, "") {
            Err(Pkcs12Fout::AlgoritmeNietOndersteund(m)) => assert_eq!(m, "meerdere privésleutels"),
            Err(e) => panic!("andere fout {e}"),
            Ok(_) => panic!("geopend"),
        }
    }

    #[test]
    fn rekenbudget_telt_alle_afleidingen_op() {
        let mut b = Rekenbudget::nieuw();
        b.boek(9_000_000, 2).unwrap_or_else(|e| panic!("{e}"));
        b.boek(2_000, 1).unwrap_or_else(|e| panic!("{e}"));
        match b.boek(1_000_000, 2) {
            Err(Pkcs12Fout::AlgoritmeNietOndersteund(m)) => assert_eq!(m, "iteratiegetal totaal 20002000"),
            Err(e) => panic!("andere fout {e}"),
            Ok(()) => panic!("budget overschreden zonder fout"),
        }
        assert_eq!(b.gebruikt, 18_002_000, "een geweigerde boeking telt niet mee");
        match b.boek(10_000_001, 1) {
            Err(Pkcs12Fout::AlgoritmeNietOndersteund(m)) => assert_eq!(m, "iteratiegetal 10000001"),
            Err(e) => panic!("andere fout {e}"),
            Ok(()) => panic!("grens per afleiding genegeerd"),
        }
    }
}
