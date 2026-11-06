//! Rondgang ondertekenen → verifiëren (spec §9.3), met de eigen RSA-fixtures
//! (`tests/fixtures/pkcs12`, wachtwoord `proef123`). Waar OpenSSL of Poppler
//! (`pdfsig`) op de machine staan, controleren die als onafhankelijke tweede
//! lezer dezelfde bestanden; zonder die programma's slaan die delen over met
//! een melding.

use std::path::{Path, PathBuf};
use std::process::Command;

use super::onderteken::*;
use super::pdf_schrijven::tests::minimale_pdf;
use super::pdf_schrijven::{schrijf_toevoeging, NieuwObject, Trailergegevens, XrefVorm};
use super::pkcs12::{lees, ondertekenaar_index};
use super::status::{Integriteit, Status};
use super::verifieer::{verifieer_document, HandtekeningInfo};
use super::vertrouwen::Vertrouwensarchief;
use super::wijzigingen::LatereWijziging;

const WACHTWOORD: &str = "proef123";

fn p12(naam: &str) -> Vec<u8> {
    std::fs::read(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/pkcs12").join(naam)).unwrap()
}

fn testcertificaat() -> Vec<u8> {
    let inhoud = lees(&p12("openssl3-aes256.p12"), WACHTWOORD).unwrap();
    inhoud.certificaten[ondertekenaar_index(&inhoud).unwrap()].der.clone()
}

/// Het CA-certificaat uit `met-keten.p12` (het certificaat dat niet bij de sleutel hoort).
fn test_ca() -> Vec<u8> {
    let inhoud = lees(&p12("met-keten.p12"), WACHTWOORD).unwrap();
    let blad = ondertekenaar_index(&inhoud).unwrap();
    inhoud.certificaten.iter().enumerate().find(|(i, _)| *i != blad).unwrap().1.der.clone()
}

fn onderteken_proef(bron: &[u8], opties: &Ondertekenopties) -> Vec<u8> {
    onderteken(bron, &p12("openssl3-aes256.p12"), WACHTWOORD, opties, None).unwrap()
}

fn verifieer(bytes: &[u8]) -> Vec<HandtekeningInfo> {
    verifieer_document(bytes, &Vertrouwensarchief::leeg(), 1_800_000_000).unwrap()
}

/// Een pagina met een eigen annotatie, zoals de app hem opslaat.
fn pdf_met_annotatie() -> Vec<u8> {
    pdf_uit(&[
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Annots [5 0 R] >>",
        "<< /Length 44 >>\nstream\nBT /F1 24 Tf 72 720 Td (Hallo wereld) Tj ET\n\nendstream",
        "<< /Type /Annot /Subtype /Square /Rect [100 100 200 200] /C [1 0 0] /Contents (eigen annotatie) >>",
    ])
}

/// Een PDF met de objecten 1..n en een klassieke xref-tabel.
fn pdf_uit(objecten: &[&str]) -> Vec<u8> {
    let mut uit = b"%PDF-1.7\n".to_vec();
    let mut offsets = Vec::new();
    for (i, o) in objecten.iter().enumerate() {
        offsets.push(uit.len());
        uit.extend_from_slice(format!("{} 0 obj\n{o}\nendobj\n", i + 1).as_bytes());
    }
    let xref = uit.len();
    uit.extend_from_slice(format!("xref\n0 {}\n0000000000 65535 f\r\n", objecten.len() + 1).as_bytes());
    for o in offsets {
        uit.extend_from_slice(format!("{o:010} 00000 n\r\n").as_bytes());
    }
    uit.extend_from_slice(
        format!("trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n", objecten.len() + 1).as_bytes(),
    );
    uit
}

/// Het `/ByteRange` van de laatste handtekening, uit de bytes zelf gelezen.
fn laatste_bytebereik(bytes: &[u8]) -> [usize; 4] {
    let p = bytes.windows(12).rposition(|w| w == b"/ByteRange [").unwrap() + 12;
    let einde = p + bytes[p..].iter().position(|&b| b == b']').unwrap();
    let getallen: Vec<usize> =
        std::str::from_utf8(&bytes[p..einde]).unwrap().split_whitespace().map(|g| g.parse().unwrap()).collect();
    [getallen[0], getallen[1], getallen[2], getallen[3]]
}

fn png(b: u32, h: u32) -> String {
    use base64::Engine;
    let mut beeld = image::RgbaImage::new(b, h);
    for (x, y, p) in beeld.enumerate_pixels_mut() {
        *p = image::Rgba([0, 0, 160, if (x + y) % 3 == 0 { 255 } else { 0 }]);
    }
    let mut uit = std::io::Cursor::new(Vec::new());
    beeld.write_to(&mut uit, image::ImageFormat::Png).unwrap();
    base64::engine::general_purpose::STANDARD.encode(uit.into_inner())
}

#[test]
fn onzichtbaar_ondertekend_is_intact_over_het_hele_document() {
    let bron = pdf_met_annotatie();
    let uit = onderteken_proef(
        &bron,
        &Ondertekenopties { reden: Some("Goedgekeurd voor uitvoering".into()), plaats: Some("Delft".into()), ..Default::default() },
    );
    // Incrementeel: de bronbytes staan ongewijzigd vooraan.
    assert!(uit.starts_with(&bron));
    let lijst = verifieer(&uit);
    assert_eq!(lijst.len(), 1);
    let h = &lijst[0];
    assert_eq!(h.integriteit, Some(Integriteit::Intact));
    assert!(h.dekt_hele_document);
    assert!(!h.daarna_gewijzigd);
    assert_eq!(h.subfilter.as_deref(), Some("ETSI.CAdES.detached"));
    assert_eq!(h.ondertekenaar.as_deref(), Some("OPDS Test Ondertekenaar"));
    assert_eq!(h.reden.as_deref(), Some("Goedgekeurd voor uitvoering"));
    assert_eq!(h.plaats.as_deref(), Some("Delft"));
    assert!(h.woordenboek_ondertekend);
    // Zonder rootarchief: geldig maar niet vertrouwd.
    assert!(matches!(h.status, Status::OnbekendCertificaat { .. }));
    // Dit testcertificaat heeft serverAuth: ook als wortel geen documentondertekenaar.
    let cert = testcertificaat();
    let archief = Vertrouwensarchief::uit_der([cert.as_slice()]);
    let vertrouwd = verifieer_document(&uit, &archief, 1_800_000_000).unwrap();
    assert!(matches!(vertrouwd[0].status, Status::OnbekendCertificaat { .. }));
    // De eigen annotatie is er nog, en de pagina heeft er een widget bij.
    let doc = lopdf::Document::load_mem(&uit).unwrap();
    let pagina = doc.get_dictionary(*doc.get_pages().get(&1).unwrap()).unwrap();
    let annots = pagina.get(b"Annots").unwrap().as_array().unwrap();
    assert_eq!(annots.len(), 2);
    assert_eq!(annots[0].as_reference().unwrap(), (5, 0));
    let acroform = doc.catalog().unwrap().get(b"AcroForm").unwrap().as_dict().unwrap();
    assert_eq!(acroform.get(b"SigFlags").unwrap().as_i64().unwrap(), 3);
}

#[test]
fn met_keten_en_vertrouwde_ca_is_geldig() {
    let uit = onderteken(&pdf_met_annotatie(), &p12("met-keten.p12"), WACHTWOORD, &Ondertekenopties::default(), None).unwrap();
    let h = &verifieer(&uit)[0];
    assert_eq!(h.integriteit, Some(Integriteit::Intact));
    // Zonder de CA in het archief: niet vertrouwd ("signature valid, certificate not trusted").
    assert!(matches!(h.status, Status::OnbekendCertificaat { reden: crate::status::WantrouwenReden::GeenKeten }));
    // De volledige keten uit het .p12 zit in de CMS: met alleen de CA als wortel geldig.
    let ca = test_ca();
    let archief = Vertrouwensarchief::uit_der([ca.as_slice()]);
    let h = &verifieer_document(&uit, &archief, 1_800_000_000).unwrap()[0];
    assert_eq!(h.status, Status::Geldig, "{h:?}");
    assert_eq!(h.keten.len(), 2);
    assert_eq!(h.ondertekenaar.as_deref(), Some("OPDS Test Documentondertekenaar"));
}

#[test]
fn bytebereik_sluit_precies_het_gat_uit() {
    let uit = onderteken_proef(&minimale_pdf(), &Ondertekenopties::default());
    let [s1, l1, s2, l2] = laatste_bytebereik(&uit);
    assert_eq!(s1, 0);
    assert_eq!(s2 + l2, uit.len(), "het tweede stuk reikt tot het einde van het bestand");
    assert_eq!(uit[l1], b'<');
    assert_eq!(uit[s2 - 1], b'>');
    assert!(uit[l1 + 1..s2 - 1].iter().all(u8::is_ascii_hexdigit));
    // De plaatshouder is in-place gepatcht: precies even lang, aangevuld met spaties.
    let p = uit.windows(12).rposition(|w| w == b"/ByteRange [").unwrap();
    let tekst = std::str::from_utf8(&uit[p..p + "/ByteRange [0 0000000000 0000000000 0000000000]".len()]).unwrap();
    assert!(tekst.ends_with(']') || tekst.ends_with(' '), "{tekst}");
    // De CMS staat in het gat, de rest is nullen.
    let hex = &uit[l1 + 1..s2 - 1];
    assert!(hex.starts_with(b"30"));
    assert!(hex.ends_with(b"0000"));
}

#[test]
fn een_byte_in_het_ondertekende_bereik_wijzigen_geeft_gewijzigd() {
    let uit = onderteken_proef(&pdf_met_annotatie(), &Ondertekenopties::default());
    // "Hallo wereld" → "Hallo Wereld": zelfde lengte, andere inhoud.
    let mut vervalst = uit.clone();
    let p = vervalst.windows(12).position(|w| w == b"Hallo wereld").unwrap();
    vervalst[p + 6] = b'W';
    let h = &verifieer(&vervalst)[0];
    assert_eq!(h.integriteit, Some(Integriteit::Gewijzigd));
    assert_eq!(h.status, Status::GewijzigdNaOndertekenen);
}

/// Een incrementele toevoeging na het ondertekenen, met `objecten` als nieuwe versies.
fn voeg_toe(bytes: &[u8], objecten: &[((u32, u16), String)]) -> Vec<u8> {
    let doc = lopdf::Document::load_mem(bytes).unwrap();
    let trailer = Trailergegevens {
        vorm: XrefVorm::Tabel,
        vorige_xref: doc.xref_start,
        grootte: doc.max_id + 1,
        root: doc.trailer.get(b"Root").unwrap().as_reference().unwrap(),
        info: None,
        id: None,
    };
    let nieuw: Vec<NieuwObject> =
        objecten.iter().map(|(id, t)| NieuwObject { id: *id, inhoud: t.clone().into_bytes() }).collect();
    schrijf_toevoeging(bytes, &trailer, &nieuw).0
}

#[test]
fn later_een_annotatie_erbij_of_de_inhoud_vervangen() {
    let uit = onderteken_proef(&pdf_met_annotatie(), &Ondertekenopties::default());
    let doc = lopdf::Document::load_mem(&uit).unwrap();
    let vrij = doc.max_id + 1;
    let pagina_id = *doc.get_pages().get(&1).unwrap();
    let pagina = doc.get_dictionary(pagina_id).unwrap();
    let mut annots = String::new();
    for a in pagina.get(b"Annots").unwrap().as_array().unwrap() {
        let (n, g) = a.as_reference().unwrap();
        annots.push_str(&format!("{n} {g} R "));
    }
    // Annotatie erbij: toegestaan, de handtekening blijft intact.
    let met_annotatie = voeg_toe(
        &uit,
        &[
            (pagina_id, format!("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Annots [{annots}{vrij} 0 R] >>")),
            ((vrij, 0), "<< /Type /Annot /Subtype /Text /Rect [10 10 30 30] /Contents (later) >>".to_string()),
        ],
    );
    let h = &verifieer(&met_annotatie)[0];
    assert_eq!(h.integriteit, Some(Integriteit::Intact));
    assert!(h.daarna_gewijzigd);
    assert_eq!(h.latere_wijziging, Some(LatereWijziging::Toevoegingen));
    // Paginainhoud vervangen: ook intact (de ondertekende bytes staan er nog),
    // maar de latere wijziging raakt de inhoud.
    let vervangen = voeg_toe(&uit, &[((4, 0), "<< /Length 0 >>\nstream\n\nendstream".to_string())]);
    let h = &verifieer(&vervangen)[0];
    assert_eq!(h.integriteit, Some(Integriteit::Intact));
    assert!(h.daarna_gewijzigd);
    assert_eq!(h.latere_wijziging, Some(LatereWijziging::Inhoud));
}

#[test]
fn twee_keer_ondertekenen() {
    let eerste = onderteken_proef(&pdf_met_annotatie(), &Ondertekenopties::default());
    let tweede = onderteken_proef(&eerste, &Ondertekenopties { reden: Some("Tweede goedkeuring".into()), ..Default::default() });
    let lijst = verifieer(&tweede);
    assert_eq!(lijst.len(), 2);
    assert_eq!(lijst[0].integriteit, Some(Integriteit::Intact));
    assert!(!lijst[0].dekt_hele_document);
    assert_eq!(lijst[0].latere_wijziging, Some(LatereWijziging::Toevoegingen));
    assert_eq!(lijst[1].integriteit, Some(Integriteit::Intact));
    assert!(lijst[1].dekt_hele_document);
    assert_ne!(lijst[0].veldnaam, lijst[1].veldnaam);
}

#[test]
fn zichtbaar_met_afbeelding_op_een_gedraaide_pagina() {
    // /Rotate geërfd van de paginaboom.
    let bron = pdf_uit(&[
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 /Rotate 90 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>",
    ]);
    let opties = Ondertekenopties {
        zichtbaar: Some(ZichtbaarVeld { pagina: 1, rechthoek: [400.0, 50.0, 460.0, 250.0], weergave_base64: Some(png(200, 60)) }),
        subfilter: Subfilter::Pkcs7Detached,
        ..Default::default()
    };
    let uit = onderteken_proef(&bron, &opties);
    let h = &verifieer(&uit)[0];
    assert_eq!(h.integriteit, Some(Integriteit::Intact));
    assert_eq!(h.subfilter.as_deref(), Some("adbe.pkcs7.detached"));
    let doc = lopdf::Document::load_mem(&uit).unwrap();
    let pagina = doc.get_dictionary(*doc.get_pages().get(&1).unwrap()).unwrap();
    let widget_id = pagina.get(b"Annots").unwrap().as_array().unwrap()[0].as_reference().unwrap();
    let widget = doc.get_dictionary(widget_id).unwrap();
    let ap = widget.get(b"AP").unwrap().as_dict().unwrap().get(b"N").unwrap().as_reference().unwrap();
    let ap = doc.get_object(ap).unwrap().as_stream().unwrap();
    // Leesrichting 200 x 60 op een pagina met /Rotate 90.
    let bbox: Vec<f32> = ap.dict.get(b"BBox").unwrap().as_array().unwrap().iter().map(|o| o.as_float().unwrap()).collect();
    assert_eq!(bbox, vec![0.0, 0.0, 200.0, 60.0]);
    assert!(ap.dict.get(b"Matrix").is_ok());
    let img = ap.dict.get(b"Resources").unwrap().as_dict().unwrap().get(b"XObject").unwrap().as_dict().unwrap();
    let img = doc.get_object(img.get(b"Img").unwrap().as_reference().unwrap()).unwrap().as_stream().unwrap();
    assert!(img.dict.get(b"SMask").is_ok(), "doorzichtige PNG krijgt een masker");
}

#[test]
fn xref_stroom_bron_krijgt_een_xref_stroom() {
    let mut doc = lopdf::Document::load_mem(&pdf_met_annotatie()).unwrap();
    doc.reference_table.cross_reference_type = lopdf::xref::XrefType::CrossReferenceStream;
    let mut bron = Vec::new();
    doc.save_to(&mut bron).unwrap();
    assert!(bron.windows(10).any(|w| w == b"/Type/XRef") || bron.windows(11).any(|w| w == b"/Type /XRef"));
    let uit = onderteken_proef(&bron, &Ondertekenopties::default());
    let staart = &uit[bron.len()..];
    assert!(staart.windows(11).any(|w| w == b"/Type /XRef"), "toevoeging met xref-stroom");
    assert!(!staart.windows(6).any(|w| w == b"\nxref\n"));
    let h = &verifieer(&uit)[0];
    assert_eq!(h.integriteit, Some(Integriteit::Intact));
    assert!(h.dekt_hele_document);
}

#[test]
fn verkeerd_wachtwoord_en_ongeschikte_bestanden_worden_geweigerd() {
    let bron = minimale_pdf();
    let fout = |p: &str, w: &str| onderteken(&bron, &p12(p), w, &Ondertekenopties::default(), None).unwrap_err();
    assert_eq!(fout("openssl3-aes256.p12", "fout"), OndertekenFout::VerkeerdWachtwoord);
    assert_eq!(fout("windows-export-3des.p12", ""), OndertekenFout::VerkeerdWachtwoord);
    assert_eq!(fout("alleen-certificaat.p12", WACHTWOORD), OndertekenFout::GeenPriveSleutel);
    assert_eq!(fout("sleutel-zonder-certificaat.p12", WACHTWOORD), OndertekenFout::GeenCertificaat);
    // Andere exportformaten van dezelfde sleutel ondertekenen wel.
    for naam in ["windows-export-3des.p12", "certutil-3des.p12", "zonder-mac-3des.p12"] {
        assert!(onderteken(&bron, &p12(naam), WACHTWOORD, &Ondertekenopties::default(), None).is_ok(), "{naam}");
    }
    assert!(onderteken(&bron, &p12("zonder-wachtwoord.p12"), "", &Ondertekenopties::default(), None).is_ok());
    // Geen PDF, versleutelde PDF, onbekende pagina.
    assert!(matches!(
        onderteken(b"rommel", &p12("openssl3-aes256.p12"), WACHTWOORD, &Ondertekenopties::default(), None),
        Err(OndertekenFout::PdfOnleesbaar { .. })
    ));
    let opties = Ondertekenopties {
        zichtbaar: Some(ZichtbaarVeld { pagina: 7, rechthoek: [0.0, 0.0, 10.0, 10.0], weergave_base64: None }),
        ..Default::default()
    };
    assert_eq!(
        onderteken(&bron, &p12("openssl3-aes256.p12"), WACHTWOORD, &opties, None).unwrap_err(),
        OndertekenFout::PaginaBestaatNiet
    );
}

#[test]
fn bestand_ondertekenen_weigert_hetzelfde_pad_en_laat_niets_half_achter() {
    let map = std::env::temp_dir().join(format!("opds-onderteken-{}", std::process::id()));
    std::fs::create_dir_all(&map).unwrap();
    let bron = map.join("bron.pdf");
    std::fs::write(&bron, pdf_met_annotatie()).unwrap();
    let p12_pad = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/pkcs12/openssl3-aes256.p12");
    let opties = Ondertekenopties::default();
    assert_eq!(onderteken_bestand(&bron, &bron, &p12_pad, WACHTWOORD, &opties, None), Err(OndertekenFout::ZelfdeBestand));
    let doel = map.join("doel.pdf");
    assert_eq!(onderteken_bestand(&bron, &doel, &p12_pad, "fout", &opties, None), Err(OndertekenFout::VerkeerdWachtwoord));
    assert!(!doel.exists());
    onderteken_bestand(&bron, &doel, &p12_pad, WACHTWOORD, &opties, None).unwrap();
    assert_eq!(verifieer(&std::fs::read(&doel).unwrap())[0].integriteit, Some(Integriteit::Intact));
    // Een mislukte tijdstempel: geen bestand, wel de oorzaak.
    let doel2 = map.join("doel2.pdf");
    let mut mislukt = |_: &[u8]| -> Result<Vec<u8>, String> { Err("dienst onbereikbaar".into()) };
    assert_eq!(
        onderteken_bestand(&bron, &doel2, &p12_pad, WACHTWOORD, &opties, Some(&mut mislukt)),
        Err(OndertekenFout::Tijdstempel { detail: "dienst onbereikbaar".into() })
    );
    assert!(!doel2.exists());
    assert_eq!(std::fs::read_dir(&map).unwrap().count(), 2, "geen tijdelijke bestanden achtergebleven");
    std::fs::remove_dir_all(&map).unwrap();
}

// ---- Onafhankelijke lezers: OpenSSL en Poppler (pdfsig), indien aanwezig ----

fn programma(naam: &str) -> bool {
    Command::new(naam).arg("-v").output().is_ok() || Command::new(naam).arg("version").output().is_ok()
}

fn proefmap(naam: &str) -> PathBuf {
    let map = std::env::temp_dir().join(format!("opds-{naam}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&map);
    std::fs::create_dir_all(&map).unwrap();
    map
}

fn pem(der: &[u8]) -> String {
    use base64::Engine;
    let b64 = base64::engine::general_purpose::STANDARD.encode(der);
    let regels: Vec<&str> = b64.as_bytes().chunks(64).map(|c| std::str::from_utf8(c).unwrap()).collect();
    format!("-----BEGIN CERTIFICATE-----\n{}\n-----END CERTIFICATE-----\n", regels.join("\n"))
}

/// Haalt CMS en ondertekende bytes uit `pdf` en laat `openssl cms -verify` ze controleren.
fn openssl_controle(map: &Path, pdf: &[u8]) -> std::process::Output {
    let [_, l1, s2, l2] = laatste_bytebereik(pdf);
    let hex = std::str::from_utf8(&pdf[l1 + 1..s2 - 1]).unwrap();
    let mut cms: Vec<u8> = (0..hex.len()).step_by(2).map(|i| u8::from_str_radix(&hex[i..i + 2], 16).unwrap()).collect();
    // Vulnullen achter de DER weghalen.
    let (_, rest) = super::ber::lees_tlv(&cms).unwrap();
    let lengte = cms.len() - rest.len();
    cms.truncate(lengte);
    let mut gegevens = pdf[..l1].to_vec();
    gegevens.extend_from_slice(&pdf[s2..s2 + l2]);
    std::fs::write(map.join("handtekening.der"), &cms).unwrap();
    std::fs::write(map.join("gegevens.bin"), &gegevens).unwrap();
    std::fs::write(map.join("wortel.pem"), pem(&testcertificaat())).unwrap();
    Command::new("openssl")
        .args(["cms", "-verify", "-binary", "-inform", "DER", "-purpose", "any"])
        .arg("-in")
        .arg(map.join("handtekening.der"))
        .arg("-content")
        .arg(map.join("gegevens.bin"))
        .arg("-CAfile")
        .arg(map.join("wortel.pem"))
        .arg("-out")
        .arg(map.join("uit.bin"))
        .output()
        .unwrap()
}

#[test]
fn openssl_verifieert_de_cms_over_het_bytebereik() {
    if !programma("openssl") {
        eprintln!("openssl ontbreekt; onafhankelijke CMS-controle overgeslagen");
        return;
    }
    let map = proefmap("openssl-cms");
    for subfilter in [Subfilter::CadesDetached, Subfilter::Pkcs7Detached] {
        let uit = onderteken_proef(&pdf_met_annotatie(), &Ondertekenopties { subfilter, ..Default::default() });
        let o = openssl_controle(&map, &uit);
        assert!(o.status.success(), "{subfilter:?}: {}", String::from_utf8_lossy(&o.stderr));
        // De structuur: signingCertificateV2 altijd, signingTime alleen bij PKCS#7.
        let tekst = Command::new("openssl")
            .args(["cms", "-cmsout", "-print", "-inform", "DER", "-in"])
            .arg(map.join("handtekening.der"))
            .output()
            .unwrap();
        let tekst = String::from_utf8_lossy(&tekst.stdout).into_owned();
        assert!(tekst.contains("id-smime-aa-signingCertificateV2"), "{tekst}");
        assert!(tekst.contains("messageDigest"));
        assert!(tekst.contains("contentType"));
        assert_eq!(tekst.contains("signingTime"), subfilter == Subfilter::Pkcs7Detached, "{subfilter:?}");
        // Gewijzigde gegevens: OpenSSL weigert ook.
        let mut vervalst = uit.clone();
        let p = vervalst.windows(12).position(|w| w == b"Hallo wereld").unwrap();
        vervalst[p] = b'J';
        assert!(!openssl_controle(&map, &vervalst).status.success());
    }
    std::fs::remove_dir_all(&map).unwrap();
}

/// `pdfsig` (Poppler, de PDF-bibliotheek van onder meer Evince en Okular).
fn pdfsig(pad: &Path) -> Option<String> {
    let o = Command::new("pdfsig").arg(pad).output().ok()?;
    Some(format!("{}{}", String::from_utf8_lossy(&o.stdout), String::from_utf8_lossy(&o.stderr)))
}

#[test]
fn poppler_pdfsig_vindt_de_handtekening_geldig() {
    if !programma("pdfsig") {
        eprintln!("pdfsig ontbreekt; controle met Poppler overgeslagen");
        return;
    }
    let map = proefmap("pdfsig");
    let opties = Ondertekenopties {
        reden: Some("Goedgekeurd".into()),
        zichtbaar: Some(ZichtbaarVeld { pagina: 1, rechthoek: [300.0, 50.0, 500.0, 110.0], weergave_base64: Some(png(200, 60)) }),
        ..Default::default()
    };
    let uit = onderteken_proef(&pdf_met_annotatie(), &opties);
    let pad = map.join("ondertekend.pdf");
    std::fs::write(&pad, &uit).unwrap();
    let tekst = pdfsig(&pad).unwrap();
    assert!(tekst.contains("Signature is Valid"), "{tekst}");
    assert!(tekst.contains("Total document signed"), "{tekst}");
    assert!(tekst.contains("ETSI.CAdES.detached"), "{tekst}");
    // Daarna een annotatie erbij: nog steeds geldig, maar niet meer het hele document.
    let doc = lopdf::Document::load_mem(&uit).unwrap();
    let vrij = doc.max_id + 1;
    let erbij = voeg_toe(&uit, &[((vrij, 0), "<< /Type /Annot /Subtype /Text /Rect [1 1 2 2] >>".to_string())]);
    std::fs::write(&pad, &erbij).unwrap();
    let tekst = pdfsig(&pad).unwrap();
    assert!(tekst.contains("Signature is Valid"), "{tekst}");
    assert!(!tekst.contains("Total document signed"), "{tekst}");
    // Een byte in het ondertekende bereik gewijzigd: ongeldig.
    let mut vervalst = uit.clone();
    let p = vervalst.windows(12).position(|w| w == b"Hallo wereld").unwrap();
    vervalst[p] = b'J';
    std::fs::write(&pad, &vervalst).unwrap();
    let tekst = pdfsig(&pad).unwrap();
    assert!(!tekst.contains("Signature is Valid"), "{tekst}");
    std::fs::remove_dir_all(&map).unwrap();
}

/// Een tijdstempeldienst van OpenSSL (`openssl ts -reply`) met een eigen
/// wegwerpcertificaat: de hele weg verzoek → antwoord → token in de CMS.
#[test]
fn tijdstempel_van_een_rfc3161_dienst() {
    if !programma("openssl") {
        eprintln!("openssl ontbreekt; tijdstempeltest overgeslagen");
        return;
    }
    let map = proefmap("tsa");
    let ok = Command::new("openssl")
        .args(["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "2", "-subj", "/CN=OPDS Proef-TSA"])
        .args(["-addext", "extendedKeyUsage=critical,timeStamping", "-addext", "keyUsage=critical,digitalSignature"])
        .arg("-keyout")
        .arg(map.join("tsa.key"))
        .arg("-out")
        .arg(map.join("tsa.crt"))
        .output()
        .unwrap();
    assert!(ok.status.success(), "{}", String::from_utf8_lossy(&ok.stderr));
    std::fs::write(map.join("serial"), "01\n").unwrap();
    std::fs::write(
        map.join("tsa.cnf"),
        format!(
            "[ tsa ]\ndefault_tsa = proef\n[ proef ]\nserial = {}\ndefault_policy = 1.2.3.4.1\ndigests = sha256\n\
             ess_cert_id_alg = sha256\nsigner_digest = sha256\naccuracy = secs:1\ncert_chain = {}\n",
            map.join("serial").display(),
            map.join("tsa.crt").display()
        ),
    )
    .unwrap();
    let mut aanroepen = 0;
    let mut dienst = |waarde: &[u8]| -> Result<Vec<u8>, String> {
        aanroepen += 1;
        let (verzoek, nonce) = super::tsa::verzoek(waarde)?;
        std::fs::write(map.join("req.tsq"), &verzoek).unwrap();
        let o = Command::new("openssl")
            .args(["ts", "-reply", "-config"])
            .arg(map.join("tsa.cnf"))
            .arg("-queryfile")
            .arg(map.join("req.tsq"))
            .arg("-signer")
            .arg(map.join("tsa.crt"))
            .arg("-inkey")
            .arg(map.join("tsa.key"))
            .arg("-out")
            .arg(map.join("resp.tsr"))
            .output()
            .unwrap();
        if !o.status.success() {
            return Err(String::from_utf8_lossy(&o.stderr).into_owned());
        }
        super::tsa::token_uit_antwoord(&std::fs::read(map.join("resp.tsr")).unwrap(), waarde, &nonce)
    };
    let uit = onderteken(&pdf_met_annotatie(), &p12("openssl3-aes256.p12"), WACHTWOORD, &Ondertekenopties::default(), Some(&mut dienst))
        .unwrap();
    assert_eq!(aanroepen, 1);
    let h = &verifieer_document(&uit, &Vertrouwensarchief::leeg(), chrono_nu()).unwrap()[0];
    assert_eq!(h.integriteit, Some(Integriteit::Intact));
    let ts = h.tijdstempel.as_ref().expect("tijdstempel in de handtekening");
    assert_eq!(ts.integriteit, Integriteit::Intact);
    assert!(ts.tijd_unix.is_some_and(|t| (t - chrono_nu()).abs() < 600));
    assert_eq!(ts.tsa.as_deref(), Some("OPDS Proef-TSA"));
    // OpenSSL zelf vindt de handtekening ook nog in orde.
    assert!(openssl_controle(&map, &uit).status.success());
    std::fs::remove_dir_all(&map).unwrap();
}

fn chrono_nu() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs() as i64
}

/// Schrijft de ondertekende proefbestanden voor de node-test met mupdf
/// (`open-pdf-studio/js/pdf/handtekeningen/fixtures/`). Alleen met de hand:
/// `cargo test -p open-pdf-signatures -- --ignored schrijf_node_fixtures`.
#[test]
#[ignore]
fn schrijf_node_fixtures() {
    let map = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../open-pdf-studio/js/pdf/handtekeningen/fixtures");
    std::fs::create_dir_all(&map).unwrap();
    let bron = pdf_met_annotatie();
    let opties = Ondertekenopties {
        reden: Some("Proef".into()),
        plaats: Some("Delft".into()),
        tijdstip: Some("D:20261027120000+01'00'".into()),
        zichtbaar: Some(ZichtbaarVeld { pagina: 1, rechthoek: [300.0, 50.0, 500.0, 110.0], weergave_base64: Some(png(200, 60)) }),
        ..Default::default()
    };
    let uit = onderteken_proef(&bron, &opties);
    std::fs::write(map.join("bron.pdf"), &bron).unwrap();
    std::fs::write(map.join("ondertekend.pdf"), &uit).unwrap();
}
