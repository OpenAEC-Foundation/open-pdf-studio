//! Vertrouwen (spec §7.1): keten naar het rootarchief van het besturingssysteem,
//! geldigheid op het relevante tijdstip en sleutelgebruik. Intrekking (OCSP,
//! CRL) wordt niet gecontroleerd (spec §10).
//!
//! [`beoordeel`] geeft altijd een oordeel: `Vertrouwd` of `NietVertrouwd`, nooit
//! `Vertrouwen::NietBepaald`. `NietBepaald` is voor de aanroeper die niet
//! beoordeelt, omdat de integriteit niet intact is. Een intacte handtekening
//! heeft altijd een certificaat (en een intact token altijd een tijd), dus kan
//! daar niet stil op `NietBepaald` (en zo op "geen keten") uitkomen.
//!
//! Certificaathandtekeningen in de keten: RSA tot 8192 bits (zulke wortels
//! bestaan), SHA-1 toegestaan maar gemeld via [`Ketenuitkomst::zwak_algoritme`].
//!
//! # Ketenbouw
//!
//! Diepte-eerst met terugstappen: per schakel eerst de kandidaten die op het
//! tijdstip geldig zijn (daarbinnen archief vóór de certificaten uit de
//! handtekening). Elk pad naar een anker wordt als geheel beoordeeld; het eerste
//! volledig kloppende pad wint. Klopt geen pad, dan telt de reden van het meest
//! gevorderde pad: een pad met anker gaat voor een doodlopend pad, daarbinnen
//! het pad waarvan de eerste fout het verst van het blad ligt, en bij
//! doodlopende paden het langste.
//!
//! Grenzen, zodat een document met veel onderling ondertekende certificaten de
//! beoordeling niet kan laten ontsporen:
//!
//! - hoogstens tien certificaten per pad (`MAX_KETEN`);
//! - een kandidaat met hetzelfde onderwerp én dezelfde publieke sleutel als een
//!   certificaat dat al in het pad staat, wordt overgeslagen (lusdetectie op
//!   naam en sleutel, niet op de bytes van het certificaat). Kandidaten met
//!   dezelfde naam en sleutel naast elkaar in één schakel blijven wél elk een
//!   eigen mogelijkheid (bijvoorbeeld een kruiscertificaat naast het gewone,
//!   of een verlopen en een geldige versie van dezelfde wortel); hun
//!   handtekeningcontrole wordt gedeeld, want die hangt alleen van de sleutel af;
//! - hoogstens honderd certificaathandtekeningen per beoordeling
//!   (`MAX_HANDTEKENINGCONTROLES`) en hoogstens duizend knopen, dat wil zeggen
//!   bezochte paduitbreidingen (`MAX_KNOPEN`);
//! - met [`beoordeel_binnen`] daarnaast een budget dat de aanroeper over
//!   meerdere beoordelingen deelt (de verificatie van één document).
//!
//! Is een budget op, dan telt wat tot dan gevonden is en staat
//! [`Ketenuitkomst::budget_op`] aan. Een `GeenKeten` met `budget_op` betekent
//! "binnen het budget geen keten gevonden", niet "er bestaat geen keten".
//!
//! # Regels per pad (RFC 5280, vereenvoudigd)
//!
//! - Geldigheid: elk certificaat, het anker inbegrepen → anders `Verlopen`.
//! - Blad, rol ondertekenaar: keyUsage (indien aanwezig) met digitalSignature of
//!   nonRepudiation. extendedKeyUsage (indien aanwezig) met anyExtendedKeyUsage,
//!   emailProtection, documentSigning of een documentondertekenings-OID van een
//!   leverancier, of clientAuth zonder serverAuth. Zonder extendedKeyUsage is
//!   het gebruik onbeperkt.
//! - Blad, rol tijdstempeldienst (RFC 3161 §2.3): extendedKeyUsage kritiek en
//!   uitsluitend id-kp-timeStamping.
//! - Tussencertificaten: basicConstraints met CA, keyUsage (indien aanwezig) met
//!   keyCertSign; een v1-certificaat zonder extensies alleen als anker.
//! - extendedKeyUsage van de tussencertificaten: de doorsnede over alle
//!   tussencertificaten (een tussencertificaat zonder extendedKeyUsage of met
//!   anyExtendedKeyUsage beperkt niets) moet de rol toestaan: voor
//!   ondertekenen dezelfde regel als bij het blad, voor een tijdstempeldienst
//!   timeStamping. De extendedKeyUsage-extensie van het anker telt hier niet;
//!   de doelen van het anker komen uit het archief (zie "Rootarchief").
//! - Anker: basicConstraints en keyUsage worden niet geëist.
//! - pathLenConstraint van elke CA in het pad (ook het anker, als aanwezig):
//!   het aantal niet-zelfuitgegeven tussencertificaten eronder is hoogstens die
//!   waarde.
//! - Kritieke extensies buiten keyUsage, basicConstraints, extendedKeyUsage,
//!   subjectAltName, certificatePolicies, policyConstraints, inhibitAnyPolicy,
//!   authorityKeyIdentifier en subjectKeyIdentifier worden niet begrepen: het
//!   certificaat wordt geweigerd (ook het anker). Dus ook nameConstraints: een
//!   keten met kritieke nameConstraints is nooit vertrouwd (spec §10).
//!   Beleidsregels zelf (policy-mapping, vereiste beleid) worden niet uitgewerkt.
//! - Doelen van het anker volgens het archief ([`Wortelgebruik`]): de rol moet
//!   zijn toegestaan, voor dit blad (notBefore) en dit tijdstip.
//!
//! Een fout in keyUsage, extendedKeyUsage (ook de doorsnede en de doelen van
//! het anker), CA-eisen, pathlen of kritieke extensies geeft `Sleutelgebruik`;
//! een verlopen certificaat in hetzelfde pad gaat daarvoor.
//!
//! De doelen van het anker zijn een andere toets dan de extendedKeyUsage-regel
//! van het blad: het archief zegt waarvoor het besturingssysteem de wortel
//! vertrouwt, het blad zegt waarvoor de sleutel bedoeld is. Beide moeten de rol
//! toestaan. anyExtendedKeyUsage telt bij de doelen van een wortel alleen als
//! het archief het uitdrukkelijk noemt.
//!
//! # Rootarchief
//!
//! Windows: het archief `ROOT` van de huidige gebruiker wordt rechtstreeks en
//! alleen-lezen gelezen (Win32 `CertOpenStore`); dat toont ook de wortels van de
//! computer (`LocalMachine\ROOT`) en uit groepsbeleid. Geen filter op huidige
//! geldigheid of TLS-serverauthenticatie: een handtekening wordt op een ander
//! tijdstip en voor een ander doel beoordeeld. Per wortel wordt bewaard:
//!
//! - de doelen volgens Windows (extensie en eigenschap "enhanced key usage"
//!   samen). Een wortel met alleen serverAuth blijft in het archief, maar is
//!   voor geen van beide rollen een geldig anker (`Sleutelgebruik`). Zijn de
//!   doelen niet te lezen, dan wordt de wortel weggelaten (één logregel);
//! - `CERT_DISALLOWED_FILETIME_PROP_ID` (104): de wortel geldt alleen als
//!   anker voor tijdstippen én bladen (notBefore) vóór die datum; daarna is hij
//!   geen anker (meestal `GeenKeten`). Zonder datum wordt de wortel weggelaten;
//! - `CERT_NOT_BEFORE_FILETIME_PROP_ID` (126) met
//!   `CERT_NOT_BEFORE_ENHKEY_USAGE_PROP_ID` (127): voor die doelen (zonder 127:
//!   alle doelen) geen bladen met notBefore ná die datum (`Sleutelgebruik` als
//!   de rol daardoor niet meer mag).
//!
//! Certificaten uit `Disallowed` (huidige gebruiker en, alleen-lezen,
//! `LocalMachine`) zijn nooit anker en nooit tussencertificaat. Wortels die
//! Windows pas automatisch bijwerkt als ze voor het eerst nodig zijn en die nog
//! niet lokaal staan, ontbreken; zo'n keten geeft "geen keten". `SSL_CERT_FILE`
//! en `SSL_CERT_DIR` hebben op Windows geen invloed.
//!
//! Andere platforms: `rustls-native-certs` (macOS-sleutelhanger, OpenSSL-paden op
//! Linux), zonder doelen per wortel en zonder gewantrouwde certificaten. Is
//! `SSL_CERT_FILE` of `SSL_CERT_DIR` gezet, dan komen de wortels uitsluitend
//! daarvandaan en niet uit het platformarchief. Let op: op Linux bevat de
//! systeembundel vaak alleen wortels voor TLS-servers; wortels van
//! ondertekeningsdiensten ontbreken dan en zulke handtekeningen geven "geen
//! keten".
//!
//! Het archief wordt één keer per sessie geladen. Leesfouten slaan het
//! betreffende certificaat of archief over; een paniek tijdens het laden geeft
//! een leeg archief dat de rest van de sessie blijft gelden (alles "geen keten").

use std::collections::HashMap;
use std::sync::OnceLock;

use const_oid::ObjectIdentifier;
use der::Decode;
use x509_cert::ext::pkix::{BasicConstraints, ExtendedKeyUsage, KeyUsage};
use x509_cert::ext::Extension;

use super::algoritme::{controleer_certificaathandtekening, gebruikte_hash, Hashalg, WaardeFout};
use super::cms_lees::{lees_certificaat, Certificaat};
use super::status::{Vertrouwen, WantrouwenReden};

const KEY_USAGE: ObjectIdentifier = ObjectIdentifier::new_unwrap("2.5.29.15");
const BASIC_CONSTRAINTS: ObjectIdentifier = ObjectIdentifier::new_unwrap("2.5.29.19");
const EXT_KEY_USAGE: ObjectIdentifier = ObjectIdentifier::new_unwrap("2.5.29.37");
const ID_KP_TIME_STAMPING: ObjectIdentifier = ObjectIdentifier::new_unwrap("1.3.6.1.5.5.7.3.8");
const ANY_EXTENDED_KEY_USAGE: ObjectIdentifier = ObjectIdentifier::new_unwrap("2.5.29.37.0");
const ID_KP_SERVER_AUTH: ObjectIdentifier = ObjectIdentifier::new_unwrap("1.3.6.1.5.5.7.3.1");
const ID_KP_CLIENT_AUTH: ObjectIdentifier = ObjectIdentifier::new_unwrap("1.3.6.1.5.5.7.3.2");
const ID_KP_EMAIL_PROTECTION: ObjectIdentifier = ObjectIdentifier::new_unwrap("1.3.6.1.5.5.7.3.4");
const ID_KP_DOCUMENT_SIGNING: ObjectIdentifier = ObjectIdentifier::new_unwrap("1.3.6.1.5.5.7.3.36");

/// Concrete doelen waarmee een ondertekenaar een document mag ondertekenen. De
/// laatste twee zijn documentondertekenings-OID's van een leverancier.
const ONDERTEKENDOELEN: [ObjectIdentifier; 4] = [
    ID_KP_EMAIL_PROTECTION,
    ID_KP_DOCUMENT_SIGNING,
    ObjectIdentifier::new_unwrap("1.3.6.1.4.1.311.10.3.12"),
    ObjectIdentifier::new_unwrap("1.2.840.113583.1.1.5"),
];

/// Extensies die kritiek mogen zijn. AKI en SKI horen nooit kritiek te zijn,
/// maar worden getolereerd.
const BEGREPEN_EXTENSIES: [ObjectIdentifier; 9] = [
    KEY_USAGE,
    BASIC_CONSTRAINTS,
    EXT_KEY_USAGE,
    ObjectIdentifier::new_unwrap("2.5.29.17"), // subjectAltName
    ObjectIdentifier::new_unwrap("2.5.29.32"), // certificatePolicies
    ObjectIdentifier::new_unwrap("2.5.29.36"), // policyConstraints
    ObjectIdentifier::new_unwrap("2.5.29.54"), // inhibitAnyPolicy
    ObjectIdentifier::new_unwrap("2.5.29.35"), // authorityKeyIdentifier
    ObjectIdentifier::new_unwrap("2.5.29.14"), // subjectKeyIdentifier
];

/// Hoogstens zoveel certificaten per keten, blad en anker inbegrepen.
const MAX_KETEN: usize = 10;
/// Hoogstens zoveel certificaathandtekeningen per [`beoordeel`].
const MAX_HANDTEKENINGCONTROLES: usize = 100;
/// Hoogstens zoveel knopen (aanroepen van de zoekstap) per [`beoordeel`].
const MAX_KNOPEN: usize = 1000;

/// Een verzameling doelen (extendedKeyUsage-OID's).
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum Doelen {
    #[default]
    Alle,
    Alleen(Vec<ObjectIdentifier>),
}

impl Doelen {
    fn bevat(&self, oid: &ObjectIdentifier) -> bool {
        match self {
            Doelen::Alle => true,
            Doelen::Alleen(v) => v.contains(oid),
        }
    }
}

/// Beperking van een wortel voor bladen die na een tijdstip zijn uitgegeven.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Beperking {
    /// Bladen met notBefore ná dit tijdstip (Unix-seconden) ...
    pub na_unix: i64,
    /// ... gelden niet meer voor deze doelen.
    pub doelen: Doelen,
}

/// Waarvoor een wortel als anker mag dienen (zie de moduledocumentatie).
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Wortelgebruik {
    pub doelen: Doelen,
    /// Alleen anker voor tijdstippen en bladen (notBefore) vóór dit tijdstip.
    pub uitgeschakeld_vanaf: Option<i64>,
    pub beperking_na: Option<Beperking>,
}

impl Wortelgebruik {
    /// Staat de wortel `rol` toe voor een blad met notBefore `blad_van`?
    fn rol_toegestaan(&self, rol: Rol, blad_van: i64) -> bool {
        let beperkt = |o: &ObjectIdentifier| {
            self.beperking_na.as_ref().is_some_and(|b| blad_van > b.na_unix && b.doelen.bevat(o))
        };
        let mag = |o: &ObjectIdentifier| self.doelen.bevat(o) && !beperkt(o);
        let mag_elk = matches!(&self.doelen, Doelen::Alleen(v) if v.contains(&ANY_EXTENDED_KEY_USAGE))
            && !beperkt(&ANY_EXTENDED_KEY_USAGE);
        match rol {
            Rol::Ondertekenaar => {
                mag_elk
                    || ONDERTEKENDOELEN.iter().any(mag)
                    || (mag(&ID_KP_CLIENT_AUTH) && !mag(&ID_KP_SERVER_AUTH))
            }
            Rol::Tijdstempeldienst => mag_elk || mag(&ID_KP_TIME_STAMPING),
        }
    }

    fn uitgeschakeld(&self, tijd_unix: i64, blad_van: i64) -> bool {
        self.uitgeschakeld_vanaf.is_some_and(|d| tijd_unix >= d || blad_van >= d)
    }
}

/// Wat het platform over één wortel levert, vóór het archief wordt opgebouwd.
#[derive(Debug, Clone)]
pub struct Wortelgegevens {
    pub der: Vec<u8>,
    /// `None`: de doelen waren niet te lezen; de wortel wordt weggelaten.
    pub doelen: Option<Doelen>,
    /// `Some(None)`: uitgeschakeld zonder datum; de wortel wordt weggelaten.
    pub uitgeschakeld_vanaf: Option<Option<i64>>,
    pub beperking_na: Option<Beperking>,
}

impl Wortelgegevens {
    /// Een wortel zonder beperkingen.
    pub fn onbeperkt(der: Vec<u8>) -> Wortelgegevens {
        Wortelgegevens { der, doelen: Some(Doelen::Alle), uitgeschakeld_vanaf: None, beperking_na: None }
    }
}

struct Wortel {
    certificaat: Certificaat,
    gebruik: Wortelgebruik,
}

/// Wat bij het opbouwen van het archief is weggelaten.
#[derive(Debug, Default, PartialEq, Eq)]
struct Weggelaten {
    doelen_onleesbaar: usize,
    uitgeschakeld: usize,
    gewantrouwd: usize,
}

pub struct Vertrouwensarchief {
    wortels: Vec<Wortel>,
    /// DER van gewantrouwde certificaten: nooit anker, nooit tussencertificaat.
    gewantrouwd: Vec<Vec<u8>>,
}

impl Vertrouwensarchief {
    pub fn leeg() -> Vertrouwensarchief {
        Vertrouwensarchief { wortels: Vec::new(), gewantrouwd: Vec::new() }
    }

    /// Wortels zonder beperkingen. Onleesbare certificaten worden overgeslagen.
    #[cfg(test)]
    pub fn uit_der<'a>(certificaten: impl IntoIterator<Item = &'a [u8]>) -> Vertrouwensarchief {
        Vertrouwensarchief::uit_wortelgegevens(certificaten.into_iter().map(|d| Wortelgegevens::onbeperkt(d.to_vec())), &[])
    }

    /// Archief uit platformgegevens per wortel en gewantrouwde certificaten
    /// (DER). Weggelaten: onleesbare certificaten, wortels met onleesbare
    /// doelen, wortels die zonder datum zijn uitgeschakeld en gewantrouwde
    /// certificaten. Dubbele wortels (zelfde DER) tellen één keer.
    pub fn uit_wortelgegevens(
        wortels: impl IntoIterator<Item = Wortelgegevens>,
        gewantrouwd: &[Vec<u8>],
    ) -> Vertrouwensarchief {
        Vertrouwensarchief::bouw(wortels, gewantrouwd).0
    }

    fn bouw(wortels: impl IntoIterator<Item = Wortelgegevens>, gewantrouwd: &[Vec<u8>]) -> (Vertrouwensarchief, Weggelaten) {
        let mut weg = Weggelaten::default();
        let mut archief = Vertrouwensarchief { wortels: Vec::new(), gewantrouwd: gewantrouwd.to_vec() };
        for w in wortels {
            if gewantrouwd.contains(&w.der) {
                weg.gewantrouwd += 1;
                continue;
            }
            let Some(doelen) = w.doelen else {
                weg.doelen_onleesbaar += 1;
                continue;
            };
            let uitgeschakeld_vanaf = match w.uitgeschakeld_vanaf {
                Some(None) => {
                    weg.uitgeschakeld += 1;
                    continue;
                }
                Some(Some(d)) => Some(d),
                None => None,
            };
            let Some(certificaat) = lees_certificaat(&w.der) else { continue };
            if archief.wortels.iter().any(|b| b.certificaat.der == certificaat.der) {
                continue;
            }
            archief.wortels.push(Wortel {
                certificaat,
                gebruik: Wortelgebruik { doelen, uitgeschakeld_vanaf, beperking_na: w.beperking_na },
            });
        }
        (archief, weg)
    }

    /// Het rootarchief van het besturingssysteem, bij het eerste gebruik geladen
    /// (zie de moduledocumentatie).
    pub fn systeem() -> &'static Vertrouwensarchief {
        static ARCHIEF: OnceLock<Vertrouwensarchief> = OnceLock::new();
        ARCHIEF.get_or_init(|| {
            // Een paniek in het platformarchief geeft een leeg archief, voor de
            // rest van de sessie (alles "geen keten").
            let (wortels, gewantrouwd) = match std::panic::catch_unwind(laad_platformarchief) {
                Ok(geladen) => geladen,
                Err(_) => {
                    log::warn!("[handtekening] rootarchief: laden mislukt, leeg archief voor deze sessie");
                    return Vertrouwensarchief::leeg();
                }
            };
            let (archief, weg) = Vertrouwensarchief::bouw(wortels, &gewantrouwd);
            if weg.doelen_onleesbaar > 0 {
                log::warn!(
                    "[handtekening] rootarchief: {} wortel(s) weggelaten, doelen niet te lezen",
                    weg.doelen_onleesbaar
                );
            }
            log::info!(
                "[handtekening] rootarchief: {} certificaten ({} voor ondertekenen, {} voor tijdstempels); \
                 weggelaten: {} uitgeschakeld, {} gewantrouwd; {} gewantrouwde certificaten",
                archief.aantal(),
                archief.aantal_voor(Rol::Ondertekenaar),
                archief.aantal_voor(Rol::Tijdstempeldienst),
                weg.uitgeschakeld,
                weg.gewantrouwd,
                gewantrouwd.len()
            );
            archief
        })
    }

    pub fn aantal(&self) -> usize {
        self.wortels.len()
    }

    /// Aantal wortels waarvan de doelen `rol` toestaan, los van tijdsafhankelijke
    /// beperkingen (104, 126/127).
    pub fn aantal_voor(&self, rol: Rol) -> usize {
        self.wortels.iter().filter(|w| w.gebruik.rol_toegestaan(rol, i64::MIN)).count()
    }

    fn anker(&self, c: &Certificaat) -> Option<&Wortelgebruik> {
        self.wortels.iter().find(|w| w.certificaat.der == c.der).map(|w| &w.gebruik)
    }

    fn is_gewantrouwd(&self, c: &Certificaat) -> bool {
        self.gewantrouwd.contains(&c.der)
    }
}

/// Mag een certificaat met deze extendedKeyUsage documenten ondertekenen?
fn eku_voor_ondertekenen(eku: &[ObjectIdentifier]) -> bool {
    eku.contains(&ANY_EXTENDED_KEY_USAGE)
        || eku.iter().any(|o| ONDERTEKENDOELEN.contains(o))
        || (eku.contains(&ID_KP_CLIENT_AUTH) && !eku.contains(&ID_KP_SERVER_AUTH))
}

/// Staat deze (niet-lege) doorsnede van extendedKeyUsage `rol` toe?
fn eku_voor_rol(eku: &[ObjectIdentifier], rol: Rol) -> bool {
    match rol {
        Rol::Ondertekenaar => eku_voor_ondertekenen(eku),
        Rol::Tijdstempeldienst => eku.contains(&ID_KP_TIME_STAMPING) || eku.contains(&ANY_EXTENDED_KEY_USAGE),
    }
}

/// Doorsnede van extendedKeyUsage over `certificaten`; `None` als geen ervan
/// beperkt (geen extensie of anyExtendedKeyUsage). Een onleesbare extensie
/// beperkt tot niets.
fn eku_doorsnede(certificaten: &[&Certificaat]) -> Option<Vec<ObjectIdentifier>> {
    let mut doorsnede: Option<Vec<ObjectIdentifier>> = None;
    for c in certificaten {
        let Some(e) = extensie(c, EXT_KEY_USAGE) else { continue };
        let lijst = ExtendedKeyUsage::from_der(e).map(|k| k.0).unwrap_or_default();
        if lijst.contains(&ANY_EXTENDED_KEY_USAGE) {
            continue;
        }
        doorsnede = Some(match doorsnede {
            None => lijst,
            Some(d) => d.into_iter().filter(|o| lijst.contains(o)).collect(),
        });
    }
    doorsnede
}

#[cfg(windows)]
fn laad_platformarchief() -> (Vec<Wortelgegevens>, Vec<Vec<u8>>) {
    windows_archief::laad()
}

#[cfg(not(windows))]
fn laad_platformarchief() -> (Vec<Wortelgegevens>, Vec<Vec<u8>>) {
    let geladen = rustls_native_certs::load_native_certs();
    if !geladen.errors.is_empty() {
        log::warn!("[handtekening] rootarchief: {} fout(en) bij laden", geladen.errors.len());
    }
    (geladen.certs.iter().map(|c| Wortelgegevens::onbeperkt(c.to_vec())).collect(), Vec::new())
}

/// FILETIME (100 ns sinds 1601) als Unix-seconden; `None` bij een lege of
/// nul-datum.
#[cfg_attr(not(windows), allow(dead_code))]
fn filetime_unix(bytes: &[u8]) -> Option<i64> {
    let ft = u64::from_le_bytes(bytes.get(..8)?.try_into().ok()?);
    if ft == 0 {
        return None;
    }
    Some(i64::try_from(ft / 10_000_000).unwrap_or(i64::MAX).saturating_sub(11_644_473_600))
}

/// Doelen uit eigenschap 127 (DER-gecodeerde extendedKeyUsage); ontbreekt of
/// onleesbaar: alle doelen (de beperking geldt dan voor alles).
#[cfg_attr(not(windows), allow(dead_code))]
fn beperking_uit_eigenschappen(na: &[u8], doelen: Option<&[u8]>) -> Beperking {
    Beperking {
        na_unix: filetime_unix(na).unwrap_or(i64::MIN),
        doelen: match doelen.map(ExtendedKeyUsage::from_der) {
            Some(Ok(eku)) => Doelen::Alleen(eku.0),
            _ => Doelen::Alle,
        },
    }
}

#[cfg(windows)]
mod windows_archief {
    use std::ffi::CStr;
    use std::ptr;

    use const_oid::ObjectIdentifier;
    use windows_sys::Win32::Foundation::{GetLastError, SetLastError, CRYPT_E_NOT_FOUND};
    use windows_sys::Win32::Security::Cryptography as wc;

    use super::{beperking_uit_eigenschappen, filetime_unix, Doelen, Wortelgegevens};

    struct Winkel(wc::HCERTSTORE);

    impl Drop for Winkel {
        fn drop(&mut self) {
            // SAFETY: een geldige, door CertOpenStore geopende winkel.
            unsafe { wc::CertCloseStore(self.0, 0) };
        }
    }

    /// Opent een systeemarchief alleen-lezen.
    fn open(naam: &str, locatie: u32) -> Option<Winkel> {
        let breed: Vec<u16> = naam.encode_utf16().chain(Some(0)).collect();
        // SAFETY: `breed` is een met nul afgesloten UTF-16-string die de aanroep overleeft.
        let h = unsafe {
            wc::CertOpenStore(
                wc::CERT_STORE_PROV_SYSTEM_W,
                0,
                0,
                locatie | wc::CERT_STORE_READONLY_FLAG | wc::CERT_STORE_OPEN_EXISTING_FLAG,
                breed.as_ptr().cast(),
            )
        };
        (!h.is_null()).then_some(Winkel(h))
    }

    fn voor_elk(winkel: &Winkel, mut f: impl FnMut(*const wc::CERT_CONTEXT)) {
        let mut ctx: *const wc::CERT_CONTEXT = ptr::null();
        loop {
            // SAFETY: `ctx` is null of de vorige context uit deze winkel; de
            // functie geeft die vrij en levert de volgende.
            ctx = unsafe { wc::CertEnumCertificatesInStore(winkel.0, ctx) };
            if ctx.is_null() {
                break;
            }
            f(ctx);
        }
    }

    fn der(ctx: *const wc::CERT_CONTEXT) -> Vec<u8> {
        // SAFETY: `ctx` is een geldige context tijdens de opsomming.
        unsafe {
            let c = &*ctx;
            if c.pbCertEncoded.is_null() {
                return Vec::new();
            }
            std::slice::from_raw_parts(c.pbCertEncoded, c.cbCertEncoded as usize).to_vec()
        }
    }

    fn eigenschap(ctx: *const wc::CERT_CONTEXT, id: u32) -> Option<Vec<u8>> {
        let mut n = 0u32;
        // SAFETY: eerst de grootte opvragen, dan in een buffer van die grootte lezen.
        unsafe {
            if wc::CertGetCertificateContextProperty(ctx, id, ptr::null_mut(), &mut n) == 0 {
                return None;
            }
            let mut buf = vec![0u8; n as usize];
            if n > 0 && wc::CertGetCertificateContextProperty(ctx, id, buf.as_mut_ptr().cast(), &mut n) == 0 {
                return None;
            }
            buf.truncate(n as usize);
            Some(buf)
        }
    }

    /// Doelen volgens Windows (extensie en eigenschap samen); `None` bij een fout.
    fn doelen(ctx: *const wc::CERT_CONTEXT) -> Option<Doelen> {
        let mut n = 0u32;
        // SAFETY: grootte opvragen, dan lezen in een uitgelijnde buffer van
        // minstens die grootte; de OID-pointers wijzen binnen die buffer.
        unsafe {
            if wc::CertGetEnhancedKeyUsage(ctx, 0, ptr::null_mut(), &mut n) == 0 {
                return None;
            }
            let woorden = (n as usize).div_ceil(std::mem::size_of::<usize>()).max(2);
            let mut buf = vec![0usize; woorden];
            let mut n = u32::try_from(woorden * std::mem::size_of::<usize>()).ok()?;
            let usage = buf.as_mut_ptr().cast::<wc::CTL_USAGE>();
            SetLastError(0);
            if wc::CertGetEnhancedKeyUsage(ctx, 0, usage, &mut n) == 0 {
                return None;
            }
            let aantal = (*usage).cUsageIdentifier as usize;
            if aantal == 0 {
                // Nul doelen: CRYPT_E_NOT_FOUND = alle doelen, 0 = geen doel.
                return match GetLastError() {
                    e if e == CRYPT_E_NOT_FOUND as u32 => Some(Doelen::Alle),
                    0 => Some(Doelen::Alleen(Vec::new())),
                    _ => None,
                };
            }
            let lijst = (*usage).rgpszUsageIdentifier;
            if lijst.is_null() {
                return None;
            }
            let mut oids = Vec::with_capacity(aantal);
            for i in 0..aantal {
                let p = *lijst.add(i);
                if p.is_null() {
                    continue;
                }
                // Onleesbare OID's tellen niet mee.
                if let Some(o) = CStr::from_ptr(p.cast()).to_str().ok().and_then(|s| ObjectIdentifier::new(s).ok()) {
                    oids.push(o);
                }
            }
            Some(Doelen::Alleen(oids))
        }
    }

    const UITGESCHAKELD: u32 = wc::CERT_DISALLOWED_FILETIME_PROP_ID;
    const NIET_NA: u32 = wc::CERT_NOT_BEFORE_FILETIME_PROP_ID;
    const NIET_NA_DOELEN: u32 = wc::CERT_NOT_BEFORE_ENHKEY_USAGE_PROP_ID;

    fn wortelgegevens(ctx: *const wc::CERT_CONTEXT) -> Wortelgegevens {
        Wortelgegevens {
            der: der(ctx),
            doelen: doelen(ctx),
            uitgeschakeld_vanaf: eigenschap(ctx, UITGESCHAKELD).map(|ft| filetime_unix(&ft)),
            beperking_na: eigenschap(ctx, NIET_NA)
                .map(|ft| beperking_uit_eigenschappen(&ft, eigenschap(ctx, NIET_NA_DOELEN).as_deref())),
        }
    }

    pub(super) fn laad() -> (Vec<Wortelgegevens>, Vec<Vec<u8>>) {
        let mut gewantrouwd: Vec<Vec<u8>> = Vec::new();
        for locatie in [wc::CERT_SYSTEM_STORE_CURRENT_USER, wc::CERT_SYSTEM_STORE_LOCAL_MACHINE] {
            match open("Disallowed", locatie) {
                Some(w) => voor_elk(&w, |ctx| {
                    let d = der(ctx);
                    if !d.is_empty() && !gewantrouwd.contains(&d) {
                        gewantrouwd.push(d);
                    }
                }),
                None => log::info!("[handtekening] archief Disallowed ({locatie:#x}) niet te openen"),
            }
        }
        let Some(root) = open("ROOT", wc::CERT_SYSTEM_STORE_CURRENT_USER) else {
            log::warn!("[handtekening] rootarchief niet te openen: {}", std::io::Error::last_os_error());
            return (Vec::new(), gewantrouwd);
        };
        let mut wortels = Vec::new();
        voor_elk(&root, |ctx| wortels.push(wortelgegevens(ctx)));
        (wortels, gewantrouwd)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Rol {
    Ondertekenaar,
    Tijdstempeldienst,
}

#[derive(Debug, Clone)]
pub struct Ketenuitkomst {
    /// Altijd `Vertrouwd` of `NietVertrouwd`, nooit `NietBepaald`.
    pub vertrouwen: Vertrouwen,
    /// `keten[0]` is het blad. Bij `Vertrouwd` het gevonden pad tot en met het
    /// anker; anders het meest gevorderde pad (zie moduledocumentatie), met het
    /// anker als laatste element als dat pad er een heeft.
    pub keten: Vec<Certificaat>,
    /// Een gecontroleerde certificaathandtekening in de keten gebruikt SHA-1.
    /// De eigen handtekening van het anker telt niet mee (die wordt niet
    /// gecontroleerd). Alleen een waarschuwing: het oordeel verandert niet.
    pub zwak_algoritme: bool,
    /// De zoektocht is op het knoop- of handtekeningbudget afgebroken. Bij
    /// `NietVertrouwd` is de reden dan "binnen het budget", niet definitief.
    pub budget_op: bool,
}

/// Het beste mislukte pad tot nu toe.
enum Beste<'a> {
    Niets,
    /// Doodlopend pad; `true` als een kandidaat aan het eind alleen op een
    /// niet-ondersteund algoritme strandde.
    Doodlopend(Vec<&'a Certificaat>, bool),
    /// Pad met anker; eerste foutpositie en reden.
    Anker(Vec<&'a Certificaat>, usize, WantrouwenReden),
}

struct Zoektocht<'a> {
    kandidaten: Vec<&'a Certificaat>,
    archief: &'a Vertrouwensarchief,
    tijd_unix: i64,
    rol: Rol,
    controles: usize,
    /// Hoogstens zoveel handtekeningcontroles in deze beoordeling.
    max_controles: usize,
    knopen: usize,
    budget_op: bool,
    /// (kind, publieke sleutel van de kandidaat) → uitkomst van de handtekeningcontrole.
    uitkomsten: HashMap<(*const Certificaat, &'a [u8]), Result<(), bool>>,
    beste: Beste<'a>,
}

impl<'a> Zoektocht<'a> {
    /// Zoekt verder vanaf het laatste certificaat van `pad`; `Some` bij een kloppend pad.
    fn zoek(&mut self, pad: &mut Vec<&'a Certificaat>) -> Option<Vec<&'a Certificaat>> {
        self.knopen += 1;
        let huidig = *pad.last()?;
        let blad_van = pad.first().map_or(i64::MIN, |b| seconden(&b.x509.tbs_certificate.validity.not_before));
        if let Some(gebruik) = self.archief.anker(huidig).filter(|g| !g.uitgeschakeld(self.tijd_unix, blad_van)) {
            match beoordeel_pad(pad, self.tijd_unix, self.rol, gebruik) {
                None => return Some(pad.clone()),
                Some((positie, reden)) => {
                    let beter = match &self.beste {
                        Beste::Anker(_, p, _) => positie > *p,
                        _ => true,
                    };
                    if beter {
                        self.beste = Beste::Anker(pad.clone(), positie, reden);
                    }
                    return None;
                }
            }
        }
        let mut niet_ondersteund = false;
        if pad.len() < MAX_KETEN {
            let mut volgorde: Vec<usize> = (0..self.kandidaten.len())
                .filter(|&i| {
                    let k = self.kandidaten[i];
                    k.onderwerp_der == huidig.uitgever_der
                        && !pad.iter().any(|p| p.onderwerp_der == k.onderwerp_der && p.spki_der == k.spki_der)
                })
                .collect();
            volgorde.sort_by_key(|&i| !geldig_op(self.kandidaten[i], self.tijd_unix));
            for i in volgorde {
                let k = self.kandidaten[i];
                let sleutel = (huidig as *const Certificaat, k.spki_der.as_slice());
                let uitkomst = match self.uitkomsten.get(&sleutel) {
                    Some(u) => *u,
                    None => {
                        if self.controles >= self.max_controles {
                            self.budget_op = true;
                            break;
                        }
                        self.controles += 1;
                        let u = match controleer_certificaathandtekening(
                            &k.spki_der,
                            &huidig.handtekeningalgoritme,
                            &[huidig.tbs_der.as_slice()],
                            &huidig.handtekening,
                        ) {
                            Ok(()) => Ok(()),
                            Err(WaardeFout::NietOndersteund(_)) => Err(true),
                            Err(WaardeFout::KloptNiet) => Err(false),
                        };
                        self.uitkomsten.insert(sleutel, u);
                        u
                    }
                };
                match uitkomst {
                    Ok(()) => {
                        if self.knopen >= MAX_KNOPEN {
                            self.budget_op = true;
                            break;
                        }
                        pad.push(k);
                        if let Some(gevonden) = self.zoek(pad) {
                            return Some(gevonden);
                        }
                        pad.pop();
                    }
                    Err(true) => niet_ondersteund = true,
                    Err(false) => {}
                }
            }
        }
        let beter = match &self.beste {
            Beste::Niets => true,
            Beste::Doodlopend(p, n) => pad.len() > p.len() || (pad.len() == p.len() && niet_ondersteund && !n),
            Beste::Anker(..) => false,
        };
        if beter {
            self.beste = Beste::Doodlopend(pad.clone(), niet_ondersteund);
        }
        None
    }
}

/// Bouwt en beoordeelt de keten van `blad` naar het archief op tijdstip `tijd_unix`.
pub fn beoordeel(
    blad: &Certificaat,
    tussen: &[Certificaat],
    archief: &Vertrouwensarchief,
    tijd_unix: i64,
    rol: Rol,
) -> Ketenuitkomst {
    beoordeel_met_telling(blad, tussen, archief, tijd_unix, rol).0
}

/// Als [`beoordeel`], met hoogstens `budget` handtekeningcontroles (en nooit
/// meer dan [`MAX_HANDTEKENINGCONTROLES`]). Geeft ook het aantal gebruikte
/// controles, zodat de aanroeper één budget over meerdere beoordelingen kan
/// delen. Is het budget op, dan staat [`Ketenuitkomst::budget_op`] aan.
pub fn beoordeel_binnen(
    blad: &Certificaat,
    tussen: &[Certificaat],
    archief: &Vertrouwensarchief,
    tijd_unix: i64,
    rol: Rol,
    budget: usize,
) -> (Ketenuitkomst, usize) {
    let (uitkomst, telling) = zoek_keten(blad, tussen, archief, tijd_unix, rol, budget.min(MAX_HANDTEKENINGCONTROLES));
    (uitkomst, telling.controles)
}

/// Aantal handtekeningcontroles en knopen van één beoordeling.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Telling {
    controles: usize,
    knopen: usize,
}

/// [`beoordeel`], plus de telling van controles en knopen.
fn beoordeel_met_telling(
    blad: &Certificaat,
    tussen: &[Certificaat],
    archief: &Vertrouwensarchief,
    tijd_unix: i64,
    rol: Rol,
) -> (Ketenuitkomst, Telling) {
    zoek_keten(blad, tussen, archief, tijd_unix, rol, MAX_HANDTEKENINGCONTROLES)
}

fn zoek_keten(
    blad: &Certificaat,
    tussen: &[Certificaat],
    archief: &Vertrouwensarchief,
    tijd_unix: i64,
    rol: Rol,
    max_controles: usize,
) -> (Ketenuitkomst, Telling) {
    let mut kandidaten: Vec<&Certificaat> = Vec::new();
    for c in archief.wortels.iter().map(|w| &w.certificaat).chain(tussen.iter()) {
        if !archief.is_gewantrouwd(c) && !kandidaten.iter().any(|k| k.der == c.der) {
            kandidaten.push(c);
        }
    }
    let mut zoektocht = Zoektocht {
        kandidaten,
        archief,
        tijd_unix,
        rol,
        controles: 0,
        max_controles,
        knopen: 0,
        budget_op: false,
        uitkomsten: HashMap::new(),
        beste: Beste::Niets,
    };
    let mut pad = vec![blad];
    let (vertrouwen, keten) = match zoektocht.zoek(&mut pad) {
        Some(gevonden) => (Vertrouwen::Vertrouwd, gevonden),
        None => {
            let niet = |reden| Vertrouwen::NietVertrouwd { reden };
            match std::mem::replace(&mut zoektocht.beste, Beste::Niets) {
                Beste::Anker(p, _, reden) => (niet(reden), p),
                Beste::Doodlopend(p, true) => (niet(WantrouwenReden::AlgoritmeNietOndersteund), p),
                Beste::Doodlopend(p, false) => (niet(WantrouwenReden::GeenKeten), p),
                Beste::Niets => (niet(WantrouwenReden::GeenKeten), vec![blad]),
            }
        }
    };
    let keten: Vec<Certificaat> = keten.into_iter().cloned().collect();
    // Alle certificaten behalve het laatste zijn door hun opvolger in de keten gecontroleerd.
    let zwak_algoritme = keten
        .iter()
        .rev()
        .skip(1)
        .any(|c| gebruikte_hash(&c.handtekeningalgoritme, None).is_some_and(Hashalg::is_zwak));
    let telling = Telling { controles: zoektocht.controles, knopen: zoektocht.knopen };
    (Ketenuitkomst { vertrouwen, keten, zwak_algoritme, budget_op: zoektocht.budget_op }, telling)
}

fn seconden(t: &x509_cert::time::Time) -> i64 {
    i64::try_from(t.to_unix_duration().as_secs()).unwrap_or(i64::MAX)
}

fn geldig_op(c: &Certificaat, tijd_unix: i64) -> bool {
    let v = &c.x509.tbs_certificate.validity;
    seconden(&v.not_before) <= tijd_unix && tijd_unix <= seconden(&v.not_after)
}

fn extensie_met_oid(c: &Certificaat, oid: ObjectIdentifier) -> Option<&Extension> {
    c.x509.tbs_certificate.extensions.as_ref()?.iter().find(|e| e.extn_id == oid)
}

fn extensie(c: &Certificaat, oid: ObjectIdentifier) -> Option<&[u8]> {
    extensie_met_oid(c, oid).map(|e| e.extn_value.as_bytes())
}

/// Beoordeelt een pad van blad (`pad[0]`) tot en met anker (laatste), met de
/// doelen van het anker volgens het archief. `None` als het klopt, anders de
/// eerste foutpositie en de reden (`Verlopen` gaat voor `Sleutelgebruik`).
fn beoordeel_pad(
    pad: &[&Certificaat],
    tijd_unix: i64,
    rol: Rol,
    anker: &Wortelgebruik,
) -> Option<(usize, WantrouwenReden)> {
    let verlopen = pad.iter().position(|c| !geldig_op(c, tijd_unix));
    let blad_van = pad.first().map_or(i64::MIN, |b| seconden(&b.x509.tbs_certificate.validity.not_before));
    let laatste = pad.len().saturating_sub(1);
    let gebruik = (0..pad.len())
        .find(|&i| !gebruik_klopt_op(pad, i, rol) || (i == laatste && !anker.rol_toegestaan(rol, blad_van)));
    match (verlopen, gebruik) {
        (None, None) => None,
        (Some(v), g) => Some((g.map_or(v, |g| g.min(v)), WantrouwenReden::Verlopen)),
        (None, Some(g)) => Some((g, WantrouwenReden::Sleutelgebruik)),
    }
}

fn zelf_uitgegeven(c: &Certificaat) -> bool {
    c.onderwerp_der == c.uitgever_der
}

/// Sleutelgebruik, CA-eisen, EKU-doorsnede, pathlen en kritieke extensies van `pad[i]`.
fn gebruik_klopt_op(pad: &[&Certificaat], i: usize, rol: Rol) -> bool {
    let Some(c) = pad.get(i) else { return false };
    let onbegrepen_kritiek = c
        .x509
        .tbs_certificate
        .extensions
        .as_deref()
        .unwrap_or_default()
        .iter()
        .any(|e| e.critical && !BEGREPEN_EXTENSIES.contains(&e.extn_id));
    if onbegrepen_kritiek {
        return false;
    }
    if i == 0 {
        return blad_gebruik_klopt(c, rol);
    }
    let anker = i + 1 == pad.len();
    let bc = extensie(c, BASIC_CONSTRAINTS).map(BasicConstraints::from_der);
    if !anker {
        if !matches!(bc, Some(Ok(BasicConstraints { ca: true, .. }))) {
            return false;
        }
        if let Some(ku) = extensie(c, KEY_USAGE) {
            match KeyUsage::from_der(ku) {
                Ok(ku) if ku.key_cert_sign() => {}
                _ => return false,
            }
        }
        // De doorsnede tot en met dit tussencertificaat; ze wordt alleen kleiner,
        // dus de eerste fout ligt bij het eerste certificaat dat haar te klein maakt.
        if eku_doorsnede(pad.get(1..=i).unwrap_or_default()).is_some_and(|d| !eku_voor_rol(&d, rol)) {
            return false;
        }
    }
    if let Some(Ok(BasicConstraints { ca: true, path_len_constraint: Some(max) })) = bc {
        let eronder = pad.get(1..i).unwrap_or_default().iter().filter(|t| !zelf_uitgegeven(t)).count();
        if eronder > usize::from(max) {
            return false;
        }
    }
    true
}

fn blad_gebruik_klopt(blad: &Certificaat, rol: Rol) -> bool {
    if let Some(ku) = extensie(blad, KEY_USAGE) {
        match KeyUsage::from_der(ku) {
            Ok(ku) if ku.digital_signature() || ku.non_repudiation() => {}
            _ => return false,
        }
    }
    let eku = extensie_met_oid(blad, EXT_KEY_USAGE);
    match rol {
        Rol::Ondertekenaar => match eku {
            None => true,
            Some(e) => {
                ExtendedKeyUsage::from_der(e.extn_value.as_bytes()).is_ok_and(|eku| eku_voor_ondertekenen(&eku.0))
            }
        },
        // RFC 3161 §2.3: kritiek en uitsluitend id-kp-timeStamping.
        Rol::Tijdstempeldienst => eku.is_some_and(|e| {
            e.critical
                && ExtendedKeyUsage::from_der(e.extn_value.as_bytes())
                    .is_ok_and(|eku| !eku.0.is_empty() && eku.0.iter().all(|o| *o == ID_KP_TIME_STAMPING))
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn cert(naam: &str) -> Certificaat {
        let pad = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/verifieer").join(naam);
        lees_certificaat(&std::fs::read(pad).unwrap()).unwrap()
    }

    fn van(c: &Certificaat) -> i64 {
        i64::try_from(c.x509.tbs_certificate.validity.not_before.to_unix_duration().as_secs()).unwrap()
    }

    fn tot(c: &Certificaat) -> i64 {
        i64::try_from(c.x509.tbs_certificate.validity.not_after.to_unix_duration().as_secs()).unwrap()
    }

    fn archief(namen: &[&str]) -> Vertrouwensarchief {
        let ders: Vec<Vec<u8>> = namen.iter().map(|n| cert(n).der).collect();
        Vertrouwensarchief::uit_der(ders.iter().map(Vec::as_slice))
    }

    /// Archief met deze wortels zoals ze zijn (ook als de velden zijn aangepast).
    fn met_wortels(wortels: Vec<Certificaat>) -> Vertrouwensarchief {
        let wortels = wortels.into_iter().map(|certificaat| Wortel { certificaat, gebruik: Wortelgebruik::default() });
        Vertrouwensarchief { wortels: wortels.collect(), gewantrouwd: Vec::new() }
    }

    fn niet(reden: WantrouwenReden) -> Vertrouwen {
        Vertrouwen::NietVertrouwd { reden }
    }

    #[test]
    fn keten_via_tussencertificaat_is_vertrouwd() {
        let blad = cert("blad.der");
        let a = archief(&["root.der"]);
        assert_eq!(a.aantal(), 1);
        let u = beoordeel(&blad, &[cert("tussen.der")], &a, van(&blad) + 3600, Rol::Ondertekenaar);
        assert_eq!(u.vertrouwen, Vertrouwen::Vertrouwd);
        assert_eq!(u.keten.len(), 3);
        assert_eq!(u.keten[2].der, cert("root.der").der);
    }

    #[test]
    fn zonder_tussencertificaat_of_archief_geen_keten() {
        let blad = cert("blad.der");
        let tijd = van(&blad) + 3600;
        let u = beoordeel(&blad, &[], &archief(&["root.der"]), tijd, Rol::Ondertekenaar);
        assert_eq!(u.vertrouwen, niet(WantrouwenReden::GeenKeten));
        assert_eq!(u.keten.len(), 1);
        let u = beoordeel(&blad, &[cert("tussen.der")], &Vertrouwensarchief::leeg(), tijd, Rol::Ondertekenaar);
        assert_eq!(u.vertrouwen, niet(WantrouwenReden::GeenKeten));
        assert_eq!(u.keten.len(), 2);
    }

    #[test]
    fn buiten_geldigheid_is_verlopen() {
        let blad = cert("blad.der");
        let a = archief(&["root.der"]);
        let tussen = [cert("tussen.der")];
        let na = beoordeel(&blad, &tussen, &a, tot(&blad) + 86_400, Rol::Ondertekenaar);
        assert_eq!(na.vertrouwen, niet(WantrouwenReden::Verlopen));
        let voor = beoordeel(&blad, &tussen, &a, van(&cert("root.der")) - 86_400, Rol::Ondertekenaar);
        assert_eq!(voor.vertrouwen, niet(WantrouwenReden::Verlopen));
    }

    #[test]
    fn verkeerd_sleutelgebruik() {
        let blad = cert("blad-verkeerd-gebruik.der");
        let u = beoordeel(&blad, &[cert("tussen.der")], &archief(&["root.der"]), van(&blad) + 3600, Rol::Ondertekenaar);
        assert_eq!(u.vertrouwen, niet(WantrouwenReden::Sleutelgebruik));
    }

    #[test]
    fn tijdstempeldienst_vraagt_timestamping() {
        let a = archief(&["root.der"]);
        let tussen = [cert("tussen.der")];
        let tsa = cert("tsa.der");
        let blad = cert("blad.der");
        let tijd = van(&tsa) + 3600;
        assert_eq!(beoordeel(&tsa, &tussen, &a, tijd, Rol::Tijdstempeldienst).vertrouwen, Vertrouwen::Vertrouwd);
        // Een certificaat dat uitsluitend voor tijdstempels is, ondertekent geen documenten.
        assert_eq!(
            beoordeel(&tsa, &tussen, &a, tijd, Rol::Ondertekenaar).vertrouwen,
            niet(WantrouwenReden::Sleutelgebruik)
        );
        assert_eq!(
            beoordeel(&blad, &tussen, &a, tijd, Rol::Tijdstempeldienst).vertrouwen,
            niet(WantrouwenReden::Sleutelgebruik)
        );
    }

    #[test]
    fn ecdsa_keten_is_vertrouwd() {
        let blad = cert("blad-onder-ec-root.der");
        let u = beoordeel(&blad, &[], &archief(&["ec-root.der"]), van(&blad) + 3600, Rol::Ondertekenaar);
        assert_eq!(u.vertrouwen, Vertrouwen::Vertrouwd);
        assert_eq!(u.keten.len(), 2);
    }

    #[test]
    fn wortel_als_blad_wordt_op_gebruik_beoordeeld() {
        let root = cert("root.der");
        let u = beoordeel(&root, &[], &archief(&["root.der"]), van(&root) + 3600, Rol::Ondertekenaar);
        assert_eq!(u.vertrouwen, niet(WantrouwenReden::Sleutelgebruik));
        assert_eq!(u.keten.len(), 1);
    }

    #[test]
    fn nagemaakte_uitgever_telt_niet() {
        let blad = cert("blad.der");
        let mut nep = cert("root.der");
        nep.onderwerp_der = cert("tussen.der").onderwerp_der;
        let a = met_wortels(vec![nep]);
        let u = beoordeel(&blad, &[], &a, van(&blad) + 3600, Rol::Ondertekenaar);
        assert_eq!(u.vertrouwen, niet(WantrouwenReden::GeenKeten));
    }

    #[test]
    fn rommel_in_archief_wordt_overgeslagen() {
        let root = cert("root.der").der;
        let a = Vertrouwensarchief::uit_der([b"rommel".as_slice(), root.as_slice()]);
        assert_eq!(a.aantal(), 1);
    }

    #[test]
    fn systeemarchief_laadt_eenmalig() {
        let a = Vertrouwensarchief::systeem();
        eprintln!("rootarchief van het systeem: {} certificaten", a.aantal());
        assert!(std::ptr::eq(a, Vertrouwensarchief::systeem()));
    }

    #[test]
    fn wortel_met_rsa_8192_is_vertrouwd() {
        let blad = cert("blad-onder-rsa8192.der");
        let u = beoordeel(&blad, &[], &archief(&["root-rsa8192.der"]), van(&blad) + 3600, Rol::Ondertekenaar);
        assert_eq!(u.vertrouwen, Vertrouwen::Vertrouwd);
        assert_eq!(u.keten.len(), 2);
        assert!(!u.zwak_algoritme);
    }

    #[test]
    fn sha1_in_keten_is_vertrouwd_maar_zwak() {
        let blad = cert("blad-sha1-onder-rsa8192.der");
        let u = beoordeel(&blad, &[], &archief(&["root-rsa8192.der"]), van(&blad) + 3600, Rol::Ondertekenaar);
        assert_eq!(u.vertrouwen, Vertrouwen::Vertrouwd);
        assert!(u.zwak_algoritme);
        // De eigen handtekening van het anker telt niet: die wordt niet gecontroleerd.
        let u = beoordeel(&blad, &[], &archief(&["blad-sha1-onder-rsa8192.der"]), van(&blad) + 3600, Rol::Ondertekenaar);
        assert_eq!(u.keten.len(), 1);
        assert!(!u.zwak_algoritme);
    }

    #[test]
    fn beoordeel_geeft_altijd_een_oordeel() {
        let blad = cert("blad.der");
        let tijd = van(&blad) + 3600;
        for a in [Vertrouwensarchief::leeg(), archief(&["root.der"])] {
            for tussen in [vec![], vec![cert("tussen.der")]] {
                for rol in [Rol::Ondertekenaar, Rol::Tijdstempeldienst] {
                    assert_ne!(beoordeel(&blad, &tussen, &a, tijd, rol).vertrouwen, Vertrouwen::NietBepaald);
                }
            }
        }
    }

    /// Beoordeelt `blad` een uur na het begin van zijn geldigheid.
    fn onder_ketenwortel(blad: &str, tussen: &[&str], wortels: &[&str], rol: Rol) -> Ketenuitkomst {
        let blad = cert(blad);
        let tussen: Vec<Certificaat> = tussen.iter().map(|n| cert(n)).collect();
        beoordeel(&blad, &tussen, &archief(wortels), van(&blad) + 3600, rol)
    }

    #[test]
    fn ondertekenaar_met_alleen_serverauth_is_sleutelgebruik() {
        let u = onder_ketenwortel("k-blad-serverauth.der", &["k-tussen.der"], &["k-root.der"], Rol::Ondertekenaar);
        assert_eq!(u.vertrouwen, niet(WantrouwenReden::Sleutelgebruik));
    }

    #[test]
    fn ondertekenaar_met_emailprotection_is_vertrouwd() {
        let u = onder_ketenwortel("k-blad-email.der", &["k-tussen.der"], &["k-root.der"], Rol::Ondertekenaar);
        assert_eq!(u.vertrouwen, Vertrouwen::Vertrouwd);
        assert_eq!(u.keten.len(), 3);
    }

    #[test]
    fn doodlopende_kruiskandidaat_voor_de_goede_blokkeert_niet() {
        let u = onder_ketenwortel(
            "k-blad-email.der",
            &["k-tussen-kruis.der", "k-tussen.der"],
            &["k-root.der"],
            Rol::Ondertekenaar,
        );
        assert_eq!(u.vertrouwen, Vertrouwen::Vertrouwd);
        assert_eq!(u.keten.len(), 3);
        assert_eq!(u.keten[1].der, cert("k-tussen.der").der);
    }

    #[test]
    fn verlopen_en_geldige_versie_van_dezelfde_wortel() {
        for wortels in [["k-root-verlopen.der", "k-root.der"], ["k-root.der", "k-root-verlopen.der"]] {
            let u = onder_ketenwortel("k-blad-email.der", &["k-tussen.der"], &wortels, Rol::Ondertekenaar);
            assert_eq!(u.vertrouwen, Vertrouwen::Vertrouwd, "{wortels:?}");
            assert_eq!(u.keten[2].der, cert("k-root.der").der);
        }
        // Alleen de verlopen versie: de keten bestaat, maar is verlopen.
        let u = onder_ketenwortel("k-blad-email.der", &["k-tussen.der"], &["k-root-verlopen.der"], Rol::Ondertekenaar);
        assert_eq!(u.vertrouwen, niet(WantrouwenReden::Verlopen));
    }

    #[test]
    fn pathlen_wordt_afgedwongen() {
        let u = onder_ketenwortel(
            "k-blad-onder-subtussen.der",
            &["k-subtussen.der", "k-tussen-pathlen0.der"],
            &["k-root.der"],
            Rol::Ondertekenaar,
        );
        assert_eq!(u.vertrouwen, niet(WantrouwenReden::Sleutelgebruik));
        assert_eq!(u.keten.len(), 4);
    }

    #[test]
    fn v1_alleen_als_anker() {
        let u = onder_ketenwortel("k-blad-onder-v1.der", &["k-tussen-v1.der"], &["k-root.der"], Rol::Ondertekenaar);
        assert_eq!(u.vertrouwen, niet(WantrouwenReden::Sleutelgebruik));
        assert_eq!(u.keten.len(), 3);
        let u = onder_ketenwortel("k-blad-onder-wortel-v1.der", &[], &["k-wortel-v1.der"], Rol::Ondertekenaar);
        assert_eq!(u.vertrouwen, Vertrouwen::Vertrouwd);
    }

    #[test]
    fn anker_zonder_basicconstraints_en_keycertsign() {
        let u = onder_ketenwortel("k-blad-onder-wortel-zonder-bc.der", &[], &["k-wortel-zonder-bc.der"], Rol::Ondertekenaar);
        assert_eq!(u.vertrouwen, Vertrouwen::Vertrouwd);
        assert_eq!(u.keten.len(), 2);
    }

    #[test]
    fn onbekende_kritieke_extensies_worden_geweigerd() {
        let u = onder_ketenwortel(
            "k-blad-onder-naambeperking.der",
            &["k-tussen-naambeperking.der"],
            &["k-root.der"],
            Rol::Ondertekenaar,
        );
        assert_eq!(u.vertrouwen, niet(WantrouwenReden::Sleutelgebruik));
        let u = onder_ketenwortel("k-blad-onbekend-kritiek.der", &["k-tussen.der"], &["k-root.der"], Rol::Ondertekenaar);
        assert_eq!(u.vertrouwen, niet(WantrouwenReden::Sleutelgebruik));
        // Kritieke certificatePolicies en subjectAltName zijn bekend.
        let u = onder_ketenwortel("k-blad-beleid-kritiek.der", &["k-tussen.der"], &["k-root.der"], Rol::Ondertekenaar);
        assert_eq!(u.vertrouwen, Vertrouwen::Vertrouwd);
    }

    #[test]
    fn tijdstempeldienst_eku_kritiek_en_uitsluitend_timestamping() {
        for naam in ["k-tsa-niet-kritiek.der", "k-tsa-extra-eku.der"] {
            let u = onder_ketenwortel(naam, &["k-tussen.der"], &["k-root.der"], Rol::Tijdstempeldienst);
            assert_eq!(u.vertrouwen, niet(WantrouwenReden::Sleutelgebruik), "{naam}");
        }
    }

    /// De elf certificaten uit `k-lange-keten.der`, blad eerst.
    fn lange_keten() -> Vec<Certificaat> {
        certificaten_uit("k-lange-keten.der")
    }

    #[test]
    fn keten_van_elf_schakels_is_te_lang() {
        let c = lange_keten();
        assert_eq!(c.len(), 11);
        let tijd = van(&c[0]) + 3600;
        let tien = met_wortels(vec![c[9].clone()]);
        let u = beoordeel(&c[0], &c[1..9], &tien, tijd, Rol::Ondertekenaar);
        assert_eq!(u.vertrouwen, Vertrouwen::Vertrouwd);
        assert_eq!(u.keten.len(), 10);
        let elf = met_wortels(vec![c[10].clone()]);
        let u = beoordeel(&c[0], &c[1..10], &elf, tijd, Rol::Ondertekenaar);
        assert_eq!(u.vertrouwen, niet(WantrouwenReden::GeenKeten));
        assert_eq!(u.keten.len(), 10);
    }

    #[test]
    fn verlopen_tussencertificaat() {
        let u = onder_ketenwortel(
            "k-blad-onder-tussen-verlopen.der",
            &["k-tussen-verlopen.der"],
            &["k-root.der"],
            Rol::Ondertekenaar,
        );
        assert_eq!(u.vertrouwen, niet(WantrouwenReden::Verlopen));
        assert_eq!(u.keten.len(), 3);
    }

    #[test]
    fn token_van_dienst_zonder_timestamping_is_niet_vertrouwd() {
        let pad = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/verifieer");
        let data = std::fs::read(pad.join("data.bin")).unwrap();
        let token = std::fs::read(pad.join("k-tst-zonder-timestamping.der")).unwrap();
        let t = crate::handtekening::tijdstempel::controleer_token(&token, &[data.as_slice()]);
        assert_eq!(t.integriteit, crate::handtekening::status::Integriteit::Intact);
        let tsa = t.tsa.unwrap();
        assert_eq!(tsa.der, cert("k-blad-email.der").der);
        // De genTime is overgenomen uit tst-data.der en kan vóór de ketenwortel
        // liggen; beoordeeld wordt daarom binnen de geldigheid van het blad.
        let u = beoordeel(&tsa, &t.certificaten, &archief(&["k-root.der"]), van(&tsa) + 3600, Rol::Tijdstempeldienst);
        assert_eq!(u.vertrouwen, niet(WantrouwenReden::Sleutelgebruik));
    }

    #[test]
    fn budget_van_handtekeningcontroles() {
        let blad = cert("k-blad-email.der");
        // Kopieën van k-tussen (andere bytes, zelfde inhoud) met k-root als
        // tussencertificaat en een leeg archief: elke kopie kost een eigen
        // controle van k-root over die kopie en loopt dan dood.
        let met_kopieen = |n: usize| {
            let mut tussen: Vec<Certificaat> = (0..n)
                .map(|i| {
                    let mut c = cert("k-tussen.der");
                    c.der.extend_from_slice(&(i as u32).to_be_bytes());
                    c
                })
                .collect();
            tussen.push(cert("k-root.der"));
            beoordeel_met_telling(&blad, &tussen, &Vertrouwensarchief::leeg(), van(&blad) + 3600, Rol::Ondertekenaar)
        };
        let (u, t) = met_kopieen(50);
        assert_eq!(u.vertrouwen, niet(WantrouwenReden::GeenKeten));
        // Eén controle blad←tussen (gedeeld: zelfde sleutel), vijftig tussen←root.
        assert_eq!(t.controles, 51);
        assert!(!u.budget_op, "echte GeenKeten");
        let (u, t) = met_kopieen(150);
        assert_eq!(u.vertrouwen, niet(WantrouwenReden::GeenKeten));
        assert_eq!(t.controles, MAX_HANDTEKENINGCONTROLES);
        assert!(u.budget_op, "GeenKeten binnen het budget");
    }

    #[test]
    fn gedeeld_budget_begrenst_de_beoordeling() {
        let blad = cert("blad.der");
        let a = archief(&["root.der"]);
        let tussen = [cert("tussen.der")];
        let tijd = van(&blad) + 3600;
        let (ruim, gebruikt) = beoordeel_binnen(&blad, &tussen, &a, tijd, Rol::Ondertekenaar, 2000);
        assert_eq!(ruim.vertrouwen, Vertrouwen::Vertrouwd);
        assert!(!ruim.budget_op);
        assert!(gebruikt > 0 && gebruikt <= MAX_HANDTEKENINGCONTROLES, "{gebruikt}");
        // Zonder budget: geen controle, niet vertrouwd, en het budget meldt zich.
        let (op, gebruikt) = beoordeel_binnen(&blad, &tussen, &a, tijd, Rol::Ondertekenaar, 0);
        assert_eq!(gebruikt, 0);
        assert_eq!(op.vertrouwen, niet(WantrouwenReden::GeenKeten));
        assert!(op.budget_op);
    }

    #[test]
    fn handtekeningcontrole_gedeeld_per_sleutel() {
        let blad = cert("k-blad-email.der");
        let kruis = cert("k-tussen-kruis.der");
        let mut tussen: Vec<Certificaat> = (0..150)
            .map(|i| {
                let mut c = kruis.clone();
                c.der.extend_from_slice(&(i as u32).to_be_bytes());
                c
            })
            .collect();
        tussen.push(cert("k-tussen.der"));
        let (u, t) =
            beoordeel_met_telling(&blad, &tussen, &archief(&["k-root.der"]), van(&blad) + 3600, Rol::Ondertekenaar);
        assert_eq!(u.vertrouwen, Vertrouwen::Vertrouwd);
        assert_eq!(t.controles, 2);
        assert!(!u.budget_op);
    }

    #[test]
    fn knoopbudget() {
        let blad = cert("k-blad-email.der");
        let kruis = cert("k-tussen-kruis.der");
        // Doodlopende kopieën van het kruiscertificaat vóór k-tussen: elk een knoop.
        let met_doodlopers = |n: usize| {
            let mut tussen: Vec<Certificaat> = (0..n)
                .map(|i| {
                    let mut c = kruis.clone();
                    c.der.extend_from_slice(&(i as u32).to_be_bytes());
                    c
                })
                .collect();
            tussen.push(cert("k-tussen.der"));
            beoordeel_met_telling(&blad, &tussen, &archief(&["k-root.der"]), van(&blad) + 3600, Rol::Ondertekenaar)
        };
        let (u, t) = met_doodlopers(500);
        assert_eq!(u.vertrouwen, Vertrouwen::Vertrouwd);
        assert_eq!(t.knopen, 503);
        assert!(!u.budget_op);
        let (u, t) = met_doodlopers(1500);
        assert_eq!(u.vertrouwen, niet(WantrouwenReden::GeenKeten));
        assert_eq!(t.knopen, MAX_KNOPEN);
        assert!(u.budget_op);
    }

    #[test]
    fn extended_key_usage_van_de_ondertekenaar() {
        let oid = |s: &str| ObjectIdentifier::new_unwrap(s);
        let toegestaan = [
            "2.5.29.37.0",
            "1.3.6.1.5.5.7.3.4",
            "1.3.6.1.5.5.7.3.36",
            "1.3.6.1.4.1.311.10.3.12",
            "1.2.840.113583.1.1.5",
        ];
        for o in toegestaan {
            assert!(eku_voor_ondertekenen(&[oid(o)]), "{o}");
            assert!(eku_voor_ondertekenen(&[oid("1.3.6.1.5.5.7.3.1"), oid(o)]), "{o} met serverAuth");
        }
        assert!(eku_voor_ondertekenen(&[oid("1.3.6.1.5.5.7.3.2")]));
        assert!(!eku_voor_ondertekenen(&[oid("1.3.6.1.5.5.7.3.2"), oid("1.3.6.1.5.5.7.3.1")]));
        assert!(!eku_voor_ondertekenen(&[oid("1.3.6.1.5.5.7.3.1")]));
        assert!(!eku_voor_ondertekenen(&[oid("1.3.6.1.5.5.7.3.3")]));
        assert!(!eku_voor_ondertekenen(&[oid("1.3.6.1.5.5.7.3.8")]));
        assert!(!eku_voor_ondertekenen(&[]));
    }

    /// De certificaten uit een fixture met DER-certificaten achter elkaar.
    fn certificaten_uit(naam: &str) -> Vec<Certificaat> {
        let bytes = std::fs::read(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/verifieer").join(naam))
            .unwrap();
        let mut rest = bytes.as_slice();
        let mut uit = Vec::new();
        while !rest.is_empty() {
            let (tlv, na) = crate::handtekening::ber::lees_tlv(rest).unwrap();
            uit.push(lees_certificaat(tlv.geheel).unwrap());
            rest = na;
        }
        uit
    }

    #[test]
    fn zelfuitgegeven_certificaten_met_een_sleutel_zijn_snel_klaar() {
        let zelf = certificaten_uit("z-zelfuitgegeven.der");
        assert_eq!(zelf.len(), 10);
        let blad = cert("z-blad.der");
        let start = std::time::Instant::now();
        let u = beoordeel(&blad, &zelf, &archief(&["k-root.der"]), van(&blad) + 3600, Rol::Ondertekenaar);
        assert!(start.elapsed() < std::time::Duration::from_secs(1), "{:?}", start.elapsed());
        assert_eq!(u.vertrouwen, niet(WantrouwenReden::GeenKeten));
    }

    #[test]
    fn eku_van_tussencertificaten_beperkt_de_rol() {
        let onder = |blad: &str, tussen: &str, rol| onder_ketenwortel(blad, &[tussen], &["e-root.der"], rol).vertrouwen;
        let o = Rol::Ondertekenaar;
        let t = Rol::Tijdstempeldienst;
        assert_eq!(
            onder("e-blad-onder-serverauth.der", "e-tussen-serverauth.der", o),
            niet(WantrouwenReden::Sleutelgebruik)
        );
        assert_eq!(onder("e-blad-onder-email.der", "e-tussen-email.der", o), Vertrouwen::Vertrouwd);
        assert_eq!(onder("e-blad-onder-any.der", "e-tussen-any.der", o), Vertrouwen::Vertrouwd);
        assert_eq!(
            onder("e-blad-onder-timestamping.der", "e-tussen-timestamping.der", o),
            niet(WantrouwenReden::Sleutelgebruik)
        );
        assert_eq!(onder("e-tsa-onder-timestamping.der", "e-tussen-timestamping.der", t), Vertrouwen::Vertrouwd);
        assert_eq!(onder("e-tsa-onder-any.der", "e-tussen-any.der", t), Vertrouwen::Vertrouwd);
        assert_eq!(onder("e-tsa-onder-email.der", "e-tussen-email.der", t), niet(WantrouwenReden::Sleutelgebruik));
        assert_eq!(
            onder("e-tsa-onder-serverauth.der", "e-tussen-serverauth.der", t),
            niet(WantrouwenReden::Sleutelgebruik)
        );
        // De fout ligt bij het tussencertificaat, niet bij het blad.
        let u = onder_ketenwortel(
            "e-blad-onder-serverauth.der",
            &["e-tussen-serverauth.der"],
            &["e-root.der"],
            Rol::Ondertekenaar,
        );
        assert_eq!(u.keten.len(), 3);
    }

    #[test]
    fn eku_doorsnede_over_meer_tussencertificaten() {
        let oid = |s: &str| ObjectIdentifier::new_unwrap(s);
        let email = cert("e-tussen-email.der");
        let server = cert("e-tussen-serverauth.der");
        let any = cert("e-tussen-any.der");
        let zonder = cert("k-tussen.der");
        assert_eq!(eku_doorsnede(&[&zonder, &any]), None);
        assert_eq!(eku_doorsnede(&[&email, &any, &zonder]), Some(vec![oid("1.3.6.1.5.5.7.3.4")]));
        assert_eq!(eku_doorsnede(&[&email, &server]), Some(vec![]));
    }

    fn oids(d: &[&str]) -> Doelen {
        Doelen::Alleen(d.iter().map(|s| ObjectIdentifier::new_unwrap(s)).collect())
    }

    const SERVER: &str = "1.3.6.1.5.5.7.3.1";
    const CLIENT: &str = "1.3.6.1.5.5.7.3.2";
    const EMAIL: &str = "1.3.6.1.5.5.7.3.4";
    const TIJD: &str = "1.3.6.1.5.5.7.3.8";

    #[test]
    fn doelen_van_een_wortel_per_rol() {
        let g = |doelen| Wortelgebruik { doelen, ..Wortelgebruik::default() };
        let rollen =
            |w: &Wortelgebruik| (w.rol_toegestaan(Rol::Ondertekenaar, 0), w.rol_toegestaan(Rol::Tijdstempeldienst, 0));
        assert_eq!(rollen(&g(Doelen::Alle)), (true, true));
        assert_eq!(rollen(&g(oids(&[SERVER, EMAIL]))), (true, false));
        assert_eq!(rollen(&g(oids(&[TIJD]))), (false, true));
        assert_eq!(rollen(&g(oids(&["2.5.29.37.0"]))), (true, true));
        assert_eq!(rollen(&g(oids(&[SERVER]))), (false, false));
        assert_eq!(rollen(&g(oids(&[CLIENT, SERVER]))), (false, false));
        assert_eq!(rollen(&g(oids(&[CLIENT]))), (true, false));
        // Windows' "uitgeschakeld voor alle doelen" is een lege lijst.
        assert_eq!(rollen(&g(oids(&[]))), (false, false));
    }

    #[test]
    fn beperking_voor_later_uitgegeven_bladen() {
        let na = 1_000;
        let alleen_email = Wortelgebruik {
            beperking_na: Some(Beperking { na_unix: na, doelen: oids(&[EMAIL]) }),
            ..Wortelgebruik::default()
        };
        // Alle doelen, email beperkt: documentSigning blijft na de datum over.
        assert!(alleen_email.rol_toegestaan(Rol::Ondertekenaar, na));
        assert!(alleen_email.rol_toegestaan(Rol::Ondertekenaar, na + 1));
        let ondertekenen = [EMAIL, "1.3.6.1.5.5.7.3.36", "1.3.6.1.4.1.311.10.3.12", "1.2.840.113583.1.1.5", CLIENT];
        let met_any = Wortelgebruik {
            doelen: oids(&[EMAIL, TIJD, "2.5.29.37.0"]),
            beperking_na: Some(Beperking { na_unix: na, doelen: oids(&ondertekenen) }),
            ..Wortelgebruik::default()
        };
        assert!(met_any.rol_toegestaan(Rol::Ondertekenaar, na));
        // anyExtendedKeyUsage is niet beperkt, dus nog toegestaan.
        assert!(met_any.rol_toegestaan(Rol::Ondertekenaar, na + 1));
        let zonder_any = Wortelgebruik { doelen: oids(&[EMAIL, TIJD]), ..met_any.clone() };
        assert!(zonder_any.rol_toegestaan(Rol::Ondertekenaar, na));
        assert!(!zonder_any.rol_toegestaan(Rol::Ondertekenaar, na + 1));
        assert!(zonder_any.rol_toegestaan(Rol::Tijdstempeldienst, na + 1));
        // Zonder doelen in 127: alles beperkt.
        let alles = Wortelgebruik {
            beperking_na: Some(Beperking { na_unix: na, doelen: Doelen::Alle }),
            ..Wortelgebruik::default()
        };
        assert!(!alles.rol_toegestaan(Rol::Ondertekenaar, na + 1));
        assert!(!alles.rol_toegestaan(Rol::Tijdstempeldienst, na + 1));
    }

    /// Archief met k-root met deze platformgegevens.
    fn k_root_met(pas_aan: impl FnOnce(&mut Wortelgegevens), gewantrouwd: &[Vec<u8>]) -> Vertrouwensarchief {
        let mut w = Wortelgegevens::onbeperkt(cert("k-root.der").der);
        pas_aan(&mut w);
        Vertrouwensarchief::uit_wortelgegevens([w], gewantrouwd)
    }

    fn k_email(a: &Vertrouwensarchief, tijd: i64, rol: Rol) -> Vertrouwen {
        beoordeel(&cert("k-blad-email.der"), &[cert("k-tussen.der")], a, tijd, rol).vertrouwen
    }

    #[test]
    fn injecteerbaar_archief_toetst_doelen_per_rol() {
        let blad = cert("k-blad-email.der");
        let tijd = van(&blad) + 3600;
        let alleen_tijd = k_root_met(|w| w.doelen = Some(oids(&[TIJD])), &[]);
        assert_eq!(k_email(&alleen_tijd, tijd, Rol::Ondertekenaar), niet(WantrouwenReden::Sleutelgebruik));
        assert_eq!(alleen_tijd.aantal_voor(Rol::Ondertekenaar), 0);
        assert_eq!(alleen_tijd.aantal_voor(Rol::Tijdstempeldienst), 1);
        let alleen_email = k_root_met(|w| w.doelen = Some(oids(&[EMAIL])), &[]);
        assert_eq!(k_email(&alleen_email, tijd, Rol::Ondertekenaar), Vertrouwen::Vertrouwd);
        assert_eq!(alleen_email.aantal_voor(Rol::Tijdstempeldienst), 0);
        // Een geldige tijdstempeldienst (e-root) onder een wortel die alleen emailProtection mag.
        let tsa = cert("e-tsa-onder-timestamping.der");
        let e_root = |doelen| {
            Vertrouwensarchief::uit_wortelgegevens(
                [Wortelgegevens { doelen: Some(doelen), ..Wortelgegevens::onbeperkt(cert("e-root.der").der) }],
                &[],
            )
        };
        let tussen = [cert("e-tussen-timestamping.der")];
        let tijd = van(&tsa) + 3600;
        let u = beoordeel(&tsa, &tussen, &e_root(oids(&[EMAIL])), tijd, Rol::Tijdstempeldienst);
        assert_eq!(u.vertrouwen, niet(WantrouwenReden::Sleutelgebruik));
        let u = beoordeel(&tsa, &tussen, &e_root(oids(&[TIJD])), tijd, Rol::Tijdstempeldienst);
        assert_eq!(u.vertrouwen, Vertrouwen::Vertrouwd);
        // Onleesbare doelen: de wortel valt weg (fail-closed).
        let (onleesbaar, weg) = Vertrouwensarchief::bouw(
            [Wortelgegevens { doelen: None, ..Wortelgegevens::onbeperkt(cert("k-root.der").der) }],
            &[],
        );
        assert_eq!((onleesbaar.aantal(), weg.doelen_onleesbaar), (0, 1));
        assert_eq!(k_email(&onleesbaar, van(&blad) + 3600, Rol::Ondertekenaar), niet(WantrouwenReden::GeenKeten));
    }

    #[test]
    fn gewantrouwde_certificaten_zijn_geen_anker_en_geen_tussencertificaat() {
        let blad = cert("k-blad-email.der");
        let tijd = van(&blad) + 3600;
        let (a, weg) =
            Vertrouwensarchief::bouw([Wortelgegevens::onbeperkt(cert("k-root.der").der)], &[cert("k-root.der").der]);
        assert_eq!((a.aantal(), weg.gewantrouwd), (0, 1));
        // Ook niet als tussencertificaat meegegeven.
        let u = beoordeel(&blad, &[cert("k-tussen.der"), cert("k-root.der")], &a, tijd, Rol::Ondertekenaar);
        assert_eq!(u.vertrouwen, niet(WantrouwenReden::GeenKeten));
        assert_eq!(u.keten.len(), 2);
        let a = k_root_met(|_| {}, &[cert("k-tussen.der").der]);
        let u = beoordeel(&blad, &[cert("k-tussen.der")], &a, tijd, Rol::Ondertekenaar);
        assert_eq!(u.vertrouwen, niet(WantrouwenReden::GeenKeten));
        assert_eq!(u.keten.len(), 1);
        // Het kruiscertificaat met dezelfde naam en sleutel blijft een kandidaat.
        let u = beoordeel(&blad, &[cert("k-tussen.der"), cert("k-tussen-kruis.der")], &a, tijd, Rol::Ondertekenaar);
        assert_eq!(u.keten.len(), 2);
        assert_eq!(u.keten[1].der, cert("k-tussen-kruis.der").der);
    }

    #[test]
    fn uitgeschakelde_wortel_alleen_voor_eerdere_tijden_en_bladen() {
        let blad = cert("k-blad-email.der");
        let blad_van = van(&blad);
        let tijd = blad_van + 3600;
        let (zonder_datum, weg) = Vertrouwensarchief::bouw(
            [Wortelgegevens { uitgeschakeld_vanaf: Some(None), ..Wortelgegevens::onbeperkt(cert("k-root.der").der) }],
            &[],
        );
        assert_eq!((zonder_datum.aantal(), weg.uitgeschakeld), (0, 1));
        // Datum na het tijdstip en na het blad: nog vertrouwd.
        let later = k_root_met(|w| w.uitgeschakeld_vanaf = Some(Some(tijd + 1)), &[]);
        assert_eq!(k_email(&later, tijd, Rol::Ondertekenaar), Vertrouwen::Vertrouwd);
        // Tijdstip op of na de datum: geen anker.
        let a = k_root_met(|w| w.uitgeschakeld_vanaf = Some(Some(tijd)), &[]);
        assert_eq!(k_email(&a, tijd, Rol::Ondertekenaar), niet(WantrouwenReden::GeenKeten));
        // Blad uitgegeven op of na de datum, tijdstip ervoor: ook geen anker.
        let a = k_root_met(|w| w.uitgeschakeld_vanaf = Some(Some(blad_van)), &[]);
        assert_eq!(k_email(&a, blad_van - 1, Rol::Ondertekenaar), niet(WantrouwenReden::GeenKeten));
    }

    #[test]
    fn niet_voor_bladen_na_een_datum() {
        let blad = cert("k-blad-email.der");
        let blad_van = van(&blad);
        let tijd = blad_van + 3600;
        let beperkt =
            |na: i64, doelen: Doelen| k_root_met(|w| w.beperking_na = Some(Beperking { na_unix: na, doelen }), &[]);
        // k-root heeft geen doelen in het archief: alle doelen, dus ook documentSigning.
        let alleen_email = |na, doelen| {
            k_root_met(
                |w| {
                    w.doelen = Some(oids(&[EMAIL]));
                    w.beperking_na = Some(Beperking { na_unix: na, doelen });
                },
                &[],
            )
        };
        assert_eq!(k_email(&alleen_email(blad_van, oids(&[EMAIL])), tijd, Rol::Ondertekenaar), Vertrouwen::Vertrouwd);
        assert_eq!(
            k_email(&alleen_email(blad_van - 1, oids(&[EMAIL])), tijd, Rol::Ondertekenaar),
            niet(WantrouwenReden::Sleutelgebruik)
        );
        assert_eq!(
            k_email(&alleen_email(blad_van - 1, oids(&[SERVER])), tijd, Rol::Ondertekenaar),
            Vertrouwen::Vertrouwd
        );
        assert_eq!(
            k_email(&beperkt(blad_van - 1, Doelen::Alle), tijd, Rol::Ondertekenaar),
            niet(WantrouwenReden::Sleutelgebruik)
        );
        assert_eq!(k_email(&beperkt(blad_van, Doelen::Alle), tijd, Rol::Ondertekenaar), Vertrouwen::Vertrouwd);
    }

    #[test]
    fn windows_eigenschappen_lezen() {
        // 2020-01-01T00:00:00Z als FILETIME.
        let ft = ((1_577_836_800u64 + 11_644_473_600) * 10_000_000).to_le_bytes();
        assert_eq!(filetime_unix(&ft), Some(1_577_836_800));
        assert_eq!(filetime_unix(&[0u8; 8]), None);
        assert_eq!(filetime_unix(&[]), None);
        assert_eq!(filetime_unix(&[1, 2, 3]), None);
        // DER van extendedKeyUsage { emailProtection }.
        let eku = [0x30, 0x0a, 0x06, 0x08, 0x2b, 0x06, 0x01, 0x05, 0x05, 0x07, 0x03, 0x04];
        let b = beperking_uit_eigenschappen(&ft, Some(&eku));
        assert_eq!(b, Beperking { na_unix: 1_577_836_800, doelen: oids(&[EMAIL]) });
        assert_eq!(beperking_uit_eigenschappen(&ft, None).doelen, Doelen::Alle);
        assert_eq!(beperking_uit_eigenschappen(&ft, Some(b"rommel")).doelen, Doelen::Alle);
        assert_eq!(beperking_uit_eigenschappen(&[], None).na_unix, i64::MIN);
    }

    #[test]
    fn zelfuitgegeven_certificaten_blijven_binnen_het_knoopbudget() {
        let zelf = certificaten_uit("z-zelfuitgegeven.der");
        let blad = cert("z-blad.der");
        let (u, t) =
            beoordeel_met_telling(&blad, &zelf, &Vertrouwensarchief::leeg(), van(&blad) + 3600, Rol::Ondertekenaar);
        assert_eq!(u.vertrouwen, niet(WantrouwenReden::GeenKeten));
        assert!(t.knopen <= MAX_KNOPEN, "{t:?}");
    }
}
