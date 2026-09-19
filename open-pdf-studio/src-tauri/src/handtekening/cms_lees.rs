//! CMS SignedData (RFC 5652) verdraagzaam uitlezen.
//!
//! Bewust niet via de getypte `cms`-structuren: die sorteren SET OF bij het
//! decoderen (ondertekende attributen die niet in DER-volgorde staan, kloppen
//! dan niet meer) en weigeren de hele handtekening bij één afwijkend
//! certificaat. Hier: eerst BER naar DER, dan veld voor veld met de TLV-lezer.
//! De ondertekende attributen blijven als oorspronkelijke bytes bewaard.

use const_oid::ObjectIdentifier;
use der::Decode;

use super::ber::{kinderen, lees_tlv, normaliseer, BerFout, Tlv};

pub const ID_SIGNED_DATA: ObjectIdentifier = ObjectIdentifier::new_unwrap("1.2.840.113549.1.7.2");
pub const ID_DATA: ObjectIdentifier = ObjectIdentifier::new_unwrap("1.2.840.113549.1.7.1");
pub const ID_TST_INFO: ObjectIdentifier = ObjectIdentifier::new_unwrap("1.2.840.113549.1.9.16.1.4");
pub const ID_CONTENT_TYPE: ObjectIdentifier = ObjectIdentifier::new_unwrap("1.2.840.113549.1.9.3");
pub const ID_MESSAGE_DIGEST: ObjectIdentifier = ObjectIdentifier::new_unwrap("1.2.840.113549.1.9.4");
pub const ID_SIGNATURE_TIME_STAMP_TOKEN: ObjectIdentifier =
    ObjectIdentifier::new_unwrap("1.2.840.113549.1.9.16.2.14");
const SUBJECT_KEY_IDENTIFIER: ObjectIdentifier = ObjectIdentifier::new_unwrap("2.5.29.14");

/// Waarom een CMS-structuur niet te lezen is.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CmsFout(pub String);

impl From<BerFout> for CmsFout {
    fn from(e: BerFout) -> Self {
        CmsFout(e.to_string())
    }
}

fn fout(tekst: &str) -> CmsFout {
    CmsFout(tekst.to_string())
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AlgId {
    pub oid: ObjectIdentifier,
    /// Volledige DER-TLV van de parameters, indien aanwezig.
    pub parameters: Option<Vec<u8>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Sid {
    UitgeverEnSerienummer { uitgever_der: Vec<u8>, serienummer: Vec<u8> },
    SleutelId(Vec<u8>),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Attribuut {
    pub oid: ObjectIdentifier,
    /// Elke waarde als volledige DER-TLV.
    pub waarden: Vec<Vec<u8>>,
}

#[derive(Debug, Clone)]
pub struct Ondertekenaar {
    pub sid: Sid,
    pub digestalgoritme: AlgId,
    /// De ondertekende attributen met tag SET (`0x31`), in de oorspronkelijke
    /// volgorde: precies de bytes waarover de handtekening gaat.
    pub ondertekende_attributen_der: Option<Vec<u8>>,
    pub ondertekende_attributen: Vec<Attribuut>,
    pub handtekeningalgoritme: AlgId,
    pub handtekening: Vec<u8>,
    pub onondertekende_attributen: Vec<Attribuut>,
}

impl Ondertekenaar {
    /// De enige waarde (volledige TLV) van een ondertekend attribuut. `None` als
    /// het attribuut ontbreekt, vaker voorkomt of niet precies één waarde heeft
    /// (RFC 5652 §5.3 vereist dat voor `contentType` en `messageDigest`).
    fn enige_ondertekende_waarde(&self, oid: ObjectIdentifier) -> Option<&[u8]> {
        let mut gevonden = self.ondertekende_attributen.iter().filter(|a| a.oid == oid);
        let attribuut = gevonden.next()?;
        if gevonden.next().is_some() {
            return None;
        }
        match attribuut.waarden.as_slice() {
            [waarde] => Some(waarde.as_slice()),
            _ => None,
        }
    }

    /// Inhoud van het `messageDigest`-attribuut; `None` tenzij het precies één
    /// keer voorkomt met precies één OCTET STRING.
    pub fn message_digest(&self) -> Option<Vec<u8>> {
        let (t, rest) = lees_tlv(self.enige_ondertekende_waarde(ID_MESSAGE_DIGEST)?).ok()?;
        (t.tag == 0x04 && rest.is_empty()).then(|| t.inhoud.to_vec())
    }

    /// Het `contentType`-attribuut; `None` tenzij het precies één keer voorkomt
    /// met precies één OID.
    pub fn content_type(&self) -> Option<ObjectIdentifier> {
        let (t, rest) = lees_tlv(self.enige_ondertekende_waarde(ID_CONTENT_TYPE)?).ok()?;
        if !rest.is_empty() {
            return None;
        }
        oid_uit(&t).ok()
    }

    /// Eerste waarde (volledige TLV) van een onondertekend attribuut.
    pub fn onondertekend(&self, oid: ObjectIdentifier) -> Option<&[u8]> {
        self.onondertekende_attributen.iter().find(|a| a.oid == oid)?.waarden.first().map(Vec::as_slice)
    }
}

#[derive(Debug, Clone)]
pub struct SignedData {
    pub inhoudstype: ObjectIdentifier,
    /// Ingekapselde inhoud (bij een tijdstempel: TSTInfo); `None` bij detached.
    pub inhoud: Option<Vec<u8>>,
    /// Elk certificaat als DER, ook als het niet strikt leesbaar is.
    pub certificaten: Vec<Vec<u8>>,
    pub ondertekenaars: Vec<Ondertekenaar>,
}

/// Een strikt gelezen X.509-certificaat met de ruwe delen die voor
/// verificatie nodig zijn (oorspronkelijke bytes, niet opnieuw gecodeerd).
#[derive(Debug, Clone)]
pub struct Certificaat {
    pub der: Vec<u8>,
    pub tbs_der: Vec<u8>,
    pub uitgever_der: Vec<u8>,
    pub onderwerp_der: Vec<u8>,
    pub serienummer: Vec<u8>,
    pub spki_der: Vec<u8>,
    pub handtekeningalgoritme: AlgId,
    pub handtekening: Vec<u8>,
    pub x509: x509_cert::Certificate,
}

impl Certificaat {
    /// De extensie subjectKeyIdentifier, indien aanwezig.
    pub fn sleutel_id(&self) -> Option<Vec<u8>> {
        let extensie = self
            .x509
            .tbs_certificate
            .extensions
            .as_ref()?
            .iter()
            .find(|e| e.extn_id == SUBJECT_KEY_IDENTIFIER)?;
        let (t, _) = lees_tlv(extensie.extn_value.as_bytes()).ok()?;
        (t.tag == 0x04).then(|| t.inhoud.to_vec())
    }
}

pub fn oid_uit(t: &Tlv<'_>) -> Result<ObjectIdentifier, CmsFout> {
    if t.tag != 0x06 {
        return Err(fout("OID verwacht"));
    }
    ObjectIdentifier::from_bytes(t.inhoud).map_err(|_| fout("ongeldige OID"))
}

pub fn alg_id(t: &Tlv<'_>) -> Result<AlgId, CmsFout> {
    if t.tag != 0x30 {
        return Err(fout("AlgorithmIdentifier verwacht"));
    }
    let k = kinderen(t.inhoud)?;
    let eerste = k.first().ok_or_else(|| fout("lege AlgorithmIdentifier"))?;
    Ok(AlgId { oid: oid_uit(eerste)?, parameters: k.get(1).map(|p| p.geheel.to_vec()) })
}

fn attributen(inhoud: &[u8]) -> Result<Vec<Attribuut>, CmsFout> {
    let mut uit = Vec::new();
    for a in kinderen(inhoud)? {
        if a.tag != 0x30 {
            return Err(fout("Attribute verwacht"));
        }
        let k = kinderen(a.inhoud)?;
        let (Some(o), Some(waarden)) = (k.first(), k.get(1)) else {
            return Err(fout("onvolledig attribuut"));
        };
        if waarden.tag != 0x31 {
            return Err(fout("attribuutwaarden verwacht"));
        }
        uit.push(Attribuut {
            oid: oid_uit(o)?,
            waarden: kinderen(waarden.inhoud)?.iter().map(|w| w.geheel.to_vec()).collect(),
        });
    }
    Ok(uit)
}

fn lees_ondertekenaar(si: &Tlv<'_>) -> Result<Ondertekenaar, CmsFout> {
    if si.tag != 0x30 {
        return Err(fout("SignerInfo verwacht"));
    }
    let k = kinderen(si.inhoud)?;
    let veld = |i: usize| k.get(i).ok_or_else(|| fout("onvolledige SignerInfo"));
    let sid_tlv = veld(1)?;
    let sid = match sid_tlv.tag {
        0x30 => {
            let d = kinderen(sid_tlv.inhoud)?;
            let (Some(uitgever), Some(serie)) = (d.first(), d.get(1)) else {
                return Err(fout("onvolledige IssuerAndSerialNumber"));
            };
            if serie.tag != 0x02 {
                return Err(fout("serienummer verwacht"));
            }
            Sid::UitgeverEnSerienummer { uitgever_der: uitgever.geheel.to_vec(), serienummer: serie.inhoud.to_vec() }
        }
        0x80 => Sid::SleutelId(sid_tlv.inhoud.to_vec()),
        _ => return Err(fout("onbekende SignerIdentifier")),
    };
    let digestalgoritme = alg_id(veld(2)?)?;
    let mut i = 3;
    let mut ondertekende_attributen_der = None;
    let mut ondertekende_attributen = Vec::new();
    if veld(i)?.tag == 0xA0 {
        let mut set = veld(i)?.geheel.to_vec();
        if let Some(eerste) = set.first_mut() {
            *eerste = 0x31;
        }
        ondertekende_attributen = attributen(veld(i)?.inhoud)?;
        ondertekende_attributen_der = Some(set);
        i += 1;
    }
    let handtekeningalgoritme = alg_id(veld(i)?)?;
    let waarde = veld(i + 1)?;
    if waarde.tag != 0x04 {
        return Err(fout("handtekeningwaarde verwacht"));
    }
    let onondertekende_attributen = match k.get(i + 2) {
        Some(t) if t.tag == 0xA1 => attributen(t.inhoud)?,
        Some(_) => return Err(fout("onverwacht element in SignerInfo")),
        None => Vec::new(),
    };
    Ok(Ondertekenaar {
        sid,
        digestalgoritme,
        ondertekende_attributen_der,
        ondertekende_attributen,
        handtekeningalgoritme,
        handtekening: waarde.inhoud.to_vec(),
        onondertekende_attributen,
    })
}

/// Leest een ContentInfo met SignedData (DER of BER; vulbytes erachter mogen).
pub fn lees_signed_data(bytes: &[u8]) -> Result<SignedData, CmsFout> {
    let (der, _) = normaliseer(bytes)?;
    let (ci, _) = lees_tlv(&der)?;
    if ci.tag != 0x30 {
        return Err(fout("ContentInfo verwacht"));
    }
    let ci_k = kinderen(ci.inhoud)?;
    let (Some(soort), Some(omhulsel)) = (ci_k.first(), ci_k.get(1)) else {
        return Err(fout("onvolledige ContentInfo"));
    };
    if oid_uit(soort)? != ID_SIGNED_DATA {
        return Err(fout("geen SignedData"));
    }
    if omhulsel.tag != 0xA0 {
        return Err(fout("[0] verwacht in ContentInfo"));
    }
    let (sd, _) = lees_tlv(omhulsel.inhoud)?;
    if sd.tag != 0x30 {
        return Err(fout("SignedData verwacht"));
    }
    let velden = kinderen(sd.inhoud)?;
    match (velden.first(), velden.get(1), velden.get(2)) {
        (Some(v), Some(d), Some(e)) if v.tag == 0x02 && d.tag == 0x31 && e.tag == 0x30 => {}
        _ => return Err(fout("onvolledige SignedData")),
    }
    let eci = kinderen(velden[2].inhoud)?;
    let inhoudstype = oid_uit(eci.first().ok_or_else(|| fout("eContentType ontbreekt"))?)?;
    let inhoud = match eci.get(1) {
        Some(e) if e.tag == 0xA0 => {
            let (os, _) = lees_tlv(e.inhoud)?;
            if os.tag != 0x04 {
                return Err(fout("eContent is geen OCTET STRING"));
            }
            Some(os.inhoud.to_vec())
        }
        Some(_) => return Err(fout("onverwacht element in encapContentInfo")),
        None => None,
    };
    let mut certificaten = Vec::new();
    let mut signer_infos = None;
    for veld in velden.iter().skip(3) {
        match veld.tag {
            0xA0 => {
                for c in kinderen(veld.inhoud)? {
                    if c.tag == 0x30 {
                        certificaten.push(c.geheel.to_vec());
                    }
                }
            }
            0xA1 => {}
            0x31 => signer_infos = Some(veld.inhoud),
            _ => return Err(fout("onverwacht element in SignedData")),
        }
    }
    let signer_infos = signer_infos.ok_or_else(|| fout("signerInfos ontbreekt"))?;
    let mut ondertekenaars = Vec::new();
    for si in kinderen(signer_infos)? {
        ondertekenaars.push(lees_ondertekenaar(&si)?);
    }
    Ok(SignedData { inhoudstype, inhoud, certificaten, ondertekenaars })
}

/// Strikt gelezen certificaat met ruwe delen; `None` als `x509-cert` het weigert
/// of als er bytes achter het certificaat staan.
pub fn lees_certificaat(bytes: &[u8]) -> Option<Certificaat> {
    let x509 = x509_cert::Certificate::from_der(bytes).ok()?;
    let (buiten, rest) = lees_tlv(bytes).ok()?;
    if !rest.is_empty() || buiten.tag != 0x30 {
        return None;
    }
    let k = kinderen(buiten.inhoud).ok()?;
    let (tbs, alg, waarde) = (k.first()?, k.get(1)?, k.get(2)?);
    if waarde.tag != 0x03 {
        return None;
    }
    let (&ongebruikte_bits, handtekening) = waarde.inhoud.split_first()?;
    if ongebruikte_bits != 0 {
        return None;
    }
    let t = kinderen(tbs.inhoud).ok()?;
    let start = usize::from(t.first()?.tag == 0xA0);
    let handtekeningalgoritme = alg_id(alg).ok()?;
    // RFC 5280 §4.1.1.2: het buitenste algoritme moet gelijk zijn aan tbs.signature.
    if alg_id(t.get(start + 1)?).ok()? != handtekeningalgoritme {
        return None;
    }
    Some(Certificaat {
        der: bytes.to_vec(),
        tbs_der: tbs.geheel.to_vec(),
        serienummer: t.get(start)?.inhoud.to_vec(),
        uitgever_der: t.get(start + 2)?.geheel.to_vec(),
        onderwerp_der: t.get(start + 4)?.geheel.to_vec(),
        spki_der: t.get(start + 5)?.geheel.to_vec(),
        handtekeningalgoritme,
        handtekening: handtekening.to_vec(),
        x509,
    })
}

/// De minimale two's-complementcodering van een INTEGER-inhoud: overbodige
/// voorloopbytes (`00` vóór een byte zonder hoogste bit, `FF` vóór een byte
/// met) vallen weg, het teken blijft. `00 83` (+131) en `83` (-125) blijven dus
/// verschillend. `None` bij een lege inhoud.
fn canonieke_integer(b: &[u8]) -> Option<&[u8]> {
    let mut rest = b;
    loop {
        match rest {
            [] => return None,
            [0x00, volgende, ..] if volgende & 0x80 == 0 => {}
            [0xFF, volgende, ..] if volgende & 0x80 != 0 => {}
            _ => return Some(rest),
        }
        rest = rest.split_first().map_or(rest, |(_, r)| r);
    }
}

fn past_bij(c: &Certificaat, sid: &Sid) -> bool {
    match sid {
        Sid::UitgeverEnSerienummer { uitgever_der, serienummer } => {
            c.uitgever_der == *uitgever_der
                && canonieke_integer(&c.serienummer).is_some()
                && canonieke_integer(&c.serienummer) == canonieke_integer(serienummer)
        }
        Sid::SleutelId(id) => c.sleutel_id().as_deref() == Some(id.as_slice()),
    }
}

/// Alle certificaten die bij de SignerIdentifier passen, in volgorde. Meer dan
/// één is mogelijk (zelfde uitgever en serienummer); de aanroeper probeert ze
/// tot er één verifieert.
pub fn zoek_ondertekenaars<'a>(certificaten: &'a [Certificaat], sid: &Sid) -> Vec<&'a Certificaat> {
    certificaten.iter().filter(|c| past_bij(c, sid)).collect()
}

/// Het eerste certificaat dat bij de SignerIdentifier hoort.
#[cfg(test)]
pub fn zoek_ondertekenaar<'a>(certificaten: &'a [Certificaat], sid: &Sid) -> Option<&'a Certificaat> {
    certificaten.iter().find(|c| past_bij(c, sid))
}

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};
    use std::path::PathBuf;

    fn fixture(naam: &str) -> Vec<u8> {
        std::fs::read(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/verifieer").join(naam)).unwrap()
    }

    const SHA256_OID: ObjectIdentifier = ObjectIdentifier::new_unwrap("2.16.840.1.101.3.4.2.1");
    const RSA_OID: ObjectIdentifier = ObjectIdentifier::new_unwrap("1.2.840.113549.1.1.1");

    #[test]
    fn rsa_handtekening_leest_ondertekenaar_en_certificaten() {
        let sd = lees_signed_data(&fixture("cms-rsa-sha256.der")).unwrap();
        assert_eq!(sd.inhoudstype, ID_DATA);
        assert_eq!(sd.inhoud, None);
        assert_eq!(sd.certificaten.len(), 2);
        assert_eq!(sd.ondertekenaars.len(), 1);
        let o = &sd.ondertekenaars[0];
        assert!(matches!(o.sid, Sid::UitgeverEnSerienummer { .. }));
        assert_eq!(o.digestalgoritme.oid, SHA256_OID);
        assert_eq!(o.message_digest().unwrap(), Sha256::digest(fixture("data.bin")).to_vec());
        assert_eq!(o.ondertekende_attributen.len(), 4);
        assert_eq!(o.ondertekende_attributen_der.as_ref().unwrap()[0], 0x31);
        assert_eq!(o.handtekeningalgoritme.oid, RSA_OID);
        assert_eq!(o.handtekeningalgoritme.parameters.as_deref(), Some(&[0x05, 0x00][..]));
        assert_eq!(o.handtekening.len(), 256);
        assert!(o.onondertekende_attributen.is_empty());
        assert_eq!(o.onondertekend(ID_SIGNATURE_TIME_STAMP_TOKEN), None);
    }

    #[test]
    fn ber_geeft_dezelfde_structuur() {
        let sd = lees_signed_data(&fixture("cms-rsa-ber.der")).unwrap();
        assert_eq!(sd.certificaten.len(), 2);
        assert_eq!(sd.ondertekenaars.len(), 1);
        assert_eq!(sd.ondertekenaars[0].message_digest().unwrap(), Sha256::digest(fixture("data.bin")).to_vec());
    }

    #[test]
    fn tijdstempeltoken_heeft_tstinfo_als_inhoud() {
        let sd = lees_signed_data(&fixture("tst-data.der")).unwrap();
        assert_eq!(sd.inhoudstype, ID_TST_INFO);
        assert_eq!(sd.inhoud.as_ref().unwrap()[0], 0x30);
        assert_eq!(sd.certificaten.len(), 2);
        assert_eq!(sd.ondertekenaars.len(), 1);
    }

    #[test]
    fn zonder_certificaten() {
        let sd = lees_signed_data(&fixture("cms-zonder-certificaat.der")).unwrap();
        assert!(sd.certificaten.is_empty());
        assert_eq!(sd.ondertekenaars.len(), 1);
    }

    #[test]
    fn rommel_en_afgekapte_invoer_geven_fout_zonder_paniek() {
        assert!(lees_signed_data(b"").is_err());
        assert!(lees_signed_data(&[0x30, 0x00]).is_err());
        // ContentInfo met id-data in plaats van id-signedData.
        let geen_signed_data = [
            0x30, 0x0D, 0x06, 0x09, 0x2A, 0x86, 0x48, 0x86, 0xF7, 0x0D, 0x01, 0x07, 0x01, 0xA0, 0x00,
        ];
        assert_eq!(lees_signed_data(&geen_signed_data).unwrap_err(), CmsFout("geen SignedData".to_string()));
        let cms = fixture("cms-rsa-sha256.der");
        for n in 0..cms.len() {
            assert!(lees_signed_data(&cms[..n]).is_err(), "afgekapt op {n} hoort te falen");
        }
    }

    #[test]
    fn certificaat_ruwe_delen() {
        let blad = lees_certificaat(&fixture("blad.der")).unwrap();
        let tussen = lees_certificaat(&fixture("tussen.der")).unwrap();
        assert_eq!(blad.uitgever_der, tussen.onderwerp_der);
        assert_ne!(blad.onderwerp_der, blad.uitgever_der);
        assert_eq!(blad.tbs_der[0], 0x30);
        assert_eq!(blad.spki_der[0], 0x30);
        assert_eq!(blad.serienummer, vec![3]);
        assert_eq!(blad.handtekening.len(), 256);
        assert!(blad.sleutel_id().is_some());
        assert!(lees_certificaat(b"rommel").is_none());
        let mut met_rest = fixture("blad.der");
        met_rest.push(0);
        assert!(lees_certificaat(&met_rest).is_none());
    }

    #[test]
    fn ondertekenaar_via_serienummer_of_sleutel_id() {
        let sd = lees_signed_data(&fixture("cms-rsa-sha256.der")).unwrap();
        let certificaten: Vec<Certificaat> = sd.certificaten.iter().filter_map(|c| lees_certificaat(c)).collect();
        let blad = lees_certificaat(&fixture("blad.der")).unwrap();
        assert_eq!(zoek_ondertekenaar(&certificaten, &sd.ondertekenaars[0].sid).unwrap().der, blad.der);
        let met_nullen = Sid::UitgeverEnSerienummer { uitgever_der: blad.uitgever_der.clone(), serienummer: vec![0, 0, 3] };
        assert_eq!(zoek_ondertekenaar(&certificaten, &met_nullen).unwrap().der, blad.der);
        let ander = Sid::UitgeverEnSerienummer { uitgever_der: blad.uitgever_der.clone(), serienummer: vec![9] };
        assert!(zoek_ondertekenaar(&certificaten, &ander).is_none());
        let via_id = Sid::SleutelId(blad.sleutel_id().unwrap());
        assert_eq!(zoek_ondertekenaar(&certificaten, &via_id).unwrap().der, blad.der);
    }

    #[test]
    fn serienummer_vergelijkt_de_canonieke_waarde() {
        let blad = lees_certificaat(&fixture("blad.der")).unwrap();
        let met = |serienummer: Vec<u8>| Certificaat { serienummer, ..blad.clone() };
        let sid = |serienummer: Vec<u8>| Sid::UitgeverEnSerienummer { uitgever_der: blad.uitgever_der.clone(), serienummer };
        // 00 83 is +131, 83 is -125: verschillende getallen.
        let positief = [met(vec![0x00, 0x83])];
        assert!(zoek_ondertekenaar(&positief, &sid(vec![0x83])).is_none());
        assert!(zoek_ondertekenaar(&positief, &sid(vec![0x00, 0x83])).is_some());
        let negatief = [met(vec![0x83])];
        assert!(zoek_ondertekenaar(&negatief, &sid(vec![0x00, 0x83])).is_none());
        assert!(zoek_ondertekenaar(&negatief, &sid(vec![0xFF, 0x83])).is_some());
        // Niet-minimaal gecodeerd, zelfde waarde.
        assert!(zoek_ondertekenaar(&[met(vec![0x00, 0x00, 0x50])], &sid(vec![0x50])).is_some());
        assert!(zoek_ondertekenaar(&[met(vec![0x00])], &sid(vec![])).is_none());
    }

    #[test]
    fn alle_kandidaten_met_zelfde_uitgever_en_serienummer() {
        let blad = lees_certificaat(&fixture("blad.der")).unwrap();
        let tsa = lees_certificaat(&fixture("tsa.der")).unwrap();
        let nep = Certificaat { serienummer: blad.serienummer.clone(), ..tsa };
        let certificaten = [nep.clone(), blad.clone()];
        let sid = Sid::UitgeverEnSerienummer { uitgever_der: blad.uitgever_der.clone(), serienummer: vec![3] };
        let gevonden = zoek_ondertekenaars(&certificaten, &sid);
        assert_eq!(gevonden.len(), 2);
        assert_eq!(gevonden[0].der, nep.der);
        assert_eq!(gevonden[1].der, blad.der);
        assert_eq!(zoek_ondertekenaar(&certificaten, &sid).unwrap().der, nep.der);
    }

    #[test]
    fn message_digest_en_content_type_precies_eenmaal() {
        let sd = lees_signed_data(&fixture("cms-rsa-sha256.der")).unwrap();
        let o = sd.ondertekenaars[0].clone();
        assert_eq!(o.content_type(), Some(ID_DATA));
        let md = o.ondertekende_attributen.iter().find(|a| a.oid == ID_MESSAGE_DIGEST).unwrap().clone();
        let mut dubbel_attribuut = o.clone();
        dubbel_attribuut.ondertekende_attributen.push(md.clone());
        assert_eq!(dubbel_attribuut.message_digest(), None);
        let mut twee_waarden = o.clone();
        for a in twee_waarden.ondertekende_attributen.iter_mut().filter(|a| a.oid == ID_MESSAGE_DIGEST) {
            a.waarden.push(md.waarden[0].clone());
        }
        assert_eq!(twee_waarden.message_digest(), None);
        let mut zonder_type = o.clone();
        zonder_type.ondertekende_attributen.retain(|a| a.oid != ID_CONTENT_TYPE);
        assert_eq!(zonder_type.content_type(), None);
        let mut dubbel_type = o.clone();
        let ct = o.ondertekende_attributen.iter().find(|a| a.oid == ID_CONTENT_TYPE).unwrap().clone();
        dubbel_type.ondertekende_attributen.push(ct);
        assert_eq!(dubbel_type.content_type(), None);
    }

    #[test]
    fn certificaat_met_afwijkend_buitenste_algoritme_wordt_overgeslagen() {
        let mut der = fixture("blad.der");
        // sha256WithRSAEncryption komt twee keer voor: eerst in tbs.signature.
        let oid = [0x06, 0x09, 0x2A, 0x86, 0x48, 0x86, 0xF7, 0x0D, 0x01, 0x01, 0x0B];
        let p = der.windows(oid.len()).position(|w| w == oid).unwrap();
        der[p + 10] = 0x0C;
        assert!(x509_cert::Certificate::from_der(&der).is_ok());
        assert!(lees_certificaat(&der).is_none());
    }

    #[test]
    fn attributen_buiten_der_volgorde_blijven_in_oorspronkelijke_volgorde() {
        let cms = fixture("cms-attribuutvolgorde.der");
        let sd = lees_signed_data(&cms).unwrap();
        let o = &sd.ondertekenaars[0];
        let der = o.ondertekende_attributen_der.as_ref().unwrap();
        let (set, _) = lees_tlv(der).unwrap();
        let volgorde: Vec<&[u8]> = kinderen(set.inhoud).unwrap().iter().map(|t| t.geheel).collect();
        let mut gesorteerd = volgorde.clone();
        gesorteerd.sort();
        assert_ne!(volgorde, gesorteerd, "fixture hoort niet in DER-volgorde te staan");
        // De bytes staan zo ook in het bestand (met tag [0]).
        let mut als_a0 = der.clone();
        als_a0[0] = 0xA0;
        assert!(cms.windows(als_a0.len()).any(|w| w == als_a0.as_slice()));
        assert_eq!(o.content_type(), Some(ID_DATA));
        assert_eq!(o.message_digest().unwrap(), Sha256::digest(fixture("data.bin")).to_vec());
    }

    #[test]
    fn ondertekenaar_via_sleutel_id_uit_fixture() {
        let sd = lees_signed_data(&fixture("cms-sleutel-id.der")).unwrap();
        let o = &sd.ondertekenaars[0];
        let Sid::SleutelId(id) = &o.sid else { panic!("SubjectKeyIdentifier verwacht") };
        let certificaten: Vec<Certificaat> = sd.certificaten.iter().filter_map(|c| lees_certificaat(c)).collect();
        let gevonden = zoek_ondertekenaar(&certificaten, &o.sid).unwrap();
        assert_eq!(gevonden.sleutel_id().as_ref(), Some(id));
    }
}
