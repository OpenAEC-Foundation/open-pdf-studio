//! Handtekeningen verifiëren (spec §7): integriteit per soort, dekking,
//! vertrouwen en de getoonde status, plus de Tauri-commando's
//! `pdf_signature_list` en `pdf_signed_revision`.

use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::{Path, PathBuf};

use serde::Serialize;

use super::algoritme::{controleer_handtekening, gebruikte_hash, pkcs1_digest, Hashalg, WaardeFout};
use super::bytebereik::Bytebereik;
use super::certificaat::common_name;
use super::cms_lees::{
    lees_certificaat, lees_signed_data, zoek_ondertekenaars, Certificaat, Ondertekenaar, SignedData,
    ID_DATA, ID_SIGNATURE_TIME_STAMP_TOKEN,
};
use super::pdf_lezen::{lees_veldenlijst, HandtekeningVeld, PdfLeesFout, SigWoordenboek};
use super::status::{leeg_veld, leid_af, signaal, Integriteit, OnleesbaarReden, Status, Vertrouwen, WantrouwenReden};
use super::tijdstempel::controleer_token;
use super::vertrouwen::{beoordeel_binnen, Ketenuitkomst, Rol, Vertrouwensarchief};

/// Uitkomst van één ondertekenaar in een SignedData.
#[derive(Debug, Clone)]
pub struct Ondertekening {
    pub integriteit: Integriteit,
    pub detail: Option<String>,
    /// Vaste signalen ([`signaal`]) naast `detail`.
    pub signalen: Vec<&'static str>,
    /// Het certificaat van de ondertekenaar, als het gevonden is.
    pub certificaat: Option<Certificaat>,
    /// Alle strikt leesbare certificaten uit de SignedData (voor de keten).
    pub certificaten: Vec<Certificaat>,
    /// De ondertekenaar gebruikt een zwak hashalgoritme (SHA-1). Alleen een
    /// waarschuwing: de integriteit verandert er niet door.
    pub zwak_algoritme: bool,
}

/// Of het digest- of handtekeningalgoritme van de ondertekenaar een zwakke hash gebruikt.
pub fn zwak_algoritme(o: &Ondertekenaar) -> bool {
    let digest = Hashalg::uit_oid(o.digestalgoritme.oid);
    digest.is_some_and(Hashalg::is_zwak) || gebruikte_hash(&o.handtekeningalgoritme, digest).is_some_and(Hashalg::is_zwak)
}

/// Integriteit van één ondertekenaar over `inhoud` (de delen die samen de
/// ondertekende inhoud vormen), in de volgorde van spec §7.1.
pub fn controleer_ondertekenaar(sd: &SignedData, o: &Ondertekenaar, inhoud: &[&[u8]]) -> Ondertekening {
    let certificaten: Vec<Certificaat> = sd.certificaten.iter().filter_map(|c| lees_certificaat(c)).collect();
    let zwak = zwak_algoritme(o);
    let niet_te_controleren = |reden: OnleesbaarReden, code: &'static str, detail: String, certificaten: Vec<Certificaat>| Ondertekening {
        integriteit: Integriteit::NietTeControleren { reden },
        detail: Some(detail),
        signalen: vec![code],
        certificaat: None,
        certificaten,
        zwak_algoritme: zwak,
    };
    let Some(digest) = Hashalg::uit_oid(o.digestalgoritme.oid) else {
        let detail = format!("digestalgoritme {}", o.digestalgoritme.oid);
        return niet_te_controleren(
            OnleesbaarReden::AlgoritmeNietOndersteund,
            signaal::DIGESTALGORITME_NIET_ONDERSTEUND,
            detail,
            certificaten,
        );
    };
    let te_controleren: Vec<&[u8]> = match &o.ondertekende_attributen_der {
        Some(attributen) => {
            // RFC 5652 §5.3: contentType en messageDigest elk precies één keer, met één waarde.
            match o.content_type() {
                None => {
                    let detail = "contentType-attribuut ontbreekt of komt niet precies één keer met één waarde voor";
                    let code = signaal::CONTENTTYPE_ONTBREEKT_OF_MEERVOUDIG;
                    return niet_te_controleren(OnleesbaarReden::CmsOnleesbaar, code, detail.to_string(), certificaten);
                }
                Some(soort) if soort != sd.inhoudstype => {
                    let detail = format!("contentType-attribuut {soort} wijkt af van eContentType {}", sd.inhoudstype);
                    let code = signaal::CONTENTTYPE_WIJKT_AF;
                    return niet_te_controleren(OnleesbaarReden::CmsOnleesbaar, code, detail, certificaten);
                }
                Some(_) => {}
            }
            let Some(verwacht) = o.message_digest() else {
                let detail = "messageDigest ontbreekt of komt niet precies één keer met één waarde voor";
                let code = signaal::MESSAGEDIGEST_ONTBREEKT_OF_MEERVOUDIG;
                return niet_te_controleren(OnleesbaarReden::CmsOnleesbaar, code, detail.to_string(), certificaten);
            };
            if digest.hash(inhoud) != verwacht {
                let certificaat = zoek_ondertekenaars(&certificaten, &o.sid).first().map(|c| (*c).clone());
                return Ondertekening {
                    integriteit: Integriteit::Gewijzigd,
                    detail: None,
                    signalen: Vec::new(),
                    certificaat,
                    certificaten,
                    zwak_algoritme: zwak,
                };
            }
            vec![attributen.as_slice()]
        }
        None => inhoud.to_vec(),
    };
    // Meerdere certificaten kunnen bij de SignerIdentifier passen (zelfde
    // uitgever en serienummer, of zelfde sleutel-id): de eerste die klopt telt.
    let kandidaten = zoek_ondertekenaars(&certificaten, &o.sid);
    let mut geverifieerd = None;
    let mut niet_ondersteund = None;
    for kandidaat in &kandidaten {
        match controleer_handtekening(
            &kandidaat.spki_der,
            &o.handtekeningalgoritme,
            Some(digest),
            &te_controleren,
            &o.handtekening,
        ) {
            Ok(()) => {
                geverifieerd = Some((*kandidaat).clone());
                break;
            }
            Err(WaardeFout::KloptNiet) => {}
            Err(WaardeFout::NietOndersteund(d)) => {
                niet_ondersteund.get_or_insert(d);
            }
        }
    }
    let eerste = kandidaten.first().map(|c| (*c).clone());
    let Some(eerste) = eerste else {
        let detail = "certificaat van de ondertekenaar ontbreekt of is onleesbaar".to_string();
        let code = signaal::CERTIFICAAT_ONDERTEKENAAR_ONTBREEKT;
        return niet_te_controleren(OnleesbaarReden::GeenCertificaat, code, detail, certificaten);
    };
    let (integriteit, melding, certificaat) = match (geverifieerd, niet_ondersteund) {
        (Some(c), _) => (Integriteit::Intact, None, c),
        // Eén kandidaat was niet te controleren: dan valt "klopt niet" niet vast te stellen.
        (None, Some(d)) => (
            Integriteit::NietTeControleren { reden: OnleesbaarReden::AlgoritmeNietOndersteund },
            Some((signaal::HANDTEKENINGALGORITME_NIET_ONDERSTEUND, d)),
            eerste,
        ),
        (None, None) if o.ondertekende_attributen_der.is_some() => (Integriteit::Ongeldig, None, eerste),
        (None, None) => zonder_attributen_afwijkend(o, digest, &kandidaten, inhoud, eerste),
    };
    let (signalen, detail) = match melding {
        Some((code, tekst)) => (vec![code], Some(tekst)),
        None => (Vec::new(), None),
    };
    Ondertekening { integriteit, detail, signalen, certificaat: Some(certificaat), certificaten, zwak_algoritme: zwak }
}

/// Zonder ondertekende attributen gaat de handtekening rechtstreeks over de
/// inhoud. Bij RSA PKCS#1 v1.5 halen we de ondertekende digest terug: een
/// geldige codering met een andere digest betekent gewijzigde inhoud, geen
/// geldige codering een ongeldige handtekening. Bij andere algoritmen valt dat
/// niet te onderscheiden.
fn zonder_attributen_afwijkend(
    o: &Ondertekenaar,
    digest: Hashalg,
    kandidaten: &[&Certificaat],
    inhoud: &[&[u8]],
    eerste: Certificaat,
) -> (Integriteit, Option<(&'static str, String)>, Certificaat) {
    let mut pkcs1 = false;
    for kandidaat in kandidaten {
        match pkcs1_digest(&kandidaat.spki_der, &o.handtekeningalgoritme, Some(digest), &o.handtekening) {
            Ok(Some(ondertekend)) => {
                let integriteit =
                    if ondertekend != digest.hash(inhoud) { Integriteit::Gewijzigd } else { Integriteit::Ongeldig };
                return (integriteit, None, (*kandidaat).clone());
            }
            Ok(None) => pkcs1 = true,
            Err(_) => {}
        }
    }
    if pkcs1 {
        return (Integriteit::Ongeldig, None, eerste);
    }
    (
        Integriteit::Gewijzigd,
        Some((
            signaal::ZONDER_ATTRIBUTEN_NIET_TE_ONDERSCHEIDEN,
            "zonder ondertekende attributen zijn wijziging en ongeldige handtekening niet te onderscheiden".to_string(),
        )),
        eerste,
    )
}

/// Uitkomst voor een CAdES- of PKCS#7-handtekening.
#[derive(Debug, Clone)]
pub struct CmsUitkomst {
    pub integriteit: Integriteit,
    pub detail: Option<String>,
    pub signalen: Vec<&'static str>,
    pub certificaat: Option<Certificaat>,
    pub certificaten: Vec<Certificaat>,
    /// De handtekeningwaarde: daarover gaat een handtekeningtijdstempel.
    pub handtekeningwaarde: Vec<u8>,
    /// `signatureTimeStampToken` (ContentInfo-DER), indien aanwezig.
    pub tijdstempeltoken: Option<Vec<u8>>,
    /// Zie [`Ondertekening::zwak_algoritme`]; de documentverificatie (Task 11)
    /// neemt dit over in de handtekeninginformatie als waarschuwing.
    pub zwak_algoritme: bool,
}

/// Integriteit van `ETSI.CAdES.detached` en `adbe.pkcs7.detached`.
pub fn integriteit_cms(cms: &[u8], inhoud: &[&[u8]]) -> CmsUitkomst {
    let onleesbaar = |code: &'static str, detail: String| CmsUitkomst {
        integriteit: Integriteit::NietTeControleren { reden: OnleesbaarReden::CmsOnleesbaar },
        detail: Some(detail),
        signalen: vec![code],
        certificaat: None,
        certificaten: Vec::new(),
        handtekeningwaarde: Vec::new(),
        tijdstempeltoken: None,
        zwak_algoritme: false,
    };
    let sd = match lees_signed_data(cms) {
        Ok(sd) => sd,
        Err(e) => return onleesbaar(signaal::CMS_STRUCTUUR_ONLEESBAAR, e.0),
    };
    // Losse (detached) handtekening: de inhoud staat in het bytebereik, niet in de CMS.
    if sd.inhoud.is_some() {
        return onleesbaar(signaal::ECONTENT_BIJ_LOSSE_HANDTEKENING, "eContent aanwezig bij een losse handtekening".to_string());
    }
    if sd.inhoudstype != ID_DATA {
        return onleesbaar(signaal::ECONTENTTYPE_GEEN_ID_DATA, format!("eContentType {} is geen id-data", sd.inhoudstype));
    }
    let Some(o) = sd.ondertekenaars.first() else {
        return onleesbaar(signaal::GEEN_ONDERTEKENAAR, "geen ondertekenaar".to_string());
    };
    let ondertekening = controleer_ondertekenaar(&sd, o, inhoud);
    CmsUitkomst {
        integriteit: ondertekening.integriteit,
        detail: ondertekening.detail,
        signalen: ondertekening.signalen,
        certificaat: ondertekening.certificaat,
        certificaten: ondertekening.certificaten,
        handtekeningwaarde: o.handtekening.clone(),
        tijdstempeltoken: o.onondertekend(ID_SIGNATURE_TIME_STAMP_TOKEN).map(<[u8]>::to_vec),
        zwak_algoritme: ondertekening.zwak_algoritme,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Soort {
    /// `ETSI.CAdES.detached` of `adbe.pkcs7.detached`.
    Handtekening,
    /// `ETSI.RFC3161`.
    Documenttijdstempel,
    LeegVeld,
    /// Andere of ontbrekende SubFilter.
    Onbekend,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum TijdBron {
    Tijdstempel,
    /// `/M`, door de ondertekenaar opgegeven.
    Opgegeven,
    Onbekend,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CertificaatSamenvatting {
    pub naam: String,
    pub uitgever: String,
    pub geldig_van_unix: u64,
    pub geldig_tot_unix: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TijdstempelInfo {
    pub tijd_unix: Option<i64>,
    pub tsa: Option<String>,
    pub integriteit: Integriteit,
    pub vertrouwen: Vertrouwen,
    /// Het token of de keten van de dienst gebruikt SHA-1; alleen een waarschuwing.
    pub zwak_algoritme: bool,
    /// Vaste signalen ([`signaal`]) bij het token, bv. `zoekbudget-op` voor de
    /// keten van de dienst. Additief; de UI vertaalt ze.
    pub signalen: Vec<String>,
}

/// Eén regel in de balk en de inhoud van het detailvenster (spec §4.1).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HandtekeningInfo {
    pub nummer: usize,
    pub veldnaam: Option<String>,
    pub soort: Soort,
    pub subfilter: Option<String>,
    pub status: Status,
    pub daarna_gewijzigd: bool,
    /// `None` bij een leeg veld.
    pub integriteit: Option<Integriteit>,
    pub vertrouwen: Vertrouwen,
    /// Nederlandse technische toelichting; de UI toont die alleen als
    /// "Technisch detail". Voor de gebruiker tellen `signalen`.
    pub detail: Option<String>,
    /// Vaste, machineleesbare signalen ([`signaal`], kebab-case), zonder
    /// dubbelen. Additief: de UI vertaalt ze en valt bij een onbekende code
    /// terug op een neutrale tekst.
    pub signalen: Vec<String>,
    pub ondertekenaar: Option<String>,
    pub uitgever: Option<String>,
    pub tijd_unix: Option<i64>,
    pub tijd_bron: TijdBron,
    pub tijdstempel: Option<TijdstempelInfo>,
    pub dekt_hele_document: bool,
    pub bereik_einde: Option<u64>,
    pub bestandsgrootte: u64,
    pub reden: Option<String>,
    pub plaats: Option<String>,
    pub contact: Option<String>,
    pub opgegeven_naam: Option<String>,
    /// Reden, plaats, contact, opgegeven naam en `/M` vallen onder de handtekening.
    /// Zo niet, dan toont de UI ze als niet ondertekend.
    pub woordenboek_ondertekend: bool,
    pub keten: Vec<CertificaatSamenvatting>,
    /// De handtekening (digest- of handtekeningalgoritme), een documenttijdstempel
    /// of een gecontroleerde certificaathandtekening in de keten gebruikt SHA-1.
    /// Alleen een waarschuwing: integriteit en status veranderen er niet door.
    pub zwak_algoritme: bool,
    /// Het document heeft meer handtekeningvelden dan de grens
    /// ([`super::pdf_lezen::MAX_HANDTEKENINGVELDEN`]); de lijst is onvolledig.
    /// Gelijk voor alle regels van één lijst.
    pub lijst_afgekapt: bool,
}

#[derive(Debug, Serialize)]
#[serde(tag = "code", rename_all = "kebab-case")]
pub enum LijstFout {
    /// Bestand niet te lezen (I/O).
    Onleesbaar { detail: String },
    /// Geen PDF-structuur te vinden.
    PdfOnleesbaar { detail: String },
    /// Geen handtekening met dat nummer, of zonder geldig bytebereik.
    GeenHandtekening,
    /// Het opgegeven `bereikEinde` past niet bij handtekening `nummer`: het
    /// bestand is veranderd sinds de lijst werd opgesteld.
    GewijzigdSindsLijst,
}

/// Extra melding in `detail` (signaal [`signaal::GAT_WIJKT_AF_VAN_CONTENTS`]):
/// de hex-string in het gat van het bytebereik is niet de `/Contents` van het
/// handtekeningwoordenboek, zoals bij een geleend bytebereik. De integriteit
/// volgt `/Contents` (zie `pdf_lezen`).
const GAT_WIJKT_AF: &str = "de hex-string in het gat van het bytebereik wijkt af van /Contents";

/// Extra melding in `detail` (signaal [`signaal::ZOEKBUDGET_OP`]): de
/// ketenzoektocht is op het knoop- of handtekeningbudget afgebroken, per keten
/// of per document ([`Ketenuitkomst::budget_op`]). Een "geen keten" betekent
/// dan "binnen het budget geen keten gevonden".
const ZOEKBUDGET_OP: &str = "ketenzoektocht afgebroken op het zoekbudget";

/// De melding voor `detail` als een niet-vertrouwde keten op het budget stopte.
fn budget_melding(keten: Option<&Ketenuitkomst>, voorvoegsel: &str) -> Option<String> {
    keten
        .filter(|k| k.budget_op && k.vertrouwen != Vertrouwen::Vertrouwd)
        .map(|_| format!("{voorvoegsel}{ZOEKBUDGET_OP}"))
}

fn io_fout(e: impl std::fmt::Display) -> LijstFout {
    LijstFout::Onleesbaar { detail: e.to_string() }
}

fn samenvatting(keten: &[Certificaat]) -> Vec<CertificaatSamenvatting> {
    keten
        .iter()
        .map(|c| {
            let tbs = &c.x509.tbs_certificate;
            CertificaatSamenvatting {
                naam: common_name(&tbs.subject),
                uitgever: common_name(&tbs.issuer),
                geldig_van_unix: tbs.validity.not_before.to_unix_duration().as_secs(),
                geldig_tot_unix: tbs.validity.not_after.to_unix_duration().as_secs(),
            }
        })
        .collect()
}

/// Velden in revisievolgorde: op het einde van het bytebereik, ongeldige en lege achteraan.
///
/// Hetzelfde handtekeningwoordenboek bij meer dan één veld (bijvoorbeeld twee
/// velden met dezelfde `/V`) telt één keer: `pdf_lezen` voegt ze samen, en hier
/// vallen ook inhoudelijk gelijke woordenboeken weg (het eerste telt). Lege
/// velden worden niet samengevoegd. De tweede waarde: de lijst is afgekapt.
fn geordende_velden(bytes: &[u8]) -> Result<(Vec<(HandtekeningVeld, Option<Bytebereik>)>, bool), LijstFout> {
    let gelezen = lees_veldenlijst(bytes).map_err(|PdfLeesFout::Onleesbaar(detail)| LijstFout::PdfOnleesbaar { detail })?;
    let behouden: Vec<bool> = {
        let mut gezien = std::collections::HashSet::new();
        gelezen.velden.iter().map(|v| v.waarde.as_ref().map_or(true, |w| gezien.insert(w))).collect()
    };
    let mut lijst: Vec<(HandtekeningVeld, Option<Bytebereik>)> = gelezen
        .velden
        .into_iter()
        .zip(behouden)
        .filter(|(_, behoud)| *behoud)
        .map(|(v, _)| {
            let bereik = v.waarde.as_ref().and_then(|w| Bytebereik::uit_getallen(&w.bytebereik, bytes.len()).ok());
            (v, bereik)
        })
        .collect();
    lijst.sort_by_key(|(_, b)| b.map_or(usize::MAX, |b| b.einde()));
    Ok((lijst, gelezen.afgekapt))
}

/// Hoogstens zoveel certificaathandtekeningen controleert de ketenbouw per
/// document, over alle handtekeningen en tijdstempels samen. Is het op, dan zijn
/// volgende ketens niet vertrouwd met signaal [`signaal::ZOEKBUDGET_OP`].
const MAX_CONTROLES_PER_DOCUMENT: usize = 2000;

/// Alle handtekeningen van een document, elk met integriteit, dekking en vertrouwen.
pub fn verifieer_document(bytes: &[u8], archief: &Vertrouwensarchief, nu_unix: i64) -> Result<Vec<HandtekeningInfo>, LijstFout> {
    verifieer_document_binnen(bytes, archief, nu_unix, MAX_CONTROLES_PER_DOCUMENT)
}

/// Als [`verifieer_document`], met een eigen budget aan certificaatcontroles.
fn verifieer_document_binnen(
    bytes: &[u8],
    archief: &Vertrouwensarchief,
    nu_unix: i64,
    mut budget: usize,
) -> Result<Vec<HandtekeningInfo>, LijstFout> {
    let (velden, afgekapt) = geordende_velden(bytes)?;
    Ok(velden
        .into_iter()
        .enumerate()
        .map(|(nummer, (veld, _))| {
            let mut info = verifieer_veld(bytes, nummer, veld, archief, nu_unix, &mut budget);
            info.lijst_afgekapt = afgekapt;
            info
        })
        .collect())
}

#[cfg(test)]
thread_local! {
    /// Test-haak: een paniek tijdens de controle van handtekening `nummer`.
    static PANIEK_BIJ: std::cell::Cell<Option<usize>> = const { std::cell::Cell::new(None) };
}

fn paniektekst(p: &(dyn std::any::Any + Send)) -> String {
    p.downcast_ref::<&str>()
        .map(|s| (*s).to_string())
        .or_else(|| p.downcast_ref::<String>().cloned())
        .unwrap_or_else(|| "onbekende oorzaak".to_string())
}

/// Tijdstip waarop een keten wordt beoordeeld: de tijd uit een tijdstempel,
/// maar nooit later dan nu (een tijdstempel uit de toekomst verlengt niets).
fn relevante_tijd(tijdstempel: Option<i64>, nu_unix: i64) -> i64 {
    tijdstempel.map_or(nu_unix, |t| t.min(nu_unix))
}

fn verifieer_veld(
    bytes: &[u8],
    nummer: usize,
    veld: HandtekeningVeld,
    archief: &Vertrouwensarchief,
    nu_unix: i64,
    budget: &mut usize,
) -> HandtekeningInfo {
    let bestandsgrootte = bytes.len() as u64;
    let Some(sig) = veld.waarde else {
        let g = leeg_veld();
        return HandtekeningInfo {
            nummer,
            veldnaam: veld.veldnaam,
            soort: Soort::LeegVeld,
            subfilter: None,
            status: g.status,
            daarna_gewijzigd: g.daarna_gewijzigd,
            integriteit: None,
            vertrouwen: Vertrouwen::NietBepaald,
            detail: None,
            signalen: Vec::new(),
            ondertekenaar: None,
            uitgever: None,
            tijd_unix: None,
            tijd_bron: TijdBron::Onbekend,
            tijdstempel: None,
            dekt_hele_document: false,
            bereik_einde: None,
            bestandsgrootte,
            reden: None,
            plaats: None,
            contact: None,
            opgegeven_naam: None,
            woordenboek_ondertekend: false,
            keten: Vec::new(),
            zwak_algoritme: false,
            lijst_afgekapt: false,
        };
    };
    let soort = match sig.subfilter.as_deref() {
        Some("ETSI.RFC3161") => Soort::Documenttijdstempel,
        Some("ETSI.CAdES.detached") | Some("adbe.pkcs7.detached") => Soort::Handtekening,
        _ => Soort::Onbekend,
    };
    let mut info = HandtekeningInfo {
        nummer,
        veldnaam: veld.veldnaam,
        soort,
        subfilter: sig.subfilter.clone(),
        status: Status::NietOndertekendVeld,
        daarna_gewijzigd: false,
        integriteit: None,
        vertrouwen: Vertrouwen::NietBepaald,
        detail: None,
        signalen: Vec::new(),
        ondertekenaar: None,
        uitgever: None,
        tijd_unix: sig.tijd_unix,
        tijd_bron: if sig.tijd_unix.is_some() { TijdBron::Opgegeven } else { TijdBron::Onbekend },
        tijdstempel: None,
        dekt_hele_document: false,
        bereik_einde: None,
        bestandsgrootte,
        reden: sig.reden.clone(),
        plaats: sig.plaats.clone(),
        contact: sig.contact.clone(),
        opgegeven_naam: sig.naam.clone(),
        woordenboek_ondertekend: sig.woordenboek_ondertekend,
        keten: Vec::new(),
        zwak_algoritme: false,
        lijst_afgekapt: false,
    };
    // Een onverwachte fout in deze handtekening blijft bij deze handtekening (spec §8).
    let basis = info.clone();
    let uitkomst = catch_unwind(AssertUnwindSafe(|| {
        #[cfg(test)]
        if PANIEK_BIJ.with(std::cell::Cell::get) == Some(nummer) {
            panic!("geforceerde paniek in de test");
        }
        beoordeel_handtekening(bytes, &sig, soort, archief, nu_unix, budget, &mut info)
    }));
    let (integriteit, vertrouwen) = match uitkomst {
        Ok(uitkomst) => uitkomst,
        Err(paniek) => {
            info = basis;
            info.detail = Some(format!("interne fout bij het controleren: {}", paniektekst(paniek.as_ref())));
            info.signalen = vec![signaal::INTERNE_FOUT.to_string()];
            (Integriteit::NietTeControleren { reden: OnleesbaarReden::CmsOnleesbaar }, Vertrouwen::NietBepaald)
        }
    };
    let getoond = leid_af(integriteit, vertrouwen, info.dekt_hele_document);
    info.integriteit = Some(integriteit);
    info.vertrouwen = vertrouwen;
    info.status = getoond.status;
    info.daarna_gewijzigd = getoond.daarna_gewijzigd;
    info
}

fn naam_van(c: &Certificaat) -> String {
    common_name(&c.x509.tbs_certificate.subject)
}

/// Vertrouwen alleen bij een intacte uitkomst; anders `NietBepaald`. Een
/// intacte uitkomst krijgt nooit `NietBepaald`, want [`leid_af`] zou dat stil
/// als "geen keten" tonen: ontbreekt het blad (hoort bij intact niet voor te
/// komen), dan expliciet "geen keten".
fn vertrouwen_bij(
    integriteit: Integriteit,
    blad: Option<&Certificaat>,
    beoordeel_keten: impl FnOnce(&Certificaat) -> Ketenuitkomst,
) -> (Vertrouwen, Option<Ketenuitkomst>) {
    match (integriteit, blad) {
        (Integriteit::Intact, Some(blad)) => {
            let k = beoordeel_keten(blad);
            (k.vertrouwen, Some(k))
        }
        (Integriteit::Intact, None) => (Vertrouwen::NietVertrouwd { reden: WantrouwenReden::GeenKeten }, None),
        _ => (Vertrouwen::NietBepaald, None),
    }
}

/// Voegt een signaal toe, zonder dubbelen.
fn voeg_signaal_toe(signalen: &mut Vec<String>, code: &str) {
    if !signalen.iter().any(|s| s == code) {
        signalen.push(code.to_string());
    }
}

fn voeg_signalen_toe(signalen: &mut Vec<String>, codes: &[&'static str]) {
    for code in codes {
        voeg_signaal_toe(signalen, code);
    }
}

/// Beoordeelt een keten binnen het resterende documentbudget en verlaagt dat.
fn keten_binnen_budget(
    blad: &Certificaat,
    tussen: &[Certificaat],
    archief: &Vertrouwensarchief,
    tijd_unix: i64,
    rol: Rol,
    budget: &mut usize,
) -> Ketenuitkomst {
    let (uitkomst, gebruikt) = beoordeel_binnen(blad, tussen, archief, tijd_unix, rol, *budget);
    *budget = budget.saturating_sub(gebruikt);
    uitkomst
}

fn voeg_detail_toe(info: &mut HandtekeningInfo, extra: &str) {
    info.detail = Some(match info.detail.take() {
        Some(d) => format!("{d}; {extra}"),
        None => extra.to_string(),
    });
}

fn beoordeel_handtekening(
    bytes: &[u8],
    sig: &SigWoordenboek,
    soort: Soort,
    archief: &Vertrouwensarchief,
    nu_unix: i64,
    budget: &mut usize,
    info: &mut HandtekeningInfo,
) -> (Integriteit, Vertrouwen) {
    let niet = |reden| (Integriteit::NietTeControleren { reden }, Vertrouwen::NietBepaald);
    let bereik = match Bytebereik::uit_getallen(&sig.bytebereik, bytes.len()) {
        Ok(b) => b,
        Err(e) => {
            info.detail = Some(e.to_string());
            voeg_signaal_toe(&mut info.signalen, e.signaal());
            return niet(OnleesbaarReden::BytebereikOngeldig);
        }
    };
    info.bereik_einde = Some(bereik.einde() as u64);
    info.dekt_hele_document = bereik.dekt_hele_document(bytes);
    if let Err(e) = bereik.controleer_gat(bytes) {
        info.detail = Some(e.to_string());
        voeg_signaal_toe(&mut info.signalen, e.signaal());
        return niet(OnleesbaarReden::BytebereikOngeldig);
    }
    let Some(delen) = bereik.delen(bytes) else {
        voeg_signaal_toe(&mut info.signalen, signaal::BYTEBEREIK_VOORBIJ_EINDE);
        return niet(OnleesbaarReden::BytebereikOngeldig);
    };
    let gat_wijkt_af = bereik.gat_inhoud(bytes).is_some_and(|gat| gat != sig.contents);
    let uitkomst = match soort {
        Soort::Onbekend | Soort::LeegVeld => {
            info.detail = sig.subfilter.clone();
            voeg_signaal_toe(&mut info.signalen, signaal::SUBFILTER_NIET_ONDERSTEUND);
            niet(OnleesbaarReden::VerouderdFormaat)
        }
        Soort::Documenttijdstempel => {
            let t = controleer_token(&sig.contents, &delen);
            info.detail = t.detail.clone();
            voeg_signalen_toe(&mut info.signalen, &t.signalen);
            info.ondertekenaar = t.tsa.as_ref().map(naam_van);
            info.uitgever = t.tsa.as_ref().map(|c| common_name(&c.x509.tbs_certificate.issuer));
            if let Some(tijd) = t.tijd_unix {
                info.tijd_unix = Some(tijd);
                info.tijd_bron = TijdBron::Tijdstempel;
            }
            let tijd = relevante_tijd(t.tijd_unix, nu_unix);
            let (vertrouwen, keten) = vertrouwen_bij(t.integriteit, t.tsa.as_ref(), |tsa| {
                keten_binnen_budget(tsa, &t.certificaten, archief, tijd, Rol::Tijdstempeldienst, budget)
            });
            if let Some(k) = &keten {
                info.keten = samenvatting(&k.keten);
            }
            if let Some(m) = budget_melding(keten.as_ref(), "") {
                voeg_detail_toe(info, &m);
                voeg_signaal_toe(&mut info.signalen, signaal::ZOEKBUDGET_OP);
            }
            info.zwak_algoritme = t.zwak_algoritme || keten.is_some_and(|k| k.zwak_algoritme);
            (t.integriteit, vertrouwen)
        }
        Soort::Handtekening => {
            let c = integriteit_cms(&sig.contents, &delen);
            info.detail = c.detail.clone();
            voeg_signalen_toe(&mut info.signalen, &c.signalen);
            info.ondertekenaar = c.certificaat.as_ref().map(naam_van);
            info.uitgever = c.certificaat.as_ref().map(|x| common_name(&x.x509.tbs_certificate.issuer));
            let mut ondertekentijd = nu_unix;
            if let Some(token) = &c.tijdstempeltoken {
                let t = controleer_token(token, &[c.handtekeningwaarde.as_slice()]);
                let tijd = relevante_tijd(t.tijd_unix, nu_unix);
                let (tsa_vertrouwen, tsa_keten) = vertrouwen_bij(t.integriteit, t.tsa.as_ref(), |tsa| {
                    keten_binnen_budget(tsa, &t.certificaten, archief, tijd, Rol::Tijdstempeldienst, budget)
                });
                let mut tijdstempelsignalen = Vec::new();
                voeg_signalen_toe(&mut tijdstempelsignalen, &t.signalen);
                if let (Integriteit::Intact, Some(tijd)) = (t.integriteit, t.tijd_unix) {
                    info.tijd_unix = Some(tijd);
                    info.tijd_bron = TijdBron::Tijdstempel;
                    if tsa_vertrouwen == Vertrouwen::Vertrouwd {
                        ondertekentijd = relevante_tijd(Some(tijd), nu_unix);
                    }
                }
                if let Some(m) = budget_melding(tsa_keten.as_ref(), "tijdstempel: ") {
                    voeg_detail_toe(info, &m);
                    voeg_signaal_toe(&mut tijdstempelsignalen, signaal::ZOEKBUDGET_OP);
                }
                info.tijdstempel = Some(TijdstempelInfo {
                    tijd_unix: t.tijd_unix,
                    tsa: t.tsa.as_ref().map(naam_van),
                    integriteit: t.integriteit,
                    vertrouwen: tsa_vertrouwen,
                    zwak_algoritme: t.zwak_algoritme || tsa_keten.is_some_and(|k| k.zwak_algoritme),
                    signalen: tijdstempelsignalen,
                });
            }
            let (vertrouwen, keten) = vertrouwen_bij(c.integriteit, c.certificaat.as_ref(), |cert| {
                keten_binnen_budget(cert, &c.certificaten, archief, ondertekentijd, Rol::Ondertekenaar, budget)
            });
            match (&keten, &c.certificaat) {
                (Some(k), _) => info.keten = samenvatting(&k.keten),
                (None, Some(cert)) => info.keten = samenvatting(std::slice::from_ref(cert)),
                (None, None) => {}
            }
            if let Some(m) = budget_melding(keten.as_ref(), "") {
                voeg_detail_toe(info, &m);
                voeg_signaal_toe(&mut info.signalen, signaal::ZOEKBUDGET_OP);
            }
            info.zwak_algoritme = c.zwak_algoritme || keten.is_some_and(|k| k.zwak_algoritme);
            (c.integriteit, vertrouwen)
        }
    };
    if gat_wijkt_af {
        voeg_detail_toe(info, GAT_WIJKT_AF);
        voeg_signaal_toe(&mut info.signalen, signaal::GAT_WIJKT_AF_VAN_CONTENTS);
    }
    uitkomst
}

/// De bytes van het document zoals handtekening `nummer` ze ondertekende.
#[cfg(test)]
pub fn ondertekende_versie(bytes: &[u8], nummer: usize) -> Result<&[u8], LijstFout> {
    ondertekende_versie_bij(bytes, nummer, None)
}

/// Als [`ondertekende_versie`]; met `bereik_einde` (uit de eerder opgehaalde
/// lijst) moet handtekening `nummer` nog steeds op die byte eindigen, anders
/// [`LijstFout::GewijzigdSindsLijst`].
pub fn ondertekende_versie_bij(bytes: &[u8], nummer: usize, bereik_einde: Option<u64>) -> Result<&[u8], LijstFout> {
    let bereik = geordende_velden(bytes)?.0.get(nummer).and_then(|(_, b)| *b);
    if let Some(verwacht) = bereik_einde {
        if bereik.map(|b| b.einde() as u64) != Some(verwacht) {
            return Err(LijstFout::GewijzigdSindsLijst);
        }
    }
    let bereik = bereik.ok_or(LijstFout::GeenHandtekening)?;
    bereik.ondertekende_versie(bytes).ok_or(LijstFout::GeenHandtekening)
}

fn nu_unix() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| i64::try_from(d.as_secs()).unwrap_or(i64::MAX))
        .unwrap_or(0)
}

/// Vanaf deze grootte wordt een bestand in het geheugen afgebeeld in plaats van
/// ingelezen. Daaronder is een kopie goedkoop, en blijft het bestand vrij voor
/// opslaan terwijl de verificatie loopt (spec §7.3).
const AFBEELDEN_VANAF: u64 = 64 << 20;

/// Bestandsinhoud: ingelezen, of voor grote bestanden in het geheugen afgebeeld.
enum Bestandsinhoud {
    Gelezen(Vec<u8>),
    Afgebeeld(memmap2::Mmap),
}

impl std::ops::Deref for Bestandsinhoud {
    type Target = [u8];
    fn deref(&self) -> &[u8] {
        match self {
            Bestandsinhoud::Gelezen(v) => v,
            Bestandsinhoud::Afgebeeld(m) => m,
        }
    }
}

fn lees_bestand(pad: &Path, afbeelden_vanaf: u64) -> Result<Bestandsinhoud, LijstFout> {
    let bestand = std::fs::File::open(pad).map_err(io_fout)?;
    let grootte = bestand.metadata().map_err(io_fout)?.len();
    if grootte >= afbeelden_vanaf && grootte > 0 {
        // SAFETY: de afbeelding is alleen-lezen en leeft korter dan deze
        // verificatie. Kort een ander proces het bestand in, dan kan het lezen
        // op Unix een SIGBUS geven; op Windows weigert het systeem dat inkorten
        // zolang de afbeelding bestaat. Bekend risico, zie spec §7.3.
        if let Ok(afbeelding) = unsafe { memmap2::Mmap::map(&bestand) } {
            return Ok(Bestandsinhoud::Afgebeeld(afbeelding));
        }
    }
    let mut inhoud = Vec::new();
    std::io::Read::read_to_end(&mut &bestand, &mut inhoud).map_err(io_fout)?;
    Ok(Bestandsinhoud::Gelezen(inhoud))
}

/// Verifieert alle handtekeningen in `pad` (spec §4.1). Loopt op een aparte
/// thread: het rootarchief laden en hashen houdt het openen niet op (spec §7.3).
#[tauri::command]
pub async fn pdf_signature_list(pad: String) -> Result<Vec<HandtekeningInfo>, LijstFout> {
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = lees_bestand(Path::new(&pad), AFBEELDEN_VANAF)?;
        verifieer_document(&bytes, Vertrouwensarchief::systeem(), nu_unix())
    })
    .await
    .map_err(io_fout)?
}

/// Map voor ondertekende versies, binnen de cachemap van de app (per gebruiker).
pub fn map_ondertekende_versies(app_cachemap: &Path) -> PathBuf {
    app_cachemap.join("ondertekende-versies")
}

/// Maakt `map` aan; op Unix alleen toegankelijk voor de gebruiker (0700).
fn maak_eigen_map(map: &Path) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::{DirBuilderExt, PermissionsExt};
        std::fs::DirBuilder::new().recursive(true).mode(0o700).create(map)?;
        std::fs::set_permissions(map, std::fs::Permissions::from_mode(0o700))
    }
    #[cfg(not(unix))]
    {
        std::fs::create_dir_all(map)
    }
}

/// Schrijft de ondertekende versie van handtekening `nummer` uit `pad` als nieuw
/// bestand in `map`, met een unieke naam: `<stam>-rev<n>-<millis>-<teller>-<willekeurig>.pdf`
/// (stam hooguit 100 tekens). Nooit een bestaand bestand overschrijven; bij een
/// schrijffout geen half bestand achterlaten.
pub fn schrijf_ondertekende_versie(map: &Path, pad: &str, nummer: usize, bereik_einde: Option<u64>) -> Result<PathBuf, LijstFout> {
    use std::io::Write;
    use std::sync::atomic::{AtomicU64, Ordering};
    static TELLER: AtomicU64 = AtomicU64::new(0);

    let bytes = lees_bestand(Path::new(pad), AFBEELDEN_VANAF)?;
    let versie = ondertekende_versie_bij(&bytes, nummer, bereik_einde)?;
    maak_eigen_map(map).map_err(io_fout)?;
    let stam: String = Path::new(pad)
        .file_stem()
        .map(|s| s.to_string_lossy().chars().take(100).collect())
        .filter(|s: &String| !s.is_empty())
        .unwrap_or_else(|| "document".to_string());
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let mut laatste_fout = None;
    for _ in 0..16 {
        let teller = TELLER.fetch_add(1, Ordering::Relaxed);
        let willekeurig: u32 = rand::random();
        let doel = map.join(format!("{stam}-rev{}-{millis}-{teller}-{willekeurig:08x}.pdf", nummer + 1));
        let mut opties = std::fs::OpenOptions::new();
        opties.write(true).create_new(true);
        #[cfg(unix)]
        std::os::unix::fs::OpenOptionsExt::mode(&mut opties, 0o600);
        match opties.open(&doel) {
            Ok(mut bestand) => {
                if let Err(e) = bestand.write_all(versie).and_then(|()| bestand.flush()) {
                    drop(bestand);
                    let _ = std::fs::remove_file(&doel);
                    return Err(io_fout(e));
                }
                return Ok(doel);
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => laatste_fout = Some(e),
            Err(e) => return Err(io_fout(e)),
        }
    }
    Err(laatste_fout.map_or_else(|| LijstFout::Onleesbaar { detail: "geen vrije bestandsnaam".to_string() }, io_fout))
}

/// Bij het opstarten ruimt de app ondertekende versies op die zo lang niet
/// gewijzigd zijn. Ruim gekozen: een andere instantie van de app kan een
/// ondertekende versie nog open hebben.
pub const OPRUIMEN_NA: std::time::Duration = std::time::Duration::from_secs(7 * 24 * 60 * 60);

/// Verwijdert ondertekende versies (`*.pdf`) die langer dan `ouder_dan` niet
/// gewijzigd zijn. Fouten worden genegeerd: dit is een vangnet naast het
/// opruimen door de UI.
pub fn ruim_ondertekende_versies_op(map: &Path, ouder_dan: std::time::Duration) {
    let Ok(items) = std::fs::read_dir(map) else { return };
    let nu = std::time::SystemTime::now();
    for item in items.flatten() {
        let pad = item.path();
        let Ok(meta) = std::fs::symlink_metadata(&pad) else { continue };
        let oud = meta.modified().ok().and_then(|t| nu.duration_since(t).ok()).is_some_and(|d| d > ouder_dan);
        if meta.is_file() && oud && pad.extension().is_some_and(|e| e.eq_ignore_ascii_case("pdf")) {
            let _ = std::fs::remove_file(&pad);
        }
    }
}

/// Schrijft de ondertekende versie van handtekening `nummer` naar een nieuw
/// bestand in de cachemap van de app en geeft het absolute pad (spec §4.1, "Toon
/// ondertekende versie"). Het bestand komt in de fs-scope, zodat de UI het kan
/// openen en verwijderen. `bereik_einde` (JS: `bereikEinde`, optioneel): het
/// einde uit de lijst; wijkt het af, dan [`LijstFout::GewijzigdSindsLijst`].
#[tauri::command]
pub async fn pdf_signed_revision(
    app: tauri::AppHandle,
    pad: String,
    nummer: usize,
    bereik_einde: Option<u64>,
) -> Result<String, LijstFout> {
    use tauri::Manager;
    use tauri_plugin_fs::FsExt;
    let cachemap = app.path().app_cache_dir().map_err(io_fout)?;
    let doel = tauri::async_runtime::spawn_blocking(move || {
        schrijf_ondertekende_versie(&map_ondertekende_versies(&cachemap), &pad, nummer, bereik_einde)
    })
    .await
    .map_err(io_fout)??;
    let _ = app.fs_scope().allow_file(&doel);
    Ok(doel.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn fixture(naam: &str) -> Vec<u8> {
        std::fs::read(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/verifieer").join(naam)).unwrap()
    }

    fn niet(reden: OnleesbaarReden) -> Integriteit {
        Integriteit::NietTeControleren { reden }
    }

    #[test]
    fn rsa_handtekening_is_intact() {
        let data = fixture("data.bin");
        let u = integriteit_cms(&fixture("cms-rsa-sha256.der"), &[data.as_slice()]);
        assert_eq!(u.integriteit, Integriteit::Intact);
        assert_eq!(u.detail, None);
        let blad = lees_certificaat(&fixture("blad.der")).unwrap();
        assert_eq!(u.certificaat.unwrap().onderwerp_der, blad.onderwerp_der);
        assert_eq!(u.certificaten.len(), 2);
        assert_eq!(u.handtekeningwaarde.len(), 256);
        assert_eq!(u.tijdstempeltoken, None);
    }

    #[test]
    fn twee_delen_gelijk_aan_het_geheel() {
        let data = fixture("data.bin");
        let u = integriteit_cms(&fixture("cms-rsa-sha256.der"), &[&data[..10], &data[10..]]);
        assert_eq!(u.integriteit, Integriteit::Intact);
    }

    #[test]
    fn andere_inhoud_is_gewijzigd() {
        let mut data = fixture("data.bin");
        data[0] ^= 1;
        let u = integriteit_cms(&fixture("cms-rsa-sha256.der"), &[data.as_slice()]);
        assert_eq!(u.integriteit, Integriteit::Gewijzigd);
        assert!(u.certificaat.is_some());
    }

    #[test]
    fn beschadigde_handtekeningwaarde_is_ongeldig() {
        let data = fixture("data.bin");
        for naam in ["cms-rsa-sha256.der", "cms-ec-p256-sha384.der"] {
            let mut cms = fixture(naam);
            let laatste = cms.len() - 1;
            cms[laatste] ^= 1;
            assert_eq!(integriteit_cms(&cms, &[data.as_slice()]).integriteit, Integriteit::Ongeldig, "{naam}");
        }
    }

    #[test]
    fn pss_ecdsa_en_ber_zijn_intact() {
        let data = fixture("data.bin");
        for naam in ["cms-rsa-pss.der", "cms-ec-p256-sha384.der"] {
            assert_eq!(integriteit_cms(&fixture(naam), &[data.as_slice()]).integriteit, Integriteit::Intact, "{naam}");
        }
        // De BER-fixture (`-stream`) bevat de inhoud ook als eContent: de
        // ondertekenaar is intact, maar als losse handtekening niet te controleren.
        let ber = lees_signed_data(&fixture("cms-rsa-ber.der")).unwrap();
        assert!(ber.inhoud.is_some());
        let o = ber.ondertekenaars[0].clone();
        assert_eq!(controleer_ondertekenaar(&ber, &o, &[data.as_slice()]).integriteit, Integriteit::Intact);
        let u = integriteit_cms(&fixture("cms-rsa-ber.der"), &[data.as_slice()]);
        assert_eq!(u.integriteit, niet(OnleesbaarReden::CmsOnleesbaar));
        assert_eq!(u.signalen, [signaal::ECONTENT_BIJ_LOSSE_HANDTEKENING]);
    }

    #[test]
    fn zonder_certificaat_niet_te_controleren() {
        let data = fixture("data.bin");
        let u = integriteit_cms(&fixture("cms-zonder-certificaat.der"), &[data.as_slice()]);
        assert_eq!(u.integriteit, niet(OnleesbaarReden::GeenCertificaat));
        assert!(u.detail.is_some());
        assert_eq!(u.signalen, [signaal::CERTIFICAAT_ONDERTEKENAAR_ONTBREEKT]);
    }

    #[test]
    fn onbekend_handtekeningalgoritme_niet_te_controleren() {
        let data = fixture("data.bin");
        let mut cms = fixture("cms-rsa-sha256.der");
        // Laatste rsaEncryption-OID is die van de SignerInfo; maak er 1.2.840.113549.1.1.99 van.
        let oid = [0x06, 0x09, 0x2A, 0x86, 0x48, 0x86, 0xF7, 0x0D, 0x01, 0x01, 0x01];
        let p = cms.windows(oid.len()).rposition(|w| w == oid).unwrap();
        cms[p + 10] = 0x63;
        let u = integriteit_cms(&cms, &[data.as_slice()]);
        assert_eq!(u.integriteit, niet(OnleesbaarReden::AlgoritmeNietOndersteund));
        assert!(u.detail.unwrap().contains("1.2.840.113549.1.1.99"));
    }

    #[test]
    fn rommel_is_cms_onleesbaar() {
        let data = fixture("data.bin");
        let rommels: [&[u8]; 3] = [b"", b"rommel", &[0x30, 0x03, 0x02, 0x01, 0x01]];
        for rommel in rommels {
            let u = integriteit_cms(rommel, &[data.as_slice()]);
            assert_eq!(u.integriteit, niet(OnleesbaarReden::CmsOnleesbaar));
        }
    }

    fn der(tag: u8, inhoud: &[u8]) -> Vec<u8> {
        let n = inhoud.len();
        let mut uit = vec![tag];
        if n < 0x80 {
            uit.push(n as u8);
        } else {
            let lengte: Vec<u8> = n.to_be_bytes().into_iter().skip_while(|&b| b == 0).collect();
            uit.push(0x80 | lengte.len() as u8);
            uit.extend(lengte);
        }
        uit.extend_from_slice(inhoud);
        uit
    }

    /// Bouwt een DER-ContentInfo opnieuw op na aanpassing van de SignedData-velden.
    fn herbouw_signed_data(cms: &[u8], pas_aan: impl FnOnce(&mut Vec<Vec<u8>>)) -> Vec<u8> {
        use crate::handtekening::ber::{kinderen, lees_tlv};
        let (ci, _) = lees_tlv(cms).unwrap();
        let ci_k = kinderen(ci.inhoud).unwrap();
        let (sd, _) = lees_tlv(ci_k[1].inhoud).unwrap();
        let mut velden: Vec<Vec<u8>> = kinderen(sd.inhoud).unwrap().iter().map(|t| t.geheel.to_vec()).collect();
        pas_aan(&mut velden);
        let mut inhoud = ci_k[0].geheel.to_vec();
        inhoud.extend(der(0xA0, &der(0x30, &velden.concat())));
        der(0x30, &inhoud)
    }

    const OID_ID_DATA: [u8; 11] = [0x06, 0x09, 0x2A, 0x86, 0x48, 0x86, 0xF7, 0x0D, 0x01, 0x07, 0x01];

    #[test]
    fn tijdstempeltoken_wordt_doorgegeven() {
        use crate::handtekening::ber::{kinderen, lees_tlv};
        let data = fixture("data.bin");
        let token = fixture("tst-data.der");
        let cms = herbouw_signed_data(&fixture("cms-rsa-sha256.der"), |velden| {
            let set = velden.last_mut().unwrap();
            let (set_tlv, _) = lees_tlv(set).unwrap();
            let mut si = kinderen(set_tlv.inhoud).unwrap()[0].inhoud.to_vec();
            let oid = [0x06, 0x0B, 0x2A, 0x86, 0x48, 0x86, 0xF7, 0x0D, 0x01, 0x09, 0x10, 0x02, 0x0E];
            let mut attribuut = oid.to_vec();
            attribuut.extend(der(0x31, &token));
            si.extend(der(0xA1, &der(0x30, &attribuut)));
            *set = der(0x31, &der(0x30, &si));
        });
        let u = integriteit_cms(&cms, &[data.as_slice()]);
        assert_eq!(u.integriteit, Integriteit::Intact, "{:?}", u.detail);
        assert_eq!(u.tijdstempeltoken, Some(token));
        assert_eq!(integriteit_cms(&fixture("cms-rsa-sha256.der"), &[data.as_slice()]).tijdstempeltoken, None);
    }

    #[test]
    fn detached_handtekening_met_econtent_of_ander_type_niet_te_controleren() {
        let data = fixture("data.bin");
        // Het herbouwen zelf verandert niets.
        assert_eq!(herbouw_signed_data(&fixture("cms-rsa-sha256.der"), |_| {}), fixture("cms-rsa-sha256.der"));
        let met_inhoud = herbouw_signed_data(&fixture("cms-rsa-sha256.der"), |velden| {
            let mut eci = OID_ID_DATA.to_vec();
            eci.extend(der(0xA0, &der(0x04, &data)));
            velden[2] = der(0x30, &eci);
        });
        assert_eq!(lees_signed_data(&met_inhoud).unwrap().inhoud.as_deref(), Some(data.as_slice()));
        let u = integriteit_cms(&met_inhoud, &[data.as_slice()]);
        assert_eq!(u.integriteit, niet(OnleesbaarReden::CmsOnleesbaar));
        assert!(u.detail.unwrap().contains("eContent"));

        let ander_type = herbouw_signed_data(&fixture("cms-rsa-sha256.der"), |velden| {
            let mut oid = OID_ID_DATA;
            oid[10] = 0x05;
            velden[2] = der(0x30, &oid);
        });
        let u = integriteit_cms(&ander_type, &[data.as_slice()]);
        assert_eq!(u.integriteit, niet(OnleesbaarReden::CmsOnleesbaar));
        assert!(u.detail.unwrap().contains("id-data"));
        assert_eq!(u.signalen, [signaal::ECONTENTTYPE_GEEN_ID_DATA]);
    }

    #[test]
    fn zonder_ondertekende_attributen_gewijzigd_en_ongeldig_gescheiden() {
        let data = fixture("data.bin");
        let cms = fixture("cms-zonder-attributen.der");
        assert!(lees_signed_data(&cms).unwrap().ondertekenaars[0].ondertekende_attributen_der.is_none());
        let u = integriteit_cms(&cms, &[data.as_slice()]);
        assert_eq!(u.integriteit, Integriteit::Intact, "{:?}", u.detail);
        assert!(u.certificaat.is_some());

        let mut anders = data.clone();
        anders[0] ^= 1;
        let u = integriteit_cms(&cms, &[anders.as_slice()]);
        assert_eq!(u.integriteit, Integriteit::Gewijzigd);
        assert_eq!(u.detail, None);
        assert!(u.signalen.is_empty());
        assert!(u.certificaat.is_some());

        let mut kapot = cms.clone();
        let laatste = kapot.len() - 1;
        kapot[laatste] ^= 1;
        let u = integriteit_cms(&kapot, &[data.as_slice()]);
        assert_eq!(u.integriteit, Integriteit::Ongeldig);
        assert!(u.certificaat.is_some());
        // Beschadigd en andere inhoud: de waarde is geen geldige codering, dus ongeldig.
        assert_eq!(integriteit_cms(&kapot, &[anders.as_slice()]).integriteit, Integriteit::Ongeldig);
    }

    #[test]
    fn met_attributen_telt_de_hash_van_het_digestalgoritme() {
        let data = fixture("data.bin");
        let sd = lees_signed_data(&fixture("cms-rsa-sha256.der")).unwrap();
        // sha512WithRSAEncryption bij digestalgoritme SHA-256: niet samenhangend.
        let mut o = sd.ondertekenaars[0].clone();
        o.handtekeningalgoritme.oid = const_oid::ObjectIdentifier::new_unwrap("1.2.840.113549.1.1.13");
        let u = controleer_ondertekenaar(&sd, &o, &[data.as_slice()]);
        assert_eq!(u.integriteit, niet(OnleesbaarReden::AlgoritmeNietOndersteund));
        // messageDigest wordt met het digestalgoritme berekend, niet met de hash uit het handtekening-OID.
        let mut o = sd.ondertekenaars[0].clone();
        o.handtekeningalgoritme.oid = const_oid::ObjectIdentifier::new_unwrap("1.2.840.113549.1.1.11");
        assert_eq!(controleer_ondertekenaar(&sd, &o, &[data.as_slice()]).integriteit, Integriteit::Intact);
        o.digestalgoritme.oid = const_oid::ObjectIdentifier::new_unwrap("2.16.840.1.101.3.4.2.3");
        assert_eq!(controleer_ondertekenaar(&sd, &o, &[data.as_slice()]).integriteit, Integriteit::Gewijzigd);
    }

    use crate::handtekening::cms_lees::{Attribuut, ID_CONTENT_TYPE, ID_MESSAGE_DIGEST};

    #[test]
    fn attributen_buiten_der_volgorde_en_sleutel_id_zijn_intact() {
        let data = fixture("data.bin");
        for naam in ["cms-attribuutvolgorde.der", "cms-sleutel-id.der"] {
            let u = integriteit_cms(&fixture(naam), &[data.as_slice()]);
            assert_eq!(u.integriteit, Integriteit::Intact, "{naam}: {:?}", u.detail);
            assert!(u.certificaat.is_some());
        }
    }

    #[test]
    fn hersorteerde_attributen_kloppen_niet_meer() {
        use crate::handtekening::ber::{kinderen, lees_tlv};
        let data = fixture("data.bin");
        let sd = lees_signed_data(&fixture("cms-attribuutvolgorde.der")).unwrap();
        let mut o = sd.ondertekenaars[0].clone();
        let der = o.ondertekende_attributen_der.clone().unwrap();
        let (set, _) = lees_tlv(&der).unwrap();
        let mut delen: Vec<&[u8]> = kinderen(set.inhoud).unwrap().iter().map(|t| t.geheel).collect();
        delen.sort();
        let inhoud = delen.concat();
        let mut gesorteerd = der[..der.len() - inhoud.len()].to_vec();
        gesorteerd.extend(inhoud);
        assert_ne!(gesorteerd, der);
        o.ondertekende_attributen_der = Some(gesorteerd);
        assert_eq!(controleer_ondertekenaar(&sd, &o, &[data.as_slice()]).integriteit, Integriteit::Ongeldig);
    }

    #[test]
    fn eerste_kandidaat_met_verkeerde_sleutel_blokkeert_niet() {
        let data = fixture("data.bin");
        let mut sd = lees_signed_data(&fixture("cms-rsa-sha256.der")).unwrap();
        // TSA-certificaat (andere RSA-sleutel, zelfde uitgever) met serienummer 3 van het blad.
        let mut nep = fixture("tsa.der");
        let serie = [0x02, 0x01, 0x06];
        let p = nep.windows(3).position(|w| w == serie).unwrap();
        nep[p + 2] = 0x03;
        assert_eq!(lees_certificaat(&nep).unwrap().serienummer, vec![3]);
        sd.certificaten.insert(0, nep);
        let o = sd.ondertekenaars[0].clone();
        let u = controleer_ondertekenaar(&sd, &o, &[data.as_slice()]);
        assert_eq!(u.integriteit, Integriteit::Intact);
        assert_eq!(u.certificaat.unwrap().der, fixture("blad.der"));
        // Alleen de verkeerde kandidaat: de handtekening klopt niet.
        sd.certificaten.retain(|c| *c != fixture("blad.der"));
        assert_eq!(controleer_ondertekenaar(&sd, &o, &[data.as_slice()]).integriteit, Integriteit::Ongeldig);
    }

    #[test]
    fn message_digest_en_content_type_volgens_rfc_5652() {
        let data = fixture("data.bin");
        let sd = lees_signed_data(&fixture("cms-rsa-sha256.der")).unwrap();
        let o = sd.ondertekenaars[0].clone();
        let controleer = |o: &Ondertekenaar| controleer_ondertekenaar(&sd, o, &[data.as_slice()]);
        assert_eq!(controleer(&o).integriteit, Integriteit::Intact);

        let md = o.ondertekende_attributen.iter().find(|a| a.oid == ID_MESSAGE_DIGEST).unwrap().clone();
        let mut dubbel = o.clone();
        dubbel.ondertekende_attributen.push(md.clone());
        let u = controleer(&dubbel);
        assert_eq!(u.integriteit, niet(OnleesbaarReden::CmsOnleesbaar));
        assert!(u.detail.unwrap().contains("messageDigest"));

        let mut zonder_md = o.clone();
        zonder_md.ondertekende_attributen.retain(|a| a.oid != ID_MESSAGE_DIGEST);
        let u = controleer(&zonder_md);
        assert_eq!(u.integriteit, niet(OnleesbaarReden::CmsOnleesbaar));
        assert!(u.detail.unwrap().contains("messageDigest"));

        let mut twee_waarden = o.clone();
        for a in twee_waarden.ondertekende_attributen.iter_mut().filter(|a| a.oid == ID_MESSAGE_DIGEST) {
            a.waarden.push(md.waarden[0].clone());
        }
        assert_eq!(controleer(&twee_waarden).integriteit, niet(OnleesbaarReden::CmsOnleesbaar));

        let mut zonder_type = o.clone();
        zonder_type.ondertekende_attributen.retain(|a| a.oid != ID_CONTENT_TYPE);
        let u = controleer(&zonder_type);
        assert_eq!(u.integriteit, niet(OnleesbaarReden::CmsOnleesbaar));
        assert!(u.detail.unwrap().contains("contentType"));

        let mut ander_type = o.clone();
        ander_type.ondertekende_attributen.retain(|a| a.oid != ID_CONTENT_TYPE);
        // id-ct-TSTInfo als waarde, terwijl eContentType id-data is.
        let tst = vec![0x06, 0x0B, 0x2A, 0x86, 0x48, 0x86, 0xF7, 0x0D, 0x01, 0x09, 0x10, 0x01, 0x04];
        ander_type.ondertekende_attributen.push(Attribuut { oid: ID_CONTENT_TYPE, waarden: vec![tst] });
        let u = controleer(&ander_type);
        assert_eq!(u.integriteit, niet(OnleesbaarReden::CmsOnleesbaar));
        assert!(u.detail.unwrap().contains("contentType"));
    }

    #[test]
    fn zwak_algoritme_verandert_de_integriteit_niet() {
        let data = fixture("data.bin");
        let sd = lees_signed_data(&fixture("cms-rsa-sha256.der")).unwrap();
        let o = sd.ondertekenaars[0].clone();
        let sterk = controleer_ondertekenaar(&sd, &o, &[data.as_slice()]);
        assert_eq!(sterk.integriteit, Integriteit::Intact);
        assert!(!sterk.zwak_algoritme);
        assert!(!integriteit_cms(&fixture("cms-rsa-sha256.der"), &[data.as_slice()]).zwak_algoritme);
        let mut sha1 = o.clone();
        sha1.digestalgoritme.oid = const_oid::ObjectIdentifier::new_unwrap("1.3.14.3.2.26");
        let zwak = controleer_ondertekenaar(&sd, &sha1, &[data.as_slice()]);
        assert_eq!(zwak.integriteit, Integriteit::Gewijzigd);
        assert!(zwak.zwak_algoritme);
    }

    use crate::handtekening::status::{Status, Vertrouwen, WantrouwenReden};
    use crate::handtekening::vertrouwen::Vertrouwensarchief;

    fn bouw_pdf(objecten: &[&str]) -> Vec<u8> {
        let mut pdf = b"%PDF-1.7\n".to_vec();
        let mut posities = Vec::new();
        for (i, o) in objecten.iter().enumerate() {
            posities.push(pdf.len());
            pdf.extend_from_slice(format!("{} 0 obj\n{}\nendobj\n", i + 1, o).as_bytes());
        }
        let xref = pdf.len();
        pdf.extend_from_slice(format!("xref\n0 {}\n0000000000 65535 f\r\n", objecten.len() + 1).as_bytes());
        for p in posities {
            pdf.extend_from_slice(format!("{p:010} 00000 n\r\n").as_bytes());
        }
        pdf.extend_from_slice(
            format!("trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n", objecten.len() + 1).as_bytes(),
        );
        pdf
    }

    /// PDF met één handtekeningveld waarvan het bytebereik precies het gat uitsluit
    /// en tot het einde reikt; `toevoeging` komt daarna (buiten het bereik).
    fn pdf_met_handtekening(subfilter: &str, contents_hex: &str, toevoeging: &str) -> Vec<u8> {
        let sig = format!(
            "<< /Type /Sig /SubFilter /{subfilter} /ByteRange [0 0000000000 0000000000 0000000000] /Contents <{contents_hex}> >>"
        );
        let mut pdf = bouw_pdf(&["<< /Type /Catalog /AcroForm << /Fields [2 0 R] >> >>", "<< /FT /Sig /T (H1) /V 3 0 R >>", sig.as_str()]);
        let lt = pdf.windows(11).position(|w| w == b"/Contents <").unwrap() + 10;
        let start2 = lt + 1 + contents_hex.len() + 1;
        let bereik = format!("0 {lt:010} {start2:010} {:010}", pdf.len() - start2);
        let p = pdf.windows(34).position(|w| w == b"0 0000000000 0000000000 0000000000").unwrap();
        pdf[p..p + 34].copy_from_slice(bereik.as_bytes());
        pdf.extend_from_slice(toevoeging.as_bytes());
        pdf
    }

    fn hex(bytes: &[u8]) -> String {
        bytes.iter().map(|b| format!("{b:02X}")).collect()
    }

    #[test]
    fn leeg_veld_en_ongeldig_bereik() {
        let pdf = bouw_pdf(&[
            "<< /Type /Catalog /AcroForm << /Fields [2 0 R 3 0 R] >> >>",
            "<< /FT /Sig /T (Leeg) >>",
            "<< /FT /Sig /T (Kapot) /V << /Type /Sig /SubFilter /ETSI.CAdES.detached /ByteRange [0 5] /Contents <00> >> >>",
        ]);
        let lijst = verifieer_document(&pdf, &Vertrouwensarchief::leeg(), 0).unwrap();
        assert_eq!(lijst.len(), 2);
        assert_eq!((lijst[0].nummer, lijst[0].soort, lijst[0].status), (0, Soort::LeegVeld, Status::NietOndertekendVeld));
        assert_eq!(lijst[0].integriteit, None);
        assert_eq!(lijst[1].veldnaam.as_deref(), Some("Kapot"));
        assert_eq!(lijst[1].integriteit, Some(niet(OnleesbaarReden::BytebereikOngeldig)));
        assert_eq!(lijst[1].status, Status::NietTeControleren { reden: OnleesbaarReden::BytebereikOngeldig });
        assert_eq!(lijst[1].detail.as_deref(), Some("het bytebereik heeft geen vier getallen"));
        assert_eq!(lijst[1].signalen, [signaal::BYTEBEREIK_GEEN_VIER_GETALLEN]);
        assert!(lijst[0].signalen.is_empty());
    }

    #[test]
    fn verouderd_subfilter_met_volledige_dekking() {
        let pdf = pdf_met_handtekening("adbe.x509.rsa_sha1", "3000", "");
        let lijst = verifieer_document(&pdf, &Vertrouwensarchief::leeg(), 0).unwrap();
        assert_eq!(lijst.len(), 1);
        let h = &lijst[0];
        assert_eq!(h.soort, Soort::Onbekend);
        assert_eq!(h.integriteit, Some(niet(OnleesbaarReden::VerouderdFormaat)));
        assert!(h.dekt_hele_document);
        assert_eq!(h.bereik_einde, Some(pdf.len() as u64));
        assert_eq!(h.detail.as_deref(), Some("adbe.x509.rsa_sha1"));
        assert_eq!(h.signalen, [signaal::SUBFILTER_NIET_ONDERSTEUND]);
    }

    #[test]
    fn onleesbare_cms_en_documenttijdstempel_met_toevoeging() {
        let toevoeging = "\n% toevoeging\n";
        let pdf = pdf_met_handtekening("ETSI.CAdES.detached", "3003020101", toevoeging);
        let h = &verifieer_document(&pdf, &Vertrouwensarchief::leeg(), 0).unwrap()[0];
        assert_eq!(h.soort, Soort::Handtekening);
        assert_eq!(h.integriteit, Some(niet(OnleesbaarReden::CmsOnleesbaar)));
        assert_eq!(h.signalen, [signaal::CMS_STRUCTUUR_ONLEESBAAR]);
        assert!(!h.dekt_hele_document);
        assert!(!h.daarna_gewijzigd, "alleen een intacte handtekening krijgt de toevoeging");
        assert_eq!(h.bestandsgrootte, pdf.len() as u64);
        assert_eq!(h.bereik_einde, Some((pdf.len() - toevoeging.len()) as u64));
        let dts = pdf_met_handtekening("ETSI.RFC3161", "00", "");
        let h = &verifieer_document(&dts, &Vertrouwensarchief::leeg(), 0).unwrap()[0];
        assert_eq!(h.soort, Soort::Documenttijdstempel);
        assert_eq!(h.integriteit, Some(niet(OnleesbaarReden::CmsOnleesbaar)));
        assert_eq!(h.vertrouwen, Vertrouwen::NietBepaald);
    }

    #[test]
    fn alleen_witruimte_na_het_bereik_telt_als_hele_document() {
        let pdf = pdf_met_handtekening("adbe.x509.rsa_sha1", "3000", "\r\n \0");
        let h = &verifieer_document(&pdf, &Vertrouwensarchief::leeg(), 0).unwrap()[0];
        assert!(h.dekt_hele_document);
        assert_eq!(h.bereik_einde, Some((pdf.len() - 4) as u64));
    }

    #[test]
    fn onleesbare_pdf_is_een_fout() {
        assert!(matches!(
            verifieer_document(b"rommel", &Vertrouwensarchief::leeg(), 0),
            Err(LijstFout::PdfOnleesbaar { .. })
        ));
    }

    #[test]
    fn ondertekende_versie_eindigt_bij_het_bereik() {
        let toevoeging = "\n% toevoeging\n";
        let pdf = pdf_met_handtekening("ETSI.CAdES.detached", "3000", toevoeging);
        assert_eq!(ondertekende_versie(&pdf, 0).unwrap(), &pdf[..pdf.len() - toevoeging.len()]);
        assert!(matches!(ondertekende_versie(&pdf, 1), Err(LijstFout::GeenHandtekening)));
    }

    #[test]
    fn commandos_lezen_van_schijf() {
        let toevoeging = "\n% toevoeging\n";
        let pdf = pdf_met_handtekening("ETSI.CAdES.detached", "3000", toevoeging);
        let pad = std::env::temp_dir().join(format!("opds-verifieer-proef-{}.pdf", std::process::id()));
        std::fs::write(&pad, &pdf).unwrap();
        let pad_tekst = pad.to_string_lossy().into_owned();
        let lijst = tauri::async_runtime::block_on(pdf_signature_list(pad_tekst.clone())).unwrap();
        assert_eq!(lijst.len(), 1);
        let map = std::env::temp_dir().join(format!("opds-verifieer-versies-{}", std::process::id()));
        let versie = schrijf_ondertekende_versie(&map, &pad_tekst, 0, None).unwrap();
        assert!(versie.is_absolute());
        assert_eq!(versie.extension().unwrap(), "pdf");
        assert_eq!(std::fs::read(&versie).unwrap().len(), pdf.len() - toevoeging.len());
        // Ook afgebeeld in het geheugen dezelfde bytes.
        assert_eq!(&*lees_bestand(&pad, 0).unwrap(), pdf.as_slice());
        assert!(matches!(lees_bestand(&pad, 0).unwrap(), Bestandsinhoud::Afgebeeld(_)));
        assert!(matches!(lees_bestand(&pad, u64::MAX).unwrap(), Bestandsinhoud::Gelezen(_)));
        std::fs::remove_dir_all(&map).unwrap();
        std::fs::remove_file(&pad).unwrap();
        assert!(matches!(
            tauri::async_runtime::block_on(pdf_signature_list("Z:/bestaat/niet.pdf".into())),
            Err(LijstFout::Onleesbaar { .. })
        ));
    }

    #[test]
    fn serialisatie_voor_de_js_kant() {
        let pdf = pdf_met_handtekening("adbe.x509.rsa_sha1", "3000", "");
        let lijst = verifieer_document(&pdf, &Vertrouwensarchief::leeg(), 0).unwrap();
        let v = serde_json::to_value(&lijst[0]).unwrap();
        assert_eq!(v["status"]["code"], "niet-te-controleren");
        assert_eq!(v["status"]["reden"], "verouderd-formaat");
        assert_eq!(v["daarnaGewijzigd"], false);
        assert_eq!(v["dektHeleDocument"], true);
        assert_eq!(v["soort"], "onbekend");
        assert_eq!(v["tijdBron"], "onbekend");
        assert_eq!(v["integriteit"]["uitkomst"], "niet-te-controleren");
        assert_eq!(v["vertrouwen"]["uitkomst"], "niet-bepaald");
        assert_eq!(v["zwakAlgoritme"], false);
        assert_eq!(v["woordenboekOndertekend"], true);
        assert_eq!(v["lijstAfgekapt"], false);
        assert_eq!(v["signalen"], serde_json::json!(["subfilter-niet-ondersteund"]));
        assert_eq!(
            serde_json::to_string(&LijstFout::PdfOnleesbaar { detail: "x".into() }).unwrap(),
            r#"{"code":"pdf-onleesbaar","detail":"x"}"#
        );
        assert_eq!(serde_json::to_string(&LijstFout::GewijzigdSindsLijst).unwrap(), r#"{"code":"gewijzigd-sinds-lijst"}"#);
    }

    #[test]
    fn ondertekende_versie_controleert_het_bereikeinde_uit_de_lijst() {
        let toevoeging = "\n% toevoeging\n";
        let pdf = pdf_met_handtekening("ETSI.CAdES.detached", "3000", toevoeging);
        let einde = (pdf.len() - toevoeging.len()) as u64;
        assert_eq!(ondertekende_versie_bij(&pdf, 0, Some(einde)).unwrap().len() as u64, einde);
        assert!(matches!(ondertekende_versie_bij(&pdf, 0, Some(einde + 1)), Err(LijstFout::GewijzigdSindsLijst)));
        // De handtekening is er niet meer: ook gewijzigd sinds de lijst.
        assert!(matches!(ondertekende_versie_bij(&pdf, 1, Some(einde)), Err(LijstFout::GewijzigdSindsLijst)));
        assert!(matches!(ondertekende_versie_bij(&pdf, 1, None), Err(LijstFout::GeenHandtekening)));
    }

    #[test]
    fn ondertekende_versies_krijgen_een_unieke_naam_in_een_eigen_map() {
        let basis = std::env::temp_dir().join(format!("opds-verifieer-uniek-{}", std::process::id()));
        let lange_stam = "s".repeat(200);
        let bron = basis.join(format!("{lange_stam}.pdf"));
        std::fs::create_dir_all(&basis).unwrap();
        let pdf = pdf_met_handtekening("ETSI.CAdES.detached", "3000", "\n% toevoeging\n");
        std::fs::write(&bron, &pdf).unwrap();
        let map = map_ondertekende_versies(&basis.join("cache"));
        let bron_tekst = bron.to_string_lossy().into_owned();
        let paden: Vec<PathBuf> = (0..20).map(|_| schrijf_ondertekende_versie(&map, &bron_tekst, 0, None).unwrap()).collect();
        let uniek: std::collections::HashSet<_> = paden.iter().collect();
        assert_eq!(uniek.len(), paden.len(), "zelfde milliseconde, toch unieke namen");
        for pad in &paden {
            assert_eq!(pad.parent().unwrap(), map);
            let naam = pad.file_name().unwrap().to_string_lossy().into_owned();
            assert!(naam.starts_with(&format!("{}-rev1-", "s".repeat(100))), "{naam}");
            assert!(!naam.starts_with(&"s".repeat(101)), "{naam}");
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(std::fs::metadata(&map).unwrap().permissions().mode() & 0o777, 0o700);
            assert_eq!(std::fs::metadata(&paden[0]).unwrap().permissions().mode() & 0o777, 0o600);
        }
        assert!(matches!(
            schrijf_ondertekende_versie(&map, &bron_tekst, 0, Some(1)),
            Err(LijstFout::GewijzigdSindsLijst)
        ));
        assert_eq!(std::fs::read_dir(&map).unwrap().count(), paden.len(), "bij een fout geen bestand");
        std::fs::remove_dir_all(&basis).unwrap();
    }

    #[test]
    fn opruimen_verwijdert_alleen_oude_pdf_bestanden() {
        let map = std::env::temp_dir().join(format!("opds-verifieer-opruimen-{}", std::process::id()));
        std::fs::create_dir_all(&map).unwrap();
        let dagen_geleden = |n: u64| std::time::SystemTime::now() - std::time::Duration::from_secs(n * 24 * 60 * 60);
        let maak = |naam: &str, dagen: u64| {
            let pad = map.join(naam);
            let f = std::fs::File::create(&pad).unwrap();
            f.set_modified(dagen_geleden(dagen)).unwrap();
            pad
        };
        let oud = maak("oud-rev1.pdf", 8);
        let dagen_oud = maak("dagen-oud-rev1.pdf", 2);
        let nieuw = maak("nieuw-rev1.pdf", 0);
        let ander = maak("ander.txt", 8);
        ruim_ondertekende_versies_op(&map, OPRUIMEN_NA);
        assert!(!oud.exists());
        // Een paar dagen oud kan nog open staan in een andere instantie.
        assert!(dagen_oud.exists());
        assert!(nieuw.exists());
        assert!(ander.exists());
        // Een ontbrekende map is geen fout.
        ruim_ondertekende_versies_op(&map.join("bestaat-niet"), std::time::Duration::ZERO);
        std::fs::remove_dir_all(&map).unwrap();
    }

    #[test]
    fn paniek_in_een_handtekening_blijft_bij_die_handtekening() {
        let pdf = pdf_met_geleend_bereik();
        let gewoon = verifieer_document(&pdf, &Vertrouwensarchief::leeg(), 0).unwrap();
        PANIEK_BIJ.with(|p| p.set(Some(0)));
        let lijst = verifieer_document(&pdf, &Vertrouwensarchief::leeg(), 0);
        PANIEK_BIJ.with(|p| p.set(None));
        let lijst = lijst.unwrap();
        assert_eq!(lijst.len(), 2);
        assert_eq!(lijst[0].integriteit, Some(niet(OnleesbaarReden::CmsOnleesbaar)));
        assert_eq!(lijst[0].status, Status::NietTeControleren { reden: OnleesbaarReden::CmsOnleesbaar });
        assert_eq!(lijst[0].vertrouwen, Vertrouwen::NietBepaald);
        assert!(lijst[0].detail.as_deref().unwrap().contains("geforceerde paniek"), "{:?}", lijst[0].detail);
        assert_eq!(lijst[0].signalen, [signaal::INTERNE_FOUT]);
        assert_eq!(lijst[0].veldnaam.as_deref(), Some("A"));
        // De andere handtekening wordt gewoon gecontroleerd.
        assert_eq!(lijst[1].integriteit, gewoon[1].integriteit);
        assert_eq!(lijst[1].detail, gewoon[1].detail);
        assert_eq!(lijst[1].signalen, gewoon[1].signalen);
    }

    #[test]
    fn relevante_tijd_ligt_nooit_na_nu() {
        assert_eq!(relevante_tijd(None, 1_000), 1_000);
        assert_eq!(relevante_tijd(Some(900), 1_000), 900);
        assert_eq!(relevante_tijd(Some(5_000), 1_000), 1_000);
    }

    #[test]
    fn meer_dan_de_grens_aan_velden_markeert_de_lijst() {
        use crate::handtekening::pdf_lezen::MAX_HANDTEKENINGVELDEN;
        let n = MAX_HANDTEKENINGVELDEN + 1;
        let refs: Vec<String> = (0..n).map(|i| format!("{} 0 R", i + 2)).collect();
        let mut objecten = vec![format!("<< /Type /Catalog /AcroForm << /Fields [{}] >> >>", refs.join(" "))];
        objecten.extend((0..n).map(|i| format!("<< /FT /Sig /T (V{i}) >>")));
        let pdf = bouw_pdf(&objecten.iter().map(String::as_str).collect::<Vec<_>>());
        let lijst = verifieer_document(&pdf, &Vertrouwensarchief::leeg(), 0).unwrap();
        assert_eq!(lijst.len(), MAX_HANDTEKENINGVELDEN);
        assert!(lijst.iter().all(|h| h.lijst_afgekapt));
        assert!(!verifieer_document(&pdf_met_geleend_bereik(), &Vertrouwensarchief::leeg(), 0).unwrap()[0].lijst_afgekapt);
    }

    #[test]
    fn budget_op_in_detail() {
        let k = |vertrouwen, budget_op| Ketenuitkomst { vertrouwen, keten: Vec::new(), zwak_algoritme: false, budget_op };
        let geen = Vertrouwen::NietVertrouwd { reden: WantrouwenReden::GeenKeten };
        assert_eq!(budget_melding(Some(&k(geen, true)), "tijdstempel: ").as_deref(), Some("tijdstempel: ketenzoektocht afgebroken op het zoekbudget"));
        assert_eq!(budget_melding(Some(&k(geen, false)), ""), None);
        assert_eq!(budget_melding(Some(&k(Vertrouwen::Vertrouwd, true)), ""), None);
        assert_eq!(budget_melding(None, ""), None);
    }

    #[test]
    fn signalen_zonder_dubbelen() {
        let mut signalen = Vec::new();
        voeg_signaal_toe(&mut signalen, signaal::ZOEKBUDGET_OP);
        voeg_signalen_toe(&mut signalen, &[signaal::ZOEKBUDGET_OP, signaal::INTERNE_FOUT]);
        assert_eq!(signalen, [signaal::ZOEKBUDGET_OP, signaal::INTERNE_FOUT]);
    }

    #[test]
    fn documentbudget_wordt_gedeeld_en_raakt_op() {
        let blad = lees_certificaat(&fixture("blad.der")).unwrap();
        let tussen = [lees_certificaat(&fixture("tussen.der")).unwrap()];
        let root = fixture("root.der");
        let archief = Vertrouwensarchief::uit_der([root.as_slice()]);
        let tijd = i64::try_from(blad.x509.tbs_certificate.validity.not_before.to_unix_duration().as_secs()).unwrap() + 3600;
        let mut budget = 3;
        let eerste = keten_binnen_budget(&blad, &tussen, &archief, tijd, Rol::Ondertekenaar, &mut budget);
        assert_eq!(eerste.vertrouwen, Vertrouwen::Vertrouwd);
        assert!(budget < 3, "de controles tellen af: {budget}");
        // Tot het budget op is; daarna niet vertrouwd met budget_op (signaal zoekbudget-op).
        let mut uitkomsten = Vec::new();
        for _ in 0..4 {
            uitkomsten.push(keten_binnen_budget(&blad, &tussen, &archief, tijd, Rol::Ondertekenaar, &mut budget));
        }
        assert_eq!(budget, 0);
        let laatste = uitkomsten.last().unwrap();
        assert_eq!(laatste.vertrouwen, Vertrouwen::NietVertrouwd { reden: WantrouwenReden::GeenKeten });
        assert!(laatste.budget_op);
        assert!(budget_melding(Some(laatste), "").is_some());
    }

    /// Met het corpus: een document met meer handtekeningen, en een budget dat
    /// na de eerste keten op is. Volgende intacte handtekeningen krijgen het
    /// signaal; met het gewone budget geen enkele.
    #[test]
    fn documentbudget_over_alle_handtekeningen() {
        let Some(map) = crate::handtekening::corpusmap("pades") else { return };
        let bytes = std::fs::read(map.join("pades-5-signatures-and-1-document-timestamp.pdf")).unwrap();
        let heeft = |h: &HandtekeningInfo| h.signalen.iter().any(|s| s == signaal::ZOEKBUDGET_OP);
        let gewoon = verifieer_document(&bytes, &Vertrouwensarchief::leeg(), 1_789_000_000).unwrap();
        assert!(!gewoon.iter().any(heeft));
        let krap = verifieer_document_binnen(&bytes, &Vertrouwensarchief::leeg(), 1_789_000_000, 0).unwrap();
        let intact: Vec<&HandtekeningInfo> = krap.iter().filter(|h| h.integriteit == Some(Integriteit::Intact)).collect();
        assert!(intact.len() >= 2);
        assert!(intact.iter().any(|h| heeft(h)), "{:?}", intact.iter().map(|h| &h.signalen).collect::<Vec<_>>());
        for h in &intact {
            assert_ne!(h.status, Status::Geldig);
        }
    }

    #[test]
    fn intacte_uitkomst_krijgt_nooit_niet_bepaald() {
        let blad = lees_certificaat(&fixture("blad.der")).unwrap();
        let leeg = Vertrouwensarchief::leeg();
        let keten = |c: &Certificaat| crate::handtekening::vertrouwen::beoordeel(c, &[], &leeg, 0, Rol::Ondertekenaar);
        // Zonder blad (hoort bij intact niet voor te komen): geen keten, geen `NietBepaald`.
        let (v, k) = vertrouwen_bij(Integriteit::Intact, None, keten);
        assert_eq!(v, Vertrouwen::NietVertrouwd { reden: WantrouwenReden::GeenKeten });
        assert!(k.is_none());
        let (v, k) = vertrouwen_bij(Integriteit::Intact, Some(&blad), keten);
        assert_eq!(v, Vertrouwen::NietVertrouwd { reden: WantrouwenReden::GeenKeten });
        assert!(k.is_some());
        for anders in [Integriteit::Gewijzigd, Integriteit::Ongeldig, niet(OnleesbaarReden::CmsOnleesbaar)] {
            let (v, k) = vertrouwen_bij(anders, Some(&blad), |_| panic!("alleen intact wordt beoordeeld"));
            assert_eq!((v, k.is_none()), (Vertrouwen::NietBepaald, true));
        }
    }

    /// Handtekeningveld met een CMS uit de fixtures als `/Contents`.
    fn pdf_met_cms(cms: &[u8]) -> Vec<u8> {
        pdf_met_handtekening("ETSI.CAdES.detached", &hex(cms), "")
    }

    #[test]
    fn cms_uit_de_fixtures_gewijzigd_met_keten_en_zonder_waarschuwing() {
        let pdf = pdf_met_cms(&fixture("cms-rsa-sha256.der"));
        let h = &verifieer_document(&pdf, &Vertrouwensarchief::leeg(), 0).unwrap()[0];
        assert_eq!(h.integriteit, Some(Integriteit::Gewijzigd));
        assert_eq!(h.status, Status::GewijzigdNaOndertekenen);
        assert_eq!(h.vertrouwen, Vertrouwen::NietBepaald);
        assert!(h.ondertekenaar.is_some());
        assert_eq!(h.keten.len(), 1);
        assert!(!h.zwak_algoritme);
        assert_eq!(h.detail, None);
        assert!(h.signalen.is_empty());
    }

    #[test]
    fn zwak_algoritme_wordt_een_waarschuwing() {
        use crate::handtekening::ber::{kinderen, lees_tlv};
        let sha1 = [0x30, 0x09, 0x06, 0x05, 0x2B, 0x0E, 0x03, 0x02, 0x1A, 0x05, 0x00];
        let cms = herbouw_signed_data(&fixture("cms-rsa-sha256.der"), |velden| {
            let set = velden.last_mut().unwrap();
            let (set_tlv, _) = lees_tlv(set).unwrap();
            let (si, _) = lees_tlv(kinderen(set_tlv.inhoud).unwrap()[0].geheel).unwrap();
            let mut delen: Vec<Vec<u8>> = kinderen(si.inhoud).unwrap().iter().map(|t| t.geheel.to_vec()).collect();
            delen[2] = sha1.to_vec();
            *set = der(0x31, &der(0x30, &delen.concat()));
        });
        let pdf = pdf_met_cms(&cms);
        let h = &verifieer_document(&pdf, &Vertrouwensarchief::leeg(), 0).unwrap()[0];
        assert!(h.zwak_algoritme);
        // Alleen een waarschuwing: integriteit en status zoals zonder.
        assert_eq!(h.integriteit, Some(Integriteit::Gewijzigd));
        assert_eq!(h.status, Status::GewijzigdNaOndertekenen);
    }

    #[test]
    fn tijdstempel_over_een_andere_waarde_is_niet_de_getoonde_tijd() {
        use crate::handtekening::ber::{kinderen, lees_tlv};
        let token = fixture("tst-data.der");
        let cms = herbouw_signed_data(&fixture("cms-rsa-sha256.der"), |velden| {
            let set = velden.last_mut().unwrap();
            let (set_tlv, _) = lees_tlv(set).unwrap();
            let mut si = kinderen(set_tlv.inhoud).unwrap()[0].inhoud.to_vec();
            let oid = [0x06, 0x0B, 0x2A, 0x86, 0x48, 0x86, 0xF7, 0x0D, 0x01, 0x09, 0x10, 0x02, 0x0E];
            let mut attribuut = oid.to_vec();
            attribuut.extend(der(0x31, &token));
            si.extend(der(0xA1, &der(0x30, &attribuut)));
            *set = der(0x31, &der(0x30, &si));
        });
        let sig = format!(
            "<< /Type /Sig /SubFilter /ETSI.CAdES.detached /M (D:20180901162846+02'00') /ByteRange [0 0000000000 0000000000 0000000000] /Contents <{}> >>",
            hex(&cms)
        );
        let mut pdf = bouw_pdf(&["<< /Type /Catalog /AcroForm << /Fields [2 0 R] >> >>", "<< /FT /Sig /T (H1) /V 3 0 R >>", &sig]);
        let lt = pdf.windows(11).position(|w| w == b"/Contents <").unwrap() + 10;
        let start2 = lt + 2 + cms.len() * 2;
        let bereik = format!("0 {lt:010} {start2:010} {:010}", pdf.len() - start2);
        let p = pdf.windows(34).position(|w| w == b"0 0000000000 0000000000 0000000000").unwrap();
        pdf[p..p + 34].copy_from_slice(bereik.as_bytes());
        let h = &verifieer_document(&pdf, &Vertrouwensarchief::leeg(), 0).unwrap()[0];
        let t = h.tijdstempel.as_ref().expect("token doorgegeven");
        // Het token gaat over data.bin, niet over deze handtekeningwaarde.
        assert_eq!(t.integriteit, Integriteit::Gewijzigd);
        assert_eq!(t.vertrouwen, Vertrouwen::NietBepaald);
        assert!(t.signalen.is_empty());
        assert_eq!((h.tijd_unix, h.tijd_bron), (Some(1_535_812_126), TijdBron::Opgegeven));
    }

    /// Twee handtekeningwoordenboeken (objecten 4 en 5) met hetzelfde bytebereik:
    /// dat van 4, eindigend na object 4. Object 5 leent het, met eigen `/Contents`.
    fn pdf_met_geleend_bereik() -> Vec<u8> {
        let sig = |contents: &str| {
            format!("<< /Type /Sig /SubFilter /ETSI.CAdES.detached /Reason (R{contents}) /ByteRange [0 0000000000 0000000000 0000000000] /Contents <{contents}> >>")
        };
        let (a, b) = (sig("3000"), sig("3001"));
        let mut pdf = bouw_pdf(&[
            "<< /Type /Catalog /AcroForm << /Fields [2 0 R 3 0 R] >> >>",
            "<< /FT /Sig /T (A) /V 4 0 R >>",
            "<< /FT /Sig /T (B) /V 5 0 R >>",
            &a,
            &b,
        ]);
        let tekst = String::from_utf8_lossy(&pdf).into_owned();
        let lt = tekst.find("/Contents <3000>").unwrap() + 10;
        let start2 = lt + 6;
        let einde = tekst.find("5 0 obj").unwrap();
        let bereik = format!("0 {lt:010} {start2:010} {:010}", einde - start2);
        for _ in 0..2 {
            let p = pdf.windows(34).position(|w| w == b"0 0000000000 0000000000 0000000000").unwrap();
            pdf[p..p + 34].copy_from_slice(bereik.as_bytes());
        }
        pdf
    }

    #[test]
    fn geleend_bereik_meldt_afwijkend_gat_en_niet_ondertekend_woordenboek() {
        let pdf = pdf_met_geleend_bereik();
        let lijst = verifieer_document(&pdf, &Vertrouwensarchief::leeg(), 0).unwrap();
        assert_eq!(lijst.len(), 2);
        let (a, b) = (&lijst[0], &lijst[1]);
        assert_eq!((a.veldnaam.as_deref(), b.veldnaam.as_deref()), (Some("A"), Some("B")));
        assert!(a.woordenboek_ondertekend);
        assert!(!a.detail.as_deref().unwrap_or("").contains(GAT_WIJKT_AF));
        assert!(!a.signalen.iter().any(|s| s == signaal::GAT_WIJKT_AF_VAN_CONTENTS));
        // Reden en `/M` van B vallen niet onder het (geleende) bereik; de UI markeert ze.
        assert!(!b.woordenboek_ondertekend);
        assert_eq!(b.reden.as_deref(), Some("R3001"));
        assert!(b.detail.as_deref().unwrap().contains(GAT_WIJKT_AF), "{:?}", b.detail);
        assert_eq!(b.signalen.iter().filter(|s| *s == signaal::GAT_WIJKT_AF_VAN_CONTENTS).count(), 1, "{:?}", b.signalen);
        // Het extra signaal verandert de integriteit niet.
        assert_eq!(a.integriteit, b.integriteit);
    }

    #[test]
    fn twee_velden_met_dezelfde_waarde_tellen_eenmaal() {
        let sig = "<< /Type /Sig /SubFilter /adbe.x509.rsa_sha1 /ByteRange [0 5] /Contents <3000> >>";
        let pdf = bouw_pdf(&[
            "<< /Type /Catalog /AcroForm << /Fields [2 0 R 3 0 R 5 0 R] >> >>",
            "<< /FT /Sig /T (Eerste) /V 4 0 R >>",
            "<< /FT /Sig /T (Tweede) /V 4 0 R >>",
            sig,
            "<< /FT /Sig /T (Leeg1) >>",
        ]);
        let lijst = verifieer_document(&pdf, &Vertrouwensarchief::leeg(), 0).unwrap();
        let namen: Vec<_> = lijst.iter().map(|h| (h.nummer, h.veldnaam.as_deref())).collect();
        assert_eq!(namen, [(0, Some("Eerste")), (1, Some("Leeg1"))]);
        // Lege velden worden niet samengevoegd.
        let pdf = bouw_pdf(&[
            "<< /Type /Catalog /AcroForm << /Fields [2 0 R 3 0 R] >> >>",
            "<< /FT /Sig /T (Leeg) >>",
            "<< /FT /Sig /T (Leeg) >>",
        ]);
        assert_eq!(verifieer_document(&pdf, &Vertrouwensarchief::leeg(), 0).unwrap().len(), 2);
    }

    fn sha256_hex(tekst: &str) -> String {
        use sha2::{Digest, Sha256};
        Sha256::digest(tekst.as_bytes()).iter().map(|b| format!("{b:02x}")).collect()
    }

    /// Zelfde vorm als een regel in `handtekeningen` van het manifest. De reden
    /// van het vertrouwensoordeel staat er niet in: die hangt af van het
    /// rootarchief van de machine en van de klok.
    fn als_manifestregel(h: &HandtekeningInfo) -> serde_json::Value {
        let mut regel = serde_json::Map::new();
        regel.insert("soort".into(), serde_json::to_value(h.soort).unwrap());
        // Als hash: veldnamen in het corpus bevatten namen van producten.
        if let Some(naam) = &h.veldnaam {
            regel.insert("veldnaamSha256".into(), sha256_hex(naam).into());
        }
        if h.soort == Soort::LeegVeld {
            return serde_json::Value::Object(regel);
        }
        regel.insert("dekt".into(), serde_json::Value::Bool(h.dekt_hele_document));
        if let Some(einde) = h.bereik_einde {
            regel.insert("bereikEinde".into(), einde.into());
        }
        regel.insert("woordenboekOndertekend".into(), h.woordenboek_ondertekend.into());
        // Als hash: redenen in het corpus bevatten namen van personen en producten.
        if let Some(reden) = &h.reden {
            regel.insert("opgegevenRedenSha256".into(), sha256_hex(reden).into());
        }
        regel.insert("tijdBron".into(), serde_json::to_value(h.tijd_bron).unwrap());
        if let Some(i) = h.integriteit {
            let v = serde_json::to_value(i).unwrap();
            regel.insert("integriteit".into(), v["uitkomst"].clone());
            if let Some(reden) = v.get("reden") {
                regel.insert("reden".into(), reden.clone());
            }
        }
        if let Some(t) = &h.tijdstempel {
            regel.insert("tijdstempel".into(), serde_json::to_value(t.integriteit).unwrap()["uitkomst"].clone());
        }
        serde_json::Value::Object(regel)
    }

    /// Het externe PAdES-corpus (scripts/haal-handtekening-testdata.py) tegen de
    /// gemeten verwachtingen in het manifest. Ontbreekt het, dan slaat de test over.
    #[test]
    fn corpus_volgens_manifest() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
        let Some(map) = crate::handtekening::corpusmap("pades") else { return };
        let manifest: serde_json::Value =
            serde_json::from_slice(&std::fs::read(root.join("scripts/handtekening-testdata.json")).unwrap()).unwrap();
        let bestanden = manifest["bronnen"]["pades"]["bestanden"].as_array().unwrap();
        assert_eq!(bestanden.len(), 18);
        // Het manifest zelf bewaakt de vervangen reden: het ondertekende exemplaar telt.
        let vervalst = bestanden.iter().find(|f| f["bestand"] == "pades-spoofing-replaced-reason.pdf").unwrap();
        assert_eq!(vervalst["handtekeningen"][0]["woordenboekOndertekend"], true);
        assert_eq!(vervalst["handtekeningen"][0]["opgegevenRedenSha256"], sha256_hex("DSS testing"));
        // Veldnamen alleen als hash in het manifest.
        assert!(bestanden.iter().flat_map(|f| f["handtekeningen"].as_array().unwrap()).all(|h| h.get("veldnaam").is_none()));
        assert_eq!(bestanden[0]["handtekeningen"][0]["veldnaamSha256"], sha256_hex("Signature1"));
        let mut fouten = Vec::new();
        for f in bestanden {
            let naam = f["bestand"].as_str().unwrap();
            let verwacht = f["handtekeningen"].as_array().expect("manifest zonder handtekeningen");
            let bytes = std::fs::read(map.join(naam)).unwrap();
            let lijst = match verifieer_document(&bytes, &Vertrouwensarchief::leeg(), 1_789_000_000) {
                Ok(l) => l,
                Err(e) => {
                    fouten.push(format!("{naam}: {e:?}"));
                    continue;
                }
            };
            let gemeten: Vec<serde_json::Value> = lijst.iter().map(als_manifestregel).collect();
            if gemeten != *verwacht {
                fouten.push(format!(
                    "{naam}:\n  gemeten  {}\n  verwacht {}",
                    serde_json::Value::Array(gemeten),
                    serde_json::Value::Array(verwacht.clone())
                ));
            }
            for h in &lijst {
                if h.status == Status::Geldig {
                    fouten.push(format!("{naam} #{}: 'Geldig' zonder rootarchief", h.nummer));
                }
                let moet_melden = h.integriteit == Some(Integriteit::Intact) && !h.dekt_hele_document;
                if h.daarna_gewijzigd != moet_melden {
                    fouten.push(format!("{naam} #{}: daarna_gewijzigd = {}", h.nummer, h.daarna_gewijzigd));
                }
                // Een intacte handtekening of tijdstempel krijgt altijd een vertrouwensoordeel.
                if h.integriteit == Some(Integriteit::Intact) && h.vertrouwen == Vertrouwen::NietBepaald {
                    fouten.push(format!("{naam} #{}: intact met vertrouwen 'niet bepaald'", h.nummer));
                }
                if let Some(t) = h.tijdstempel.as_ref().filter(|t| t.integriteit == Integriteit::Intact) {
                    if t.vertrouwen == Vertrouwen::NietBepaald {
                        fouten.push(format!("{naam} #{}: intact tijdstempel met vertrouwen 'niet bepaald'", h.nummer));
                    }
                }
                if h.soort != Soort::LeegVeld && h.integriteit.is_none() {
                    fouten.push(format!("{naam} #{}: geen integriteit", h.nummer));
                }
            }
        }
        assert!(fouten.is_empty(), "{}", fouten.join("\n"));
    }
}
