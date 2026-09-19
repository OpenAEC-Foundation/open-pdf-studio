# Digitale handtekeningen, deel 2: verifiëren en statusbalk — implementatieplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bestaande handtekeningen in een geopende PDF verifiëren in Rust (integriteit, dekking, vertrouwen) en de uitkomst tonen in een balk boven de pagina, met detailvenster, "Toon ondertekende versie" en een waarschuwing bij gewoon opslaan van een ondertekend document.

**Architecture:** Nieuwe Rust-modules in `src-tauri/src/handtekening/`: `status.rs` (pure statusafleiding), `bytebereik.rs` (leesdeel), `ber.rs` (BER→DER en TLV-lezer), `cms_lees.rs` (verdraagzaam SignedData lezen), `algoritme.rs` (hashes, RSA PKCS#1 v1.5, RSASSA-PSS, ECDSA P-256/P-384), `pdf_lezen.rs` (handtekeningvelden via `lopdf`, met herstel bij kapotte xref), `verifieer.rs` (integriteit per soort, document, Tauri-commando's), `tijdstempel.rs` (RFC 3161-tokens) en `vertrouwen.rs` (rootarchief van het besturingssysteem, keten, geldigheid, sleutelgebruik). JS roept `pdf_signature_list` aan na het openen van een document met handtekeningvelden; een SolidJS-balk en -dialoog tonen het resultaat. Dit is deel 2 van 3 uit de spec; ondertekenen volgt in deel 3.

**Tech Stack:** Rust (RustCrypto op de `der 0.7`-lijn: `x509-cert 0.2`, `rsa 0.9`, `sha1`/`sha2 0.10` met `oid`, `p256`/`p384 0.13`), `lopdf 0.34`, `rustls-native-certs 0.8` (buiten Windows) en `schannel 0.1` (Windows), Tauri 2, SolidJS, i18next, `node:test`, Python 3 (`pypdfium2`, `cryptography`) voor het orakel, OpenSSL 3 voor fixtures.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-16-digitale-handtekeningen-design.md` (§3.2, §4, §7, §8, §9.1, §9.2, §12).
- Werk in een eigen worktree op branch `feat/handtekeningen`; nooit in de hoofd-checkout. `$RIGMAP` is een eigen, tijdelijke map voor de testinstantie van de app.
- Alle RustCrypto-crates op de `der 0.7`-lijn. Niet mengen met `der 0.8`, `x509-cert 0.3`, `pkcs8 0.11`, `sha2 0.11`, `const-oid 0.10`, `p256`/`p384 0.14` of `ecdsa 0.17`: dat levert onverenigbare typen op.
- Geen paniek op invoer uit een bestand: geen `unwrap`/`expect`/indexering die kan falen op bestandsbytes in productiecode. `lopdf` wordt binnen `catch_unwind` aangeroepen. Tests mogen `unwrap` gebruiken.
- Een fout in één handtekening blijft bij die handtekening (spec §8); een onleesbare PDF geeft een nette fout, nooit een crash.
- Geen namen van commerciële derde partijen (software, producten) in code, comments, docs, testnamen of commits. Geen lokale of persoonsgebonden paden en geen chatgeschiedenis in de repo.
- Commit-berichten zonder AI-attributie; niet pushen.
- Build en tests altijd met `CARGO_TARGET_DIR="$BUILDMAP"`: een eigen build-map buiten gesynchroniseerde mappen.
- Vóór elke commit: `cd open-pdf-studio/src-tauri && CARGO_TARGET_DIR="$BUILDMAP" cargo test --lib handtekening` groen, en vanuit `open-pdf-studio/`: `npm run test:unit` en `npx vite build` groen (`npx vite build` is de enige echte syntaxcontrole voor `js/`; build-uitvoer nooit door `tail` halen om succes te beoordelen).
- Testcorpus: `testdata/handtekeningen/` (genegeerd door git), op te halen met `python scripts/haal-handtekening-testdata.py`. Tests die het nodig hebben, slaan over met een melding als het ontbreekt.
- Verificatiebestanden en corpusbestanden worden nooit overschreven; tests in de app werken op kopieën in een tijdelijke map.
- UI: dialogen via de bestaande `Dialog.jsx` (Windows-stijl, verplaatsbaar, sluit niet bij klik buiten). Cursor niet aanpassen. Nieuwe teksten in alle 39 locales.

## Gemeten uitgangspunten

Vastgesteld op het corpus (18 PDF's) met `pypdfium2`, een eigen DER-lezer in Python, `cryptography` en OpenSSL 3.5; het resultaat staat per handtekening in Task 12.

- **SubFilters:** `ETSI.CAdES.detached` (16 bestanden), `adbe.pkcs7.detached` (`encrypted.pdf`, `pades-alter-signature-appearance-modify-stream.pdf`), `ETSI.RFC3161` (documenttijdstempels in `pades3_Baseline_B.pdf` ×2, `doc-firmado.pdf`, `pades-5-signatures-and-1-document-timestamp.pdf`). Geen verouderde SubFilters.
- **Documenttijdstempels (§9.2, nu bevestigd):** alle vier *intact*: imprint over het bytebereik klopt, `messageDigest` over TSTInfo klopt en de handtekening van de tijdstempeldienst klopt. Dekking: in `pades3_Baseline_B.pdf` beide niet tot het einde (de laatste handtekening daar is een CAdES-handtekening), in `doc-firmado.pdf` en het 5-handtekeningenbestand tot het einde.
- **Handtekeningtijdstempels** (`signatureTimeStampToken`): `doc-firmado.pdf`, `-T`, `-LT` en de eerste twee handtekeningen van het 5-handtekeningenbestand, alle intact (imprint over de handtekeningwaarde). `BadEncodedCMS.pdf` heeft er ook een, maar die gebruikt OID `sha1WithRSAEncryption` met een EC-sleutel: niet te controleren.
- **Digestalgoritmen:** SHA-256 (meeste), SHA-512 (`pades-bes*`, eerste handtekening `pades3_Baseline_B.pdf`), SHA-1 alleen in `BadEncodedCMS.pdf`. Tijdstempels: SHA-256.
- **Handtekeningalgoritmen:** `sha256WithRSAEncryption`, `sha512WithRSAEncryption`, `rsaEncryption` met de hash uit het digestalgoritme (5 bestanden, plus alle tijdstempeltokens op één na), **RSASSA-PSS** (laatste handtekening `pades3_Baseline_B.pdf`: SHA-256, MGF1-SHA-256, zout 32). ECDSA alleen in `BadEncodedCMS.pdf` (zonder bruikbaar certificaat). `pades-unsupported-signature-algorithm.pdf` gebruikt de curve-OID `1.2.840.10045.3.1.7` als handtekeningalgoritme bij een RSA-sleutel. Sleutels: RSA 1024–3072.
- **BER:** 6 bestanden (`doc-firmado*`, `hello_signed_INCSAVE_signed*`, `modified_after_signature.pdf`) hebben CMS met onbepaalde lengtes. De `der`-crate weigert dat; `ber.rs` normaliseert.
- **Volgorde ondertekende attributen:** in het 5-handtekeningenbestand staan ze niet in DER-volgorde; de handtekening klopt alleen over de oorspronkelijke bytes. `cms`-typen sorteren SET OF bij decoderen, dus `cms_lees.rs` leest ruw.
- **`hello_signed_INCSAVE_signed_EDITED.pdf`:** de `/ByteRange` van de tweede handtekening is vervangen door die van de eerste. `/Contents` moet daarom uit het handtekeningwoordenboek komen, niet uit het gat.
- **`pades-5-signatures-and-1-document-timestamp.pdf`:** de laatste trailer heeft `/Prev 0`; `lopdf 0.34` weigert het bestand (`Error::Trailer`). `pdf_lezen.rs` herstelt de xref door objectkoppen te scannen.
- **`malformed-pades.pdf`:** de eerste regel (`%PDF-…`) is vervangen door rommel. PDFium en `lopdf` weigeren het; via herstel is de handtekening leesbaar en klopt `messageDigest` niet: **gewijzigd** (afwijking van §9.2, dat "niet te controleren" noemt; de ondertekende bytes zijn aantoonbaar veranderd).
- **`BadEncodedCMS.pdf`:** het enige certificaat heeft een niet-minimaal gecodeerd serienummer (`00 50 51…`); strikte DER-lezers weigeren het. Uitkomst **niet te controleren, reden geen-certificaat** (§9.2 noemt "CMS onleesbaar"; de CMS zelf is leesbaar).
- **`encrypted.pdf`:** RC4-128 (V2 R3), leeg gebruikerswachtwoord. `/Contents` is niet versleuteld (ISO 32000-1 §7.6.1); `/Reason`, `/Name`, `/Location`, `/M` wel. `lopdf` ontsleutelt niet automatisch; `pdf_lezen.rs` ontsleutelt alleen die tekstvelden.
- **Rootarchief Windows (deze machine):** 67 wortels, waarvan 14 ECC (P-256/P-384, ECDSA-SHA256/384). Daarom ECDSA-verificatie voor ketens; §10 sluit ECDSA alleen uit als ondertekensleutel.
  - *Na de tweede review:* 68 certificaten in `ROOT` van de gebruiker; 2 hebben eigenschap 104 zonder datum en vallen weg (66 in het archief). Doelen per rol (los van data): 48 wortels voor ondertekenen, 45 voor tijdstempels (eerder 56 voor beide). Op een tijdstip in september 2026 met een even recent blad: 41 voor ondertekenen (104 met datum en 126/127 tellen dan mee), 45 voor tijdstempels. `Disallowed` van gebruiker en computer is op deze machine leeg (beide alleen-lezen te openen, ook zonder beheerder).
  - *Bij uitvoering, na review:* `rustls-native-certs` filtert op Windows op huidige geldigheid en serverAuth (55 van 68 in `ROOT` van de gebruiker). Het archief wordt daarom op Windows met `schannel` zelf gelezen: 68 certificaten, waarvan 12 weggelaten omdat Windows het doel beperkt tot iets zonder documentondertekening of tijdstempels (bijvoorbeeld alleen serverAuth, serverAuth + clientAuth of codeSigning): 56 wortels. `LocalMachine\ROOT` apart openen geeft via `schannel` "toegang geweigerd" zonder beheerder; de wortels van de computer zijn al zichtbaar via het archief van de gebruiker.
- **Crates:** `rustls-native-certs 0.8.3` staat al in `Cargo.lock` (via `rustls-platform-verifier`) en hangt alleen aan `rustls-pki-types`, `schannel`, `security-framework` en `openssl-probe`: geen tweede der/x509-lijn. `p256`/`p384 0.13` gebruiken `ecdsa 0.16`, `elliptic-curve 0.13`, `sec1 0.7`, `spki 0.7`, `der 0.7`.

## Takenoverzicht

| # | Taak | Produceert |
|---|---|---|
| 1 | `status.rs` | assen en getoonde status |
| 2 | `bytebereik.rs` (leesdeel) | `Bytebereik` |
| 3 | Testfixtures verifiëren | certificaten, CMS, tijdstempeltoken |
| 4 | `ber.rs` | BER→DER, TLV-lezer, ASN.1-tijd |
| 5 | `cms_lees.rs` | `SignedData`, `Certificaat` |
| 6 | `algoritme.rs` | `Hashalg`, `controleer_handtekening` |
| 7 | `pdf_lezen.rs` | `lees_handtekeningvelden` |
| 8 | `verifieer.rs`: integriteit CAdES/PKCS#7 | `integriteit_cms`, `controleer_ondertekenaar` |
| 9 | `tijdstempel.rs` | `controleer_token` |
| 10 | `vertrouwen.rs` | `Vertrouwensarchief`, `beoordeel` |
| 11 | Document verifiëren en Tauri-commando's | `pdf_signature_list`, `pdf_signed_revision` |
| 12 | Manifest per handtekening, orakel, corpustest | `scripts/pades-orakel.py` |
| 13 | i18n-sleutels in 39 locales | `dialogs.signatureVerification.*` |
| 14 | JS: verificatie starten en balk | `HandtekeningBar` |
| 15 | Detailvenster en ondertekende versie | `HandtekeningDetailDialog` |
| 16 | Waarschuwing bij gewoon opslaan | `bevestigOpslaanMetHandtekeningen` |
| 17 | Verificatie in een releasebuild | — |

---

### Task 1: `status.rs` — assen en getoonde status

**Files:**
- Create: `open-pdf-studio/src-tauri/src/handtekening/status.rs`
- Modify: `open-pdf-studio/src-tauri/src/handtekening/mod.rs`

**Interfaces:**
- Consumes: niets (puur; alleen `serde`).
- Produces (in `crate::handtekening::status`):
  - `pub enum OnleesbaarReden { PdfOnleesbaar, BytebereikOngeldig, CmsOnleesbaar, GeenCertificaat, AlgoritmeNietOndersteund, VerouderdFormaat }` — `Debug, Clone, Copy, PartialEq, Eq, Serialize`, kebab-case.
  - `pub enum Integriteit { Intact, Gewijzigd, Ongeldig, NietTeControleren { reden: OnleesbaarReden } }` — serde-tag `uitkomst`.
  - `pub enum WantrouwenReden { GeenKeten, Verlopen, Sleutelgebruik, AlgoritmeNietOndersteund }`.
  - `pub enum Vertrouwen { Vertrouwd, NietVertrouwd { reden: WantrouwenReden }, NietBepaald }` — serde-tag `uitkomst`.
  - `pub enum Status { Geldig, OnbekendCertificaat { reden: WantrouwenReden }, GewijzigdNaOndertekenen, OngeldigeHandtekening, NietTeControleren { reden: OnleesbaarReden }, NietOndertekendVeld }` — serde-tag `code`.
  - `pub struct Getoond { pub status: Status, pub daarna_gewijzigd: bool }` — camelCase.
  - `pub fn leid_af(integriteit: Integriteit, vertrouwen: Vertrouwen, dekt_hele_document: bool) -> Getoond`
  - `pub fn leeg_veld() -> Getoond`

- [ ] **Step 1: Module declareren**

Vervang de module-regels in `open-pdf-studio/src-tauri/src/handtekening/mod.rs` door (alfabetisch):

```rust
pub mod certificaat;
pub mod pkcs12;
pub mod status;
```

- [ ] **Step 2: Tests schrijven (falen eerst)**

Maak `open-pdf-studio/src-tauri/src/handtekening/status.rs` met alleen de tests:

```rust
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
```

- [ ] **Step 3: Tests draaien, zien falen**

```bash
cd open-pdf-studio/src-tauri && CARGO_TARGET_DIR="$BUILDMAP" cargo test --lib handtekening::status 2>&1 | grep -E "^error\[" | head -3
```
Expected: compileerfouten `error[E0412]: cannot find type ...` / `error[E0425]: cannot find function leid_af` (de typen bestaan nog niet).

- [ ] **Step 4: Implementatie**

Zet boven het testblok in `status.rs`:

```rust
//! Getoonde status van een handtekening, puur afgeleid uit de losse controles
//! (spec §7.1 en §7.2). Geen I/O en geen cryptografie: de andere modules leveren
//! de drie assen, deze module beslist wat de gebruiker ziet.

use serde::Serialize;

/// Waarom een handtekening niet te controleren is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum OnleesbaarReden {
    /// De PDF-structuur is niet te ontleden.
    PdfOnleesbaar,
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
```

- [ ] **Step 5: Tests draaien**

```bash
cd open-pdf-studio/src-tauri && CARGO_TARGET_DIR="$BUILDMAP" cargo test --lib handtekening::status 2>&1 | grep -E "test result|panicked"
```
Expected: `test result: ok. 7 passed; 0 failed`.

- [ ] **Step 6: Rest groen, dan commit**

```bash
cd open-pdf-studio/src-tauri && CARGO_TARGET_DIR="$BUILDMAP" cargo test --lib handtekening 2>&1 | grep -E "^test result"
cd .. && npm run test:unit 2>&1 | grep -E "^# (pass|fail)" && npx vite build > /dev/null 2>&1; echo "vite exit $?"
cd .. && git add open-pdf-studio/src-tauri/src/handtekening/mod.rs open-pdf-studio/src-tauri/src/handtekening/status.rs
git commit -m "feat(handtekening): getoonde status puur afgeleid uit integriteit, vertrouwen en dekking"
```
Expected: `test result: ok.` met `0 failed`; `# fail 0`; `vite exit 0`.

---

### Task 2: `bytebereik.rs` — het ondertekende bytebereik lezen

**Files:**
- Create: `open-pdf-studio/src-tauri/src/handtekening/bytebereik.rs`
- Modify: `open-pdf-studio/src-tauri/src/handtekening/mod.rs`

**Interfaces:**
- Consumes: niets (puur).
- Produces (in `crate::handtekening::bytebereik`):
  - `pub struct Bytebereik { pub start1: usize, pub lengte1: usize, pub start2: usize, pub lengte2: usize }` — `Debug, Clone, Copy, PartialEq, Eq`.
  - `pub enum BereikFout { GeenVierGetallen, Negatief, BeginNietNul, GatTeKlein, VoorbijEinde, GatGeenHexString }` — `Debug, Clone, Copy, PartialEq, Eq`, `Display`.
  - `impl Bytebereik`:
    - `pub fn uit_getallen(getallen: &[i64], bestandslengte: usize) -> Result<Bytebereik, BereikFout>`
    - `pub fn einde(&self) -> usize`
    - `pub fn dekt_hele_document(&self, bestandslengte: usize) -> bool`
    - `pub fn gat<'a>(&self, bytes: &'a [u8]) -> Option<&'a [u8]>`
    - `pub fn controleer_gat(&self, bytes: &[u8]) -> Result<(), BereikFout>`
    - `pub fn delen<'a>(&self, bytes: &'a [u8]) -> Option<[&'a [u8]; 2]>`
    - `pub fn ondertekende_versie<'a>(&self, bytes: &'a [u8]) -> Option<&'a [u8]>`

Het schrijven van plaatshouders en in-place patchen (spec §4.2) hoort bij deel 3 en valt hier buiten.

- [ ] **Step 1: Module declareren**

Voeg in `open-pdf-studio/src-tauri/src/handtekening/mod.rs` toe, vóór `pub mod certificaat;`:

```rust
pub mod bytebereik;
```

- [ ] **Step 2: Tests schrijven (falen eerst)**

Maak `open-pdf-studio/src-tauri/src/handtekening/bytebereik.rs` met alleen de tests. Het proefbestand is 27 bytes: `<` staat op index 15, `>` op index 20.

```rust
#[cfg(test)]
mod tests {
    use super::*;

    const PDF: &[u8] = b"%PDF-1.7 hallo <0A1b> einde";

    #[test]
    fn geldig_bereik_dat_het_hele_document_dekt() {
        let b = Bytebereik::uit_getallen(&[0, 15, 21, 6], PDF.len()).unwrap();
        assert_eq!(b, Bytebereik { start1: 0, lengte1: 15, start2: 21, lengte2: 6 });
        assert_eq!(b.einde(), 27);
        assert!(b.dekt_hele_document(PDF.len()));
        assert_eq!(b.controleer_gat(PDF), Ok(()));
    }

    #[test]
    fn bereik_dat_niet_tot_het_einde_reikt() {
        let b = Bytebereik::uit_getallen(&[0, 15, 21, 3], PDF.len()).unwrap();
        assert_eq!(b.einde(), 24);
        assert!(!b.dekt_hele_document(PDF.len()));
    }

    #[test]
    fn ongeldige_getallen_geven_een_fout() {
        let n = PDF.len();
        assert_eq!(Bytebereik::uit_getallen(&[0, 15, 21], n), Err(BereikFout::GeenVierGetallen));
        assert_eq!(Bytebereik::uit_getallen(&[0, 15, 21, 6, 1], n), Err(BereikFout::GeenVierGetallen));
        assert_eq!(Bytebereik::uit_getallen(&[0, -15, 21, 6], n), Err(BereikFout::Negatief));
        assert_eq!(Bytebereik::uit_getallen(&[1, 15, 21, 6], n), Err(BereikFout::BeginNietNul));
        assert_eq!(Bytebereik::uit_getallen(&[0, 15, 16, 11], n), Err(BereikFout::GatTeKlein));
        assert_eq!(Bytebereik::uit_getallen(&[0, 15, 21, 7], n), Err(BereikFout::VoorbijEinde));
        assert_eq!(Bytebereik::uit_getallen(&[0, i64::MAX, i64::MAX, i64::MAX], n), Err(BereikFout::GatTeKlein));
        assert_eq!(Bytebereik::uit_getallen(&[0, 1, i64::MAX, i64::MAX], n), Err(BereikFout::VoorbijEinde));
    }

    #[test]
    fn gat_moet_een_hex_string_zijn() {
        let b = Bytebereik::uit_getallen(&[0, 14, 21, 6], PDF.len()).unwrap();
        assert_eq!(b.controleer_gat(PDF), Err(BereikFout::GatGeenHexString));
        let met_witruimte = b"%PDF-1.7 hallo <0A 1\nb> einde";
        let b = Bytebereik::uit_getallen(&[0, 15, 23, 6], met_witruimte.len()).unwrap();
        assert_eq!(b.controleer_gat(met_witruimte), Ok(()));
        let geen_hex = b"%PDF-1.7 hallo <0A1g> einde";
        let b = Bytebereik::uit_getallen(&[0, 15, 21, 6], geen_hex.len()).unwrap();
        assert_eq!(b.controleer_gat(geen_hex), Err(BereikFout::GatGeenHexString));
    }

    #[test]
    fn delen_sluiten_precies_het_gat_uit() {
        let b = Bytebereik::uit_getallen(&[0, 15, 21, 6], PDF.len()).unwrap();
        let [een, twee] = b.delen(PDF).unwrap();
        assert_eq!(een, b"%PDF-1.7 hallo ");
        assert_eq!(twee, b" einde");
        assert_eq!(b.gat(PDF).unwrap(), b"<0A1b>");
        assert_eq!(een.len() + b.gat(PDF).unwrap().len() + twee.len(), PDF.len());
    }

    #[test]
    fn ondertekende_versie_eindigt_bij_het_bereik() {
        let b = Bytebereik::uit_getallen(&[0, 15, 21, 3], PDF.len()).unwrap();
        assert_eq!(b.ondertekende_versie(PDF).unwrap(), b"%PDF-1.7 hallo <0A1b> ei");
    }

    #[test]
    fn handmatig_ongeldig_bereik_geeft_geen_paniek() {
        let b = Bytebereik { start1: 0, lengte1: usize::MAX, start2: usize::MAX, lengte2: usize::MAX };
        assert_eq!(b.delen(PDF), None);
        assert_eq!(b.gat(PDF), None);
        assert_eq!(b.ondertekende_versie(PDF), None);
        assert_eq!(b.einde(), usize::MAX);
        assert_eq!(b.controleer_gat(PDF), Err(BereikFout::VoorbijEinde));
    }

    #[test]
    fn foutmelding_is_leesbaar() {
        assert_eq!(BereikFout::GatGeenHexString.to_string(), "het gat in het bytebereik is geen hex-string");
    }
}
```

- [ ] **Step 3: Tests draaien, zien falen**

```bash
cd open-pdf-studio/src-tauri && CARGO_TARGET_DIR="$BUILDMAP" cargo test --lib handtekening::bytebereik 2>&1 | grep -E "^error\[" | head -3
```
Expected: `error[E0433]`/`error[E0412]`: `Bytebereik` en `BereikFout` bestaan nog niet.

- [ ] **Step 4: Implementatie**

Zet boven het testblok in `bytebereik.rs`:

```rust
//! Het ondertekende bytebereik (`/ByteRange`, ISO 32000-1 §12.8.1): lezen,
//! controleren en dekking. Puur, zonder I/O. Plaatshouders schrijven en
//! in-place patchen komen hier bij het ondertekenen bij.

/// De twee ondertekende stukken van het bestand; daartussen ligt het gat met `/Contents`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Bytebereik {
    pub start1: usize,
    pub lengte1: usize,
    pub start2: usize,
    pub lengte2: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BereikFout {
    GeenVierGetallen,
    Negatief,
    BeginNietNul,
    /// Het gat is kleiner dan `<>`, of het tweede stuk begint vóór het einde van het eerste.
    GatTeKlein,
    VoorbijEinde,
    GatGeenHexString,
}

impl std::fmt::Display for BereikFout {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let tekst = match self {
            BereikFout::GeenVierGetallen => "het bytebereik heeft geen vier getallen",
            BereikFout::Negatief => "het bytebereik bevat een negatief getal",
            BereikFout::BeginNietNul => "het bytebereik begint niet bij 0",
            BereikFout::GatTeKlein => "het gat in het bytebereik is te klein",
            BereikFout::VoorbijEinde => "het bytebereik reikt voorbij het einde van het bestand",
            BereikFout::GatGeenHexString => "het gat in het bytebereik is geen hex-string",
        };
        f.write_str(tekst)
    }
}

impl Bytebereik {
    /// Uit de getallen van `/ByteRange`, gecontroleerd tegen de bestandslengte.
    pub fn uit_getallen(getallen: &[i64], bestandslengte: usize) -> Result<Bytebereik, BereikFout> {
        let [a, b, c, d] = <[i64; 4]>::try_from(getallen).map_err(|_| BereikFout::GeenVierGetallen)?;
        let naar = |x: i64| usize::try_from(x).map_err(|_| BereikFout::Negatief);
        let (start1, lengte1, start2, lengte2) = (naar(a)?, naar(b)?, naar(c)?, naar(d)?);
        if start1 != 0 {
            return Err(BereikFout::BeginNietNul);
        }
        match lengte1.checked_add(2) {
            Some(minimum) if start2 >= minimum => {}
            _ => return Err(BereikFout::GatTeKlein),
        }
        match start2.checked_add(lengte2) {
            Some(einde) if einde <= bestandslengte => {}
            _ => return Err(BereikFout::VoorbijEinde),
        }
        Ok(Bytebereik { start1, lengte1, start2, lengte2 })
    }

    /// Eerste byte ná het bereik.
    pub fn einde(&self) -> usize {
        self.start2.saturating_add(self.lengte2)
    }

    /// Reikt het bereik tot het einde van het bestand? Zo niet, dan is er na het
    /// ondertekenen iets toegevoegd.
    pub fn dekt_hele_document(&self, bestandslengte: usize) -> bool {
        self.einde() == bestandslengte
    }

    /// De bytes tussen de twee stukken, inclusief `<` en `>`.
    pub fn gat<'a>(&self, bytes: &'a [u8]) -> Option<&'a [u8]> {
        bytes.get(self.start1.checked_add(self.lengte1)?..self.start2)
    }

    /// Het gat moet een hex-string zijn: `<`, hexcijfers of witruimte, `>`.
    pub fn controleer_gat(&self, bytes: &[u8]) -> Result<(), BereikFout> {
        let gat = self.gat(bytes).ok_or(BereikFout::VoorbijEinde)?;
        match gat {
            [b'<', midden @ .., b'>']
                if midden
                    .iter()
                    .all(|x| x.is_ascii_hexdigit() || matches!(x, b' ' | b'\n' | b'\r' | b'\t' | b'\x0c')) =>
            {
                Ok(())
            }
            _ => Err(BereikFout::GatGeenHexString),
        }
    }

    /// De twee ondertekende stukken; `None` als het bereik niet in `bytes` past.
    pub fn delen<'a>(&self, bytes: &'a [u8]) -> Option<[&'a [u8]; 2]> {
        Some([
            bytes.get(self.start1..self.start1.checked_add(self.lengte1)?)?,
            bytes.get(self.start2..self.start2.checked_add(self.lengte2)?)?,
        ])
    }

    /// Het bestand zoals het ondertekend werd: alles tot het einde van het bereik.
    pub fn ondertekende_versie<'a>(&self, bytes: &'a [u8]) -> Option<&'a [u8]> {
        bytes.get(..self.start2.checked_add(self.lengte2)?)
    }
}
```

- [ ] **Step 5: Tests draaien**

```bash
cd open-pdf-studio/src-tauri && CARGO_TARGET_DIR="$BUILDMAP" cargo test --lib handtekening::bytebereik 2>&1 | grep -E "test result|panicked"
```
Expected: `test result: ok. 8 passed; 0 failed`.

- [ ] **Step 6: Rest groen, dan commit**

```bash
cd open-pdf-studio/src-tauri && CARGO_TARGET_DIR="$BUILDMAP" cargo test --lib handtekening 2>&1 | grep -E "^test result"
cd .. && npm run test:unit 2>&1 | grep -E "^(#|ℹ) (pass|fail)" && npx vite build > /dev/null 2>&1; echo "vite exit $?"
cd .. && git add open-pdf-studio/src-tauri/src/handtekening/mod.rs open-pdf-studio/src-tauri/src/handtekening/bytebereik.rs
git commit -m "feat(handtekening): ondertekend bytebereik lezen, gat controleren en dekking bepalen"
```
Expected: `0 failed`; `fail 0`; `vite exit 0`.

---

### Task 3: Testfixtures voor verifiëren

**Files:**
- Create: `open-pdf-studio/src-tauri/tests/fixtures/verifieer/maak-fixtures.sh`
- Create: `open-pdf-studio/src-tauri/tests/fixtures/verifieer/README.md`
- Create (gegenereerd): `data.bin`, `root.der`, `tussen.der`, `blad.der`, `blad-verkeerd-gebruik.der`, `ec.der`, `tsa.der`, `ec-root.der`, `blad-onder-ec-root.der`, `cms-rsa-sha256.der`, `cms-rsa-pss.der`, `cms-ec-p256-sha384.der`, `cms-zonder-certificaat.der`, `cms-rsa-ber.der`, `tst-data.der` in dezelfde map
- Modify: `.gitattributes`

**Interfaces:**
- Produces: map `open-pdf-studio/src-tauri/tests/fixtures/verifieer/` met:
  - `data.bin`: de ondertekende inhoud (`Ondertekende testinhoud voor OPDS.` + LF, 35 bytes).
  - Keten RSA: `root.der` (CA, keyCertSign) → `tussen.der` (CA, pathlen 0) → `blad.der` (digitalSignature + nonRepudiation), `blad-verkeerd-gebruik.der` (alleen keyEncipherment), `ec.der` (P-256-sleutel, uitgegeven door `tussen`), `tsa.der` (digitalSignature, EKU timeStamping kritiek, uitgegeven door `tussen`).
  - Keten ECDSA: `ec-root.der` (P-384, CA) → `blad-onder-ec-root.der` (ecdsa-with-SHA384).
  - Detached CMS over `data.bin`, elk met de ketencertificaten `blad`/`ec` + `tussen` ingebed: `cms-rsa-sha256.der` (signatureAlgorithm `rsaEncryption`, SHA-256), `cms-rsa-pss.der` (RSASSA-PSS SHA-256), `cms-ec-p256-sha384.der` (ecdsa-with-SHA384 op P-256), `cms-zonder-certificaat.der` (`-nocerts`), `cms-rsa-ber.der` (onbepaalde lengtes, `-stream`).
  - `tst-data.der`: RFC 3161-token (SHA-256-imprint over `data.bin`), ondertekend door `tsa`, met `tsa` + `tussen` ingebed.
  - Alle certificaten tien jaar geldig vanaf het aanmaakmoment. Tests lezen de geldigheid uit de certificaten zelf.

- [ ] **Step 1: `.bin` als binair markeren**

Voeg in `.gitattributes` na de regel `*.p7s      binary` toe:

```
*.bin      binary
```

- [ ] **Step 2: Script schrijven**

`open-pdf-studio/src-tauri/tests/fixtures/verifieer/maak-fixtures.sh`:

```bash
#!/usr/bin/env bash
# Maakt de testfixtures voor het verifiëren van handtekeningen (opnieuw) aan.
# Wegwerpsleutels staan alleen in een tijdelijke map; in de repo komen enkel
# certificaten, CMS-structuren en een tijdstempeltoken.
set -euo pipefail
export MSYS_NO_PATHCONV=1
# Onder Git Bash een Windows-pad, zodat de (native) openssl het kan openen.
M="$(cd "$(dirname "$0")" && { pwd -W 2>/dev/null || pwd; })"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
cd "$T"

cat > ext.cnf <<'CNF'
[root]
basicConstraints=critical,CA:TRUE
keyUsage=critical,keyCertSign,cRLSign
subjectKeyIdentifier=hash
[tussen]
basicConstraints=critical,CA:TRUE,pathlen:0
keyUsage=critical,keyCertSign,cRLSign
subjectKeyIdentifier=hash
authorityKeyIdentifier=keyid
[blad]
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,nonRepudiation
subjectKeyIdentifier=hash
authorityKeyIdentifier=keyid
[blad_verkeerd]
basicConstraints=critical,CA:FALSE
keyUsage=critical,keyEncipherment
[tsa]
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature
extendedKeyUsage=critical,timeStamping
CNF

cat > tsa.cnf <<'CNF'
[tsa_config]
serial = tsaserial
signer_digest = sha256
default_policy = 1.2.3.4.1
digests = sha256, sha384, sha512
accuracy = secs:1
ordering = no
tsa_name = no
ess_cert_id_chain = no
ess_cert_id_alg = sha256
CNF
echo 01 > tsaserial

openssl req -x509 -newkey rsa:2048 -nodes -keyout root.key -out root.pem -subj "/CN=OPDS Test Root" \
  -days 3650 -extensions root -config ext.cnf -sha256
openssl req -newkey rsa:2048 -nodes -keyout tussen.key -out tussen.csr -subj "/CN=OPDS Test Tussen"
openssl x509 -req -in tussen.csr -CA root.pem -CAkey root.key -set_serial 2 -days 3650 \
  -extfile ext.cnf -extensions tussen -out tussen.pem -sha256
openssl req -newkey rsa:2048 -nodes -keyout blad.key -out blad.csr -subj "/CN=OPDS Test Blad"
openssl x509 -req -in blad.csr -CA tussen.pem -CAkey tussen.key -set_serial 3 -days 3650 \
  -extfile ext.cnf -extensions blad -out blad.pem -sha256
openssl x509 -req -in blad.csr -CA tussen.pem -CAkey tussen.key -set_serial 4 -days 3650 \
  -extfile ext.cnf -extensions blad_verkeerd -out blad-verkeerd-gebruik.pem -sha256
openssl ecparam -name prime256v1 -genkey -noout -out ec.key
openssl req -new -key ec.key -out ec.csr -subj "/CN=OPDS Test EC"
openssl x509 -req -in ec.csr -CA tussen.pem -CAkey tussen.key -set_serial 5 -days 3650 \
  -extfile ext.cnf -extensions blad -out ec.pem -sha256
openssl req -newkey rsa:2048 -nodes -keyout tsa.key -out tsa.csr -subj "/CN=OPDS Test TSA"
openssl x509 -req -in tsa.csr -CA tussen.pem -CAkey tussen.key -set_serial 6 -days 3650 \
  -extfile ext.cnf -extensions tsa -out tsa.pem -sha256
openssl ecparam -name secp384r1 -genkey -noout -out ec-root.key
openssl req -x509 -new -key ec-root.key -out ec-root.pem -subj "/CN=OPDS Test EC Root" \
  -days 3650 -extensions root -config ext.cnf -sha384
openssl x509 -req -in blad.csr -CA ec-root.pem -CAkey ec-root.key -set_serial 7 -days 3650 \
  -extfile ext.cnf -extensions blad -out blad-onder-ec-root.pem -sha384

printf 'Ondertekende testinhoud voor OPDS.\n' > "$M/data.bin"
openssl cms -sign -binary -in "$M/data.bin" -signer blad.pem -inkey blad.key -certfile tussen.pem \
  -md sha256 -outform DER -out "$M/cms-rsa-sha256.der"
openssl cms -sign -binary -in "$M/data.bin" -signer blad.pem -inkey blad.key -certfile tussen.pem \
  -md sha256 -keyopt rsa_padding_mode:pss -outform DER -out "$M/cms-rsa-pss.der"
openssl cms -sign -binary -in "$M/data.bin" -signer ec.pem -inkey ec.key -certfile tussen.pem \
  -md sha384 -outform DER -out "$M/cms-ec-p256-sha384.der"
openssl cms -sign -binary -in "$M/data.bin" -signer blad.pem -inkey blad.key -nocerts \
  -md sha256 -outform DER -out "$M/cms-zonder-certificaat.der"
openssl cms -sign -binary -stream -in "$M/data.bin" -signer blad.pem -inkey blad.key -certfile tussen.pem \
  -md sha256 -outform DER -out "$M/cms-rsa-ber.der"
openssl ts -query -data "$M/data.bin" -sha256 -cert -out req.tsq
openssl ts -reply -queryfile req.tsq -inkey tsa.key -signer tsa.pem -chain tussen.pem \
  -config tsa.cnf -section tsa_config -token_out -out "$M/tst-data.der" 2>/dev/null

for f in root tussen blad blad-verkeerd-gebruik ec tsa ec-root blad-onder-ec-root; do
  openssl x509 -in "$f.pem" -outform DER -out "$M/$f.der"
done
echo "fixtures aangemaakt in $M"
```

- [ ] **Step 3: Fixtures aanmaken**

Run (Git Bash, vanuit de worktree-root):

```bash
bash open-pdf-studio/src-tauri/tests/fixtures/verifieer/maak-fixtures.sh 2>&1 | tail -n 1
ls open-pdf-studio/src-tauri/tests/fixtures/verifieer | grep -v -E "\.(sh|md)$" | wc -l
wc -c < open-pdf-studio/src-tauri/tests/fixtures/verifieer/data.bin
```
Expected: `fixtures aangemaakt in …`, `15`, `35`. Er staat geen `.key`- of `.pem`-bestand in de map.

- [ ] **Step 4: Onafhankelijk controleren met OpenSSL**

```bash
export MSYS_NO_PATHCONV=1
M=open-pdf-studio/src-tauri/tests/fixtures/verifieer
T="$(cd "$(mktemp -d)" && { pwd -W 2>/dev/null || pwd; })"
openssl x509 -inform DER -in "$M/root.der" -out "$T/root.pem"
openssl x509 -inform DER -in "$M/ec-root.der" -out "$T/ec-root.pem"
openssl x509 -inform DER -in "$M/tussen.der" -out "$T/tussen.pem"
for c in cms-rsa-sha256 cms-rsa-pss cms-ec-p256-sha384 cms-rsa-ber; do
  printf "%-20s " "$c"
  openssl cms -verify -binary -inform DER -in "$M/$c.der" -content "$M/data.bin" -CAfile "$T/root.pem" -purpose any -out "$T/uit" 2>&1 | tail -n 1
done
openssl ts -verify -data "$M/data.bin" -in "$M/tst-data.der" -token_in -CAfile "$T/root.pem" -untrusted "$T/tussen.pem" 2>/dev/null
openssl x509 -inform DER -in "$M/blad-onder-ec-root.der" -out "$T/b.pem" && openssl verify -CAfile "$T/ec-root.pem" "$T/b.pem" | sed 's/.*: //'
head -c 2 "$M/cms-rsa-ber.der" | od -An -tx1
rm -rf "$T"
```
Expected: vier keer `CMS Verification successful`, `Verification: OK`, `OK`, en ` 30 80` (BER met onbepaalde lengte).

- [ ] **Step 5: README**

`open-pdf-studio/src-tauri/tests/fixtures/verifieer/README.md`:

```markdown
# Testfixtures voor het verifiëren van handtekeningen

Wegwerpcertificaten en handtekeningen, uitsluitend voor tests. Opnieuw aan te
maken met `maak-fixtures.sh` (OpenSSL 3, Git Bash); de privésleutels bestaan
alleen tijdens dat script in een tijdelijke map.

| Bestand | Inhoud |
|---|---|
| `data.bin` | ondertekende inhoud |
| `root.der` | `CN=OPDS Test Root`, RSA-2048, CA |
| `tussen.der` | `CN=OPDS Test Tussen`, CA, uitgegeven door root |
| `blad.der` | `CN=OPDS Test Blad`, digitalSignature + nonRepudiation, uitgegeven door tussen |
| `blad-verkeerd-gebruik.der` | zelfde sleutel, alleen keyEncipherment |
| `ec.der` | `CN=OPDS Test EC`, P-256, uitgegeven door tussen |
| `tsa.der` | `CN=OPDS Test TSA`, EKU timeStamping (kritiek), uitgegeven door tussen |
| `ec-root.der` | `CN=OPDS Test EC Root`, P-384, CA |
| `blad-onder-ec-root.der` | blad-sleutel, ecdsa-with-SHA384 door EC-root |
| `cms-rsa-sha256.der` | detached CMS over `data.bin`, `rsaEncryption` + SHA-256 |
| `cms-rsa-pss.der` | idem, RSASSA-PSS SHA-256 |
| `cms-ec-p256-sha384.der` | idem, ecdsa-with-SHA384 met de EC-sleutel |
| `cms-zonder-certificaat.der` | idem, zonder ingebedde certificaten |
| `cms-rsa-ber.der` | idem als BER met onbepaalde lengtes |
| `tst-data.der` | RFC 3161-token over `data.bin`, SHA-256, door de TSA |

Alle certificaten zijn tien jaar geldig vanaf het aanmaakmoment; tests lezen
de geldigheid uit het certificaat en hangen niet van de huidige datum af.
```

- [ ] **Step 6: Commit**

```bash
git add .gitattributes open-pdf-studio/src-tauri/tests/fixtures/verifieer
git commit -m "test(handtekening): certificaatketens, CMS-handtekeningen en tijdstempeltoken voor verificatietests"
```

---

### Task 4: `ber.rs` — BER naar DER, TLV-lezer en ASN.1-tijd

**Files:**
- Create: `open-pdf-studio/src-tauri/src/handtekening/ber.rs`
- Modify: `open-pdf-studio/src-tauri/src/handtekening/mod.rs`

**Interfaces:**
- Consumes: fixtures `tests/fixtures/verifieer/cms-rsa-sha256.der` en `cms-rsa-ber.der` (Task 3).
- Produces (in `crate::handtekening::ber`):
  - `pub const MAX_DIEPTE: usize = 64;`
  - `pub enum BerFout { Afgekapt, OnbepaaldeLengte, OnbepaaldBijPrimitief, HogeTag, LengteTeGroot, TeDiep, VreemdDeelInString }` — `Debug, Clone, Copy, PartialEq, Eq`, `Display`.
  - `pub struct Tlv<'a> { pub tag: u8, pub inhoud: &'a [u8], pub geheel: &'a [u8] }` — `Debug, Clone, Copy, PartialEq, Eq`.
  - `pub fn lees_tlv(b: &[u8]) -> Result<(Tlv<'_>, &[u8]), BerFout>` — één DER-element (bepaalde lengte) plus de rest.
  - `pub fn kinderen(inhoud: &[u8]) -> Result<Vec<Tlv<'_>>, BerFout>`
  - `pub fn normaliseer(b: &[u8]) -> Result<(Vec<u8>, usize), BerFout>` — DER van het eerste element en het aantal gelezen invoerbytes.
  - `pub fn unix_tijd(jaar: i64, maand: u32, dag: u32, uur: u32, minuut: u32, seconde: u32) -> Option<i64>`
  - `pub fn tijd_unix(tag: u8, inhoud: &[u8]) -> Option<i64>` — UTCTime (`0x17`) of GeneralizedTime (`0x18`), fractie en offset toegestaan.

Waarom: 6 van de 18 corpusbestanden bevatten CMS als BER met onbepaalde lengtes, en tijdstempels gebruiken GeneralizedTime met fracties (`20130508191615.82Z`). De `der`-crate weigert allebei. Normaliseren verandert nooit de volgorde van elementen: ondertekende attributen blijven byte-voor-byte gelijk.

- [ ] **Step 1: Module declareren**

Voeg in `open-pdf-studio/src-tauri/src/handtekening/mod.rs` toe, vóór `pub mod bytebereik;`:

```rust
pub mod ber;
```

- [ ] **Step 2: Tests schrijven (falen eerst)**

Maak `open-pdf-studio/src-tauri/src/handtekening/ber.rs` met alleen de tests:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn fixture(naam: &str) -> Vec<u8> {
        std::fs::read(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/verifieer").join(naam)).unwrap()
    }

    #[test]
    fn tlv_en_kinderen() {
        let b = [0x30, 0x06, 0x02, 0x01, 0x05, 0x04, 0x01, 0xAA, 0xFF];
        let (seq, rest) = lees_tlv(&b).unwrap();
        assert_eq!(seq.tag, 0x30);
        assert_eq!(seq.geheel, &b[..8]);
        assert_eq!(rest, &[0xFF]);
        let k = kinderen(seq.inhoud).unwrap();
        assert_eq!(k.len(), 2);
        assert_eq!((k[0].tag, k[0].inhoud), (0x02, &[0x05][..]));
        assert_eq!((k[1].tag, k[1].inhoud), (0x04, &[0xAA][..]));
    }

    #[test]
    fn der_lezer_weigert_netjes() {
        assert_eq!(lees_tlv(&[]), Err(BerFout::Afgekapt));
        assert_eq!(lees_tlv(&[0x30]), Err(BerFout::Afgekapt));
        assert_eq!(lees_tlv(&[0x30, 0x05, 0x02]), Err(BerFout::Afgekapt));
        assert_eq!(lees_tlv(&[0x30, 0x80, 0x00, 0x00]), Err(BerFout::OnbepaaldeLengte));
        assert_eq!(lees_tlv(&[0x1F, 0x01, 0x00]), Err(BerFout::HogeTag));
        assert_eq!(lees_tlv(&[0x04, 0x85, 1, 0, 0, 0, 0]), Err(BerFout::LengteTeGroot));
        assert_eq!(lees_tlv(&[0x04, 0x84, 0xFF, 0xFF, 0xFF, 0xFF]), Err(BerFout::Afgekapt));
    }

    #[test]
    fn der_blijft_ongewijzigd() {
        let der = fixture("cms-rsa-sha256.der");
        assert_eq!(normaliseer(&der).unwrap(), (der.clone(), der.len()));
    }

    #[test]
    fn onbepaalde_lengtes_worden_bepaald() {
        let ber = [0x30, 0x80, 0x02, 0x01, 0x05, 0x00, 0x00, 0xEE];
        assert_eq!(normaliseer(&ber).unwrap(), (vec![0x30, 0x03, 0x02, 0x01, 0x05], 7));
    }

    #[test]
    fn samengestelde_octet_string_wordt_primitief() {
        let ber = [0x24, 0x80, 0x04, 0x02, 0xAA, 0xBB, 0x04, 0x01, 0xCC, 0x00, 0x00];
        assert_eq!(normaliseer(&ber).unwrap(), (vec![0x04, 0x03, 0xAA, 0xBB, 0xCC], 11));
        let genest = [0x30, 0x80, 0xA0, 0x80, 0x24, 0x04, 0x04, 0x02, 0xAA, 0xBB, 0x00, 0x00, 0x00, 0x00];
        assert_eq!(
            normaliseer(&genest).unwrap(),
            (vec![0x30, 0x06, 0xA0, 0x04, 0x04, 0x02, 0xAA, 0xBB], 14)
        );
    }

    #[test]
    fn lengtes_krijgen_minimale_vorm() {
        assert_eq!(normaliseer(&[0x04, 0x82, 0x00, 0x03, 1, 2, 3]).unwrap(), (vec![0x04, 0x03, 1, 2, 3], 7));
        let mut ber = vec![0x30, 0x80, 0x04, 0x81, 0xC8];
        ber.extend(std::iter::repeat(7u8).take(200));
        ber.extend([0x00, 0x00]);
        let (der, gelezen) = normaliseer(&ber).unwrap();
        assert_eq!(gelezen, ber.len());
        assert_eq!(&der[..5], &[0x30, 0x81, 0xCB, 0x04, 0x81]);
        assert_eq!(der.len(), 3 + 203);
    }

    #[test]
    fn ber_fixture_wordt_geldige_der() {
        let ber = fixture("cms-rsa-ber.der");
        assert_eq!(&ber[..2], &[0x30, 0x80]);
        let (der, gelezen) = normaliseer(&ber).unwrap();
        assert!(gelezen <= ber.len());
        assert_eq!(&der[..2], &[0x30, 0x82]);
        let (_, rest) = lees_tlv(&der).unwrap();
        assert!(rest.is_empty());
        assert_eq!(normaliseer(&der).unwrap(), (der.clone(), der.len()));
    }

    #[test]
    fn rommel_geeft_fout_zonder_paniek() {
        let ber = fixture("cms-rsa-ber.der");
        for n in 0..ber.len() {
            assert!(normaliseer(&ber[..n]).is_err(), "afgekapt op {n} hoort te falen");
        }
        assert_eq!(normaliseer(&[0x04, 0x80, 0x00, 0x00]), Err(BerFout::OnbepaaldBijPrimitief));
        assert_eq!(
            normaliseer(&[0x24, 0x80, 0x02, 0x01, 0x00, 0x00, 0x00]),
            Err(BerFout::VreemdDeelInString)
        );
        assert_eq!(normaliseer(&[0x30, 0x03, 0x02, 0x05, 0x00]), Err(BerFout::Afgekapt));
    }

    #[test]
    fn te_diep_genest_wordt_geweigerd() {
        let mut b = Vec::new();
        for _ in 0..100 {
            b.extend([0x30, 0x80]);
        }
        b.extend(std::iter::repeat(0u8).take(200));
        assert_eq!(normaliseer(&b), Err(BerFout::TeDiep));
    }

    #[test]
    fn unix_tijd_volgt_de_kalender() {
        assert_eq!(unix_tijd(1970, 1, 1, 0, 0, 0), Some(0));
        assert_eq!(unix_tijd(2000, 3, 1, 0, 0, 0), Some(951_868_800));
        assert_eq!(unix_tijd(2016, 2, 29, 12, 0, 0), Some(1_456_747_200));
        assert_eq!(unix_tijd(1999, 12, 31, 23, 59, 59), Some(946_684_799));
        assert_eq!(unix_tijd(1950, 1, 1, 0, 0, 0), Some(-631_152_000));
        assert_eq!(unix_tijd(2020, 13, 1, 0, 0, 0), None);
        assert_eq!(unix_tijd(2020, 1, 32, 0, 0, 0), None);
    }

    #[test]
    fn asn1_tijden_met_fractie_en_offset() {
        assert_eq!(tijd_unix(0x17, b"160418114016Z"), Some(1_460_979_616));
        assert_eq!(tijd_unix(0x17, b"491231235959Z"), Some(2_524_607_999));
        assert_eq!(tijd_unix(0x17, b"500101000000Z"), Some(-631_152_000));
        assert_eq!(tijd_unix(0x18, b"20130508191615.82Z"), Some(1_368_040_575));
        assert_eq!(tijd_unix(0x18, b"20191205153402.572Z"), Some(1_575_560_042));
        assert_eq!(tijd_unix(0x18, b"20180901162846+0200"), Some(1_535_812_126));
        assert_eq!(tijd_unix(0x18, b"20180915221037"), None);
        assert_eq!(tijd_unix(0x18, b"2018091522103Z"), None);
        assert_eq!(tijd_unix(0x04, b"20180915221037Z"), None);
        assert_eq!(tijd_unix(0x18, &[0xFF, 0xFE]), None);
    }
}
```

- [ ] **Step 3: Tests draaien, zien falen**

```bash
cd open-pdf-studio/src-tauri && CARGO_TARGET_DIR="$BUILDMAP" cargo test --lib handtekening::ber 2>&1 | grep -E "^error\[" | head -3
```
Expected: `error[E0425]`/`error[E0433]`: `lees_tlv`, `BerFout` enz. bestaan nog niet.

- [ ] **Step 4: Implementatie**

Zet boven het testblok in `ber.rs`:

```rust
//! BER naar DER, een kleine TLV-lezer en ASN.1-tijden.
//!
//! CMS in PDF's komt in de praktijk ook als BER voor (onbepaalde lengtes,
//! samengestelde OCTET STRING's). De `der`-crate weigert dat. `normaliseer`
//! zet lengtes om naar DER zonder de volgorde van elementen te veranderen, zodat
//! ondertekende attributen byte-voor-byte gelijk blijven aan wat de
//! ondertekenaar hashte. Alleen tags met één byte (alles wat CMS, X.509 en
//! RFC 3161 gebruiken).

/// Maximale nesting; dieper is geen echte handtekening maar een aanval op de stapel.
pub const MAX_DIEPTE: usize = 64;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BerFout {
    Afgekapt,
    /// Onbepaalde lengte waar DER verwacht wordt.
    OnbepaaldeLengte,
    OnbepaaldBijPrimitief,
    HogeTag,
    LengteTeGroot,
    TeDiep,
    VreemdDeelInString,
}

impl std::fmt::Display for BerFout {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let tekst = match self {
            BerFout::Afgekapt => "ASN.1 afgekapt",
            BerFout::OnbepaaldeLengte => "onbepaalde lengte in DER",
            BerFout::OnbepaaldBijPrimitief => "onbepaalde lengte bij een primitief element",
            BerFout::HogeTag => "tag met meerdere bytes",
            BerFout::LengteTeGroot => "lengteveld te groot",
            BerFout::TeDiep => "te diep genest",
            BerFout::VreemdDeelInString => "vreemd deel in samengestelde OCTET STRING",
        };
        f.write_str(tekst)
    }
}

/// Eén element: tag, inhoud en het hele element (kop + inhoud).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Tlv<'a> {
    pub tag: u8,
    pub inhoud: &'a [u8],
    pub geheel: &'a [u8],
}

/// Kop lezen: (tag, lengte of `None` bij onbepaald, kopgrootte).
fn lees_kop(b: &[u8]) -> Result<(u8, Option<usize>, usize), BerFout> {
    let tag = *b.first().ok_or(BerFout::Afgekapt)?;
    if tag & 0x1F == 0x1F {
        return Err(BerFout::HogeTag);
    }
    let l0 = *b.get(1).ok_or(BerFout::Afgekapt)?;
    if l0 == 0x80 {
        return Ok((tag, None, 2));
    }
    if l0 < 0x80 {
        return Ok((tag, Some(usize::from(l0)), 2));
    }
    let n = usize::from(l0 & 0x7F);
    if n > 4 {
        return Err(BerFout::LengteTeGroot);
    }
    let bytes = b.get(2..2 + n).ok_or(BerFout::Afgekapt)?;
    let lengte = bytes.iter().fold(0usize, |acc, &x| (acc << 8) | usize::from(x));
    Ok((tag, Some(lengte), 2 + n))
}

/// Leest één DER-element aan het begin van `b`; geeft het element en de rest.
pub fn lees_tlv(b: &[u8]) -> Result<(Tlv<'_>, &[u8]), BerFout> {
    let (tag, lengte, kop) = lees_kop(b)?;
    let n = lengte.ok_or(BerFout::OnbepaaldeLengte)?;
    let einde = kop.checked_add(n).ok_or(BerFout::Afgekapt)?;
    let geheel = b.get(..einde).ok_or(BerFout::Afgekapt)?;
    let inhoud = geheel.get(kop..).ok_or(BerFout::Afgekapt)?;
    let rest = b.get(einde..).ok_or(BerFout::Afgekapt)?;
    Ok((Tlv { tag, inhoud, geheel }, rest))
}

/// Alle elementen achter elkaar in `inhoud` (de inhoud van een SEQUENCE of SET).
pub fn kinderen(inhoud: &[u8]) -> Result<Vec<Tlv<'_>>, BerFout> {
    let mut uit = Vec::new();
    let mut rest = inhoud;
    while !rest.is_empty() {
        let (t, na) = lees_tlv(rest)?;
        uit.push(t);
        rest = na;
    }
    Ok(uit)
}

fn schrijf_lengte(uit: &mut Vec<u8>, n: usize) {
    if n < 0x80 {
        uit.push(n as u8);
        return;
    }
    let bytes = (n as u64).to_be_bytes();
    let eerste = bytes.iter().position(|&x| x != 0).unwrap_or(7);
    uit.push(0x80 | (8 - eerste) as u8);
    uit.extend_from_slice(&bytes[eerste..]);
}

/// Zet het eerste element van `b` om naar DER. Geeft de DER-bytes en het aantal
/// gelezen invoerbytes (vulbytes erachter, zoals de nullen in `/Contents`, blijven buiten).
pub fn normaliseer(b: &[u8]) -> Result<(Vec<u8>, usize), BerFout> {
    let mut uit = Vec::with_capacity(b.len());
    let gelezen = normaliseer_in(b, 0, &mut uit)?;
    Ok((uit, gelezen))
}

fn normaliseer_in(b: &[u8], diepte: usize, uit: &mut Vec<u8>) -> Result<usize, BerFout> {
    if diepte > MAX_DIEPTE {
        return Err(BerFout::TeDiep);
    }
    let (tag, lengte, kop) = lees_kop(b)?;
    let samengesteld = tag & 0x20 != 0;
    if !samengesteld {
        let n = lengte.ok_or(BerFout::OnbepaaldBijPrimitief)?;
        let einde = kop.checked_add(n).ok_or(BerFout::Afgekapt)?;
        let inhoud = b.get(kop..einde).ok_or(BerFout::Afgekapt)?;
        uit.push(tag);
        schrijf_lengte(uit, n);
        uit.extend_from_slice(inhoud);
        return Ok(einde);
    }
    let mut binnen = Vec::new();
    let mut pos = kop;
    match lengte {
        Some(n) => {
            let einde = kop.checked_add(n).ok_or(BerFout::Afgekapt)?;
            let deel = b.get(..einde).ok_or(BerFout::Afgekapt)?;
            while pos < einde {
                let rest = deel.get(pos..).ok_or(BerFout::Afgekapt)?;
                pos += normaliseer_in(rest, diepte + 1, &mut binnen)?;
            }
        }
        None => loop {
            let rest = b.get(pos..).ok_or(BerFout::Afgekapt)?;
            match rest {
                [0, 0, ..] => {
                    pos += 2;
                    break;
                }
                [] | [_] => return Err(BerFout::Afgekapt),
                _ => pos += normaliseer_in(rest, diepte + 1, &mut binnen)?,
            }
        },
    }
    if tag == 0x24 {
        // Samengestelde OCTET STRING: delen aaneenrijgen tot één primitieve.
        let mut data = Vec::new();
        for deel in kinderen(&binnen)? {
            if deel.tag != 0x04 {
                return Err(BerFout::VreemdDeelInString);
            }
            data.extend_from_slice(deel.inhoud);
        }
        uit.push(0x04);
        schrijf_lengte(uit, data.len());
        uit.extend_from_slice(&data);
    } else {
        uit.push(tag);
        schrijf_lengte(uit, binnen.len());
        uit.extend_from_slice(&binnen);
    }
    Ok(pos)
}

/// Seconden sinds 1970-01-01 UTC voor een datum en tijd in UTC (proleptisch
/// gregoriaans). `None` bij een onmogelijke maand, dag of tijd.
pub fn unix_tijd(jaar: i64, maand: u32, dag: u32, uur: u32, minuut: u32, seconde: u32) -> Option<i64> {
    if !(1..=12).contains(&maand) || !(1..=31).contains(&dag) || uur > 23 || minuut > 59 || seconde > 60 {
        return None;
    }
    let y = if maand <= 2 { jaar - 1 } else { jaar };
    let era = (if y >= 0 { y } else { y - 399 }) / 400;
    let yoe = y - era * 400;
    let mp = (i64::from(maand) + 9) % 12;
    let doy = (153 * mp + 2) / 5 + i64::from(dag) - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let dagen = era * 146_097 + doe - 719_468;
    Some(dagen * 86_400 + i64::from(uur) * 3600 + i64::from(minuut) * 60 + i64::from(seconde))
}

/// UTCTime (tag `0x17`, `YYMMDDHHMM[SS]`) of GeneralizedTime (tag `0x18`,
/// `YYYYMMDDHHMM[SS][.fractie]`), gevolgd door `Z` of `±hhmm`. De fractie telt niet mee.
pub fn tijd_unix(tag: u8, inhoud: &[u8]) -> Option<i64> {
    let s = std::str::from_utf8(inhoud).ok()?;
    let cijfers = |t: &str| t.bytes().all(|b| b.is_ascii_digit());
    let (jaar, rest) = match tag {
        0x17 => {
            let yy = s.get(0..2).filter(|t| cijfers(t))?.parse::<i64>().ok()?;
            (if yy >= 50 { 1900 + yy } else { 2000 + yy }, s.get(2..)?)
        }
        0x18 => (s.get(0..4).filter(|t| cijfers(t))?.parse::<i64>().ok()?, s.get(4..)?),
        _ => return None,
    };
    let getal = |van: usize| -> Option<u32> { rest.get(van..van + 2).filter(|t| cijfers(t))?.parse().ok() };
    let (maand, dag, uur, minuut) = (getal(0)?, getal(2)?, getal(4)?, getal(6)?);
    let (seconde, mut pos) = match getal(8) {
        Some(s) => (s, 10),
        None => (0, 8),
    };
    if matches!(rest.as_bytes().get(pos), Some(b'.') | Some(b',')) {
        pos += 1;
        while rest.as_bytes().get(pos).is_some_and(|b| b.is_ascii_digit()) {
            pos += 1;
        }
    }
    let basis = unix_tijd(jaar, maand, dag, uur, minuut, seconde)?;
    let zone = rest.get(pos..)?;
    if zone == "Z" {
        return Some(basis);
    }
    let teken = match zone.as_bytes().first() {
        Some(b'+') => -1,
        Some(b'-') => 1,
        _ => return None,
    };
    if zone.len() != 5 || !cijfers(&zone[1..]) {
        return None;
    }
    let uren: i64 = zone[1..3].parse().ok()?;
    let minuten: i64 = zone[3..5].parse().ok()?;
    Some(basis + teken * (uren * 3600 + minuten * 60))
}
```

- [ ] **Step 5: Tests draaien**

```bash
cd open-pdf-studio/src-tauri && CARGO_TARGET_DIR="$BUILDMAP" cargo test --lib handtekening::ber 2>&1 | grep -E "test result|panicked"
```
Expected: `test result: ok. 11 passed; 0 failed`.

- [ ] **Step 6: Rest groen, dan commit**

```bash
cd open-pdf-studio/src-tauri && CARGO_TARGET_DIR="$BUILDMAP" cargo test --lib handtekening 2>&1 | grep -E "^test result"
cd .. && npm run test:unit 2>&1 | grep -E "^(#|ℹ) (pass|fail)" && npx vite build > /dev/null 2>&1; echo "vite exit $?"
cd .. && git add open-pdf-studio/src-tauri/src/handtekening/mod.rs open-pdf-studio/src-tauri/src/handtekening/ber.rs
git commit -m "feat(handtekening): BER-structuren normaliseren naar DER en ASN.1-tijden lezen"
```
Expected: `0 failed`; `fail 0`; `vite exit 0`.

---

### Task 5: `cms_lees.rs` — SignedData en certificaten verdraagzaam lezen

**Files:**
- Create: `open-pdf-studio/src-tauri/src/handtekening/cms_lees.rs`
- Modify: `open-pdf-studio/src-tauri/src/handtekening/mod.rs`

**Interfaces:**
- Consumes: `crate::handtekening::ber::{kinderen, lees_tlv, normaliseer, BerFout, Tlv}` (Task 4); fixtures uit Task 3.
- Produces (in `crate::handtekening::cms_lees`):
  - `pub const ID_SIGNED_DATA`, `ID_DATA`, `ID_TST_INFO`, `ID_MESSAGE_DIGEST`, `ID_SIGNATURE_TIME_STAMP_TOKEN: ObjectIdentifier`
  - `pub struct CmsFout(pub String)` — `Debug, Clone, PartialEq, Eq`; `impl From<BerFout> for CmsFout`.
  - `pub struct AlgId { pub oid: ObjectIdentifier, pub parameters: Option<Vec<u8>> }` — parameters als volledige DER-TLV.
  - `pub enum Sid { UitgeverEnSerienummer { uitgever_der: Vec<u8>, serienummer: Vec<u8> }, SleutelId(Vec<u8>) }`
  - `pub struct Attribuut { pub oid: ObjectIdentifier, pub waarden: Vec<Vec<u8>> }` — elke waarde als volledige DER-TLV.
  - `pub struct Ondertekenaar { pub sid: Sid, pub digestalgoritme: AlgId, pub ondertekende_attributen_der: Option<Vec<u8>>, pub ondertekende_attributen: Vec<Attribuut>, pub handtekeningalgoritme: AlgId, pub handtekening: Vec<u8>, pub onondertekende_attributen: Vec<Attribuut> }`
    - `pub fn message_digest(&self) -> Option<Vec<u8>>`
    - `pub fn onondertekend(&self, oid: ObjectIdentifier) -> Option<&[u8]>`
  - `pub struct SignedData { pub inhoudstype: ObjectIdentifier, pub inhoud: Option<Vec<u8>>, pub certificaten: Vec<Vec<u8>>, pub ondertekenaars: Vec<Ondertekenaar> }`
  - `pub struct Certificaat { pub der: Vec<u8>, pub tbs_der: Vec<u8>, pub uitgever_der: Vec<u8>, pub onderwerp_der: Vec<u8>, pub serienummer: Vec<u8>, pub spki_der: Vec<u8>, pub handtekeningalgoritme: AlgId, pub handtekening: Vec<u8>, pub x509: x509_cert::Certificate }` — `Debug, Clone`.
    - `pub fn sleutel_id(&self) -> Option<Vec<u8>>`
  - `pub fn oid_uit(t: &Tlv<'_>) -> Result<ObjectIdentifier, CmsFout>`
  - `pub fn alg_id(t: &Tlv<'_>) -> Result<AlgId, CmsFout>`
  - `pub fn lees_signed_data(bytes: &[u8]) -> Result<SignedData, CmsFout>`
  - `pub fn lees_certificaat(bytes: &[u8]) -> Option<Certificaat>`
  - `pub fn zoek_ondertekenaar<'a>(certificaten: &'a [Certificaat], sid: &Sid) -> Option<&'a Certificaat>`

Waarom niet de getypte `cms`-structuren: die sorteren SET OF bij decoderen (in het 5-handtekeningenbestand van het corpus staan de ondertekende attributen niet in DER-volgorde en klopt de handtekening alleen over de oorspronkelijke bytes) en weigeren de hele handtekening bij één afwijkend certificaat (`BadEncodedCMS.pdf`: niet-minimaal serienummer). Certificaten worden hier los en strikt gelezen; een onleesbaar certificaat valt weg.

- [ ] **Step 1: Module declareren**

Voeg in `open-pdf-studio/src-tauri/src/handtekening/mod.rs` toe, na `pub mod certificaat;`:

```rust
pub mod cms_lees;
```

- [ ] **Step 2: Tests schrijven (falen eerst)**

Maak `open-pdf-studio/src-tauri/src/handtekening/cms_lees.rs` met alleen de tests:

```rust
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
}
```

- [ ] **Step 3: Tests draaien, zien falen**

```bash
cd open-pdf-studio/src-tauri && CARGO_TARGET_DIR="$BUILDMAP" cargo test --lib handtekening::cms_lees 2>&1 | grep -E "^error\[" | head -3
```
Expected: `error[E0425]`/`error[E0412]`: `lees_signed_data`, `Sid` enz. bestaan nog niet.

- [ ] **Step 4: Implementatie**

Zet boven het testblok in `cms_lees.rs`:

```rust
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
    /// Inhoud van het `messageDigest`-attribuut.
    pub fn message_digest(&self) -> Option<Vec<u8>> {
        let attribuut = self.ondertekende_attributen.iter().find(|a| a.oid == ID_MESSAGE_DIGEST)?;
        let (t, _) = lees_tlv(attribuut.waarden.first()?).ok()?;
        (t.tag == 0x04).then(|| t.inhoud.to_vec())
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
    Some(Certificaat {
        der: bytes.to_vec(),
        tbs_der: tbs.geheel.to_vec(),
        serienummer: t.get(start)?.inhoud.to_vec(),
        uitgever_der: t.get(start + 2)?.geheel.to_vec(),
        onderwerp_der: t.get(start + 4)?.geheel.to_vec(),
        spki_der: t.get(start + 5)?.geheel.to_vec(),
        handtekeningalgoritme: alg_id(alg).ok()?,
        handtekening: handtekening.to_vec(),
        x509,
    })
}

fn zonder_voorloopnullen(b: &[u8]) -> &[u8] {
    let n = b.iter().take_while(|&&x| x == 0).count();
    &b[n.min(b.len().saturating_sub(1))..]
}

/// Het certificaat dat bij de SignerIdentifier hoort.
pub fn zoek_ondertekenaar<'a>(certificaten: &'a [Certificaat], sid: &Sid) -> Option<&'a Certificaat> {
    certificaten.iter().find(|c| match sid {
        Sid::UitgeverEnSerienummer { uitgever_der, serienummer } => {
            c.uitgever_der == *uitgever_der
                && zonder_voorloopnullen(&c.serienummer) == zonder_voorloopnullen(serienummer)
        }
        Sid::SleutelId(id) => c.sleutel_id().as_deref() == Some(id.as_slice()),
    })
}
```

- [ ] **Step 5: Tests draaien**

```bash
cd open-pdf-studio/src-tauri && CARGO_TARGET_DIR="$BUILDMAP" cargo test --lib handtekening::cms_lees 2>&1 | grep -E "test result|panicked"
```
Expected: `test result: ok. 7 passed; 0 failed`.

- [ ] **Step 6: Rest groen, dan commit**

```bash
cd open-pdf-studio/src-tauri && CARGO_TARGET_DIR="$BUILDMAP" cargo test --lib handtekening 2>&1 | grep -E "^test result"
cd .. && npm run test:unit 2>&1 | grep -E "^(#|ℹ) (pass|fail)" && npx vite build > /dev/null 2>&1; echo "vite exit $?"
cd .. && git add open-pdf-studio/src-tauri/src/handtekening/mod.rs open-pdf-studio/src-tauri/src/handtekening/cms_lees.rs
git commit -m "feat(handtekening): CMS SignedData en certificaten verdraagzaam uitlezen"
```
Expected: `0 failed`; `fail 0`; `vite exit 0`.

---

### Task 6: `algoritme.rs` — hashes en handtekeningwaarden

**Files:**
- Create: `open-pdf-studio/src-tauri/src/handtekening/algoritme.rs`
- Modify: `open-pdf-studio/src-tauri/src/handtekening/mod.rs`
- Modify: `open-pdf-studio/src-tauri/Cargo.toml`

**Interfaces:**
- Consumes: `crate::handtekening::ber::{kinderen, lees_tlv, BerFout}` (Task 4); `crate::handtekening::cms_lees::{alg_id, oid_uit, AlgId, CmsFout}` en voor tests `lees_signed_data`, `lees_certificaat`, `zoek_ondertekenaar`, `Certificaat`, `SignedData` (Task 5); fixtures (Task 3).
- Produces (in `crate::handtekening::algoritme`):
  - `pub enum Hashalg { Sha1, Sha256, Sha384, Sha512 }` — `Debug, Clone, Copy, PartialEq, Eq`.
    - `pub fn uit_oid(oid: ObjectIdentifier) -> Option<Hashalg>`
    - `pub fn hash(self, delen: &[&[u8]]) -> Vec<u8>` — hash over de aaneenschakeling van de delen, zonder te kopiëren.
  - `pub enum WaardeFout { NietOndersteund(String), KloptNiet }` — `Debug, Clone, PartialEq, Eq`.
  - `pub fn controleer_handtekening(spki_der: &[u8], alg: &AlgId, standaard_hash: Option<Hashalg>, delen: &[&[u8]], handtekening: &[u8]) -> Result<(), WaardeFout>` — `standaard_hash` is het digestalgoritme van de CMS, voor algoritme-OID's zonder eigen hash (`rsaEncryption`, `id-ecPublicKey`); `None` bij certificaathandtekeningen.

Ondersteund (gemeten in het corpus, plus ECDSA voor de ketens uit het rootarchief): SHA-1/-256/-384/-512; RSA PKCS#1 v1.5 via `rsaEncryption` en `sha{1,256,384,512}WithRSAEncryption`; RSASSA-PSS met MGF1 over dezelfde hash; ECDSA P-256 en P-384 via `ecdsa-with-SHA{1,256,384,512}` of `id-ecPublicKey`. Al het andere geeft `NietOndersteund`, ook een sleuteltype dat niet bij het algoritme past.

- [ ] **Step 1: Dependencies**

Vervang in `open-pdf-studio/src-tauri/Cargo.toml` de regel `sha2 = "0.10"` door:

```toml
sha2 = { version = "0.10", features = ["oid"] }
```

en de regel `sha1 = "0.10"` door:

```toml
sha1 = { version = "0.10", features = ["oid"] }
```

Voeg direct onder `rsa = "0.9"` toe:

```toml
# ECDSA-verificatie (handtekeningen en certificaatketens, spec §7.1). 0.13 is de
# der 0.7-lijn; "pkcs8" levert ook Signature::from_der.
p256 = { version = "0.13", default-features = false, features = ["ecdsa", "pkcs8"] }
p384 = { version = "0.13", default-features = false, features = ["ecdsa", "pkcs8"] }
```

`oid` is nodig voor `rsa::Pkcs1v15Sign::new::<D>()` (de DigestInfo-prefix); zonder die prefixcontrole zou een handtekening met een misvormde DigestInfo (`malformed-rsa-digestinfo.pdf`) ten onrechte kloppen.

- [ ] **Step 2: Module declareren**

Voeg in `open-pdf-studio/src-tauri/src/handtekening/mod.rs` bovenaan de modulelijst toe:

```rust
pub mod algoritme;
```

- [ ] **Step 3: Tests schrijven (falen eerst)**

Maak `open-pdf-studio/src-tauri/src/handtekening/algoritme.rs` met alleen de tests:

```rust
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
            controleer_handtekening(&cert.spki_der, &zonder_parameters, Some(Hashalg::Sha256), &[attrs], &o.handtekening),
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
}
```

- [ ] **Step 4: Tests draaien, zien falen**

```bash
cd open-pdf-studio/src-tauri && CARGO_TARGET_DIR="$BUILDMAP" cargo test --lib handtekening::algoritme 2>&1 | grep -E "^error\[" | head -3
```
Expected: `error[E0433]`/`error[E0425]`: `Hashalg`, `controleer_handtekening`, `pss_parameters` bestaan nog niet.

- [ ] **Step 5: Implementatie**

Zet boven het testblok in `algoritme.rs`:

```rust
//! Hash- en handtekeningalgoritmen voor het verifiëren.
//!
//! SHA-1/-256/-384/-512; RSA PKCS#1 v1.5 (`rsaEncryption` en
//! `sha*WithRSAEncryption`), RSASSA-PSS met MGF1 over dezelfde hash, en ECDSA op
//! P-256 en P-384. SHA-1 blijft toegestaan: oude handtekeningen en ketens
//! gebruiken het nog. RSA-sleutels groter dan 4096 bits weigert `rsa` 0.9.

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

/// Controleert `handtekening` over de delen met de publieke sleutel uit `spki_der`.
pub fn controleer_handtekening(
    spki_der: &[u8],
    alg: &AlgId,
    standaard_hash: Option<Hashalg>,
    delen: &[&[u8]],
    handtekening: &[u8],
) -> Result<(), WaardeFout> {
    let o = alg.oid;
    let standaard = || standaard_hash.ok_or_else(|| niet(format!("{o} zonder digestalgoritme")));
    if o == RSA_ENCRYPTION {
        rsa_pkcs1(spki_der, standaard()?, delen, handtekening)
    } else if o == SHA1_RSA {
        rsa_pkcs1(spki_der, Hashalg::Sha1, delen, handtekening)
    } else if o == SHA256_RSA {
        rsa_pkcs1(spki_der, Hashalg::Sha256, delen, handtekening)
    } else if o == SHA384_RSA {
        rsa_pkcs1(spki_der, Hashalg::Sha384, delen, handtekening)
    } else if o == SHA512_RSA {
        rsa_pkcs1(spki_der, Hashalg::Sha512, delen, handtekening)
    } else if o == RSASSA_PSS {
        let (hash, zout) = pss_parameters(alg.parameters.as_deref())?;
        rsa_pss(spki_der, hash, zout, delen, handtekening)
    } else if o == ECDSA_SHA1 {
        ecdsa(spki_der, Hashalg::Sha1, delen, handtekening)
    } else if o == ECDSA_SHA256 {
        ecdsa(spki_der, Hashalg::Sha256, delen, handtekening)
    } else if o == ECDSA_SHA384 {
        ecdsa(spki_der, Hashalg::Sha384, delen, handtekening)
    } else if o == ECDSA_SHA512 {
        ecdsa(spki_der, Hashalg::Sha512, delen, handtekening)
    } else if o == EC_PUBLIC_KEY {
        ecdsa(spki_der, standaard()?, delen, handtekening)
    } else {
        Err(niet(format!("handtekeningalgoritme {o}")))
    }
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

fn rsa_sleutel(spki_der: &[u8]) -> Result<rsa::RsaPublicKey, WaardeFout> {
    use rsa::pkcs1::DecodeRsaPublicKey;
    let (alg, sleutel) = spki_delen(spki_der)?;
    if alg.oid != RSA_ENCRYPTION && alg.oid != RSASSA_PSS {
        return Err(niet("sleutel is geen RSA-sleutel"));
    }
    rsa::RsaPublicKey::from_pkcs1_der(&sleutel).map_err(|e| niet(format!("RSA-sleutel: {e}")))
}

fn rsa_pkcs1(spki_der: &[u8], hash: Hashalg, delen: &[&[u8]], handtekening: &[u8]) -> Result<(), WaardeFout> {
    use rsa::Pkcs1v15Sign;
    let sleutel = rsa_sleutel(spki_der)?;
    let schema = match hash {
        Hashalg::Sha1 => Pkcs1v15Sign::new::<sha1::Sha1>(),
        Hashalg::Sha256 => Pkcs1v15Sign::new::<sha2::Sha256>(),
        Hashalg::Sha384 => Pkcs1v15Sign::new::<sha2::Sha384>(),
        Hashalg::Sha512 => Pkcs1v15Sign::new::<sha2::Sha512>(),
    };
    sleutel.verify(schema, &hash.hash(delen), handtekening).map_err(|_| WaardeFout::KloptNiet)
}

fn rsa_pss(spki_der: &[u8], hash: Hashalg, zout: usize, delen: &[&[u8]], handtekening: &[u8]) -> Result<(), WaardeFout> {
    use rsa::Pss;
    let sleutel = rsa_sleutel(spki_der)?;
    let schema = match hash {
        Hashalg::Sha1 => Pss::new_with_salt::<sha1::Sha1>(zout),
        Hashalg::Sha256 => Pss::new_with_salt::<sha2::Sha256>(zout),
        Hashalg::Sha384 => Pss::new_with_salt::<sha2::Sha384>(zout),
        Hashalg::Sha512 => Pss::new_with_salt::<sha2::Sha512>(zout),
    };
    sleutel.verify(schema, &hash.hash(delen), handtekening).map_err(|_| WaardeFout::KloptNiet)
}

fn klein_getal(b: &[u8]) -> Option<usize> {
    if b.is_empty() || b.len() > 4 {
        return None;
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
        let waarde = p256::ecdsa::Signature::from_der(handtekening).map_err(|_| WaardeFout::KloptNiet)?;
        sleutel.verify_prehash(&digest, &waarde).map_err(|_| WaardeFout::KloptNiet)
    } else if curve == P384 {
        if hash == Hashalg::Sha1 {
            return Err(niet("SHA-1 is te kort voor P-384"));
        }
        let sleutel = p384::ecdsa::VerifyingKey::from_sec1_bytes(&punt).map_err(|_| niet("P-384-sleutel onleesbaar"))?;
        let waarde = p384::ecdsa::Signature::from_der(handtekening).map_err(|_| WaardeFout::KloptNiet)?;
        sleutel.verify_prehash(&digest, &waarde).map_err(|_| WaardeFout::KloptNiet)
    } else {
        Err(niet(format!("curve {curve}")))
    }
}
```

- [ ] **Step 6: Tests draaien**

```bash
cd open-pdf-studio/src-tauri && CARGO_TARGET_DIR="$BUILDMAP" cargo test --lib handtekening::algoritme 2>&1 | grep -E "test result|panicked"
```
Expected: `test result: ok. 8 passed; 0 failed`.

- [ ] **Step 7: Geen tweede der-lijn**

```bash
cd "$(git rev-parse --show-toplevel)"
for c in der x509-cert const-oid spki pkcs8 sha2 ecdsa elliptic-curve p256 p384; do
  printf "%-15s " "$c"; grep -A1 -x "name = \"$c\"" Cargo.lock | grep version | tr -d '\r' | tr '\n' ' '; echo
done
```
Expected: `der` toont `0.7.x` (en eventueel `0.8.x` van een andere, al bestaande afhankelijkheid); `x509-cert 0.2.x` staat erbij (een `0.3.0` mag alleen al vóór deze taak in de lock gestaan hebben); `ecdsa 0.16.x`, `elliptic-curve 0.13.x`, `p256 0.13.x`, `p384 0.13.x`, `sha2 0.10.x`. Geen `ecdsa 0.17`, `p256 0.14` of `sha2 0.11`.

- [ ] **Step 8: Rest groen, dan commit**

```bash
cd open-pdf-studio/src-tauri && CARGO_TARGET_DIR="$BUILDMAP" cargo test --lib handtekening 2>&1 | grep -E "^test result"
cd .. && npm run test:unit 2>&1 | grep -E "^(#|ℹ) (pass|fail)" && npx vite build > /dev/null 2>&1; echo "vite exit $?"
cd .. && git add Cargo.lock open-pdf-studio/src-tauri/Cargo.toml open-pdf-studio/src-tauri/src/handtekening/mod.rs open-pdf-studio/src-tauri/src/handtekening/algoritme.rs
git commit -m "feat(handtekening): hash- en handtekeningcontrole voor RSA, RSASSA-PSS en ECDSA"
```
Expected: `0 failed`; `fail 0`; `vite exit 0`.

---

### Task 7: `pdf_lezen.rs` — handtekeningvelden uit de PDF

**Files:**
- Create: `open-pdf-studio/src-tauri/src/handtekening/pdf_lezen.rs`
- Modify: `open-pdf-studio/src-tauri/src/handtekening/mod.rs`

**Interfaces:**
- Consumes: `crate::handtekening::ber::unix_tijd` (Task 4); `lopdf 0.34` (staat al in `Cargo.toml`); corpus `testdata/handtekeningen/pades/` (optioneel).
- Produces (in `crate::handtekening::pdf_lezen`):
  - `pub struct SigWoordenboek { pub subfilter: Option<String>, pub soort_type: Option<String>, pub bytebereik: Vec<i64>, pub contents: Vec<u8>, pub naam: Option<String>, pub reden: Option<String>, pub plaats: Option<String>, pub contact: Option<String>, pub tijd_unix: Option<i64> }` — `Debug, Clone, PartialEq, Eq`.
  - `pub struct HandtekeningVeld { pub veldnaam: Option<String>, pub waarde: Option<SigWoordenboek> }` — `waarde == None` is een leeg veld.
  - `pub enum PdfLeesFout { Onleesbaar(String) }`
  - `pub fn lees_handtekeningvelden(bytes: &[u8]) -> Result<Vec<HandtekeningVeld>, PdfLeesFout>` — in AcroForm-volgorde; losse handtekeningwoordenboeken alleen als er geen enkel veld is.
  - `pub fn pdf_datum_unix(tekst: &str) -> Option<i64>` — PDF-datum (`D:YYYYMMDDHHmmSSOHH'mm'`) naar Unix-tijd.

Gedrag, gemeten op het corpus:
- `lopdf` weigert `pades-5-signatures-and-1-document-timestamp.pdf` (laatste trailer `/Prev 0`) en `malformed-pades.pdf` (kopregel beschadigd). Dan wordt de xref hersteld door objectkoppen `N G obj` te scannen; later in het bestand wint. Dat werkt omdat een handtekeningwoordenboek nooit in een objectstroom staat (het bytebereik verwijst naar bestandsposities).
- Ook als `lopdf` laadt maar een `/V`-verwijzing niet oplost, wordt herstel geprobeerd.
- `/Contents` wordt nooit ontsleuteld (ISO 32000-1 §7.6.1). `/Name`, `/Reason`, `/Location`, `/ContactInfo`, `/M` en `/T` in een versleuteld document wel (leeg gebruikerswachtwoord, RC4 zoals `lopdf` ondersteunt); lukt dat niet, dan blijven ze `None`.
- `lopdf` draait binnen `catch_unwind`.

- [ ] **Step 1: Module declareren**

Voeg in `open-pdf-studio/src-tauri/src/handtekening/mod.rs` toe, vóór `pub mod pkcs12;`:

```rust
pub mod pdf_lezen;
```

- [ ] **Step 2: Tests schrijven (falen eerst)**

Maak `open-pdf-studio/src-tauri/src/handtekening/pdf_lezen.rs` met alleen de tests:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    /// Minimale PDF met klassieke xref-tabel; objecten krijgen nummer 1, 2, 3, …
    fn bouw_pdf(objecten: &[&str], trailer_extra: &str) -> Vec<u8> {
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
            format!(
                "trailer\n<< /Size {} /Root 1 0 R{} >>\nstartxref\n{}\n%%EOF\n",
                objecten.len() + 1,
                trailer_extra,
                xref
            )
            .as_bytes(),
        );
        pdf
    }

    const SIG: &str = "<< /Type /Sig /SubFilter /ETSI.CAdES.detached /ByteRange [0 10 20 30] /Contents <3082000A> /M (D:20180901162846+02'00') /Reason (Proef) /Name (Jan) /Location (Delft) >>";

    fn standaard(trailer_extra: &str) -> Vec<u8> {
        bouw_pdf(
            &[
                "<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [4 0 R 6 0 R] /SigFlags 3 >> >>",
                "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
                "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Annots [4 0 R 6 0 R] >>",
                "<< /FT /Sig /T (Handtekening1) /Type /Annot /Subtype /Widget /Rect [0 0 0 0] /P 3 0 R /V 5 0 R >>",
                SIG,
                "<< /FT /Sig /T (Leeg) /Type /Annot /Subtype /Widget /Rect [0 0 0 0] /P 3 0 R >>",
            ],
            trailer_extra,
        )
    }

    fn verwacht_standaard() -> Vec<HandtekeningVeld> {
        vec![
            HandtekeningVeld {
                veldnaam: Some("Handtekening1".into()),
                waarde: Some(SigWoordenboek {
                    subfilter: Some("ETSI.CAdES.detached".into()),
                    soort_type: Some("Sig".into()),
                    bytebereik: vec![0, 10, 20, 30],
                    contents: vec![0x30, 0x82, 0x00, 0x0A],
                    naam: Some("Jan".into()),
                    reden: Some("Proef".into()),
                    plaats: Some("Delft".into()),
                    contact: None,
                    tijd_unix: Some(1_535_812_126),
                }),
            },
            HandtekeningVeld { veldnaam: Some("Leeg".into()), waarde: None },
        ]
    }

    #[test]
    fn velden_met_waarde_en_leeg_veld() {
        assert_eq!(lees_handtekeningvelden(&standaard("")).unwrap(), verwacht_standaard());
    }

    #[test]
    fn geerfd_veldtype_en_samengestelde_naam() {
        let pdf = bouw_pdf(
            &[
                "<< /Type /Catalog /AcroForm << /Fields [2 0 R] >> >>",
                "<< /FT /Sig /T (Groep) /Kids [3 0 R] >>",
                "<< /T (Kind) /Parent 2 0 R /V << /Type /Sig /SubFilter /adbe.pkcs7.detached /ByteRange [0 1 2 3] /Contents <00> >> >>",
            ],
            "",
        );
        let velden = lees_handtekeningvelden(&pdf).unwrap();
        assert_eq!(velden.len(), 1);
        assert_eq!(velden[0].veldnaam.as_deref(), Some("Groep.Kind"));
        let w = velden[0].waarde.as_ref().unwrap();
        assert_eq!(w.subfilter.as_deref(), Some("adbe.pkcs7.detached"));
        assert_eq!(w.bytebereik, vec![0, 1, 2, 3]);
        assert_eq!(w.contents, vec![0]);
    }

    #[test]
    fn widgets_als_kinderen_horen_bij_het_veld() {
        let pdf = bouw_pdf(
            &[
                "<< /Type /Catalog /AcroForm << /Fields [2 0 R] >> >>",
                "<< /FT /Sig /T (Veld) /V 3 0 R /Kids [4 0 R] >>",
                SIG,
                "<< /Type /Annot /Subtype /Widget /Parent 2 0 R /Rect [0 0 0 0] >>",
            ],
            "",
        );
        let velden = lees_handtekeningvelden(&pdf).unwrap();
        assert_eq!(velden.len(), 1);
        assert_eq!(velden[0].veldnaam.as_deref(), Some("Veld"));
        assert_eq!(velden[0].waarde.as_ref().unwrap().reden.as_deref(), Some("Proef"));
    }

    #[test]
    fn herstel_bij_kapotte_prev_en_kopregel() {
        assert_eq!(lees_handtekeningvelden(&standaard(" /Prev 0")).unwrap(), verwacht_standaard());
        let mut kop = standaard("");
        kop[..5].copy_from_slice(b"#XYZ-");
        assert_eq!(lees_handtekeningvelden(&kop).unwrap(), verwacht_standaard());
    }

    #[test]
    fn zonder_velden_losse_woordenboeken_en_rommel() {
        let pdf = bouw_pdf(&["<< /Type /Catalog >>", SIG], "");
        let velden = lees_handtekeningvelden(&pdf).unwrap();
        assert_eq!(velden.len(), 1);
        assert_eq!(velden[0].veldnaam, None);
        assert_eq!(velden[0].waarde.as_ref().unwrap().reden.as_deref(), Some("Proef"));
        let zonder = bouw_pdf(&["<< /Type /Catalog >>"], "");
        assert_eq!(lees_handtekeningvelden(&zonder).unwrap(), vec![]);
        assert!(matches!(lees_handtekeningvelden(b"geen pdf"), Err(PdfLeesFout::Onleesbaar(_))));
    }

    #[test]
    fn pdf_datum_varianten() {
        assert_eq!(pdf_datum_unix("D:20180901162846+02'00'"), Some(1_535_812_126));
        assert_eq!(pdf_datum_unix("D:20180901142846Z"), Some(1_535_812_126));
        assert_eq!(pdf_datum_unix("D:20180901142846"), Some(1_535_812_126));
        assert_eq!(pdf_datum_unix("D:20180901102846-04'00'"), Some(1_535_812_126));
        assert_eq!(pdf_datum_unix("20180901142846Z"), Some(1_535_812_126));
        assert_eq!(pdf_datum_unix("D:2018"), Some(1_514_764_800));
        assert_eq!(pdf_datum_unix("rommel"), None);
        assert_eq!(pdf_datum_unix("D:2018É"), Some(1_514_764_800));
    }

    #[test]
    fn afgekapte_pdf_geeft_geen_paniek() {
        let pdf = standaard("");
        for n in (0..pdf.len()).step_by(7) {
            let _ = lees_handtekeningvelden(&pdf[..n]);
        }
    }

    #[test]
    fn corpus_versleuteld_en_hersteld() {
        let map = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../testdata/handtekeningen/pades");
        if !map.is_dir() {
            eprintln!("corpus ontbreekt ({}); test overgeslagen", map.display());
            return;
        }
        let lees = |naam: &str| lees_handtekeningvelden(&std::fs::read(map.join(naam)).unwrap()).unwrap();
        let versleuteld = lees("encrypted.pdf");
        assert_eq!(versleuteld.len(), 1);
        let w = versleuteld[0].waarde.as_ref().unwrap();
        assert_eq!(w.subfilter.as_deref(), Some("adbe.pkcs7.detached"));
        assert_eq!(w.reden.as_deref(), Some("Výstup z informačního systému veřejné správy"));
        assert_eq!(w.plaats.as_deref(), Some("ČÚZK, Praha"));
        assert_eq!(w.contents.first(), Some(&0x30));
        let vijf = lees("pades-5-signatures-and-1-document-timestamp.pdf");
        assert_eq!(vijf.len(), 6);
        assert!(vijf.iter().all(|v| v.waarde.as_ref().is_some_and(|w| w.bytebereik.len() == 4)));
        let kapot = lees("malformed-pades.pdf");
        assert_eq!(kapot.len(), 1);
        assert_eq!(kapot[0].waarde.as_ref().unwrap().bytebereik, vec![0, 18801, 37747, 113379]);
        let aanvulling = lees("pades-signed-annot-added.pdf");
        assert_eq!(aanvulling.iter().filter(|v| v.waarde.is_none()).count(), 1);
    }
}
```

- [ ] **Step 3: Tests draaien, zien falen**

```bash
cd open-pdf-studio/src-tauri && CARGO_TARGET_DIR="$BUILDMAP" cargo test --lib handtekening::pdf_lezen 2>&1 | grep -E "^error\[" | head -3
```
Expected: `error[E0425]`/`error[E0422]`: `lees_handtekeningvelden`, `SigWoordenboek` enz. bestaan nog niet.

- [ ] **Step 4: Implementatie**

Zet boven het testblok in `pdf_lezen.rs`:

```rust
//! Handtekeningvelden uit een PDF lezen (ISO 32000-1 §12.7.4.5 en §12.8.1).
//!
//! Via `lopdf`. Weigert `lopdf` het bestand, of lost een `/V`-verwijzing niet
//! op, dan bouwen we de xref opnieuw op door objectkoppen `N G obj` te zoeken;
//! later in het bestand wint. Dat kan omdat een handtekeningwoordenboek nooit in
//! een objectstroom staat: het bytebereik verwijst naar bestandsposities.
//!
//! `/Contents` wordt nooit ontsleuteld (ISO 32000-1 §7.6.1); tekstvelden in een
//! versleuteld document wel, met het lege gebruikerswachtwoord.

use std::collections::HashSet;
use std::panic::{catch_unwind, AssertUnwindSafe};

use lopdf::xref::{Xref, XrefEntry, XrefType};
use lopdf::{Dictionary, Document, Object, ObjectId};

use super::ber::unix_tijd;

const MAX_VELDDIEPTE: usize = 32;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SigWoordenboek {
    pub subfilter: Option<String>,
    /// `/Type`: `Sig` of `DocTimeStamp` (mag ontbreken).
    pub soort_type: Option<String>,
    /// Ruwe getallen uit `/ByteRange`; een niet-geheel getal wordt -1.
    pub bytebereik: Vec<i64>,
    /// Bytes van `/Contents` (hex-gedecodeerd, nooit ontsleuteld).
    pub contents: Vec<u8>,
    pub naam: Option<String>,
    pub reden: Option<String>,
    pub plaats: Option<String>,
    pub contact: Option<String>,
    /// `/M`, door de ondertekenaar opgegeven; geen bewijs.
    pub tijd_unix: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HandtekeningVeld {
    pub veldnaam: Option<String>,
    /// `None`: leeg handtekeningveld.
    pub waarde: Option<SigWoordenboek>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PdfLeesFout {
    Onleesbaar(String),
}

enum Tekstsleutel {
    Geen,
    Sleutel(Vec<u8>),
    Onbekend,
}

struct Verzameling {
    uit: Vec<HandtekeningVeld>,
    bezocht: HashSet<ObjectId>,
    volledig: bool,
}

fn veilig<T>(f: impl FnOnce() -> T) -> Option<T> {
    catch_unwind(AssertUnwindSafe(f)).ok()
}

/// Alle handtekeningvelden, in de volgorde van het AcroForm.
pub fn lees_handtekeningvelden(bytes: &[u8]) -> Result<Vec<HandtekeningVeld>, PdfLeesFout> {
    let gewoon = veilig(|| Document::load_mem(bytes)).and_then(Result::ok).filter(|d| d.catalog().is_ok());
    let mut onvolledig = None;
    if let Some(doc) = gewoon {
        match veilig(|| verzamel(&doc)) {
            Some((velden, true)) => return Ok(velden),
            Some((velden, false)) => onvolledig = Some(velden),
            None => {}
        }
    }
    if let Some(Some(doc)) = veilig(|| herstel(bytes)) {
        if let Some((velden, _)) = veilig(|| verzamel(&doc)) {
            return Ok(velden);
        }
    }
    onvolledig.ok_or_else(|| PdfLeesFout::Onleesbaar("geen PDF-structuur gevonden".to_string()))
}

fn verzamel(doc: &Document) -> (Vec<HandtekeningVeld>, bool) {
    let sleutel = tekstsleutel(doc);
    let mut staat = Verzameling { uit: Vec::new(), bezocht: HashSet::new(), volledig: true };
    if let Some(velden) = veldenlijst(doc) {
        for v in velden {
            loop_veld(doc, &sleutel, v, None, None, 0, &mut staat);
        }
    }
    if staat.uit.is_empty() {
        for (&id, obj) in &doc.objects {
            if let Ok(d) = obj.as_dict() {
                if d.has(b"ByteRange") && d.has(b"Contents") {
                    let waarde = sig_woordenboek(doc, &sleutel, d, Some(id));
                    staat.uit.push(HandtekeningVeld { veldnaam: None, waarde: Some(waarde) });
                }
            }
        }
    }
    (staat.uit, staat.volledig)
}

fn veldenlijst(doc: &Document) -> Option<&Vec<Object>> {
    let acroform = doc.catalog().ok()?.get(b"AcroForm").ok()?;
    let (_, acroform) = doc.dereference(acroform).ok()?;
    let velden = acroform.as_dict().ok()?.get(b"Fields").ok()?;
    doc.dereference(velden).ok()?.1.as_array().ok()
}

fn loop_veld<'a>(
    doc: &'a Document,
    sleutel: &Tekstsleutel,
    obj: &'a Object,
    ouder_naam: Option<&str>,
    ouder_ft: Option<&'a [u8]>,
    diepte: usize,
    staat: &mut Verzameling,
) {
    if diepte > MAX_VELDDIEPTE {
        return;
    }
    let Ok((id, obj)) = doc.dereference(obj) else {
        staat.volledig = false;
        return;
    };
    if let Some(id) = id {
        if !staat.bezocht.insert(id) {
            return;
        }
    }
    let Ok(d) = obj.as_dict() else { return };
    let deel = d.get(b"T").ok().and_then(|t| tekst(sleutel, t, id));
    let naam = match (ouder_naam, deel) {
        (Some(o), Some(t)) => Some(format!("{o}.{t}")),
        (None, Some(t)) => Some(t),
        (o, None) => o.map(str::to_string),
    };
    let ft = d.get(b"FT").ok().and_then(|f| f.as_name().ok()).or(ouder_ft);
    if let Ok((_, kids)) = d.get(b"Kids").and_then(|k| doc.dereference(k)) {
        if let Ok(kids) = kids.as_array() {
            let veldkinderen = kids.iter().any(|k| {
                doc.dereference(k).ok().and_then(|(_, k)| k.as_dict().ok()).is_some_and(|k| k.has(b"T"))
            });
            if veldkinderen {
                for k in kids {
                    loop_veld(doc, sleutel, k, naam.as_deref(), ft, diepte + 1, staat);
                }
                return;
            }
        }
    }
    if ft != Some(b"Sig".as_slice()) {
        return;
    }
    let waarde = match d.get(b"V") {
        Err(_) => None,
        Ok(v) => match doc.dereference(v) {
            Ok((vid, Object::Dictionary(vd))) => Some(sig_woordenboek(doc, sleutel, vd, vid.or(id))),
            Ok(_) => None,
            Err(_) => {
                staat.volledig = false;
                None
            }
        },
    };
    staat.uit.push(HandtekeningVeld { veldnaam: naam, waarde });
}

fn sig_woordenboek(doc: &Document, sleutel: &Tekstsleutel, d: &Dictionary, bron: Option<ObjectId>) -> SigWoordenboek {
    let naam = |k: &[u8]| d.get(k).ok().and_then(|o| o.as_name().ok()).map(|n| String::from_utf8_lossy(n).into_owned());
    let tekstveld = |k: &[u8]| d.get(k).ok().and_then(|o| tekst(sleutel, o, bron));
    let bytebereik = d
        .get(b"ByteRange")
        .ok()
        .and_then(|o| doc.dereference(o).ok())
        .and_then(|(_, o)| o.as_array().ok())
        .map(|a| a.iter().map(|x| x.as_i64().unwrap_or(-1)).collect())
        .unwrap_or_default();
    let contents = d.get(b"Contents").ok().and_then(|o| o.as_str().ok()).map(<[u8]>::to_vec).unwrap_or_default();
    SigWoordenboek {
        subfilter: naam(b"SubFilter"),
        soort_type: naam(b"Type"),
        bytebereik,
        contents,
        naam: tekstveld(b"Name"),
        reden: tekstveld(b"Reason"),
        plaats: tekstveld(b"Location"),
        contact: tekstveld(b"ContactInfo"),
        tijd_unix: tekstveld(b"M").and_then(|m| pdf_datum_unix(&m)),
    }
}

fn tekstsleutel(doc: &Document) -> Tekstsleutel {
    if doc.trailer.get(b"Encrypt").is_err() {
        return Tekstsleutel::Geen;
    }
    match lopdf::encryption::get_encryption_key(doc, "", true) {
        Ok(k) => Tekstsleutel::Sleutel(k),
        Err(_) => Tekstsleutel::Onbekend,
    }
}

fn tekst(sleutel: &Tekstsleutel, obj: &Object, bron: Option<ObjectId>) -> Option<String> {
    let ruw = obj.as_str().ok()?;
    let bytes = match (sleutel, bron) {
        (Tekstsleutel::Geen, _) => ruw.to_vec(),
        (Tekstsleutel::Sleutel(k), Some(id)) => lopdf::encryption::decrypt_object(k, id, obj).ok()?,
        _ => return None,
    };
    lopdf::decode_text_string(&Object::String(bytes, lopdf::StringFormat::Literal)).ok()
}

fn is_wit(b: u8) -> bool {
    matches!(b, b' ' | b'\n' | b'\r' | b'\t' | b'\x0c' | b'\0')
}

/// Posities van alle objectkoppen `N G obj`: (nummer, generatie, begin van N).
fn objectkoppen(bytes: &[u8]) -> Vec<(u32, u16, usize)> {
    let mut uit = Vec::new();
    for (p, w) in bytes.windows(3).enumerate() {
        if w == b"obj" && bytes.get(p + 3).map_or(true, |b| !b.is_ascii_alphanumeric()) {
            if let Some(kop) = kop_voor(bytes, p) {
                uit.push(kop);
            }
        }
    }
    uit
}

fn kop_voor(bytes: &[u8], obj: usize) -> Option<(u32, u16, usize)> {
    let terug_zolang = |mut i: usize, f: fn(u8) -> bool| {
        while i > 0 && bytes.get(i - 1).is_some_and(|&b| f(b)) {
            i -= 1;
        }
        i
    };
    let wit1 = terug_zolang(obj, is_wit);
    let gen_begin = terug_zolang(wit1, |b| b.is_ascii_digit());
    let wit2 = terug_zolang(gen_begin, is_wit);
    let num_begin = terug_zolang(wit2, |b| b.is_ascii_digit());
    if wit1 == obj || gen_begin == wit1 || wit2 == gen_begin || num_begin == wit2 {
        return None;
    }
    if num_begin > 0 && bytes.get(num_begin - 1).is_some_and(|b| b.is_ascii_alphanumeric()) {
        return None;
    }
    let generatie = std::str::from_utf8(bytes.get(gen_begin..wit1)?).ok()?.parse().ok()?;
    let nummer = std::str::from_utf8(bytes.get(num_begin..wit2)?).ok()?.parse().ok()?;
    Some((nummer, generatie, num_begin))
}

/// Laatste `sleutel N G R` in het bestand, zoals `/Root 1 0 R` in de trailer.
fn laatste_verwijzing(bytes: &[u8], sleutel: &[u8]) -> Option<(u32, u16)> {
    let mut p = bytes.len().checked_sub(sleutel.len())?;
    loop {
        if bytes.get(p..)?.starts_with(sleutel) {
            if let Some(v) = verwijzing_na(bytes.get(p + sleutel.len()..)?) {
                return Some(v);
            }
        }
        if p == 0 {
            return None;
        }
        p -= 1;
    }
}

fn verwijzing_na(b: &[u8]) -> Option<(u32, u16)> {
    let vooruit_zolang = |mut i: usize, f: fn(u8) -> bool| {
        while b.get(i).is_some_and(|&x| f(x)) {
            i += 1;
        }
        i
    };
    let n1 = vooruit_zolang(0, is_wit);
    let n2 = vooruit_zolang(n1, |x| x.is_ascii_digit());
    let g1 = vooruit_zolang(n2, is_wit);
    let g2 = vooruit_zolang(g1, |x| x.is_ascii_digit());
    let r = vooruit_zolang(g2, is_wit);
    if n2 == n1 || g1 == n2 || g2 == g1 || b.get(r) != Some(&b'R') {
        return None;
    }
    let nummer = std::str::from_utf8(b.get(n1..n2)?).ok()?.parse().ok()?;
    let generatie = std::str::from_utf8(b.get(g1..g2)?).ok()?.parse().ok()?;
    Some((nummer, generatie))
}

/// Document opbouwen uit gescande objectkoppen, zonder xref of trailer te vertrouwen.
fn herstel(bytes: &[u8]) -> Option<Document> {
    let mut xref = Xref::new(0, XrefType::CrossReferenceTable);
    for (nummer, generatie, begin) in objectkoppen(bytes) {
        let offset = u32::try_from(begin).ok()?;
        xref.insert(nummer, XrefEntry::Normal { offset, generation: generatie });
    }
    let root = laatste_verwijzing(bytes, b"/Root")?;
    xref.size = xref.max_id() + 1;
    let mut reader = lopdf::Reader { buffer: bytes, document: Document::new() };
    reader.document.reference_table = xref.clone();
    let mut doc = Document::new();
    for (&nummer, entry) in &xref.entries {
        if let XrefEntry::Normal { generation, .. } = *entry {
            if let Ok(obj) = reader.get_object((nummer, generation), &mut HashSet::new()) {
                doc.objects.insert((nummer, generation), obj);
            }
        }
    }
    doc.max_id = xref.max_id();
    doc.reference_table = xref;
    doc.trailer.set("Root", Object::Reference(root));
    if let Some(versleuteling) = laatste_verwijzing(bytes, b"/Encrypt") {
        doc.trailer.set("Encrypt", Object::Reference(versleuteling));
    }
    doc.catalog().ok()?;
    Some(doc)
}

/// PDF-datum (ISO 32000-1 §7.9.4) naar Unix-tijd. Ontbrekende delen krijgen hun
/// laagste waarde; zonder tijdzone geldt UTC.
pub fn pdf_datum_unix(tekst: &str) -> Option<i64> {
    let s = tekst.strip_prefix("D:").unwrap_or(tekst);
    let getal = |van: usize, lengte: usize| -> Option<u32> {
        s.get(van..van + lengte).filter(|d| d.bytes().all(|b| b.is_ascii_digit()))?.parse().ok()
    };
    let jaar = getal(0, 4)?;
    let maand = getal(4, 2).unwrap_or(1);
    let dag = getal(6, 2).unwrap_or(1);
    let uur = getal(8, 2).unwrap_or(0);
    let minuut = getal(10, 2).unwrap_or(0);
    let seconde = getal(12, 2).unwrap_or(0);
    let basis = unix_tijd(i64::from(jaar), maand, dag, uur, minuut, seconde)?;
    let rest = s.get(14..).unwrap_or("");
    let teken = match rest.as_bytes().first() {
        Some(b'+') => -1,
        Some(b'-') => 1,
        _ => return Some(basis),
    };
    let cijfers: String = rest.chars().skip(1).filter(char::is_ascii_digit).collect();
    let uren: i64 = cijfers.get(0..2)?.parse().ok()?;
    let minuten: i64 = cijfers.get(2..4).and_then(|m| m.parse().ok()).unwrap_or(0);
    Some(basis + teken * (uren * 3600 + minuten * 60))
}
```

- [ ] **Step 5: Tests draaien**

```bash
python scripts/haal-handtekening-testdata.py --controleer
cd open-pdf-studio/src-tauri && CARGO_TARGET_DIR="$BUILDMAP" cargo test --lib handtekening::pdf_lezen -- --nocapture 2>&1 | grep -E "test result|panicked|corpus ontbreekt"
```
Expected: `test result: ok. 8 passed; 0 failed`, zonder regel `corpus ontbreekt`. `lopdf` kan bij de kapotte proefbestanden foutregels loggen; dat is verwacht.

- [ ] **Step 6: Rest groen, dan commit**

```bash
cd open-pdf-studio/src-tauri && CARGO_TARGET_DIR="$BUILDMAP" cargo test --lib handtekening 2>&1 | grep -E "^test result"
cd .. && npm run test:unit 2>&1 | grep -E "^(#|ℹ) (pass|fail)" && npx vite build > /dev/null 2>&1; echo "vite exit $?"
cd .. && git add open-pdf-studio/src-tauri/src/handtekening/mod.rs open-pdf-studio/src-tauri/src/handtekening/pdf_lezen.rs
git commit -m "feat(handtekening): handtekeningvelden lezen, met xref-herstel en ontsleutelde tekstvelden"
```
Expected: `0 failed`; `fail 0`; `vite exit 0`.

---

### Task 8: `verifieer.rs` — integriteit van CAdES- en PKCS#7-handtekeningen

**Files:**
- Create: `open-pdf-studio/src-tauri/src/handtekening/verifieer.rs`
- Modify: `open-pdf-studio/src-tauri/src/handtekening/mod.rs`

**Interfaces:**
- Consumes: `algoritme::{controleer_handtekening, Hashalg, WaardeFout}` (Task 6); `cms_lees::{lees_certificaat, lees_signed_data, zoek_ondertekenaar, Certificaat, Ondertekenaar, SignedData, ID_SIGNATURE_TIME_STAMP_TOKEN}` (Task 5); `status::{Integriteit, OnleesbaarReden}` (Task 1); fixtures (Task 3).
- Produces (in `crate::handtekening::verifieer`):
  - `pub struct Ondertekening { pub integriteit: Integriteit, pub detail: Option<String>, pub certificaat: Option<Certificaat>, pub certificaten: Vec<Certificaat> }` — `Debug, Clone`.
  - `pub fn controleer_ondertekenaar(sd: &SignedData, o: &Ondertekenaar, inhoud: &[&[u8]]) -> Ondertekening` — ook gebruikt door `tijdstempel.rs` (Task 9).
  - `pub struct CmsUitkomst { pub integriteit: Integriteit, pub detail: Option<String>, pub certificaat: Option<Certificaat>, pub certificaten: Vec<Certificaat>, pub handtekeningwaarde: Vec<u8>, pub tijdstempeltoken: Option<Vec<u8>> }` — `Debug, Clone`.
  - `pub fn integriteit_cms(cms: &[u8], inhoud: &[&[u8]]) -> CmsUitkomst` — voor `ETSI.CAdES.detached` en `adbe.pkcs7.detached`; `inhoud` zijn de twee delen van het bytebereik.

Volgorde van de controles (spec §7.1; zo onderscheidt de code *gewijzigd* van *ongeldig*):
1. CMS niet leesbaar → *niet te controleren* (`CmsOnleesbaar`).
2. Digestalgoritme onbekend → *niet te controleren* (`AlgoritmeNietOndersteund`).
3. Met ondertekende attributen: `messageDigest` ontbreekt → `CmsOnleesbaar`; wijkt af van de hash over het bytebereik → *gewijzigd*.
4. Geen (strikt leesbaar) certificaat van de ondertekenaar → `GeenCertificaat`.
5. Handtekeningalgoritme of sleutel niet ondersteund → `AlgoritmeNietOndersteund`.
6. Handtekeningwaarde klopt → *intact*; klopt niet → *ongeldig* (de digest klopte). Zonder ondertekende attributen is dat niet te onderscheiden: dan *gewijzigd*, met toelichting.

Alleen de eerste SignerInfo telt; een PAdES-handtekening heeft er één.

- [ ] **Step 1: Module declareren**

Voeg in `open-pdf-studio/src-tauri/src/handtekening/mod.rs` toe, na `pub mod status;`:

```rust
pub mod verifieer;
```

- [ ] **Step 2: Tests schrijven (falen eerst)**

Maak `open-pdf-studio/src-tauri/src/handtekening/verifieer.rs` met alleen de tests:

```rust
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
        for naam in ["cms-rsa-pss.der", "cms-ec-p256-sha384.der", "cms-rsa-ber.der"] {
            assert_eq!(integriteit_cms(&fixture(naam), &[data.as_slice()]).integriteit, Integriteit::Intact, "{naam}");
        }
    }

    #[test]
    fn zonder_certificaat_niet_te_controleren() {
        let data = fixture("data.bin");
        let u = integriteit_cms(&fixture("cms-zonder-certificaat.der"), &[data.as_slice()]);
        assert_eq!(u.integriteit, niet(OnleesbaarReden::GeenCertificaat));
        assert!(u.detail.is_some());
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

    #[test]
    fn tijdstempeltoken_wordt_doorgegeven() {
        let token = fixture("tst-data.der");
        let o = crate::handtekening::cms_lees::Ondertekenaar {
            onondertekende_attributen: vec![crate::handtekening::cms_lees::Attribuut {
                oid: ID_SIGNATURE_TIME_STAMP_TOKEN,
                waarden: vec![token.clone()],
            }],
            ..lees_signed_data(&fixture("cms-rsa-sha256.der")).unwrap().ondertekenaars[0].clone()
        };
        assert_eq!(o.onondertekend(ID_SIGNATURE_TIME_STAMP_TOKEN), Some(token.as_slice()));
    }
}
```

- [ ] **Step 3: Tests draaien, zien falen**

```bash
cd open-pdf-studio/src-tauri && CARGO_TARGET_DIR="$BUILDMAP" cargo test --lib handtekening::verifieer 2>&1 | grep -E "^error\[" | head -3
```
Expected: `error[E0425]`: `integriteit_cms` bestaat nog niet.

- [ ] **Step 4: Implementatie**

Zet boven het testblok in `verifieer.rs`:

```rust
//! Handtekeningen verifiëren (spec §7.1): integriteit per soort.

use super::algoritme::{controleer_handtekening, Hashalg, WaardeFout};
use super::cms_lees::{
    lees_certificaat, lees_signed_data, zoek_ondertekenaar, Certificaat, Ondertekenaar, SignedData,
    ID_SIGNATURE_TIME_STAMP_TOKEN,
};
use super::status::{Integriteit, OnleesbaarReden};

/// Uitkomst van één ondertekenaar in een SignedData.
#[derive(Debug, Clone)]
pub struct Ondertekening {
    pub integriteit: Integriteit,
    pub detail: Option<String>,
    /// Het certificaat van de ondertekenaar, als het gevonden is.
    pub certificaat: Option<Certificaat>,
    /// Alle strikt leesbare certificaten uit de SignedData (voor de keten).
    pub certificaten: Vec<Certificaat>,
}

fn niet_te_controleren(reden: OnleesbaarReden, detail: String, certificaten: Vec<Certificaat>) -> Ondertekening {
    Ondertekening {
        integriteit: Integriteit::NietTeControleren { reden },
        detail: Some(detail),
        certificaat: None,
        certificaten,
    }
}

/// Integriteit van één ondertekenaar over `inhoud` (de delen die samen de
/// ondertekende inhoud vormen), in de volgorde van spec §7.1.
pub fn controleer_ondertekenaar(sd: &SignedData, o: &Ondertekenaar, inhoud: &[&[u8]]) -> Ondertekening {
    let certificaten: Vec<Certificaat> = sd.certificaten.iter().filter_map(|c| lees_certificaat(c)).collect();
    let Some(digest) = Hashalg::uit_oid(o.digestalgoritme.oid) else {
        let detail = format!("digestalgoritme {}", o.digestalgoritme.oid);
        return niet_te_controleren(OnleesbaarReden::AlgoritmeNietOndersteund, detail, certificaten);
    };
    let te_controleren: Vec<&[u8]> = match &o.ondertekende_attributen_der {
        Some(attributen) => {
            let Some(verwacht) = o.message_digest() else {
                return niet_te_controleren(OnleesbaarReden::CmsOnleesbaar, "messageDigest ontbreekt".to_string(), certificaten);
            };
            if digest.hash(inhoud) != verwacht {
                return Ondertekening {
                    integriteit: Integriteit::Gewijzigd,
                    detail: None,
                    certificaat: zoek_ondertekenaar(&certificaten, &o.sid).cloned(),
                    certificaten,
                };
            }
            vec![attributen.as_slice()]
        }
        None => inhoud.to_vec(),
    };
    let Some(certificaat) = zoek_ondertekenaar(&certificaten, &o.sid).cloned() else {
        let detail = "certificaat van de ondertekenaar ontbreekt of is onleesbaar".to_string();
        return niet_te_controleren(OnleesbaarReden::GeenCertificaat, detail, certificaten);
    };
    let uitkomst = controleer_handtekening(
        &certificaat.spki_der,
        &o.handtekeningalgoritme,
        Some(digest),
        &te_controleren,
        &o.handtekening,
    );
    let (integriteit, detail) = match uitkomst {
        Ok(()) => (Integriteit::Intact, None),
        Err(WaardeFout::KloptNiet) if o.ondertekende_attributen_der.is_some() => (Integriteit::Ongeldig, None),
        Err(WaardeFout::KloptNiet) => (
            Integriteit::Gewijzigd,
            Some("zonder ondertekende attributen zijn wijziging en ongeldige handtekening niet te onderscheiden".to_string()),
        ),
        Err(WaardeFout::NietOndersteund(d)) => {
            (Integriteit::NietTeControleren { reden: OnleesbaarReden::AlgoritmeNietOndersteund }, Some(d))
        }
    };
    Ondertekening { integriteit, detail, certificaat: Some(certificaat), certificaten }
}

/// Uitkomst voor een CAdES- of PKCS#7-handtekening.
#[derive(Debug, Clone)]
pub struct CmsUitkomst {
    pub integriteit: Integriteit,
    pub detail: Option<String>,
    pub certificaat: Option<Certificaat>,
    pub certificaten: Vec<Certificaat>,
    /// De handtekeningwaarde: daarover gaat een handtekeningtijdstempel.
    pub handtekeningwaarde: Vec<u8>,
    /// `signatureTimeStampToken` (ContentInfo-DER), indien aanwezig.
    pub tijdstempeltoken: Option<Vec<u8>>,
}

/// Integriteit van `ETSI.CAdES.detached` en `adbe.pkcs7.detached`.
pub fn integriteit_cms(cms: &[u8], inhoud: &[&[u8]]) -> CmsUitkomst {
    let onleesbaar = |detail: String| CmsUitkomst {
        integriteit: Integriteit::NietTeControleren { reden: OnleesbaarReden::CmsOnleesbaar },
        detail: Some(detail),
        certificaat: None,
        certificaten: Vec::new(),
        handtekeningwaarde: Vec::new(),
        tijdstempeltoken: None,
    };
    let sd = match lees_signed_data(cms) {
        Ok(sd) => sd,
        Err(e) => return onleesbaar(e.0),
    };
    let Some(o) = sd.ondertekenaars.first() else {
        return onleesbaar("geen ondertekenaar".to_string());
    };
    let ondertekening = controleer_ondertekenaar(&sd, o, inhoud);
    CmsUitkomst {
        integriteit: ondertekening.integriteit,
        detail: ondertekening.detail,
        certificaat: ondertekening.certificaat,
        certificaten: ondertekening.certificaten,
        handtekeningwaarde: o.handtekening.clone(),
        tijdstempeltoken: o.onondertekend(ID_SIGNATURE_TIME_STAMP_TOKEN).map(<[u8]>::to_vec),
    }
}
```

- [ ] **Step 5: Tests draaien**

```bash
cd open-pdf-studio/src-tauri && CARGO_TARGET_DIR="$BUILDMAP" cargo test --lib handtekening::verifieer 2>&1 | grep -E "test result|panicked"
```
Expected: `test result: ok. 9 passed; 0 failed`.

- [ ] **Step 6: Rest groen, dan commit**

```bash
cd open-pdf-studio/src-tauri && CARGO_TARGET_DIR="$BUILDMAP" cargo test --lib handtekening 2>&1 | grep -E "^test result"
cd .. && npm run test:unit 2>&1 | grep -E "^(#|ℹ) (pass|fail)" && npx vite build > /dev/null 2>&1; echo "vite exit $?"
cd .. && git add open-pdf-studio/src-tauri/src/handtekening/mod.rs open-pdf-studio/src-tauri/src/handtekening/verifieer.rs
git commit -m "feat(handtekening): integriteit van CAdES- en PKCS#7-handtekeningen, gewijzigd en ongeldig gescheiden"
```
Expected: `0 failed`; `fail 0`; `vite exit 0`.

---

### Task 9: `tijdstempel.rs` — RFC 3161-tokens controleren

**Files:**
- Create: `open-pdf-studio/src-tauri/src/handtekening/tijdstempel.rs`
- Modify: `open-pdf-studio/src-tauri/src/handtekening/mod.rs`

**Interfaces:**
- Consumes: `algoritme::Hashalg` (Task 6); `ber::{kinderen, lees_tlv, tijd_unix}` (Task 4); `cms_lees::{alg_id, lees_certificaat, lees_signed_data, Certificaat, ID_TST_INFO}` (Task 5); `status::{Integriteit, OnleesbaarReden}` (Task 1); `verifieer::controleer_ondertekenaar` (Task 8); fixtures `tst-data.der`, `tsa.der`, `data.bin`, `cms-rsa-sha256.der` (Task 3).
- Produces (in `crate::handtekening::tijdstempel`):
  - `pub struct TstInfo { pub imprint_alg: Hashalg, pub imprint: Vec<u8>, pub tijd_unix: i64 }` — `Debug, Clone, PartialEq, Eq`.
  - `pub enum TstFout { Onleesbaar(String), AlgoritmeNietOndersteund(String) }` — `Debug, Clone, PartialEq, Eq`.
  - `pub fn lees_tst_info(der: &[u8]) -> Result<TstInfo, TstFout>` — strikt volgens RFC 3161 §2.4.2 (aangescherpt na review): version 1, policy een OID, serialNumber een INTEGER, messageImprint precies twee elementen, hash-parameters afwezig of NULL, genTime eindigt op `Z` zonder tijdzone en een fractie staat achter een punt (een komma: `Onleesbaar`, toegevoegd na de tweede review); anders `Onleesbaar`. Velden na genTime (accuracy, ordering, nonce, tsa, extensies) worden niet gelezen.
  - Bewuste beperkingen (moduledoc en spec §10): alleen de eerste SignerInfo telt; ESSCertID/ESSCertIDv2 wordt niet gecontroleerd (binding via de sleutel van het gevonden certificaat); accuracy genegeerd; de dienst wordt beoordeeld op de eigen genTime.
  - `pub struct TokenUitkomst { pub integriteit: Integriteit, pub detail: Option<String>, pub tijd_unix: Option<i64>, pub tsa: Option<Certificaat>, pub certificaten: Vec<Certificaat>, pub zwak_algoritme: bool }` — `Debug, Clone`; `tijd_unix` alleen bij een intact token; `zwak_algoritme` (toegevoegd bij uitvoering) is een waarschuwing en verandert de integriteit niet.
  - `pub fn controleer_token(token: &[u8], gegevens: &[&[u8]]) -> TokenUitkomst` — documenttijdstempel: `gegevens` = de delen van het bytebereik; handtekeningtijdstempel: `gegevens` = `[handtekeningwaarde]`.

Controle (spec §7.1; gemeten: alle vier documenttijdstempels in het corpus zijn zo intact):
1. Token niet leesbaar, geen TSTInfo → `CmsOnleesbaar`; onbekend imprint-algoritme → `AlgoritmeNietOndersteund`.
2. `messageImprint` ≠ hash over `gegevens` → *gewijzigd* (de gestempelde bytes zijn veranderd).
3. Daarna de ondertekenaar van het token met `controleer_ondertekenaar` over de TSTInfo. Wijkt daar `messageDigest` af, dan klopt het token niet met zichzelf: *ongeldig* (de gestempelde bytes zijn niet veranderd).

Een controle op `messageDigest` tegen het bytebereik geeft bij documenttijdstempels vals alarm; daarom de imprint.

- [ ] **Step 1: Module declareren**

Voeg in `open-pdf-studio/src-tauri/src/handtekening/mod.rs` toe, na `pub mod status;`:

```rust
pub mod tijdstempel;
```

- [ ] **Step 2: Tests schrijven (falen eerst)**

Maak `open-pdf-studio/src-tauri/src/handtekening/tijdstempel.rs` met alleen de tests:

```rust
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

    #[test]
    fn token_over_de_data_is_intact() {
        let data = fixture("data.bin");
        let u = controleer_token(&fixture("tst-data.der"), &[data.as_slice()]);
        assert_eq!(u.integriteit, Integriteit::Intact);
        let tsa = lees_certificaat(&fixture("tsa.der")).unwrap();
        assert_eq!(u.tsa.as_ref().unwrap().onderwerp_der, tsa.onderwerp_der);
        assert_eq!(u.certificaten.len(), 2);
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
        assert_eq!(controleer_token(b"rommel", &[data.as_slice()]).integriteit, cms_onleesbaar);
        assert_eq!(controleer_token(&fixture("cms-rsa-sha256.der"), &[data.as_slice()]).integriteit, cms_onleesbaar);
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
```

- [ ] **Step 3: Tests draaien, zien falen**

```bash
cd open-pdf-studio/src-tauri && CARGO_TARGET_DIR="$BUILDMAP" cargo test --lib handtekening::tijdstempel 2>&1 | grep -E "^error\[" | head -3
```
Expected: `error[E0425]`/`error[E0412]`: `lees_tst_info`, `TstInfo` enz. bestaan nog niet.

- [ ] **Step 4: Implementatie**

Zet boven het testblok in `tijdstempel.rs`:

```rust
//! RFC 3161-tijdstempels controleren: documenttijdstempels (`ETSI.RFC3161`) en
//! handtekeningtijdstempels (`signatureTimeStampToken`).

use super::algoritme::Hashalg;
use super::ber::{kinderen, lees_tlv, tijd_unix};
use super::cms_lees::{alg_id, lees_signed_data, Certificaat, ID_TST_INFO};
use super::status::{Integriteit, OnleesbaarReden};
use super::verifieer::controleer_ondertekenaar;

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
pub fn lees_tst_info(der: &[u8]) -> Result<TstInfo, TstFout> {
    let onleesbaar = |tekst: String| TstFout::Onleesbaar(tekst);
    let (seq, _) = lees_tlv(der).map_err(|e| onleesbaar(e.to_string()))?;
    if seq.tag != 0x30 {
        return Err(onleesbaar("TSTInfo is geen SEQUENCE".to_string()));
    }
    let velden = kinderen(seq.inhoud).map_err(|e| onleesbaar(e.to_string()))?;
    let (Some(imprint), Some(tijd)) = (velden.get(2), velden.get(4)) else {
        return Err(onleesbaar("TSTInfo onvolledig".to_string()));
    };
    if imprint.tag != 0x30 || tijd.tag != 0x18 {
        return Err(onleesbaar("TSTInfo onverwacht opgebouwd".to_string()));
    }
    let delen = kinderen(imprint.inhoud).map_err(|e| onleesbaar(e.to_string()))?;
    let (Some(alg), Some(waarde)) = (delen.first(), delen.get(1)) else {
        return Err(onleesbaar("messageImprint onvolledig".to_string()));
    };
    if waarde.tag != 0x04 {
        return Err(onleesbaar("messageImprint zonder hash".to_string()));
    }
    let alg = alg_id(alg).map_err(|e| onleesbaar(e.0))?;
    let imprint_alg = Hashalg::uit_oid(alg.oid)
        .ok_or_else(|| TstFout::AlgoritmeNietOndersteund(format!("imprint-algoritme {}", alg.oid)))?;
    let seconden = tijd_unix(0x18, tijd.inhoud).ok_or_else(|| onleesbaar("genTime onleesbaar".to_string()))?;
    Ok(TstInfo { imprint_alg, imprint: waarde.inhoud.to_vec(), tijd_unix: seconden })
}

#[derive(Debug, Clone)]
pub struct TokenUitkomst {
    pub integriteit: Integriteit,
    pub detail: Option<String>,
    /// Alleen bij een intact token.
    pub tijd_unix: Option<i64>,
    /// Certificaat van de tijdstempeldienst, als het gevonden is.
    pub tsa: Option<Certificaat>,
    pub certificaten: Vec<Certificaat>,
}

fn niet(reden: OnleesbaarReden, detail: String) -> TokenUitkomst {
    TokenUitkomst {
        integriteit: Integriteit::NietTeControleren { reden },
        detail: Some(detail),
        tijd_unix: None,
        tsa: None,
        certificaten: Vec::new(),
    }
}

/// Controleert een RFC 3161-token over `gegevens`.
pub fn controleer_token(token: &[u8], gegevens: &[&[u8]]) -> TokenUitkomst {
    let sd = match lees_signed_data(token) {
        Ok(sd) => sd,
        Err(e) => return niet(OnleesbaarReden::CmsOnleesbaar, e.0),
    };
    let Some(inhoud) = sd.inhoud.as_ref().filter(|_| sd.inhoudstype == ID_TST_INFO) else {
        return niet(OnleesbaarReden::CmsOnleesbaar, "token bevat geen TSTInfo".to_string());
    };
    let info = match lees_tst_info(inhoud) {
        Ok(info) => info,
        Err(TstFout::Onleesbaar(d)) => return niet(OnleesbaarReden::CmsOnleesbaar, d),
        Err(TstFout::AlgoritmeNietOndersteund(d)) => return niet(OnleesbaarReden::AlgoritmeNietOndersteund, d),
    };
    let Some(o) = sd.ondertekenaars.first() else {
        return niet(OnleesbaarReden::CmsOnleesbaar, "token zonder ondertekenaar".to_string());
    };
    if info.imprint_alg.hash(gegevens) != info.imprint {
        return TokenUitkomst {
            integriteit: Integriteit::Gewijzigd,
            detail: None,
            tijd_unix: None,
            tsa: None,
            certificaten: Vec::new(),
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
        tijd_unix: (integriteit == Integriteit::Intact).then_some(info.tijd_unix),
        tsa: ondertekening.certificaat,
        certificaten: ondertekening.certificaten,
    }
}
```

- [ ] **Step 5: Tests draaien**

```bash
cd open-pdf-studio/src-tauri && CARGO_TARGET_DIR="$BUILDMAP" cargo test --lib handtekening::tijdstempel 2>&1 | grep -E "test result|panicked"
```
Expected: `test result: ok. 7 passed; 0 failed`.

- [ ] **Step 6: Rest groen, dan commit**

```bash
cd open-pdf-studio/src-tauri && CARGO_TARGET_DIR="$BUILDMAP" cargo test --lib handtekening 2>&1 | grep -E "^test result"
cd .. && npm run test:unit 2>&1 | grep -E "^(#|ℹ) (pass|fail)" && npx vite build > /dev/null 2>&1; echo "vite exit $?"
cd .. && git add open-pdf-studio/src-tauri/src/handtekening/mod.rs open-pdf-studio/src-tauri/src/handtekening/tijdstempel.rs
git commit -m "feat(handtekening): tijdstempeltokens controleren via imprint en handtekening van de dienst"
```
Expected: `0 failed`; `fail 0`; `vite exit 0`.

---

### Task 10: `vertrouwen.rs` — rootarchief, keten, geldigheid en sleutelgebruik

**Files:**
- Create: `open-pdf-studio/src-tauri/src/handtekening/vertrouwen.rs`
- Modify: `open-pdf-studio/src-tauri/src/handtekening/mod.rs`
- Modify: `open-pdf-studio/src-tauri/Cargo.toml`

**Interfaces:**
- Consumes: `algoritme::{controleer_handtekening, WaardeFout}` (Task 6); `cms_lees::{lees_certificaat, Certificaat}` (Task 5); `status::{Vertrouwen, WantrouwenReden}` (Task 1); fixtures `root.der`, `tussen.der`, `blad.der`, `blad-verkeerd-gebruik.der`, `tsa.der`, `ec-root.der`, `blad-onder-ec-root.der` (Task 3). Na review ook de `k-*.der`-fixtures (`maak-fixtures.sh keten`) en `tijdstempel::controleer_token` in een test.
- Produces (in `crate::handtekening::vertrouwen`):
  - `pub struct Vertrouwensarchief { wortels: Vec<Certificaat> }`
    - `pub fn leeg() -> Vertrouwensarchief`
    - `pub fn uit_der<'a>(certificaten: impl IntoIterator<Item = &'a [u8]>) -> Vertrouwensarchief`
    - `pub fn systeem() -> &'static Vertrouwensarchief` — eenmalig per sessie geladen, daarna gecachet. Windows (na de tweede review): `ROOT` van de huidige gebruiker alleen-lezen via `windows-sys` 0.59 (`Win32_Security_Cryptography`; de eerdere `schannel`-afhankelijkheid vervalt), zonder filter op huidige geldigheid of serverAuth; per wortel de doelen (`CertGetEnhancedKeyUsage`, fout → wortel weggelaten met één logregel), eigenschap 104 (`CERT_DISALLOWED_FILETIME_PROP_ID`) en 126/127 (`CERT_NOT_BEFORE_FILETIME_PROP_ID`, `CERT_NOT_BEFORE_ENHKEY_USAGE_PROP_ID`); certificaten uit `Disallowed` van gebruiker en computer. Andere platforms: `rustls-native-certs` (met `SSL_CERT_FILE`/`SSL_CERT_DIR` uitsluitend daarvandaan), zonder doelen. Een paniek bij het laden geeft een leeg archief voor de rest van de sessie.
    - `pub fn aantal(&self) -> usize`
    - Toegevoegd na de tweede review: `pub fn aantal_voor(&self, rol: Rol) -> usize` (wortels waarvan de doelen de rol toestaan, los van data) en `pub fn uit_wortelgegevens(wortels: impl IntoIterator<Item = Wortelgegevens>, gewantrouwd: &[Vec<u8>]) -> Vertrouwensarchief` (injecteerbaar, platformneutraal; weggelaten: onleesbare certificaten, `doelen: None`, `uitgeschakeld_vanaf: Some(None)` en gewantrouwde DER's). Het archief bewaart intern per wortel een `Wortelgebruik` en de gewantrouwde DER's; `uit_der` maakt wortels zonder beperkingen.
  - Toegevoegd na de tweede review: `pub enum Doelen { Alle, Alleen(Vec<ObjectIdentifier>) }`; `pub struct Beperking { pub na_unix: i64, pub doelen: Doelen }` (bladen met notBefore ná `na_unix` niet voor `doelen`); `pub struct Wortelgebruik { pub doelen: Doelen, pub uitgeschakeld_vanaf: Option<i64>, pub beperking_na: Option<Beperking> }`; `pub struct Wortelgegevens { pub der: Vec<u8>, pub doelen: Option<Doelen>, pub uitgeschakeld_vanaf: Option<Option<i64>>, pub beperking_na: Option<Beperking> }` met `pub fn onbeperkt(der: Vec<u8>) -> Wortelgegevens`.
  - `pub enum Rol { Ondertekenaar, Tijdstempeldienst }` — `Debug, Clone, Copy, PartialEq, Eq`.
  - `pub struct Ketenuitkomst { pub vertrouwen: Vertrouwen, pub keten: Vec<Certificaat>, pub zwak_algoritme: bool, pub budget_op: bool }` — `keten[0]` is het blad; bij een gevonden anker is het laatste element het wortelcertificaat. `zwak_algoritme` (toegevoegd bij uitvoering): een gecontroleerde certificaathandtekening in de keten gebruikt SHA-1; de eigen handtekening van het anker telt niet mee. `budget_op` (toegevoegd na de tweede review): de zoektocht is op het knoop- of handtekeningbudget afgebroken; een `GeenKeten` betekent dan "binnen het budget geen keten gevonden". `vertrouwen` is altijd `Vertrouwd` of `NietVertrouwd`, nooit `NietBepaald`.
  - Toegevoegd bij uitvoering, in `crate::handtekening::algoritme`: `pub fn controleer_certificaathandtekening(spki_der: &[u8], alg: &AlgId, delen: &[&[u8]], handtekening: &[u8]) -> Result<(), WaardeFout>` — als `controleer_handtekening` zonder digestalgoritme, maar met RSA-sleutels tot 8192 bits (`RsaPublicKey::new_with_max_size`); `beoordeel` gebruikt die. Handtekeningen in een document blijven begrensd op 4096 bits. Fixtures `root-rsa8192.der`, `blad-onder-rsa8192.der`, `blad-sha1-onder-rsa8192.der` (`maak-fixtures.sh rsa8192`).
  - `pub fn beoordeel(blad: &Certificaat, tussen: &[Certificaat], archief: &Vertrouwensarchief, tijd_unix: i64, rol: Rol) -> Ketenuitkomst` — signatuur ongewijzigd; `keten` is bij `NietVertrouwd` (na review) het meest gevorderde pad.

Regels (spec §7.1; aangescherpt na review, de oorspronkelijke eenvoudige zoekstap hieronder in de stappen is vervangen):
- Keten: diepte-eerst met terugstappen. Per schakel de kandidaten (archief, dan certificaten uit de handtekening) met onderwerp gelijk aan de uitgever; die op `tijd_unix` geldig zijn eerst. Een kandidaat telt als zijn handtekening over het huidige certificaat klopt; een certificaat dat zelf in het archief staat, is het anker. Elk pad naar een anker wordt als geheel beoordeeld (geldigheid, CA-eisen, gebruik); het eerste volledig kloppende pad wint. Anders de reden van het meest gevorderde pad: pad met anker vóór doodlopend pad, daarbinnen de eerste fout het verst van het blad, bij doodlopende paden het langste (`AlgoritmeNietOndersteund` als aan het eind een kandidaat alleen op een niet-ondersteund algoritme strandde, anders `GeenKeten`). Maximaal 10 certificaten per pad (een elfde schakel wordt niet meer gezocht) en maximaal 100 certificaathandtekeningcontroles per beoordeling. Na de tweede review: maximaal 1000 knopen (aanroepen van de zoekstap) per beoordeling; een kandidaat met hetzelfde onderwerp én dezelfde SPKI als een certificaat in het pad wordt overgeslagen (lusdetectie op naam en sleutel); de handtekeningcontrole wordt per (kind, SPKI van de kandidaat) gecachet. Kandidaten met gelijke naam en sleutel in één schakel worden níet samengevoegd: `k-tussen-kruis.der` en `k-tussen.der` hebben dezelfde naam en sleutel maar een andere uitgever, en `k-root-verlopen.der`/`k-root.der` een andere geldigheid. Fixture `z-zelfuitgegeven.der` + `z-blad.der` (`maak-fixtures.sh zelfuitgegeven`): tien zelfuitgegeven CA's met één sleutel zijn binnen 1 s beoordeeld (`GeenKeten`).
- Geldigheid: elk certificaat in het pad, het anker inbegrepen, geldig op `tijd_unix` → anders `Verlopen` (gaat binnen een pad voor `Sleutelgebruik`).
- Sleutelgebruik van het blad als ondertekenaar: keyUsage (indien aanwezig) met digitalSignature of nonRepudiation. extendedKeyUsage (indien aanwezig) met minstens één van anyExtendedKeyUsage `2.5.29.37.0`, emailProtection `1.3.6.1.5.5.7.3.4`, documentSigning `1.3.6.1.5.5.7.3.36`, of de documentondertekenings-OID's van een leverancier `1.3.6.1.4.1.311.10.3.12` en `1.2.840.113583.1.1.5`; clientAuth `1.3.6.1.5.5.7.3.2` alleen als serverAuth ontbreekt. Zonder extendedKeyUsage onbeperkt. Een certificaat dat uitsluitend voor tijdstempels is, is dus geen geldige ondertekenaar.
- Tijdstempeldienst (RFC 3161 §2.3): extendedKeyUsage kritiek en uitsluitend id-kp-timeStamping.
- Tussencertificaten: basicConstraints CA en, als keyUsage er is, keyCertSign. De v1-uitzondering geldt alleen voor het anker; van het anker worden basicConstraints en keyUsage niet geëist.
- extendedKeyUsage van tussencertificaten (na de tweede review): de doorsnede over de tussencertificaten (zonder extensie of met anyExtendedKeyUsage: geen beperking; onleesbaar: leeg) moet de rol toestaan (`eku_voor_ondertekenen` resp. timeStamping) → anders `Sleutelgebruik` op het eerste tussencertificaat dat de doorsnede te klein maakt. De extendedKeyUsage-extensie van het anker telt hier niet. Fixtures `e-*.der` (`maak-fixtures.sh eku`).
- pathLenConstraint van elke CA in het pad (ook het anker als het die heeft): aantal niet-zelfuitgegeven tussencertificaten eronder ≤ pathlen.
- Kritieke extensies buiten keyUsage, basicConstraints, extendedKeyUsage, subjectAltName, certificatePolicies, policyConstraints, inhibitAnyPolicy, AKI en SKI → geweigerd (ook bij het anker), dus ook nameConstraints (geen eigen reden: `Sleutelgebruik`, vermeld in spec §10).
- Doelen van het anker (na de tweede review): de rol wordt bij het anker getoetst aan `Wortelgebruik` in plaats van een wortel te houden zodra één rol mag. Ondertekenaar: een concreet ondertekendoel (emailProtection, documentSigning, de twee leveranciers-OID's) of clientAuth zonder serverAuth is toegestaan en niet beperkt, of anyExtendedKeyUsage staat uitdrukkelijk in de doelen; tijdstempeldienst: timeStamping, of uitdrukkelijk anyExtendedKeyUsage. Een beperking (126/127) haalt voor bladen met latere notBefore de genoemde doelen weg. Faalt dat → `Sleutelgebruik` op het anker. Een uitschakeldatum (104) geldt voor het tijdstip én de notBefore van het blad; op of na die datum is de wortel geen anker (de zoektocht gaat verder alsof hij niet in het archief staat, meestal `GeenKeten`). Gewantrouwde certificaten zijn geen anker en geen kandidaat-tussencertificaat. Dit is een andere toets dan de extendedKeyUsage-regel van het blad; beide moeten kloppen.
- Alle fouten in gebruik, CA-eisen, pathlen en kritieke extensies → `Sleutelgebruik`.
- Intrekking (OCSP, CRL) valt buiten scope (spec §10).

- [ ] **Step 1: Dependency**

Voeg in `open-pdf-studio/src-tauri/Cargo.toml` direct onder de `p384`-regel toe:

```toml
# Rootarchief van het besturingssysteem als DER (Windows-archief, macOS-sleutelhanger,
# OpenSSL-paden op Linux). Staat al in Cargo.lock; geen eigen X.509-lijn.
rustls-native-certs = "0.8"
```

- [ ] **Step 2: Module declareren**

Voeg in `open-pdf-studio/src-tauri/src/handtekening/mod.rs` als laatste modulerregel toe:

```rust
pub mod vertrouwen;
```

- [ ] **Step 3: Tests schrijven (falen eerst)**

Maak `open-pdf-studio/src-tauri/src/handtekening/vertrouwen.rs` met alleen de tests:

```rust
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
        assert_eq!(beoordeel(&tsa, &tussen, &a, tijd, Rol::Ondertekenaar).vertrouwen, Vertrouwen::Vertrouwd);
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
        let a = Vertrouwensarchief { wortels: vec![nep] };
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
}
```

- [ ] **Step 4: Tests draaien, zien falen**

```bash
cd open-pdf-studio/src-tauri && CARGO_TARGET_DIR="$BUILDMAP" cargo test --lib handtekening::vertrouwen 2>&1 | grep -E "^error\[" | head -3
```
Expected: `error[E0433]`/`error[E0425]`: `Vertrouwensarchief`, `beoordeel` bestaan nog niet.

- [ ] **Step 5: Implementatie**

Zet boven het testblok in `vertrouwen.rs`:

```rust
//! Vertrouwen (spec §7.1): keten naar het rootarchief van het besturingssysteem,
//! geldigheid op het relevante tijdstip en sleutelgebruik. Intrekking (OCSP,
//! CRL) wordt niet gecontroleerd (spec §10).

use std::sync::OnceLock;

use const_oid::ObjectIdentifier;
use der::Decode;
use x509_cert::ext::pkix::{BasicConstraints, ExtendedKeyUsage, KeyUsage};

use super::algoritme::{controleer_handtekening, WaardeFout};
use super::cms_lees::{lees_certificaat, Certificaat};
use super::status::{Vertrouwen, WantrouwenReden};

const KEY_USAGE: ObjectIdentifier = ObjectIdentifier::new_unwrap("2.5.29.15");
const BASIC_CONSTRAINTS: ObjectIdentifier = ObjectIdentifier::new_unwrap("2.5.29.19");
const EXT_KEY_USAGE: ObjectIdentifier = ObjectIdentifier::new_unwrap("2.5.29.37");
const ID_KP_TIME_STAMPING: ObjectIdentifier = ObjectIdentifier::new_unwrap("1.3.6.1.5.5.7.3.8");
const MAX_KETEN: usize = 10;

pub struct Vertrouwensarchief {
    wortels: Vec<Certificaat>,
}

impl Vertrouwensarchief {
    pub fn leeg() -> Vertrouwensarchief {
        Vertrouwensarchief { wortels: Vec::new() }
    }

    /// Onleesbare certificaten worden overgeslagen.
    pub fn uit_der<'a>(certificaten: impl IntoIterator<Item = &'a [u8]>) -> Vertrouwensarchief {
        Vertrouwensarchief { wortels: certificaten.into_iter().filter_map(lees_certificaat).collect() }
    }

    /// Het rootarchief van het besturingssysteem, bij het eerste gebruik geladen.
    pub fn systeem() -> &'static Vertrouwensarchief {
        static ARCHIEF: OnceLock<Vertrouwensarchief> = OnceLock::new();
        ARCHIEF.get_or_init(|| {
            let geladen = rustls_native_certs::load_native_certs();
            if !geladen.errors.is_empty() {
                log::warn!("[handtekening] rootarchief: {} fout(en) bij laden", geladen.errors.len());
            }
            let archief = Vertrouwensarchief::uit_der(geladen.certs.iter().map(|c| &c[..]));
            log::info!("[handtekening] rootarchief: {} certificaten", archief.aantal());
            archief
        })
    }

    pub fn aantal(&self) -> usize {
        self.wortels.len()
    }

    fn bevat(&self, c: &Certificaat) -> bool {
        self.wortels.iter().any(|w| w.der == c.der)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Rol {
    Ondertekenaar,
    Tijdstempeldienst,
}

#[derive(Debug, Clone)]
pub struct Ketenuitkomst {
    pub vertrouwen: Vertrouwen,
    pub keten: Vec<Certificaat>,
}

/// Bouwt en beoordeelt de keten van `blad` naar het archief op tijdstip `tijd_unix`.
pub fn beoordeel(
    blad: &Certificaat,
    tussen: &[Certificaat],
    archief: &Vertrouwensarchief,
    tijd_unix: i64,
    rol: Rol,
) -> Ketenuitkomst {
    let mut keten = vec![blad.clone()];
    let mut anker = false;
    let mut algoritme_probleem = false;
    while keten.len() <= MAX_KETEN {
        let Some(huidig) = keten.last().cloned() else { break };
        if archief.bevat(&huidig) {
            anker = true;
            break;
        }
        let mut volgende = None;
        for kandidaat in archief.wortels.iter().chain(tussen.iter()) {
            if kandidaat.onderwerp_der != huidig.uitgever_der || keten.iter().any(|k| k.der == kandidaat.der) {
                continue;
            }
            match controleer_handtekening(
                &kandidaat.spki_der,
                &huidig.handtekeningalgoritme,
                None,
                &[huidig.tbs_der.as_slice()],
                &huidig.handtekening,
            ) {
                Ok(()) => {
                    volgende = Some(kandidaat.clone());
                    break;
                }
                Err(WaardeFout::NietOndersteund(_)) => algoritme_probleem = true,
                Err(WaardeFout::KloptNiet) => {}
            }
        }
        match volgende {
            Some(c) => keten.push(c),
            None => break,
        }
    }
    let niet = |reden| Vertrouwen::NietVertrouwd { reden };
    let vertrouwen = if !anker {
        niet(if algoritme_probleem { WantrouwenReden::AlgoritmeNietOndersteund } else { WantrouwenReden::GeenKeten })
    } else if !keten.iter().all(|c| geldig_op(c, tijd_unix)) {
        niet(WantrouwenReden::Verlopen)
    } else if !gebruik_klopt(&keten, rol) {
        niet(WantrouwenReden::Sleutelgebruik)
    } else {
        Vertrouwen::Vertrouwd
    };
    Ketenuitkomst { vertrouwen, keten }
}

fn seconden(t: &x509_cert::time::Time) -> i64 {
    i64::try_from(t.to_unix_duration().as_secs()).unwrap_or(i64::MAX)
}

fn geldig_op(c: &Certificaat, tijd_unix: i64) -> bool {
    let v = &c.x509.tbs_certificate.validity;
    seconden(&v.not_before) <= tijd_unix && tijd_unix <= seconden(&v.not_after)
}

fn extensie(c: &Certificaat, oid: ObjectIdentifier) -> Option<&[u8]> {
    c.x509.tbs_certificate.extensions.as_ref()?.iter().find(|e| e.extn_id == oid).map(|e| e.extn_value.as_bytes())
}

fn gebruik_klopt(keten: &[Certificaat], rol: Rol) -> bool {
    let Some((blad, uitgevers)) = keten.split_first() else { return false };
    if let Some(ku) = extensie(blad, KEY_USAGE) {
        match KeyUsage::from_der(ku) {
            Ok(ku) if ku.digital_signature() || ku.non_repudiation() => {}
            _ => return false,
        }
    }
    if rol == Rol::Tijdstempeldienst {
        match extensie(blad, EXT_KEY_USAGE).map(ExtendedKeyUsage::from_der) {
            Some(Ok(eku)) if eku.0.contains(&ID_KP_TIME_STAMPING) => {}
            _ => return false,
        }
    }
    for ca in uitgevers {
        match extensie(ca, BASIC_CONSTRAINTS).map(BasicConstraints::from_der) {
            Some(Ok(bc)) if bc.ca => {}
            None if ca.x509.tbs_certificate.version == x509_cert::certificate::Version::V1 => {}
            _ => return false,
        }
        if let Some(ku) = extensie(ca, KEY_USAGE) {
            match KeyUsage::from_der(ku) {
                Ok(ku) if ku.key_cert_sign() => {}
                _ => return false,
            }
        }
    }
    true
}
```

- [ ] **Step 6: Tests draaien**

```bash
cd open-pdf-studio/src-tauri && CARGO_TARGET_DIR="$BUILDMAP" cargo test --lib handtekening::vertrouwen -- --nocapture 2>&1 | grep -E "test result|panicked|rootarchief van het systeem"
```
Expected: `test result: ok. 10 passed; 0 failed` en op Windows `rootarchief van het systeem: N certificaten` met N groter dan 0.

- [ ] **Step 7: Rest groen, dan commit**

```bash
cd open-pdf-studio/src-tauri && CARGO_TARGET_DIR="$BUILDMAP" cargo test --lib handtekening 2>&1 | grep -E "^test result"
cd .. && npm run test:unit 2>&1 | grep -E "^(#|ℹ) (pass|fail)" && npx vite build > /dev/null 2>&1; echo "vite exit $?"
cd .. && git add Cargo.lock open-pdf-studio/src-tauri/Cargo.toml open-pdf-studio/src-tauri/src/handtekening/mod.rs open-pdf-studio/src-tauri/src/handtekening/vertrouwen.rs
git commit -m "feat(handtekening): vertrouwen via het rootarchief van het besturingssysteem, geldigheid en sleutelgebruik"
```
Expected: `0 failed`; `fail 0`; `vite exit 0`.

---

### Task 11: Document verifiëren en de Tauri-commando's

**Files:**
- Modify: `open-pdf-studio/src-tauri/src/handtekening/verifieer.rs`
- Modify: `open-pdf-studio/src-tauri/src/handtekening/certificaat.rs` (één regel: `common_name` crate-zichtbaar)
- Modify: `open-pdf-studio/src-tauri/src/lib.rs` (commando's registreren)

**Interfaces:**
- Consumes:
  - `bytebereik::Bytebereik` (Task 2): `uit_getallen`, `einde`, `dekt_hele_document`, `controleer_gat`, `delen`, `ondertekende_versie`.
  - `certificaat::common_name(naam: &x509_cert::name::Name) -> String` (deel 1; hier `pub(crate)` gemaakt).
  - `pdf_lezen::{lees_handtekeningvelden, HandtekeningVeld, PdfLeesFout, SigWoordenboek}` (Task 7). `SigWoordenboek::woordenboek_ondertekend: bool` zegt of het gebruikte exemplaar van het handtekeningwoordenboek binnen het eigen bytebereik ligt; zo niet, dan zijn `/Name`, `/Reason`, `/Location`, `/ContactInfo` en `/M` niet mee ondertekend (bijvoorbeeld een later vervangen reden). `lees_handtekeningvelden` geeft ook `PdfLeesFout::Onleesbaar` bij een te diep geneste PDF-structuur.
  - `status::{leeg_veld, leid_af, Integriteit, OnleesbaarReden, Status, Vertrouwen}` (Task 1).
  - `tijdstempel::controleer_token` (Task 9) en `TokenUitkomst`.
  - `vertrouwen::{beoordeel, Ketenuitkomst, Rol, Vertrouwensarchief}` (Task 10). Na review strenger (zie Task 10): een ondertekenaarscertificaat met alleen serverAuth of uitsluitend timeStamping is `Sleutelgebruik`; een tijdstempeldienst vraagt een kritieke extendedKeyUsage met uitsluitend timeStamping. `beoordeel` geeft nooit `Vertrouwen::NietBepaald`. `NietBepaald` alleen gebruiken als er niet beoordeeld wordt omdat de integriteit niet intact is. Een intacte handtekening heeft altijd `certificaat: Some` (Task 8) en een intact token altijd `tsa: Some` en `tijd_unix: Some` (Task 9); de `_ => NietBepaald`-takken zijn bij `Intact` dus onbereikbaar. Houd dat zo (test: geen `HandtekeningInfo` met `integriteit == Some(Intact)` en `vertrouwen == NietBepaald`), anders wordt een intacte handtekening via `leid_af` stil "geen keten".
  - `verifieer::integriteit_cms`, `CmsUitkomst` (Task 8, zelfde bestand).
  - Zwak algoritme (SHA-1): `CmsUitkomst::zwak_algoritme` en `Ondertekening::zwak_algoritme` (Task 8), `TokenUitkomst::zwak_algoritme: bool` (Task 9: imprint-, digest- of handtekeningalgoritme van het token is SHA-1), en voor de keten `Ketenuitkomst::zwak_algoritme` (Task 10; telt de niet-gecontroleerde eigen handtekening van het anker niet mee, dus geen losse `gebruikte_hash` per certificaat). Alleen als waarschuwing in `HandtekeningInfo` (en het detailvenster) tonen; integriteit en getoonde status veranderen er niet door.
- Produces (in `crate::handtekening::verifieer`, allemaal `Serialize` met camelCase-velden en kebab-case-varianten):
  - `pub enum Soort { Handtekening, Documenttijdstempel, LeegVeld, Onbekend }`
  - `pub enum TijdBron { Tijdstempel, Opgegeven, Onbekend }`
  - `pub struct CertificaatSamenvatting { pub naam: String, pub uitgever: String, pub geldig_van_unix: u64, pub geldig_tot_unix: u64 }`
  - `pub struct TijdstempelInfo { pub tijd_unix: Option<i64>, pub tsa: Option<String>, pub integriteit: Integriteit, pub vertrouwen: Vertrouwen }`
  - `pub struct HandtekeningInfo { pub nummer: usize, pub veldnaam: Option<String>, pub soort: Soort, pub subfilter: Option<String>, pub status: Status, pub daarna_gewijzigd: bool, pub integriteit: Option<Integriteit>, pub vertrouwen: Vertrouwen, pub detail: Option<String>, pub ondertekenaar: Option<String>, pub uitgever: Option<String>, pub tijd_unix: Option<i64>, pub tijd_bron: TijdBron, pub tijdstempel: Option<TijdstempelInfo>, pub dekt_hele_document: bool, pub bereik_einde: Option<u64>, pub bestandsgrootte: u64, pub reden: Option<String>, pub plaats: Option<String>, pub contact: Option<String>, pub opgegeven_naam: Option<String>, pub woordenboek_ondertekend: bool, pub keten: Vec<CertificaatSamenvatting> }` — `woordenboek_ondertekend` neemt `SigWoordenboek::woordenboek_ondertekend` over (`false` bij een leeg veld); is het `false`, dan toont de UI reden, plaats, contact, opgegeven naam en een `/M`-tijd als niet ondertekend.
  - `pub enum LijstFout { Onleesbaar { detail: String }, PdfOnleesbaar { detail: String }, GeenHandtekening }` — serde-tag `code`.
  - *Bij uitvoering toegevoegd:* `HandtekeningInfo::zwak_algoritme: bool` en `TijdstempelInfo::zwak_algoritme: bool` (waarschuwing, zie Consumes); `Bytebereik::dekt_hele_document(&self, bytes: &[u8])` (was: bestandslengte) telt alleen PDF-witruimte na het bereik als gedekt, en `Bytebereik::gat_inhoud(&self, bytes) -> Option<Vec<u8>>` levert de gedecodeerde hex-string in het gat; wijkt die af van `/Contents`, dan komt dat als extra signaal in `detail`. Gelijke handtekeningwoordenboeken (twee velden met dezelfde `/V`) worden in `geordende_velden` ontdubbeld: het eerste veld telt. De vertrouwensbepaling loopt via `vertrouwen_bij`, dat bij een intacte uitkomst nooit `NietBepaald` geeft. Na de tweede review: stopt de ketenzoektocht van een niet-vertrouwde keten op het budget (`Ketenuitkomst::budget_op`), dan komt `ketenzoektocht afgebroken op het zoekbudget` in `detail` (voor de keten van een handtekeningtijdstempel met voorvoegsel `tijdstempel: `); `status` en `vertrouwen` blijven `GeenKeten`.
  - `pub fn verifieer_document(bytes: &[u8], archief: &Vertrouwensarchief, nu_unix: i64) -> Result<Vec<HandtekeningInfo>, LijstFout>` — gesorteerd op het einde van het bytebereik (revisievolgorde); velden zonder geldig bereik achteraan; `nummer` is de positie in die lijst.
  - `pub fn ondertekende_versie(bytes: &[u8], nummer: usize) -> Result<&[u8], LijstFout>`
  - `#[tauri::command] pub async fn pdf_signature_list(pad: String) -> Result<Vec<HandtekeningInfo>, LijstFout>`
  - `#[tauri::command] pub async fn pdf_signed_revision(pad: String, nummer: usize) -> Result<String, LijstFout>` — schrijft de bytes tot het einde van het bytebereik naar `<temp>/opds-ondertekende-versies/<stam>-rev<nummer+1>-<millis>.pdf` en geeft dat pad.
  - *Na de derde review (additief; JSON-vorm verder ongewijzigd):*
    - `pdf_lezen::lees_veldenlijst(bytes) -> Result<Veldenlijst, PdfLeesFout>` met `pub struct Veldenlijst { pub velden: Vec<HandtekeningVeld>, pub afgekapt: bool }` en `pub const MAX_HANDTEKENINGVELDEN: usize = 1000`; `lees_handtekeningvelden` geeft daarvan `velden`. Velden met dezelfde `/V` (zelfde `ObjectId`, of hetzelfde directe woordenboek via erfenis) worden al in `pdf_lezen` samengevoegd, vóór het bouwen van `SigWoordenboek` (geen kopie van `/Contents` of herhaald `kies_exemplaar` per veld). De veldnaam komt van het veld waarvan de objectkop binnen het bytebereik van de handtekening ligt, anders van het eerste veld in formuliervolgorde. `geordende_velden` ontdubbelt inhoudelijk gelijke woordenboeken daarna nog met een `HashSet`. Na 1000 velden (lege meegeteld) stopt het lezen.
    - `HandtekeningInfo::lijst_afgekapt: bool` (JSON `lijstAfgekapt`, gelijk op alle regels): de lijst is op 1000 velden afgekapt.
    - Een paniek tijdens de controle van één handtekening (`catch_unwind` in `verifieer_veld`) geeft voor die handtekening `NietTeControleren { CmsOnleesbaar }` met `detail` `interne fout bij het controleren: …`; de andere handtekeningen worden gewoon gecontroleerd. Test via een `cfg(test)`-haak.
    - Relevante tijd voor een keten = `min(genTime, nu)` (handtekeningtijdstempel, documenttijdstempel en de ondertekenaar bij een vertrouwd token).
    - `Bytebereik::controleer_gat` staat NUL toe binnen `<…>` (witruimte volgens ISO 32000-1 §7.2.2 en §7.3.4.3, zoals bij de dekkingsregel); buiten `<…>` blijft niets toegestaan.
    - `pdf_signature_list` leest bestanden vanaf 64 MiB via een geheugenafbeelding (`memmap2`, stond al in `Cargo.toml`); kleinere bestanden worden ingelezen (zie spec §7.3).
    - `LijstFout::GewijzigdSindsLijst` (JSON `{ code: 'gewijzigd-sinds-lijst' }`).
    - `pub fn ondertekende_versie_bij(bytes, nummer, bereik_einde: Option<u64>) -> Result<&[u8], LijstFout>`: met `bereik_einde` moet handtekening `nummer` daar nog eindigen, anders `GewijzigdSindsLijst` (ook als de handtekening er niet meer is).
    - `#[tauri::command] pub async fn pdf_signed_revision(app: AppHandle, pad: String, nummer: usize, bereik_einde: Option<u64>) -> Result<String, LijstFout>` (JS: `{ pad, nummer, bereikEinde? }`; antwoord blijft een absoluut pad). Schrijft naar `<app-cachemap>/ondertekende-versies/` (`app.path().app_cache_dir()`, per gebruiker; op Unix map 0700 en bestand 0600) met `create_new`, als `<stam ≤ 100 tekens>-rev<n>-<millis>-<teller>-<willekeurig>.pdf`: elke aanroep een nieuwe naam. Bij een schrijffout blijft er geen half bestand achter. Het bestand komt via `fs_scope().allow_file` in de fs-scope, zodat de UI het kan openen en met `fs.remove` verwijderen. Hulpfuncties: `schrijf_ondertekende_versie(map, pad, nummer, bereik_einde) -> Result<PathBuf, LijstFout>`, `map_ondertekende_versies(app_cachemap) -> PathBuf`, `ruim_ondertekende_versies_op(map, ouder_dan)` (alleen `*.pdf`, fouten genegeerd); die laatste draait bij het opstarten (setup in `lib.rs`, eigen thread) met zeven dagen als grens.
  - *Na de eindreview (additief; bestaande JSON-velden ongewijzigd):*
    - `HandtekeningInfo::signalen: Vec<String>` en `TijdstempelInfo::signalen: Vec<String>` (JSON `signalen`): vaste, machineleesbare codes in kebab-case uit `status::signaal` (bv. `gat-wijkt-af-van-contents`, `zoekbudget-op`, `interne-fout`, `messagedigest-ontbreekt-of-meervoudig`, `contenttype-wijkt-af`, `econtent-bij-losse-handtekening`, `bytebereik-geen-vier-getallen`, `subfilter-niet-ondersteund`), zonder dubbelen. Ze staan naast `detail`, dat een Nederlandse technische tekst blijft. De UI vertaalt de codes en toont `detail` alleen ingeklapt als "Technisch detail"; een onbekende code krijgt een neutrale tekst. Signalen van een handtekeningtijdstempel staan in `tijdstempel.signalen`, die van een documenttijdstempel in `signalen` van de regel zelf.
    - `Ondertekening`, `CmsUitkomst` en `TokenUitkomst` hebben `signalen: Vec<&'static str>`; `BereikFout::signaal()` geeft de code per bytebereikfout.
    - Rekentijd per document: hoogstens 2000 certificaathandtekeningen (`MAX_CONTROLES_PER_DOCUMENT`) over alle ketens van één document samen, via `vertrouwen::beoordeel_binnen(blad, tussen, archief, tijd, rol, budget) -> (Ketenuitkomst, gebruikte_controles)`. Is het op, dan zijn volgende ketens niet vertrouwd (`budget_op`) met signaal `zoekbudget-op`.
    - `pdf_lezen`: objectstromen worden na het lezen door `lopdf` zelf en begrensd uitgepakt (64 MiB per stroom, 256 MiB samen per leesronde; alleen geen filter of `FlateDecode`). Een stroom boven de grens wordt overgeslagen en de lezing heet onvolledig (dan volgt ook het herstel).
    - `OnleesbaarReden::PdfOnleesbaar` is vervallen (werd nooit gezet; een onleesbare PDF is `LijstFout::PdfOnleesbaar`). `lees_handtekeningvelden`, `cms_lees::zoek_ondertekenaar`, `ondertekende_versie` en `Vertrouwensarchief::uit_der` bestaan alleen nog voor tests.
    - Opruimen van ondertekende versies bij het opstarten: `verifieer::OPRUIMEN_NA` (zeven dagen), zodat een tabblad in een andere, nog draaiende instantie zijn bestand houdt.
    - Bewust niet getoond in de UI: `subfilter` (alleen onder "Technisch detail") en het bovenste `vertrouwen` (de UI leest `status`, die vertrouwen al bevat). `keten[].uitgever` staat wel in het detailvenster.

Tijdstip en vertrouwen (spec §7.1):
- Handtekening: het relevante tijdstip is de tijd uit het handtekeningtijdstempel als dat token intact is én de tijdstempeldienst vertrouwd wordt (op de tijd in het token); anders de huidige tijd. `/M` telt nooit als bewijs. Getoond tijdstip: tijd uit een intact token (bron `tijdstempel`), anders `/M` (bron `opgegeven`).
- Documenttijdstempel: de dienst wordt beoordeeld op de tijd in het eigen token, met rol `Tijdstempeldienst`; getoonde naam is die van de dienst.
- Vertrouwen alleen bij een intacte handtekening; anders `NietBepaald`.

- [ ] **Step 1: `common_name` crate-zichtbaar maken**

In `open-pdf-studio/src-tauri/src/handtekening/certificaat.rs`, vervang:

```rust
fn common_name(naam: &x509_cert::name::Name) -> String {
```

door:

```rust
pub(crate) fn common_name(naam: &x509_cert::name::Name) -> String {
```

- [ ] **Step 2: Tests schrijven (falen eerst)**

Voeg in `open-pdf-studio/src-tauri/src/handtekening/verifieer.rs` onderaan **binnen** `mod tests { … }` (vóór de laatste `}`) toe:

```rust
    use crate::handtekening::status::Status;
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
    }

    #[test]
    fn onleesbare_cms_en_documenttijdstempel_met_toevoeging() {
        let toevoeging = "\n% toevoeging\n";
        let pdf = pdf_met_handtekening("ETSI.CAdES.detached", "3003020101", toevoeging);
        let h = &verifieer_document(&pdf, &Vertrouwensarchief::leeg(), 0).unwrap()[0];
        assert_eq!(h.soort, Soort::Handtekening);
        assert_eq!(h.integriteit, Some(niet(OnleesbaarReden::CmsOnleesbaar)));
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
        let versie = tauri::async_runtime::block_on(pdf_signed_revision(pad_tekst, 0)).unwrap();
        assert!(versie.ends_with(".pdf"));
        assert_eq!(std::fs::read(&versie).unwrap().len(), pdf.len() - toevoeging.len());
        std::fs::remove_file(&versie).unwrap();
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
        assert_eq!(
            serde_json::to_string(&LijstFout::PdfOnleesbaar { detail: "x".into() }).unwrap(),
            r#"{"code":"pdf-onleesbaar","detail":"x"}"#
        );
    }
```

- [ ] **Step 3: Tests draaien, zien falen**

```bash
cd open-pdf-studio/src-tauri && CARGO_TARGET_DIR="$BUILDMAP" cargo test --lib handtekening::verifieer 2>&1 | grep -E "^error\[" | head -3
```
Expected: `error[E0425]`/`error[E0433]`: `verifieer_document`, `Soort`, `LijstFout` enz. bestaan nog niet.

- [ ] **Step 4: Implementatie**

In `verifieer.rs`: vervang het importblok bovenaan (de `use`-regels direct onder de module-documentatie) door:

```rust
use serde::Serialize;

use super::algoritme::{controleer_handtekening, Hashalg, WaardeFout};
use super::bytebereik::Bytebereik;
use super::certificaat::common_name;
use super::cms_lees::{
    lees_certificaat, lees_signed_data, zoek_ondertekenaar, Certificaat, Ondertekenaar, SignedData,
    ID_SIGNATURE_TIME_STAMP_TOKEN,
};
use super::pdf_lezen::{lees_handtekeningvelden, HandtekeningVeld, PdfLeesFout, SigWoordenboek};
use super::status::{leeg_veld, leid_af, Integriteit, OnleesbaarReden, Status, Vertrouwen};
use super::tijdstempel::controleer_token;
use super::vertrouwen::{beoordeel, Rol, Vertrouwensarchief};
```

Voeg daarna, direct boven `#[cfg(test)]`, toe:

```rust
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
    pub detail: Option<String>,
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
    pub woordenboek_ondertekend: bool,
    pub keten: Vec<CertificaatSamenvatting>,
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
fn geordende_velden(bytes: &[u8]) -> Result<Vec<(HandtekeningVeld, Option<Bytebereik>)>, LijstFout> {
    let velden = lees_handtekeningvelden(bytes).map_err(|PdfLeesFout::Onleesbaar(detail)| LijstFout::PdfOnleesbaar { detail })?;
    let mut lijst: Vec<(HandtekeningVeld, Option<Bytebereik>)> = velden
        .into_iter()
        .map(|v| {
            let bereik = v.waarde.as_ref().and_then(|w| Bytebereik::uit_getallen(&w.bytebereik, bytes.len()).ok());
            (v, bereik)
        })
        .collect();
    lijst.sort_by_key(|(_, b)| b.map_or(usize::MAX, |b| b.einde()));
    Ok(lijst)
}

/// Alle handtekeningen van een document, elk met integriteit, dekking en vertrouwen.
pub fn verifieer_document(bytes: &[u8], archief: &Vertrouwensarchief, nu_unix: i64) -> Result<Vec<HandtekeningInfo>, LijstFout> {
    Ok(geordende_velden(bytes)?
        .into_iter()
        .enumerate()
        .map(|(nummer, (veld, _))| verifieer_veld(bytes, nummer, veld, archief, nu_unix))
        .collect())
}

fn verifieer_veld(bytes: &[u8], nummer: usize, veld: HandtekeningVeld, archief: &Vertrouwensarchief, nu_unix: i64) -> HandtekeningInfo {
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
    };
    let (integriteit, vertrouwen) = beoordeel_handtekening(bytes, &sig, soort, archief, nu_unix, &mut info);
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

fn beoordeel_handtekening(
    bytes: &[u8],
    sig: &SigWoordenboek,
    soort: Soort,
    archief: &Vertrouwensarchief,
    nu_unix: i64,
    info: &mut HandtekeningInfo,
) -> (Integriteit, Vertrouwen) {
    let niet = |reden| (Integriteit::NietTeControleren { reden }, Vertrouwen::NietBepaald);
    let bereik = match Bytebereik::uit_getallen(&sig.bytebereik, bytes.len()) {
        Ok(b) => b,
        Err(e) => {
            info.detail = Some(e.to_string());
            return niet(OnleesbaarReden::BytebereikOngeldig);
        }
    };
    info.bereik_einde = Some(bereik.einde() as u64);
    info.dekt_hele_document = bereik.dekt_hele_document(bytes.len());
    if let Err(e) = bereik.controleer_gat(bytes) {
        info.detail = Some(e.to_string());
        return niet(OnleesbaarReden::BytebereikOngeldig);
    }
    let Some(delen) = bereik.delen(bytes) else {
        return niet(OnleesbaarReden::BytebereikOngeldig);
    };
    match soort {
        Soort::Onbekend | Soort::LeegVeld => {
            info.detail = sig.subfilter.clone();
            niet(OnleesbaarReden::VerouderdFormaat)
        }
        Soort::Documenttijdstempel => {
            let t = controleer_token(&sig.contents, &delen);
            info.detail = t.detail.clone();
            info.ondertekenaar = t.tsa.as_ref().map(naam_van);
            info.uitgever = t.tsa.as_ref().map(|c| common_name(&c.x509.tbs_certificate.issuer));
            if let Some(tijd) = t.tijd_unix {
                info.tijd_unix = Some(tijd);
                info.tijd_bron = TijdBron::Tijdstempel;
            }
            let vertrouwen = match (t.integriteit, &t.tsa, t.tijd_unix) {
                (Integriteit::Intact, Some(tsa), Some(tijd)) => {
                    let k = beoordeel(tsa, &t.certificaten, archief, tijd, Rol::Tijdstempeldienst);
                    info.keten = samenvatting(&k.keten);
                    k.vertrouwen
                }
                _ => Vertrouwen::NietBepaald,
            };
            (t.integriteit, vertrouwen)
        }
        Soort::Handtekening => {
            let c = integriteit_cms(&sig.contents, &delen);
            info.detail = c.detail.clone();
            info.ondertekenaar = c.certificaat.as_ref().map(naam_van);
            info.uitgever = c.certificaat.as_ref().map(|x| common_name(&x.x509.tbs_certificate.issuer));
            let mut relevante_tijd = nu_unix;
            if let Some(token) = &c.tijdstempeltoken {
                let t = controleer_token(token, &[c.handtekeningwaarde.as_slice()]);
                let tsa_vertrouwen = match (t.integriteit, &t.tsa, t.tijd_unix) {
                    (Integriteit::Intact, Some(tsa), Some(tijd)) => {
                        beoordeel(tsa, &t.certificaten, archief, tijd, Rol::Tijdstempeldienst).vertrouwen
                    }
                    _ => Vertrouwen::NietBepaald,
                };
                if let (Integriteit::Intact, Some(tijd)) = (t.integriteit, t.tijd_unix) {
                    info.tijd_unix = Some(tijd);
                    info.tijd_bron = TijdBron::Tijdstempel;
                    if tsa_vertrouwen == Vertrouwen::Vertrouwd {
                        relevante_tijd = tijd;
                    }
                }
                info.tijdstempel = Some(TijdstempelInfo {
                    tijd_unix: t.tijd_unix,
                    tsa: t.tsa.as_ref().map(naam_van),
                    integriteit: t.integriteit,
                    vertrouwen: tsa_vertrouwen,
                });
            }
            let vertrouwen = match (c.integriteit, &c.certificaat) {
                (Integriteit::Intact, Some(cert)) => {
                    let k = beoordeel(cert, &c.certificaten, archief, relevante_tijd, Rol::Ondertekenaar);
                    info.keten = samenvatting(&k.keten);
                    k.vertrouwen
                }
                (_, Some(cert)) => {
                    info.keten = samenvatting(std::slice::from_ref(cert));
                    Vertrouwen::NietBepaald
                }
                _ => Vertrouwen::NietBepaald,
            };
            (c.integriteit, vertrouwen)
        }
    }
}

/// De bytes van het document zoals handtekening `nummer` ze ondertekende.
pub fn ondertekende_versie(bytes: &[u8], nummer: usize) -> Result<&[u8], LijstFout> {
    let bereik = geordende_velden(bytes)?
        .get(nummer)
        .and_then(|(_, b)| *b)
        .ok_or(LijstFout::GeenHandtekening)?;
    bereik.ondertekende_versie(bytes).ok_or(LijstFout::GeenHandtekening)
}

fn nu_unix() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| i64::try_from(d.as_secs()).unwrap_or(i64::MAX))
        .unwrap_or(0)
}

/// Verifieert alle handtekeningen in `pad` (spec §4.1). Loopt op een aparte
/// thread: het rootarchief laden en hashen houdt het openen niet op (spec §7.3).
#[tauri::command]
pub async fn pdf_signature_list(pad: String) -> Result<Vec<HandtekeningInfo>, LijstFout> {
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = std::fs::read(&pad).map_err(io_fout)?;
        verifieer_document(&bytes, Vertrouwensarchief::systeem(), nu_unix())
    })
    .await
    .map_err(io_fout)?
}

/// Schrijft de ondertekende versie van handtekening `nummer` naar een tijdelijk
/// bestand en geeft het pad (spec §4.1, "Toon ondertekende versie").
#[tauri::command]
pub async fn pdf_signed_revision(pad: String, nummer: usize) -> Result<String, LijstFout> {
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = std::fs::read(&pad).map_err(io_fout)?;
        let versie = ondertekende_versie(&bytes, nummer)?;
        let map = std::env::temp_dir().join("opds-ondertekende-versies");
        std::fs::create_dir_all(&map).map_err(io_fout)?;
        let stam = std::path::Path::new(&pad)
            .file_stem()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_else(|| "document".to_string());
        let millis = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);
        let doel = map.join(format!("{stam}-rev{}-{millis}.pdf", nummer + 1));
        std::fs::write(&doel, versie).map_err(io_fout)?;
        Ok(doel.to_string_lossy().into_owned())
    })
    .await
    .map_err(io_fout)?
}
```

Vervang tot slot de module-documentatie bovenaan `verifieer.rs` door:

```rust
//! Handtekeningen verifiëren (spec §7): integriteit per soort, dekking,
//! vertrouwen en de getoonde status, plus de Tauri-commando's
//! `pdf_signature_list` en `pdf_signed_revision`.
```

- [ ] **Step 5: Commando's registreren**

In `open-pdf-studio/src-tauri/src/lib.rs`, in `tauri::generate_handler![…]`, vervang de regel:

```rust
            handtekening::certificaat::pdf_certificate_info,
```

door:

```rust
            handtekening::certificaat::pdf_certificate_info,
            handtekening::verifieer::pdf_signature_list,
            handtekening::verifieer::pdf_signed_revision,
```

- [ ] **Step 6: Tests draaien**

```bash
cd open-pdf-studio/src-tauri && CARGO_TARGET_DIR="$BUILDMAP" cargo test --lib handtekening::verifieer 2>&1 | grep -E "test result|panicked"
CARGO_TARGET_DIR="$BUILDMAP" cargo check 2>&1 | grep -E -A3 "^(warning|error)" | grep -B1 -A2 "handtekening/" | head -20
```
Expected: `test result: ok. 16 passed; 0 failed`; de tweede opdracht toont niets (geen fout of waarschuwing in `handtekening/`).

- [ ] **Step 7: Rest groen, dan commit**

```bash
cd open-pdf-studio/src-tauri && CARGO_TARGET_DIR="$BUILDMAP" cargo test --lib handtekening 2>&1 | grep -E "^test result"
cd .. && npm run test:unit 2>&1 | grep -E "^(#|ℹ) (pass|fail)" && npx vite build > /dev/null 2>&1; echo "vite exit $?"
cd .. && git add open-pdf-studio/src-tauri/src/lib.rs open-pdf-studio/src-tauri/src/handtekening/certificaat.rs open-pdf-studio/src-tauri/src/handtekening/verifieer.rs
git commit -m "feat(handtekening): handtekeningen van een document verifiëren via pdf_signature_list en pdf_signed_revision"
```
Expected: `0 failed`; `fail 0`; `vite exit 0`.

---

### Task 12: Manifest per handtekening, orakel en corpustest

**Files:**
- Create: `scripts/pades-orakel.py`
- Modify: `scripts/handtekening-testdata.json` (per PAdES-bestand een veld `handtekeningen`, plus `meting`)
- Modify: `open-pdf-studio/src-tauri/src/handtekening/verifieer.rs` (corpustest)

**Interfaces:**
- Consumes: `verifieer::{verifieer_document, HandtekeningInfo, Soort}`, `status::{Integriteit, Status}`, `vertrouwen::Vertrouwensarchief` (Tasks 1, 10, 11); corpus via `python scripts/haal-handtekening-testdata.py`.
- Produces:
  - Manifest: per PAdES-bestand `handtekeningen: [{ soort, dekt?, integriteit?, reden?, tijdstempel? }]` in revisievolgorde (einde van het bytebereik; lege velden en ongeldige bereiken achteraan). `soort` ∈ `handtekening | documenttijdstempel | leeg-veld | onbekend`; `integriteit` ∈ `intact | gewijzigd | ongeldig | niet-te-controleren`; `reden` alleen bij niet-te-controleren; `tijdstempel` = integriteit van een handtekeningtijdstempel. Een leeg veld heeft alleen `soort`.
  - `scripts/pades-orakel.py`: onafhankelijke meting (PDFium via `pypdfium2`, eigen DER-lezer in Python, `cryptography`); `--controleer` vergelijkt met het manifest.
  - Rust-test `corpus_volgens_manifest` die `verifieer_document` tegen het manifest legt.
  - *Na de derde review:* elke rij (behalve `leeg-veld`, dat naast `soort` alleen `veldnaam` krijgt) heeft ook `veldnaam` (als bekend), `woordenboekOndertekend`, `bereikEinde` (bij een bruikbaar bereik), `tijdBron` en `opgegevenRedenSha256` (SHA-256 in hex van de `/Reason` uit het gebruikte exemplaar; als hash omdat redenen in het corpus namen van personen en producten bevatten, die niet in de repo horen). De sleutel `reden` blijft de reden van niet-te-controleren. De reden van het vertrouwensoordeel staat er niet in: die hangt af van het rootarchief van de machine en van de klok. `als_manifestregel` maakt dezelfde vorm; de corpustest controleert daarnaast in het manifest zelf dat `pades-spoofing-replaced-reason.pdf` `woordenboekOndertekend: true` heeft en als reden de hash van "DSS testing" (niet die van de later vervangen reden).
  - Het orakel meet die velden zelf, onafhankelijk van `pdf_lezen.rs`: een eigen kleine PDF-lezer zoekt objectkoppen en objectstromen in de bytes, kiest bij meer exemplaren van het handtekeningwoordenboek (zelfde bytebereik en `/Contents`) het nieuwste binnen het eigen bereik, leest veldnamen (via `/V` en `/Parent`, voorkeur voor het veld binnen het bereik, anders `/Fields`-volgorde), en ontsleutelt tekstvelden met RC4 (Standard, V 1–2, R 2–3). CMS aangescherpt: contentType-attribuut precies één keer en gelijk aan eContentType, geen eContent bij een losse handtekening en eContentType id-data (anders ook geen tijdstempel), alle passende certificaten proberen, en zonder ondertekende attributen de PKCS#1-DigestInfo terughalen om gewijzigd van ongeldig te scheiden.
  - `OPDS_CORPUS_VERPLICHT=1`: corpustests (PAdES in `pdf_lezen` en `verifieer`, PKCS#12 in `pkcs12` en `certificaat`) falen als het corpus ontbreekt, in plaats van over te slaan (`handtekening::corpusmap`).

Het bestaande veld `verwacht` (vrije tekst) blijft staan; de test gebruikt alleen `handtekeningen`. De eindstatus wordt niet getoetst: de corpuscertificaten komen van test-CA's buiten elk rootarchief (spec §9.2). Wel: zonder rootarchief is niets "Geldig", en elke intacte handtekening die niet tot het einde reikt, krijgt "daarna gewijzigd".

Afwijkingen van de tabel in spec §9.2, gemeten: `malformed-pades.pdf` is *gewijzigd* (niet "niet te controleren"): via xref-herstel is de handtekening leesbaar en `messageDigest` wijkt af, want de kopregel is overschreven. `BadEncodedCMS.pdf` heeft reden *geen-certificaat*: de CMS is leesbaar, het enige certificaat niet (niet-minimaal serienummer). De documenttijdstempelrijen zijn nu bevestigd: alle vier intact.

- [ ] **Step 1: Orakel toevoegen**

`scripts/pades-orakel.py` (letterlijk):

```python
"""Onafhankelijk orakel voor PAdES-integriteit en -dekking.

Leest handtekeningen met PDFium (pypdfium2), niet met de eigen PDF-lezer; CMS
en tijdstempels met een eigen kleine DER-lezer in Python; handtekeningwaarden
met `cryptography`. Uitkomst per handtekening, in dezelfde termen als de
verifier in de app:

  soort        handtekening | documenttijdstempel | leeg-veld | onbekend
  integriteit  intact | gewijzigd | ongeldig | niet-te-controleren
  reden        bij niet-te-controleren: cms-onleesbaar | geen-certificaat |
               algoritme-niet-ondersteund | bytebereik-ongeldig | verouderd-formaat
  dekt         bereikt het bytebereik het einde van het bestand?
  tijdstempel  integriteit van een handtekeningtijdstempel, indien aanwezig

Volgorde: op het einde van het bytebereik (revisievolgorde); lege velden achteraan.

Kan PDFium een bestand niet openen, dan zoekt het orakel `/ByteRange` en het
bijbehorende gat rechtstreeks in de bytes (alleen voor bestanden met één
handtekening).

Gebruik (vanuit de repo-root):
  python scripts/pades-orakel.py              # uitkomsten als JSON
  python scripts/pades-orakel.py --controleer # vergelijken met het manifest

Vereist: pip install pypdfium2 cryptography
"""
import ctypes
import hashlib
import json
import os
import re
import sys

import pypdfium2 as pdfium
import pypdfium2.raw as raw
from cryptography import x509
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec, padding, rsa

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MANIFEST = os.path.join(ROOT, "scripts", "handtekening-testdata.json")
MAP = os.path.join(ROOT, "testdata", "handtekeningen", "pades")

HASH = {"1.3.14.3.2.26": "sha1", "2.16.840.1.101.3.4.2.1": "sha256",
        "2.16.840.1.101.3.4.2.2": "sha384", "2.16.840.1.101.3.4.2.3": "sha512"}
RSA_V15 = {"1.2.840.113549.1.1.5": "sha1", "1.2.840.113549.1.1.11": "sha256",
           "1.2.840.113549.1.1.12": "sha384", "1.2.840.113549.1.1.13": "sha512"}
ECDSA = {"1.2.840.10045.4.1": "sha1", "1.2.840.10045.4.3.2": "sha256",
         "1.2.840.10045.4.3.3": "sha384", "1.2.840.10045.4.3.4": "sha512"}
RSA_ENCRYPTION = "1.2.840.113549.1.1.1"
RSASSA_PSS = "1.2.840.113549.1.1.10"
EC_PUBLIC_KEY = "1.2.840.10045.2.1"
ID_TSTINFO = "1.2.840.113549.1.9.16.1.4"
ID_SIGNED_DATA = "1.2.840.113549.1.7.2"
MESSAGE_DIGEST = "1.2.840.113549.1.9.4"
TIMESTAMP_TOKEN = "1.2.840.113549.1.9.16.2.14"


class Niet(Exception):
    """Niet te controleren, met reden."""


# ---------- DER / BER ----------

def kop(b, i):
    tag = b[i]
    if tag & 0x1F == 0x1F:
        raise ValueError("hoge tag")
    l0 = b[i + 1]
    if l0 == 0x80:
        return tag, None, i + 2
    if l0 < 0x80:
        return tag, l0, i + 2
    n = l0 & 0x7F
    return tag, int.from_bytes(b[i + 2:i + 2 + n], "big"), i + 2 + n


def lengte(n):
    if n < 0x80:
        return bytes([n])
    x = n.to_bytes((n.bit_length() + 7) // 8, "big")
    return bytes([0x80 | len(x)]) + x


def normaliseer(b, i=0, diepte=0):
    """BER -> DER (onbepaalde lengtes, samengestelde OCTET STRING). Geeft (der, volgende)."""
    if diepte > 64:
        raise ValueError("te diep")
    tag, n, s = kop(b, i)
    if not tag & 0x20:
        if n is None or s + n > len(b):
            raise ValueError("primitief ongeldig")
        return bytes([tag]) + lengte(n) + b[s:s + n], s + n
    delen = []
    if n is None:
        j = s
        while b[j:j + 2] != b"\x00\x00":
            d, j = normaliseer(b, j, diepte + 1)
            delen.append(d)
        einde = j + 2
    else:
        einde = s + n
        if einde > len(b):
            raise ValueError("afgekapt")
        j = s
        while j < einde:
            d, j = normaliseer(b, j, diepte + 1)
            delen.append(d)
    if tag == 0x24:
        inhoud = b"".join(inh(d) for d in delen)
        return b"\x04" + lengte(len(inhoud)) + inhoud, einde
    inhoud = b"".join(delen)
    return bytes([tag]) + lengte(len(inhoud)) + inhoud, einde


def tlv(b, i=0):
    tag, n, s = kop(b, i)
    if n is None or s + n > len(b):
        raise ValueError("geen DER")
    return tag, s, s + n


def inh(b):
    _, s, e = tlv(b)
    return b[s:e]


def kinderen(b):
    """Kinderen van een samengesteld DER-element `b` (volledige TLV's)."""
    _, s, e = tlv(b)
    uit, j = [], s
    while j < e:
        _, cs, ce = tlv(b, j)
        uit.append(b[j:ce])
        j = ce
    return uit


def oid(b):
    t, s, e = tlv(b)
    if t != 0x06:
        raise ValueError("geen OID")
    delen, v, eerste = [], 0, True
    for x in b[s:e]:
        v = (v << 7) | (x & 0x7F)
        if not x & 0x80:
            if eerste:
                a = min(v // 40, 2)
                delen += [a, v - 40 * a]
                eerste = False
            else:
                delen.append(v)
            v = 0
    return ".".join(map(str, delen))


def attributen(b):
    uit = {}
    for a in kinderen(b):
        k = kinderen(a)
        uit.setdefault(oid(k[0]), kinderen(k[1]))
    return uit


def signed_data(contents):
    der, _ = normaliseer(contents)
    ci = kinderen(der)
    if oid(ci[0]) != ID_SIGNED_DATA:
        raise ValueError("geen SignedData")
    sd = kinderen(ci[1])[0]
    velden = kinderen(sd)
    eci = kinderen(velden[2])
    econtent = inh(kinderen(eci[1])[0]) if len(eci) > 1 else None
    certs, signers = [], None
    for v in velden[3:]:
        if v[0] == 0xA0:
            certs = [c for c in kinderen(v) if c[0] == 0x30]
        elif v[0] == 0x31:
            signers = kinderen(v)
    si = kinderen(signers[0])
    j = 1
    sid = si[j]; j += 1
    digalg = oid(kinderen(si[j])[0]); j += 1
    sa = None
    attrs = {}
    if si[j][0] == 0xA0:
        sa = b"\x31" + si[j][1:]
        attrs = attributen(si[j])
        j += 1
    alg = kinderen(si[j]); j += 1
    handtekening = inh(si[j]); j += 1
    unsigned = attributen(si[j]) if j < len(si) and si[j][0] == 0xA1 else {}
    return {"econtype": oid(eci[0]), "econtent": econtent, "certs": certs, "sid": sid,
            "digalg": digalg, "signed_attrs": sa, "attrs": attrs, "sigalg": oid(alg[0]),
            "sigparams": alg[1] if len(alg) > 1 else None, "handtekening": handtekening,
            "unsigned": unsigned}


def zoek_cert(sd):
    sid = sd["sid"]
    for c in sd["certs"]:
        try:
            cert = x509.load_der_x509_certificate(c)
        except ValueError:
            continue
        if sid[0] == 0x30:
            ias = kinderen(sid)
            serie = int.from_bytes(inh(ias[1]), "big", signed=True)
            if cert.serial_number == serie and cert.issuer.public_bytes() == ias[0]:
                return cert
        else:
            try:
                ski = cert.extensions.get_extension_for_class(x509.SubjectKeyIdentifier).value.digest
            except x509.ExtensionNotFound:
                continue
            if ski == inh(sid):
                return cert
    return None


def hashobj(naam):
    return {"sha1": hashes.SHA1(), "sha256": hashes.SHA256(),
            "sha384": hashes.SHA384(), "sha512": hashes.SHA512()}[naam]


def pss_hash(params):
    h, mgf, zout = "sha1", "sha1", 20
    if params:
        for v in kinderen(params):
            b = inh(v)
            if v[0] == 0xA0:
                h = HASH.get(oid(kinderen(b)[0]))
            elif v[0] == 0xA1:
                mgf = HASH.get(oid(kinderen(kinderen(b)[1])[0]))
            elif v[0] == 0xA2:
                zout = int.from_bytes(inh(b), "big")
    if h is None or h != mgf:
        raise Niet("algoritme-niet-ondersteund")
    return h, zout


def controleer_waarde(cert, sd, gegevens):
    pk = cert.public_key()
    alg, standaard = sd["sigalg"], HASH.get(sd["digalg"])
    try:
        if alg in RSA_V15 or alg == RSA_ENCRYPTION:
            h = RSA_V15.get(alg, standaard)
            if not isinstance(pk, rsa.RSAPublicKey) or h is None:
                raise Niet("algoritme-niet-ondersteund")
            pk.verify(sd["handtekening"], gegevens, padding.PKCS1v15(), hashobj(h))
        elif alg == RSASSA_PSS:
            h, zout = pss_hash(sd["sigparams"])
            if not isinstance(pk, rsa.RSAPublicKey):
                raise Niet("algoritme-niet-ondersteund")
            pk.verify(sd["handtekening"], gegevens, padding.PSS(padding.MGF1(hashobj(h)), zout), hashobj(h))
        elif alg in ECDSA or alg == EC_PUBLIC_KEY:
            h = ECDSA.get(alg, standaard)
            if not isinstance(pk, ec.EllipticCurvePublicKey) or pk.curve.name not in ("secp256r1", "secp384r1") or h is None:
                raise Niet("algoritme-niet-ondersteund")
            pk.verify(sd["handtekening"], gegevens, ec.ECDSA(hashobj(h)))
        else:
            raise Niet("algoritme-niet-ondersteund")
        return True
    except InvalidSignature:
        return False


def controleer_ondertekenaar(sd, inhoud):
    """intact | gewijzigd | ongeldig; Niet bij niet te controleren."""
    h = HASH.get(sd["digalg"])
    if h is None:
        raise Niet("algoritme-niet-ondersteund")
    if sd["signed_attrs"] is not None:
        md = sd["attrs"].get(MESSAGE_DIGEST)
        if not md:
            raise Niet("cms-onleesbaar")
        if hashlib.new(h, inhoud).digest() != inh(md[0]):
            return "gewijzigd"
        gegevens = sd["signed_attrs"]
    else:
        gegevens = inhoud
    cert = zoek_cert(sd)
    if cert is None:
        raise Niet("geen-certificaat")
    if controleer_waarde(cert, sd, gegevens):
        return "intact"
    return "ongeldig" if sd["signed_attrs"] is not None else "gewijzigd"


def controleer_token(token, gegevens):
    try:
        sd = signed_data(token)
    except (ValueError, IndexError):
        raise Niet("cms-onleesbaar")
    if sd["econtype"] != ID_TSTINFO or sd["econtent"] is None:
        raise Niet("cms-onleesbaar")
    velden = kinderen(sd["econtent"])
    mi = kinderen(velden[2])
    h = HASH.get(oid(kinderen(mi[0])[0]))
    if h is None:
        raise Niet("algoritme-niet-ondersteund")
    if hashlib.new(h, gegevens).digest() != inh(mi[1]):
        return "gewijzigd"
    uitkomst = controleer_ondertekenaar(sd, sd["econtent"])
    return "ongeldig" if uitkomst == "gewijzigd" else uitkomst


def soort_van(subfilter):
    if subfilter == "ETSI.RFC3161":
        return "documenttijdstempel"
    if subfilter in ("ETSI.CAdES.detached", "adbe.pkcs7.detached"):
        return "handtekening"
    return "onbekend"


def beoordeel(data, br, contents, subfilter):
    rij = {"soort": soort_van(subfilter)}
    geldig = (len(br) == 4 and min(br) >= 0 and br[0] == 0 and br[1] + 2 <= br[2]
              and br[2] + br[3] <= len(data) and data[br[1]:br[1] + 1] == b"<"
              and data[br[2] - 1:br[2]] == b">")
    if not geldig:
        rij.update(integriteit="niet-te-controleren", reden="bytebereik-ongeldig", dekt=False)
        return rij, None
    rij["dekt"] = br[2] + br[3] == len(data)
    inhoud = data[br[0]:br[0] + br[1]] + data[br[2]:br[2] + br[3]]
    try:
        if rij["soort"] == "onbekend":
            raise Niet("verouderd-formaat")
        if rij["soort"] == "documenttijdstempel":
            rij["integriteit"] = controleer_token(contents, inhoud)
        else:
            try:
                sd = signed_data(contents)
            except (ValueError, IndexError):
                raise Niet("cms-onleesbaar")
            token = sd["unsigned"].get(TIMESTAMP_TOKEN)
            if token:
                try:
                    rij["tijdstempel"] = controleer_token(token[0], sd["handtekening"])
                except Niet:
                    rij["tijdstempel"] = "niet-te-controleren"
            rij["integriteit"] = controleer_ondertekenaar(sd, inhoud)
    except Niet as n:
        rij.update(integriteit="niet-te-controleren", reden=str(n))
    return rij, br[2] + br[3]


def lees_str(fn, obj):
    n = fn(obj, None, 0)
    if n <= 0:
        return ""
    buf = ctypes.create_string_buffer(n)
    fn(obj, buf, n)
    return buf.raw[:n].rstrip(b"\x00").decode("latin-1")


def onderzoek(pad):
    data = open(pad, "rb").read()
    rijen = []
    try:
        doc = pdfium.PdfDocument(pad)
    except pdfium.PdfiumError:
        doc = None
    if doc is not None:
        for i in range(raw.FPDF_GetSignatureCount(doc.raw)):
            sig = raw.FPDF_GetSignatureObject(doc.raw, i)
            nbr = raw.FPDFSignatureObj_GetByteRange(sig, None, 0)
            if nbr <= 0:
                rijen.append(({"soort": "leeg-veld"}, None))
                continue
            buf = (ctypes.c_int * nbr)()
            raw.FPDFSignatureObj_GetByteRange(sig, buf, nbr)
            n = raw.FPDFSignatureObj_GetContents(sig, None, 0)
            cb = ctypes.create_string_buffer(max(n, 1))
            raw.FPDFSignatureObj_GetContents(sig, cb, n)
            rijen.append(beoordeel(data, list(buf), cb.raw[:n], lees_str(raw.FPDFSignatureObj_GetSubFilter, sig)))
        doc.close()
    else:
        treffers = list(re.finditer(rb"/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]", data))
        if len(treffers) != 1:
            raise SystemExit(f"{pad}: ruwe scan ondersteunt precies één handtekening")
        br = [int(x) for x in treffers[0].groups()]
        gat = re.sub(rb"\s", b"", data[br[1]:br[2]].strip(b"<>"))
        sf = re.search(rb"/SubFilter\s*/([A-Za-z0-9.]+)", data)
        rijen.append(beoordeel(data, br, bytes.fromhex(gat.decode()), sf.group(1).decode() if sf else ""))
    rijen.sort(key=lambda r: r[1] if r[1] is not None else float("inf"))
    return [r for r, _ in rijen]


def main():
    manifest = json.load(open(MANIFEST, encoding="utf-8"))
    uitkomst, fouten = {}, []
    for b in manifest["bronnen"]["pades"]["bestanden"]:
        rijen = onderzoek(os.path.join(MAP, b["bestand"]))
        uitkomst[b["bestand"]] = rijen
        if "--controleer" in sys.argv and rijen != b.get("handtekeningen"):
            fouten.append(f"{b['bestand']}: orakel {rijen} != manifest {b.get('handtekeningen')}")
    if "--controleer" in sys.argv:
        print("\n".join(fouten) if fouten else f"{len(uitkomst)} bestanden gelijk aan het manifest")
        sys.exit(1 if fouten else 0)
    print(json.dumps(uitkomst, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Manifest uitbreiden met gemeten verwachtingen**

Run vanuit de worktree-root (tijdelijk script buiten de repo; de verwachtingen zijn vooraf gemeten met het orakel uit Step 1):

```bash
cat > "$TEMP/manifest-handtekeningen.py" <<'PY'
import json
PAD = "scripts/handtekening-testdata.json"
VERWACHT = json.loads("""{
    "pades-bes.pdf": [{"soort": "handtekening", "dekt": true, "integriteit": "intact"}],
    "pades3_Baseline_B.pdf": [{"soort": "handtekening", "dekt": false, "integriteit": "intact"}, {"soort": "documenttijdstempel", "dekt": false, "integriteit": "intact"}, {"soort": "documenttijdstempel", "dekt": false, "integriteit": "intact"}, {"soort": "handtekening", "dekt": true, "integriteit": "intact"}],
    "doc-firmado.pdf": [{"soort": "handtekening", "dekt": false, "tijdstempel": "intact", "integriteit": "intact"}, {"soort": "documenttijdstempel", "dekt": true, "integriteit": "intact"}],
    "doc-firmado-T.pdf": [{"soort": "handtekening", "dekt": true, "tijdstempel": "intact", "integriteit": "intact"}],
    "doc-firmado-LT.pdf": [{"soort": "handtekening", "dekt": false, "tijdstempel": "intact", "integriteit": "intact"}],
    "hello_signed_INCSAVE_signed.pdf": [{"soort": "handtekening", "dekt": false, "integriteit": "intact"}, {"soort": "handtekening", "dekt": true, "integriteit": "intact"}],
    "hello_signed_INCSAVE_signed_EDITED.pdf": [{"soort": "handtekening", "dekt": false, "integriteit": "intact"}, {"soort": "handtekening", "dekt": false, "integriteit": "gewijzigd"}],
    "modified_after_signature.pdf": [{"soort": "handtekening", "dekt": false, "integriteit": "intact"}],
    "pades-signed-annot-added.pdf": [{"soort": "handtekening", "dekt": false, "integriteit": "intact"}, {"soort": "leeg-veld"}],
    "pades-5-signatures-and-1-document-timestamp.pdf": [{"soort": "handtekening", "dekt": false, "tijdstempel": "intact", "integriteit": "intact"}, {"soort": "handtekening", "dekt": false, "tijdstempel": "intact", "integriteit": "intact"}, {"soort": "handtekening", "dekt": false, "integriteit": "intact"}, {"soort": "handtekening", "dekt": false, "integriteit": "intact"}, {"soort": "handtekening", "dekt": false, "integriteit": "intact"}, {"soort": "documenttijdstempel", "dekt": true, "integriteit": "intact"}],
    "pades-bes-no-certificates.pdf": [{"soort": "handtekening", "dekt": true, "integriteit": "niet-te-controleren", "reden": "geen-certificaat"}],
    "pades-unsupported-signature-algorithm.pdf": [{"soort": "handtekening", "dekt": true, "integriteit": "niet-te-controleren", "reden": "algoritme-niet-ondersteund"}],
    "BadEncodedCMS.pdf": [{"soort": "handtekening", "dekt": true, "tijdstempel": "niet-te-controleren", "integriteit": "niet-te-controleren", "reden": "geen-certificaat"}],
    "malformed-pades.pdf": [{"soort": "handtekening", "dekt": true, "integriteit": "gewijzigd"}],
    "malformed-rsa-digestinfo.pdf": [{"soort": "handtekening", "dekt": true, "integriteit": "ongeldig"}],
    "encrypted.pdf": [{"soort": "handtekening", "dekt": true, "integriteit": "intact"}],
    "pades-spoofing-replaced-reason.pdf": [{"soort": "handtekening", "dekt": false, "integriteit": "intact"}],
    "pades-alter-signature-appearance-modify-stream.pdf": [{"soort": "handtekening", "dekt": false, "integriteit": "intact"}, {"soort": "handtekening", "dekt": false, "integriteit": "intact"}]
}""")
manifest = json.load(open(PAD, encoding="utf-8"))
pades = manifest["bronnen"]["pades"]
pades["meting"] = ("handtekeningen: gemeten met scripts/pades-orakel.py (PDFium, eigen DER-lezer, cryptography); "
                   "malformed-pades.pdf via de ruwe scan in dat script, omdat PDFium het bestand weigert")
for b in pades["bestanden"]:
    b["handtekeningen"] = VERWACHT[b["bestand"]]
with open(PAD, "w", encoding="utf-8", newline="\n") as f:
    f.write(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")
print(len(pades["bestanden"]), "bestanden bijgewerkt")
PY
python "$TEMP/manifest-handtekeningen.py" && rm "$TEMP/manifest-handtekeningen.py"
git diff --stat scripts/handtekening-testdata.json
```
Expected: `18 bestanden bijgewerkt`; in de diff alleen toevoegingen (plus de komma achter elke `verwacht`-regel).

- [ ] **Step 3: Orakel tegen het manifest**

```bash
pip install pypdfium2 cryptography > /dev/null
python scripts/haal-handtekening-testdata.py --controleer
PYTHONIOENCODING=utf-8 python scripts/pades-orakel.py --controleer
```
Expected: `18 bestanden gelijk aan het manifest`.

- [ ] **Step 4: Corpustest schrijven**

Voeg in `open-pdf-studio/src-tauri/src/handtekening/verifieer.rs` onderaan **binnen** `mod tests { … }` toe:

```rust
    /// Zelfde vorm als een regel in `handtekeningen` van het manifest.
    fn als_manifestregel(h: &HandtekeningInfo) -> serde_json::Value {
        let mut regel = serde_json::Map::new();
        regel.insert("soort".into(), serde_json::to_value(h.soort).unwrap());
        if h.soort == Soort::LeegVeld {
            return serde_json::Value::Object(regel);
        }
        regel.insert("dekt".into(), serde_json::Value::Bool(h.dekt_hele_document));
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
        let map = root.join("testdata/handtekeningen/pades");
        if !map.is_dir() {
            eprintln!("corpus ontbreekt ({}); draai scripts/haal-handtekening-testdata.py", map.display());
            return;
        }
        let manifest: serde_json::Value =
            serde_json::from_slice(&std::fs::read(root.join("scripts/handtekening-testdata.json")).unwrap()).unwrap();
        let bestanden = manifest["bronnen"]["pades"]["bestanden"].as_array().unwrap();
        assert_eq!(bestanden.len(), 18);
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
            }
        }
        assert!(fouten.is_empty(), "{}", fouten.join("\n"));
    }
```

- [ ] **Step 5: Tests draaien**

```bash
cd open-pdf-studio/src-tauri && CARGO_TARGET_DIR="$BUILDMAP" cargo test --lib handtekening::verifieer -- --nocapture 2>&1 | grep -E "test result|panicked|corpus ontbreekt|gemeten|verwacht"
```
Expected: `test result: ok. 17 passed; 0 failed`, zonder `corpus ontbreekt`. Faalt `corpus_volgens_manifest`, dan staat per bestand `gemeten` naast `verwacht`: zoek de oorzaak in de betreffende module. Pas het manifest niet aan om de test groen te krijgen; het is onafhankelijk gemeten (Step 3).

- [ ] **Step 6: Rest groen, dan commit**

```bash
cd open-pdf-studio/src-tauri && CARGO_TARGET_DIR="$BUILDMAP" cargo test --lib handtekening 2>&1 | grep -E "^test result"
cd .. && npm run test:unit 2>&1 | grep -E "^(#|ℹ) (pass|fail)" && npx vite build > /dev/null 2>&1; echo "vite exit $?"
cd .. && git add scripts/pades-orakel.py scripts/handtekening-testdata.json open-pdf-studio/src-tauri/src/handtekening/verifieer.rs
git commit -m "test(handtekening): gemeten verwachting per handtekening in het manifest, onafhankelijk orakel en corpustest"
```
Expected: `0 failed`; `fail 0`; `vite exit 0`.

---

### Task 13: i18n-sleutels in alle 39 locales

**Files:**
- Modify: `open-pdf-studio/js/i18n/locales/*/dialogs.json` (39 bestanden)
- Create: `open-pdf-studio/js/pdf/handtekeningen/i18n-sleutels.test.mjs`
- Modify: `open-pdf-studio/package.json` (`test:unit`)

**Interfaces:**
- Consumes: niets.
- Produces: namespace `dialogs`, object `signatureVerification` met 48 sleutels:
  - `checking`, `listError` (`{{detail}}`), `documentTimestamp`, `unknownSigner`, `changedAfterwards`, `details`, `showSignedVersion`, `signedVersionTab` (`{{name}}`, `{{number}}`)
  - `status.{valid, unknownCertificate, modified, invalid, notVerifiable, unsignedField}` — één per `Status`-code uit Rust
  - `reasons.{noChain, expired, keyUsage, unsupportedAlgorithm, cmsUnreadable, noCertificate, byteRangeInvalid, pdfUnreadable, legacyFormat}` — één per `WantrouwenReden`/`OnleesbaarReden`
  - `explanation.{valid, modified, invalid}`
  - `detail.{title, status, explanation, signer, issuer, field, time, timeFromTimestamp ({{time}}), timeClaimed ({{time}}), timestamp, none, reason, location, coverage, coversWhole, coversPart ({{end}}, {{size}}), chain, validFromTo ({{from}}, {{to}}), revocationNotChecked}`
  - `save.{title, message, confirm}`
  - *Open na Task 11:* de JS-kant krijgt `woordenboekOndertekend` en `zwakAlgoritme` (zie Task 14). Het detailvenster (Task 15) heeft daarvoor nog teksten nodig die hierboven ontbreken, bijvoorbeeld `detail.notCoveredBySignature` (achter reden, plaats, contact, opgegeven naam en een `/M`-tijd als `woordenboekOndertekend` `false` is) en `detail.weakAlgorithm` (waarschuwing bij `zwakAlgoritme`, ook op het tijdstempel). Voeg ze bij uitvoering toe aan de sleutellijst, de test en alle 39 vertalingen (het aantal sleutels wordt dan 50).

De locale-bestanden hebben CRLF, twee spaties inspringing en onge-escapete Unicode; het script schrijft ze in precies die vorm terug (gecontroleerd: alle 39 `dialogs.json` gaan ongewijzigd door een lees-schrijfrondgang). Roemeens volgt de bestaande bestanden (zonder diakritische tekens), Servisch Cyrillisch, Portugees Braziliaans, Chinees vereenvoudigd.

- [ ] **Step 1: Sleuteltest schrijven (faalt eerst)**

`open-pdf-studio/js/pdf/handtekeningen/i18n-sleutels.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Alle locales hebben dezelfde handtekeningsleutels met dezelfde plaatshouders als Engels.
const MAP = join(dirname(fileURLToPath(import.meta.url)), '../../i18n/locales');

function plat(obj, voorvoegsel = '') {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === 'object' && v !== null ? plat(v, `${voorvoegsel}${k}.`) : [[`${voorvoegsel}${k}`, v]]);
}

function lees(taal) {
  const data = JSON.parse(readFileSync(join(MAP, taal, 'dialogs.json'), 'utf8'));
  return Object.fromEntries(plat(data.signatureVerification || {}));
}

const plaatshouders = (tekst) => (String(tekst).match(/\{\{\w+\}\}/g) || []).sort();

test('39 locales met identieke handtekeningsleutels en plaatshouders', () => {
  const talen = readdirSync(MAP);
  assert.equal(talen.length, 39);
  const en = lees('en');
  assert.equal(Object.keys(en).length, 48);
  for (const taal of talen) {
    const t = lees(taal);
    assert.deepEqual(Object.keys(t).sort(), Object.keys(en).sort(), taal);
    for (const [sleutel, tekst] of Object.entries(en)) {
      assert.ok(t[sleutel].trim().length > 0, `${taal} ${sleutel} leeg`);
      assert.deepEqual(plaatshouders(t[sleutel]), plaatshouders(tekst), `${taal} ${sleutel}`);
    }
  }
});
```

Voeg in `open-pdf-studio/package.json` aan het eind van het `test:unit`-script toe (vóór het afsluitende aanhalingsteken, na `js/pdf/progressive-view-guard.test.mjs`):

```
 js/pdf/handtekeningen/i18n-sleutels.test.mjs
```

Run (vanuit `open-pdf-studio/`):

```bash
node --test js/pdf/handtekeningen/i18n-sleutels.test.mjs 2>&1 | grep -E "^ℹ (pass|fail)"
```
Expected: `ℹ pass 0` en `ℹ fail 1` (de sleutels bestaan nog niet).

- [ ] **Step 2: Vertalingen toevoegen**

Maak buiten de repo `"$TEMP/handtekening-i18n.py"` met deze inhoud:

```python
"""Voegt dialogs.signatureVerification toe aan alle 39 locales (eenmalig)."""
import json
import os
import sys

MAP = sys.argv[1] if len(sys.argv) > 1 else "open-pdf-studio/js/i18n/locales"

SLEUTELS = [
    "checking", "listError", "documentTimestamp", "unknownSigner", "changedAfterwards", "details",
    "showSignedVersion", "signedVersionTab",
    "status.valid", "status.unknownCertificate", "status.modified", "status.invalid", "status.notVerifiable",
    "status.unsignedField",
    "reasons.noChain", "reasons.expired", "reasons.keyUsage", "reasons.unsupportedAlgorithm",
    "reasons.cmsUnreadable", "reasons.noCertificate", "reasons.byteRangeInvalid", "reasons.pdfUnreadable",
    "reasons.legacyFormat",
    "explanation.valid", "explanation.modified", "explanation.invalid",
    "detail.title", "detail.status", "detail.explanation", "detail.signer", "detail.issuer", "detail.field",
    "detail.time", "detail.timeFromTimestamp", "detail.timeClaimed", "detail.timestamp", "detail.none",
    "detail.reason", "detail.location", "detail.coverage", "detail.coversWhole", "detail.coversPart",
    "detail.chain", "detail.validFromTo", "detail.revocationNotChecked",
    "save.title", "save.message", "save.confirm",
]

T = {
    "en": ["Checking digital signatures…", "The signatures could not be checked: {{detail}}", "Document timestamp", "Unknown signer", "the document was changed afterwards", "Details", "Show signed version", "{{name}} (signed version {{number}})",
           "Valid", "Unknown certificate", "Modified after signing", "Invalid signature", "Cannot be verified", "Unsigned signature field",
           "No chain to a trusted root certificate", "A certificate was not valid at the relevant time", "A certificate is not intended for this use", "Unsupported algorithm", "The signature data cannot be read", "The signer's certificate is missing", "The signed byte range is invalid", "The document structure cannot be read", "Outdated signature format",
           "The signed content is unchanged and the certificate chains to a trusted root.", "The signed bytes were changed after signing.", "The signed bytes are unchanged, but the signature value does not match.",
           "Signature details", "Status", "Explanation", "Signer", "Issued by", "Field", "Time", "{{time}} (from timestamp)", "{{time}} (stated by the signer)", "Timestamp", "None", "Reason", "Location", "Coverage", "Entire document", "Bytes 0 to {{end}} of {{size}}", "Certificate chain", "Valid from {{from}} to {{to}}", "Revocation not checked.",
           "Signed document", "This document contains digital signatures. Saving rewrites the file, which makes the signatures invalid. Save anyway?", "Save anyway"],
    "nl": ["Digitale handtekeningen controleren…", "De handtekeningen konden niet worden gecontroleerd: {{detail}}", "Documenttijdstempel", "Onbekende ondertekenaar", "het document is daarna nog gewijzigd", "Details", "Toon ondertekende versie", "{{name}} (ondertekende versie {{number}})",
           "Geldig", "Onbekend certificaat", "Gewijzigd na ondertekenen", "Ongeldige handtekening", "Niet te controleren", "Niet ondertekend veld",
           "Geen keten naar een vertrouwd rootcertificaat", "Een certificaat was niet geldig op het relevante tijdstip", "Een certificaat is niet bedoeld voor dit gebruik", "Niet-ondersteund algoritme", "De handtekeninggegevens zijn niet leesbaar", "Het certificaat van de ondertekenaar ontbreekt", "Het ondertekende bytebereik is ongeldig", "De documentstructuur is niet leesbaar", "Verouderd handtekeningformaat",
           "De ondertekende inhoud is ongewijzigd en het certificaat leidt naar een vertrouwd rootcertificaat.", "De ondertekende bytes zijn na het ondertekenen veranderd.", "De ondertekende bytes zijn ongewijzigd, maar de handtekeningwaarde klopt niet.",
           "Handtekeningdetails", "Status", "Toelichting", "Ondertekenaar", "Uitgegeven door", "Veld", "Tijdstip", "{{time}} (uit tijdstempel)", "{{time}} (opgegeven door de ondertekenaar)", "Tijdstempel", "Geen", "Reden", "Plaats", "Dekking", "Hele document", "Bytes 0 tot {{end}} van {{size}}", "Certificaatketen", "Geldig van {{from}} tot {{to}}", "Intrekking niet gecontroleerd.",
           "Ondertekend document", "Dit document bevat digitale handtekeningen. Opslaan herschrijft het bestand, waardoor de handtekeningen ongeldig worden. Toch opslaan?", "Toch opslaan"],
    "de": ["Digitale Signaturen werden geprüft…", "Die Signaturen konnten nicht geprüft werden: {{detail}}", "Dokumentzeitstempel", "Unbekannter Unterzeichner", "das Dokument wurde danach noch geändert", "Details", "Signierte Version anzeigen", "{{name}} (signierte Version {{number}})",
           "Gültig", "Unbekanntes Zertifikat", "Nach dem Signieren geändert", "Ungültige Signatur", "Nicht prüfbar", "Nicht signiertes Signaturfeld",
           "Keine Kette zu einem vertrauenswürdigen Stammzertifikat", "Ein Zertifikat war zum maßgeblichen Zeitpunkt nicht gültig", "Ein Zertifikat ist nicht für diese Verwendung vorgesehen", "Nicht unterstützter Algorithmus", "Die Signaturdaten sind nicht lesbar", "Das Zertifikat des Unterzeichners fehlt", "Der signierte Bytebereich ist ungültig", "Die Dokumentstruktur ist nicht lesbar", "Veraltetes Signaturformat",
           "Der signierte Inhalt ist unverändert und das Zertifikat führt zu einem vertrauenswürdigen Stammzertifikat.", "Die signierten Bytes wurden nach dem Signieren verändert.", "Die signierten Bytes sind unverändert, aber der Signaturwert stimmt nicht.",
           "Signaturdetails", "Status", "Erläuterung", "Unterzeichner", "Ausgestellt von", "Feld", "Zeitpunkt", "{{time}} (aus Zeitstempel)", "{{time}} (vom Unterzeichner angegeben)", "Zeitstempel", "Keiner", "Grund", "Ort", "Abdeckung", "Gesamtes Dokument", "Bytes 0 bis {{end}} von {{size}}", "Zertifikatskette", "Gültig von {{from}} bis {{to}}", "Widerruf nicht geprüft.",
           "Signiertes Dokument", "Dieses Dokument enthält digitale Signaturen. Beim Speichern wird die Datei neu geschrieben, wodurch die Signaturen ungültig werden. Trotzdem speichern?", "Trotzdem speichern"],
    "fr": ["Vérification des signatures numériques…", "Les signatures n'ont pas pu être vérifiées : {{detail}}", "Horodatage du document", "Signataire inconnu", "le document a été modifié par la suite", "Détails", "Afficher la version signée", "{{name}} (version signée {{number}})",
           "Valide", "Certificat inconnu", "Modifié après la signature", "Signature non valide", "Impossible à vérifier", "Champ de signature non signé",
           "Aucune chaîne vers un certificat racine de confiance", "Un certificat n'était pas valide au moment pertinent", "Un certificat n'est pas destiné à cet usage", "Algorithme non pris en charge", "Les données de signature sont illisibles", "Le certificat du signataire est absent", "La plage d'octets signée n'est pas valide", "La structure du document est illisible", "Format de signature obsolète",
           "Le contenu signé est inchangé et le certificat remonte à une racine de confiance.", "Les octets signés ont été modifiés après la signature.", "Les octets signés sont inchangés, mais la valeur de la signature ne correspond pas.",
           "Détails de la signature", "État", "Explication", "Signataire", "Émis par", "Champ", "Date et heure", "{{time}} (issu de l'horodatage)", "{{time}} (indiqué par le signataire)", "Horodatage", "Aucun", "Motif", "Lieu", "Couverture", "Document entier", "Octets 0 à {{end}} sur {{size}}", "Chaîne de certificats", "Valide du {{from}} au {{to}}", "Révocation non vérifiée.",
           "Document signé", "Ce document contient des signatures numériques. L'enregistrement réécrit le fichier, ce qui invalide les signatures. Enregistrer quand même ?", "Enregistrer quand même"],
    "es": ["Comprobando las firmas digitales…", "No se pudieron comprobar las firmas: {{detail}}", "Sello de tiempo del documento", "Firmante desconocido", "el documento se modificó después", "Detalles", "Mostrar la versión firmada", "{{name}} (versión firmada {{number}})",
           "Válida", "Certificado desconocido", "Modificado después de firmar", "Firma no válida", "No se puede comprobar", "Campo de firma sin firmar",
           "No hay cadena hasta un certificado raíz de confianza", "Un certificado no era válido en el momento pertinente", "Un certificado no está destinado a este uso", "Algoritmo no compatible", "Los datos de la firma no se pueden leer", "Falta el certificado del firmante", "El intervalo de bytes firmado no es válido", "La estructura del documento no se puede leer", "Formato de firma obsoleto",
           "El contenido firmado no ha cambiado y el certificado lleva a una raíz de confianza.", "Los bytes firmados se modificaron después de firmar.", "Los bytes firmados no han cambiado, pero el valor de la firma no coincide.",
           "Detalles de la firma", "Estado", "Explicación", "Firmante", "Emitido por", "Campo", "Fecha y hora", "{{time}} (del sello de tiempo)", "{{time}} (indicado por el firmante)", "Sello de tiempo", "Ninguno", "Motivo", "Ubicación", "Cobertura", "Documento completo", "Bytes 0 a {{end}} de {{size}}", "Cadena de certificados", "Válido del {{from}} al {{to}}", "Revocación no comprobada.",
           "Documento firmado", "Este documento contiene firmas digitales. Al guardar se reescribe el archivo, lo que invalida las firmas. ¿Guardar de todos modos?", "Guardar de todos modos"],
    "it": ["Verifica delle firme digitali in corso…", "Impossibile verificare le firme: {{detail}}", "Marca temporale del documento", "Firmatario sconosciuto", "il documento è stato modificato in seguito", "Dettagli", "Mostra la versione firmata", "{{name}} (versione firmata {{number}})",
           "Valida", "Certificato sconosciuto", "Modificato dopo la firma", "Firma non valida", "Non verificabile", "Campo firma non firmato",
           "Nessuna catena verso un certificato radice attendibile", "Un certificato non era valido al momento rilevante", "Un certificato non è destinato a questo uso", "Algoritmo non supportato", "I dati della firma non sono leggibili", "Manca il certificato del firmatario", "L'intervallo di byte firmato non è valido", "La struttura del documento non è leggibile", "Formato di firma obsoleto",
           "Il contenuto firmato è invariato e il certificato risale a una radice attendibile.", "I byte firmati sono stati modificati dopo la firma.", "I byte firmati sono invariati, ma il valore della firma non corrisponde.",
           "Dettagli della firma", "Stato", "Spiegazione", "Firmatario", "Emesso da", "Campo", "Data e ora", "{{time}} (dalla marca temporale)", "{{time}} (dichiarato dal firmatario)", "Marca temporale", "Nessuna", "Motivo", "Luogo", "Copertura", "Intero documento", "Byte da 0 a {{end}} di {{size}}", "Catena di certificati", "Valido dal {{from}} al {{to}}", "Revoca non verificata.",
           "Documento firmato", "Questo documento contiene firme digitali. Il salvataggio riscrive il file e rende non valide le firme. Salvare comunque?", "Salva comunque"],
    "pt": ["Verificando assinaturas digitais…", "Não foi possível verificar as assinaturas: {{detail}}", "Carimbo de tempo do documento", "Signatário desconhecido", "o documento foi alterado depois", "Detalhes", "Mostrar versão assinada", "{{name}} (versão assinada {{number}})",
           "Válida", "Certificado desconhecido", "Alterado após a assinatura", "Assinatura inválida", "Não verificável", "Campo de assinatura não assinado",
           "Nenhuma cadeia até um certificado raiz confiável", "Um certificado não era válido no momento relevante", "Um certificado não se destina a este uso", "Algoritmo não suportado", "Os dados da assinatura não podem ser lidos", "O certificado do signatário está ausente", "O intervalo de bytes assinado é inválido", "A estrutura do documento não pode ser lida", "Formato de assinatura obsoleto",
           "O conteúdo assinado não foi alterado e o certificado leva a uma raiz confiável.", "Os bytes assinados foram alterados após a assinatura.", "Os bytes assinados não foram alterados, mas o valor da assinatura não confere.",
           "Detalhes da assinatura", "Status", "Explicação", "Signatário", "Emitido por", "Campo", "Data e hora", "{{time}} (do carimbo de tempo)", "{{time}} (informado pelo signatário)", "Carimbo de tempo", "Nenhum", "Motivo", "Local", "Cobertura", "Documento inteiro", "Bytes 0 a {{end}} de {{size}}", "Cadeia de certificados", "Válido de {{from}} a {{to}}", "Revogação não verificada.",
           "Documento assinado", "Este documento contém assinaturas digitais. Salvar reescreve o arquivo, o que invalida as assinaturas. Salvar mesmo assim?", "Salvar mesmo assim"],
    "ca": ["S'estan comprovant les signatures digitals…", "No s'han pogut comprovar les signatures: {{detail}}", "Segell de temps del document", "Signant desconegut", "el document s'ha modificat després", "Detalls", "Mostra la versió signada", "{{name}} (versió signada {{number}})",
           "Vàlida", "Certificat desconegut", "Modificat després de signar", "Signatura no vàlida", "No es pot comprovar", "Camp de signatura sense signar",
           "No hi ha cadena fins a un certificat arrel de confiança", "Un certificat no era vàlid en el moment rellevant", "Un certificat no està pensat per a aquest ús", "Algorisme no compatible", "Les dades de la signatura no es poden llegir", "Falta el certificat del signant", "L'interval de bytes signat no és vàlid", "L'estructura del document no es pot llegir", "Format de signatura obsolet",
           "El contingut signat no ha canviat i el certificat porta a una arrel de confiança.", "Els bytes signats s'han modificat després de signar.", "Els bytes signats no han canviat, però el valor de la signatura no coincideix.",
           "Detalls de la signatura", "Estat", "Explicació", "Signant", "Emès per", "Camp", "Data i hora", "{{time}} (del segell de temps)", "{{time}} (indicat pel signant)", "Segell de temps", "Cap", "Motiu", "Lloc", "Cobertura", "Document sencer", "Bytes 0 a {{end}} de {{size}}", "Cadena de certificats", "Vàlid del {{from}} al {{to}}", "Revocació no comprovada.",
           "Document signat", "Aquest document conté signatures digitals. Desar reescriu el fitxer, cosa que invalida les signatures. Voleu desar igualment?", "Desa igualment"],
    "da": ["Kontrollerer digitale signaturer…", "Signaturerne kunne ikke kontrolleres: {{detail}}", "Dokumenttidsstempel", "Ukendt underskriver", "dokumentet er ændret efterfølgende", "Detaljer", "Vis underskrevet version", "{{name}} (underskrevet version {{number}})",
           "Gyldig", "Ukendt certifikat", "Ændret efter underskrivning", "Ugyldig signatur", "Kan ikke kontrolleres", "Ikke-underskrevet signaturfelt",
           "Ingen kæde til et betroet rodcertifikat", "Et certifikat var ikke gyldigt på det relevante tidspunkt", "Et certifikat er ikke beregnet til denne brug", "Algoritme understøttes ikke", "Signaturdataene kan ikke læses", "Underskriverens certifikat mangler", "Det underskrevne byteområde er ugyldigt", "Dokumentets struktur kan ikke læses", "Forældet signaturformat",
           "Det underskrevne indhold er uændret, og certifikatet fører til et betroet rodcertifikat.", "De underskrevne bytes er ændret efter underskrivningen.", "De underskrevne bytes er uændrede, men signaturværdien stemmer ikke.",
           "Signaturdetaljer", "Status", "Forklaring", "Underskriver", "Udstedt af", "Felt", "Tidspunkt", "{{time}} (fra tidsstempel)", "{{time}} (angivet af underskriveren)", "Tidsstempel", "Ingen", "Årsag", "Sted", "Dækning", "Hele dokumentet", "Bytes 0 til {{end}} af {{size}}", "Certifikatkæde", "Gyldig fra {{from}} til {{to}}", "Tilbagekaldelse ikke kontrolleret.",
           "Underskrevet dokument", "Dette dokument indeholder digitale signaturer. Når du gemmer, skrives filen om, og signaturerne bliver ugyldige. Gem alligevel?", "Gem alligevel"],
    "nb": ["Kontrollerer digitale signaturer…", "Signaturene kunne ikke kontrolleres: {{detail}}", "Dokumenttidsstempel", "Ukjent undertegner", "dokumentet er endret senere", "Detaljer", "Vis signert versjon", "{{name}} (signert versjon {{number}})",
           "Gyldig", "Ukjent sertifikat", "Endret etter signering", "Ugyldig signatur", "Kan ikke kontrolleres", "Usignert signaturfelt",
           "Ingen kjede til et klarert rotsertifikat", "Et sertifikat var ikke gyldig på det aktuelle tidspunktet", "Et sertifikat er ikke beregnet for denne bruken", "Algoritmen støttes ikke", "Signaturdataene kan ikke leses", "Undertegnerens sertifikat mangler", "Det signerte byteområdet er ugyldig", "Dokumentstrukturen kan ikke leses", "Utdatert signaturformat",
           "Det signerte innholdet er uendret, og sertifikatet fører til et klarert rotsertifikat.", "De signerte bytene ble endret etter signering.", "De signerte bytene er uendret, men signaturverdien stemmer ikke.",
           "Signaturdetaljer", "Status", "Forklaring", "Undertegner", "Utstedt av", "Felt", "Tidspunkt", "{{time}} (fra tidsstempel)", "{{time}} (oppgitt av undertegneren)", "Tidsstempel", "Ingen", "Årsak", "Sted", "Dekning", "Hele dokumentet", "Byte 0 til {{end}} av {{size}}", "Sertifikatkjede", "Gyldig fra {{from}} til {{to}}", "Tilbakekalling ikke kontrollert.",
           "Signert dokument", "Dette dokumentet inneholder digitale signaturer. Lagring skriver filen på nytt, slik at signaturene blir ugyldige. Lagre likevel?", "Lagre likevel"],
    "sv": ["Kontrollerar digitala signaturer…", "Signaturerna kunde inte kontrolleras: {{detail}}", "Dokumenttidsstämpel", "Okänd undertecknare", "dokumentet har ändrats därefter", "Detaljer", "Visa signerad version", "{{name}} (signerad version {{number}})",
           "Giltig", "Okänt certifikat", "Ändrad efter signering", "Ogiltig signatur", "Kan inte kontrolleras", "Osignerat signaturfält",
           "Ingen kedja till ett betrott rotcertifikat", "Ett certifikat var inte giltigt vid den aktuella tidpunkten", "Ett certifikat är inte avsett för denna användning", "Algoritmen stöds inte", "Signaturdata kan inte läsas", "Undertecknarens certifikat saknas", "Det signerade byteintervallet är ogiltigt", "Dokumentstrukturen kan inte läsas", "Föråldrat signaturformat",
           "Det signerade innehållet är oförändrat och certifikatet leder till ett betrott rotcertifikat.", "De signerade byten ändrades efter signeringen.", "De signerade byten är oförändrade, men signaturvärdet stämmer inte.",
           "Signaturdetaljer", "Status", "Förklaring", "Undertecknare", "Utfärdat av", "Fält", "Tidpunkt", "{{time}} (från tidsstämpel)", "{{time}} (angiven av undertecknaren)", "Tidsstämpel", "Ingen", "Anledning", "Plats", "Täckning", "Hela dokumentet", "Byte 0 till {{end}} av {{size}}", "Certifikatkedja", "Giltigt från {{from}} till {{to}}", "Återkallelse inte kontrollerad.",
           "Signerat dokument", "Dokumentet innehåller digitala signaturer. När du sparar skrivs filen om, vilket gör signaturerna ogiltiga. Spara ändå?", "Spara ändå"],
    "fi": ["Tarkistetaan digitaalisia allekirjoituksia…", "Allekirjoituksia ei voitu tarkistaa: {{detail}}", "Asiakirjan aikaleima", "Tuntematon allekirjoittaja", "asiakirjaa on muutettu myöhemmin", "Tiedot", "Näytä allekirjoitettu versio", "{{name}} (allekirjoitettu versio {{number}})",
           "Kelvollinen", "Tuntematon varmenne", "Muutettu allekirjoittamisen jälkeen", "Virheellinen allekirjoitus", "Ei tarkistettavissa", "Allekirjoittamaton allekirjoituskenttä",
           "Ei ketjua luotettuun juurivarmenteeseen", "Varmenne ei ollut voimassa olennaisena ajankohtana", "Varmennetta ei ole tarkoitettu tähän käyttöön", "Algoritmia ei tueta", "Allekirjoituksen tietoja ei voi lukea", "Allekirjoittajan varmenne puuttuu", "Allekirjoitettu tavualue on virheellinen", "Asiakirjan rakennetta ei voi lukea", "Vanhentunut allekirjoitusmuoto",
           "Allekirjoitettu sisältö on muuttumaton ja varmenne johtaa luotettuun juurivarmenteeseen.", "Allekirjoitettuja tavuja on muutettu allekirjoittamisen jälkeen.", "Allekirjoitetut tavut ovat muuttumattomia, mutta allekirjoituksen arvo ei täsmää.",
           "Allekirjoituksen tiedot", "Tila", "Selitys", "Allekirjoittaja", "Myöntäjä", "Kenttä", "Ajankohta", "{{time}} (aikaleimasta)", "{{time}} (allekirjoittajan ilmoittama)", "Aikaleima", "Ei mitään", "Syy", "Paikka", "Kattavuus", "Koko asiakirja", "Tavut 0–{{end}} / {{size}}", "Varmenneketju", "Voimassa {{from}}–{{to}}", "Peruutusta ei tarkistettu.",
           "Allekirjoitettu asiakirja", "Tämä asiakirja sisältää digitaalisia allekirjoituksia. Tallentaminen kirjoittaa tiedoston uudelleen, jolloin allekirjoitukset mitätöityvät. Tallennetaanko silti?", "Tallenna silti"],
    "pl": ["Sprawdzanie podpisów cyfrowych…", "Nie udało się sprawdzić podpisów: {{detail}}", "Znacznik czasu dokumentu", "Nieznany podpisujący", "dokument został później zmieniony", "Szczegóły", "Pokaż podpisaną wersję", "{{name}} (podpisana wersja {{number}})",
           "Prawidłowy", "Nieznany certyfikat", "Zmieniony po podpisaniu", "Nieprawidłowy podpis", "Nie można sprawdzić", "Niepodpisane pole podpisu",
           "Brak łańcucha do zaufanego certyfikatu głównego", "Certyfikat nie był ważny w istotnym momencie", "Certyfikat nie jest przeznaczony do tego zastosowania", "Nieobsługiwany algorytm", "Nie można odczytać danych podpisu", "Brak certyfikatu podpisującego", "Podpisany zakres bajtów jest nieprawidłowy", "Nie można odczytać struktury dokumentu", "Przestarzały format podpisu",
           "Podpisana treść jest niezmieniona, a certyfikat prowadzi do zaufanego certyfikatu głównego.", "Podpisane bajty zostały zmienione po podpisaniu.", "Podpisane bajty są niezmienione, ale wartość podpisu się nie zgadza.",
           "Szczegóły podpisu", "Stan", "Wyjaśnienie", "Podpisujący", "Wystawiony przez", "Pole", "Czas", "{{time}} (ze znacznika czasu)", "{{time}} (podany przez podpisującego)", "Znacznik czasu", "Brak", "Powód", "Miejsce", "Zakres", "Cały dokument", "Bajty od 0 do {{end}} z {{size}}", "Łańcuch certyfikatów", "Ważny od {{from}} do {{to}}", "Nie sprawdzono unieważnienia.",
           "Podpisany dokument", "Ten dokument zawiera podpisy cyfrowe. Zapisanie przepisuje plik, przez co podpisy stają się nieprawidłowe. Zapisać mimo to?", "Zapisz mimo to"],
    "cs": ["Kontrola digitálních podpisů…", "Podpisy se nepodařilo zkontrolovat: {{detail}}", "Časové razítko dokumentu", "Neznámý podepisující", "dokument byl poté ještě změněn", "Podrobnosti", "Zobrazit podepsanou verzi", "{{name}} (podepsaná verze {{number}})",
           "Platný", "Neznámý certifikát", "Změněno po podepsání", "Neplatný podpis", "Nelze ověřit", "Nepodepsané pole podpisu",
           "Žádný řetězec k důvěryhodnému kořenovému certifikátu", "Certifikát nebyl v rozhodném okamžiku platný", "Certifikát není určen pro toto použití", "Nepodporovaný algoritmus", "Data podpisu nelze přečíst", "Chybí certifikát podepisujícího", "Podepsaný rozsah bajtů je neplatný", "Strukturu dokumentu nelze přečíst", "Zastaralý formát podpisu",
           "Podepsaný obsah je beze změny a certifikát vede k důvěryhodnému kořenovému certifikátu.", "Podepsané bajty byly po podepsání změněny.", "Podepsané bajty jsou beze změny, ale hodnota podpisu nesouhlasí.",
           "Podrobnosti podpisu", "Stav", "Vysvětlení", "Podepisující", "Vydal", "Pole", "Čas", "{{time}} (z časového razítka)", "{{time}} (uvedeno podepisujícím)", "Časové razítko", "Žádné", "Důvod", "Místo", "Rozsah", "Celý dokument", "Bajty 0 až {{end}} z {{size}}", "Řetězec certifikátů", "Platný od {{from}} do {{to}}", "Odvolání nebylo zkontrolováno.",
           "Podepsaný dokument", "Tento dokument obsahuje digitální podpisy. Uložením se soubor přepíše a podpisy se stanou neplatnými. Přesto uložit?", "Přesto uložit"],
    "sk": ["Kontrola digitálnych podpisov…", "Podpisy sa nepodarilo skontrolovať: {{detail}}", "Časová pečiatka dokumentu", "Neznámy podpisujúci", "dokument bol potom ešte zmenený", "Podrobnosti", "Zobraziť podpísanú verziu", "{{name}} (podpísaná verzia {{number}})",
           "Platný", "Neznámy certifikát", "Zmenené po podpísaní", "Neplatný podpis", "Nedá sa overiť", "Nepodpísané pole podpisu",
           "Žiadny reťazec k dôveryhodnému koreňovému certifikátu", "Certifikát nebol v rozhodujúcom čase platný", "Certifikát nie je určený na toto použitie", "Nepodporovaný algoritmus", "Údaje podpisu sa nedajú prečítať", "Chýba certifikát podpisujúceho", "Podpísaný rozsah bajtov je neplatný", "Štruktúru dokumentu sa nedá prečítať", "Zastaraný formát podpisu",
           "Podpísaný obsah je nezmenený a certifikát vedie k dôveryhodnému koreňovému certifikátu.", "Podpísané bajty boli po podpísaní zmenené.", "Podpísané bajty sú nezmenené, ale hodnota podpisu nesúhlasí.",
           "Podrobnosti podpisu", "Stav", "Vysvetlenie", "Podpisujúci", "Vydal", "Pole", "Čas", "{{time}} (z časovej pečiatky)", "{{time}} (uvedené podpisujúcim)", "Časová pečiatka", "Žiadna", "Dôvod", "Miesto", "Rozsah", "Celý dokument", "Bajty 0 až {{end}} z {{size}}", "Reťazec certifikátov", "Platný od {{from}} do {{to}}", "Odvolanie nebolo skontrolované.",
           "Podpísaný dokument", "Tento dokument obsahuje digitálne podpisy. Uložením sa súbor prepíše a podpisy sa stanú neplatnými. Napriek tomu uložiť?", "Napriek tomu uložiť"],
    "hr": ["Provjera digitalnih potpisa…", "Potpisi se nisu mogli provjeriti: {{detail}}", "Vremenski žig dokumenta", "Nepoznati potpisnik", "dokument je naknadno izmijenjen", "Pojedinosti", "Prikaži potpisanu verziju", "{{name}} (potpisana verzija {{number}})",
           "Valjan", "Nepoznati certifikat", "Izmijenjeno nakon potpisivanja", "Nevaljan potpis", "Nije moguće provjeriti", "Nepotpisano polje za potpis",
           "Nema lanca do pouzdanog korijenskog certifikata", "Certifikat nije bio valjan u relevantnom trenutku", "Certifikat nije namijenjen za ovu upotrebu", "Nepodržani algoritam", "Podaci potpisa nisu čitljivi", "Nedostaje certifikat potpisnika", "Potpisani raspon bajtova nije valjan", "Struktura dokumenta nije čitljiva", "Zastarjeli format potpisa",
           "Potpisani sadržaj nije promijenjen i certifikat vodi do pouzdanog korijenskog certifikata.", "Potpisani bajtovi promijenjeni su nakon potpisivanja.", "Potpisani bajtovi nisu promijenjeni, ali vrijednost potpisa se ne podudara.",
           "Pojedinosti potpisa", "Status", "Objašnjenje", "Potpisnik", "Izdao", "Polje", "Vrijeme", "{{time}} (iz vremenskog žiga)", "{{time}} (naveo potpisnik)", "Vremenski žig", "Nema", "Razlog", "Mjesto", "Obuhvat", "Cijeli dokument", "Bajtovi 0 do {{end}} od {{size}}", "Lanac certifikata", "Valjan od {{from}} do {{to}}", "Opoziv nije provjeren.",
           "Potpisani dokument", "Ovaj dokument sadrži digitalne potpise. Spremanje ponovno zapisuje datoteku, zbog čega potpisi postaju nevaljani. Ipak spremiti?", "Ipak spremi"],
    "sr": ["Провера дигиталних потписа…", "Потписи нису могли бити проверени: {{detail}}", "Временски жиг документа", "Непознати потписник", "документ је накнадно измењен", "Детаљи", "Прикажи потписану верзију", "{{name}} (потписана верзија {{number}})",
           "Важећи", "Непознати сертификат", "Измењено након потписивања", "Неважећи потпис", "Није могуће проверити", "Непотписано поље за потпис",
           "Нема ланца до поузданог коренског сертификата", "Сертификат није био важећи у релевантном тренутку", "Сертификат није намењен за ову употребу", "Неподржани алгоритам", "Подаци потписа нису читљиви", "Недостаје сертификат потписника", "Потписани опсег бајтова није важећи", "Структура документа није читљива", "Застарели формат потписа",
           "Потписани садржај није промењен и сертификат води до поузданог коренског сертификата.", "Потписани бајтови су промењени након потписивања.", "Потписани бајтови нису промењени, али вредност потписа се не поклапа.",
           "Детаљи потписа", "Статус", "Објашњење", "Потписник", "Издао", "Поље", "Време", "{{time}} (из временског жига)", "{{time}} (навео потписник)", "Временски жиг", "Нема", "Разлог", "Место", "Обухват", "Цео документ", "Бајтови 0 до {{end}} од {{size}}", "Ланац сертификата", "Важи од {{from}} до {{to}}", "Опозив није проверен.",
           "Потписани документ", "Овај документ садржи дигиталне потписе. Чување поново записује датотеку, због чега потписи постају неважећи. Ипак сачувати?", "Ипак сачувај"],
    "bg": ["Проверка на цифровите подписи…", "Подписите не можаха да бъдат проверени: {{detail}}", "Времеви печат на документа", "Неизвестен подписал", "документът е променен след това", "Подробности", "Покажи подписаната версия", "{{name}} (подписана версия {{number}})",
           "Валиден", "Неизвестен сертификат", "Променен след подписването", "Невалиден подпис", "Не може да се провери", "Неподписано поле за подпис",
           "Няма верига до доверен основен сертификат", "Сертификат не е бил валиден в съответния момент", "Сертификат не е предназначен за тази употреба", "Неподдържан алгоритъм", "Данните на подписа не могат да се прочетат", "Липсва сертификатът на подписалия", "Подписаният диапазон от байтове е невалиден", "Структурата на документа не може да се прочете", "Остарял формат на подписа",
           "Подписаното съдържание е непроменено и сертификатът води до доверен основен сертификат.", "Подписаните байтове са променени след подписването.", "Подписаните байтове са непроменени, но стойността на подписа не съвпада.",
           "Подробности за подписа", "Състояние", "Обяснение", "Подписал", "Издаден от", "Поле", "Време", "{{time}} (от времеви печат)", "{{time}} (посочено от подписалия)", "Времеви печат", "Няма", "Причина", "Място", "Обхват", "Целият документ", "Байтове от 0 до {{end}} от {{size}}", "Верига от сертификати", "Валиден от {{from}} до {{to}}", "Отнемането не е проверено.",
           "Подписан документ", "Този документ съдържа цифрови подписи. Записването презаписва файла, което прави подписите невалидни. Да се запише ли въпреки това?", "Запиши въпреки това"],
    "ru": ["Проверка цифровых подписей…", "Не удалось проверить подписи: {{detail}}", "Метка времени документа", "Неизвестный подписант", "документ был изменён позже", "Подробности", "Показать подписанную версию", "{{name}} (подписанная версия {{number}})",
           "Действительна", "Неизвестный сертификат", "Изменён после подписания", "Недействительная подпись", "Невозможно проверить", "Неподписанное поле подписи",
           "Нет цепочки до доверенного корневого сертификата", "Сертификат не был действителен в соответствующий момент", "Сертификат не предназначен для такого использования", "Неподдерживаемый алгоритм", "Данные подписи не читаются", "Отсутствует сертификат подписанта", "Подписанный диапазон байтов недействителен", "Структура документа не читается", "Устаревший формат подписи",
           "Подписанное содержимое не изменено, и сертификат ведёт к доверенному корневому сертификату.", "Подписанные байты были изменены после подписания.", "Подписанные байты не изменены, но значение подписи не совпадает.",
           "Сведения о подписи", "Состояние", "Пояснение", "Подписант", "Кем выдан", "Поле", "Время", "{{time}} (из метки времени)", "{{time}} (указано подписантом)", "Метка времени", "Нет", "Причина", "Место", "Охват", "Весь документ", "Байты с 0 по {{end}} из {{size}}", "Цепочка сертификатов", "Действителен с {{from}} по {{to}}", "Отзыв не проверялся.",
           "Подписанный документ", "Этот документ содержит цифровые подписи. При сохранении файл перезаписывается, и подписи становятся недействительными. Всё равно сохранить?", "Всё равно сохранить"],
    "uk": ["Перевірка цифрових підписів…", "Не вдалося перевірити підписи: {{detail}}", "Позначка часу документа", "Невідомий підписувач", "документ було змінено пізніше", "Докладно", "Показати підписану версію", "{{name}} (підписана версія {{number}})",
           "Дійсний", "Невідомий сертифікат", "Змінено після підписання", "Недійсний підпис", "Неможливо перевірити", "Непідписане поле підпису",
           "Немає ланцюжка до довіреного кореневого сертифіката", "Сертифікат не був дійсним у відповідний момент", "Сертифікат не призначений для такого використання", "Непідтримуваний алгоритм", "Дані підпису неможливо прочитати", "Відсутній сертифікат підписувача", "Підписаний діапазон байтів недійсний", "Структуру документа неможливо прочитати", "Застарілий формат підпису",
           "Підписаний вміст не змінено, і сертифікат веде до довіреного кореневого сертифіката.", "Підписані байти було змінено після підписання.", "Підписані байти не змінено, але значення підпису не збігається.",
           "Відомості про підпис", "Стан", "Пояснення", "Підписувач", "Ким видано", "Поле", "Час", "{{time}} (з позначки часу)", "{{time}} (вказано підписувачем)", "Позначка часу", "Немає", "Причина", "Місце", "Охоплення", "Увесь документ", "Байти з 0 по {{end}} із {{size}}", "Ланцюжок сертифікатів", "Дійсний з {{from}} по {{to}}", "Відкликання не перевірено.",
           "Підписаний документ", "Цей документ містить цифрові підписи. Збереження перезаписує файл, через що підписи стають недійсними. Усе одно зберегти?", "Усе одно зберегти"],
    "el": ["Έλεγχος ψηφιακών υπογραφών…", "Δεν ήταν δυνατός ο έλεγχος των υπογραφών: {{detail}}", "Χρονοσφραγίδα εγγράφου", "Άγνωστος υπογράφων", "το έγγραφο τροποποιήθηκε στη συνέχεια", "Λεπτομέρειες", "Εμφάνιση υπογεγραμμένης έκδοσης", "{{name}} (υπογεγραμμένη έκδοση {{number}})",
           "Έγκυρη", "Άγνωστο πιστοποιητικό", "Τροποποιήθηκε μετά την υπογραφή", "Μη έγκυρη υπογραφή", "Δεν μπορεί να ελεγχθεί", "Ανυπόγραφο πεδίο υπογραφής",
           "Καμία αλυσίδα προς αξιόπιστο πιστοποιητικό ρίζας", "Ένα πιστοποιητικό δεν ήταν έγκυρο τη σχετική στιγμή", "Ένα πιστοποιητικό δεν προορίζεται για αυτή τη χρήση", "Μη υποστηριζόμενος αλγόριθμος", "Τα δεδομένα της υπογραφής δεν είναι αναγνώσιμα", "Λείπει το πιστοποιητικό του υπογράφοντος", "Το υπογεγραμμένο εύρος byte δεν είναι έγκυρο", "Η δομή του εγγράφου δεν είναι αναγνώσιμη", "Παρωχημένη μορφή υπογραφής",
           "Το υπογεγραμμένο περιεχόμενο είναι αμετάβλητο και το πιστοποιητικό οδηγεί σε αξιόπιστη ρίζα.", "Τα υπογεγραμμένα byte άλλαξαν μετά την υπογραφή.", "Τα υπογεγραμμένα byte είναι αμετάβλητα, αλλά η τιμή της υπογραφής δεν ταιριάζει.",
           "Λεπτομέρειες υπογραφής", "Κατάσταση", "Επεξήγηση", "Υπογράφων", "Εκδόθηκε από", "Πεδίο", "Χρόνος", "{{time}} (από χρονοσφραγίδα)", "{{time}} (όπως δηλώθηκε από τον υπογράφοντα)", "Χρονοσφραγίδα", "Καμία", "Αιτία", "Τοποθεσία", "Κάλυψη", "Ολόκληρο το έγγραφο", "Byte 0 έως {{end}} από {{size}}", "Αλυσίδα πιστοποιητικών", "Έγκυρο από {{from}} έως {{to}}", "Η ανάκληση δεν ελέγχθηκε.",
           "Υπογεγραμμένο έγγραφο", "Αυτό το έγγραφο περιέχει ψηφιακές υπογραφές. Η αποθήκευση ξαναγράφει το αρχείο και οι υπογραφές γίνονται άκυρες. Αποθήκευση παρ' όλα αυτά;", "Αποθήκευση παρ' όλα αυτά"],
    "hu": ["Digitális aláírások ellenőrzése…", "Az aláírásokat nem sikerült ellenőrizni: {{detail}}", "Dokumentum-időbélyeg", "Ismeretlen aláíró", "a dokumentumot később módosították", "Részletek", "Aláírt változat megjelenítése", "{{name}} (aláírt változat {{number}})",
           "Érvényes", "Ismeretlen tanúsítvány", "Aláírás után módosítva", "Érvénytelen aláírás", "Nem ellenőrizhető", "Aláíratlan aláírásmező",
           "Nincs lánc megbízható főtanúsítványig", "Egy tanúsítvány nem volt érvényes a releváns időpontban", "Egy tanúsítvány nem erre a használatra készült", "Nem támogatott algoritmus", "Az aláírás adatai nem olvashatók", "Hiányzik az aláíró tanúsítványa", "Az aláírt bájttartomány érvénytelen", "A dokumentum szerkezete nem olvasható", "Elavult aláírásformátum",
           "Az aláírt tartalom változatlan, és a tanúsítvány megbízható főtanúsítványhoz vezet.", "Az aláírt bájtok az aláírás után megváltoztak.", "Az aláírt bájtok változatlanok, de az aláírás értéke nem egyezik.",
           "Aláírás részletei", "Állapot", "Magyarázat", "Aláíró", "Kibocsátó", "Mező", "Időpont", "{{time}} (időbélyegből)", "{{time}} (az aláíró szerint)", "Időbélyeg", "Nincs", "Ok", "Hely", "Lefedettség", "Teljes dokumentum", "0–{{end}}. bájt, összesen {{size}}", "Tanúsítványlánc", "Érvényes: {{from}} – {{to}}", "Visszavonás nincs ellenőrizve.",
           "Aláírt dokumentum", "Ez a dokumentum digitális aláírásokat tartalmaz. A mentés újraírja a fájlt, így az aláírások érvénytelenné válnak. Mégis menti?", "Mentés mégis"],
    "ro": ["Se verifica semnaturile digitale…", "Semnaturile nu au putut fi verificate: {{detail}}", "Marca temporala a documentului", "Semnatar necunoscut", "documentul a fost modificat ulterior", "Detalii", "Afiseaza versiunea semnata", "{{name}} (versiunea semnata {{number}})",
           "Valida", "Certificat necunoscut", "Modificat dupa semnare", "Semnatura nevalida", "Nu poate fi verificata", "Camp de semnatura nesemnat",
           "Niciun lant catre un certificat radacina de incredere", "Un certificat nu era valid la momentul relevant", "Un certificat nu este destinat acestei utilizari", "Algoritm neacceptat", "Datele semnaturii nu pot fi citite", "Lipseste certificatul semnatarului", "Intervalul de octeti semnat este nevalid", "Structura documentului nu poate fi citita", "Format de semnatura invechit",
           "Continutul semnat este neschimbat, iar certificatul duce la o radacina de incredere.", "Octetii semnati au fost modificati dupa semnare.", "Octetii semnati sunt neschimbati, dar valoarea semnaturii nu corespunde.",
           "Detaliile semnaturii", "Stare", "Explicatie", "Semnatar", "Emis de", "Camp", "Moment", "{{time}} (din marca temporala)", "{{time}} (declarat de semnatar)", "Marca temporala", "Niciuna", "Motiv", "Locatie", "Acoperire", "Intregul document", "Octetii 0 - {{end}} din {{size}}", "Lant de certificate", "Valabil de la {{from}} pana la {{to}}", "Revocarea nu a fost verificata.",
           "Document semnat", "Acest document contine semnaturi digitale. Salvarea rescrie fisierul, ceea ce invalideaza semnaturile. Salvati totusi?", "Salveaza totusi"],
    "tr": ["Dijital imzalar denetleniyor…", "İmzalar denetlenemedi: {{detail}}", "Belge zaman damgası", "Bilinmeyen imzalayan", "belge sonradan değiştirildi", "Ayrıntılar", "İmzalı sürümü göster", "{{name}} (imzalı sürüm {{number}})",
           "Geçerli", "Bilinmeyen sertifika", "İmzalandıktan sonra değiştirildi", "Geçersiz imza", "Denetlenemiyor", "İmzalanmamış imza alanı",
           "Güvenilir bir kök sertifikaya zincir yok", "Bir sertifika ilgili zamanda geçerli değildi", "Bir sertifika bu kullanım için tasarlanmamış", "Desteklenmeyen algoritma", "İmza verileri okunamıyor", "İmzalayanın sertifikası eksik", "İmzalı bayt aralığı geçersiz", "Belge yapısı okunamıyor", "Eski imza biçimi",
           "İmzalı içerik değişmemiş ve sertifika güvenilir bir köke bağlanıyor.", "İmzalı baytlar imzalandıktan sonra değiştirildi.", "İmzalı baytlar değişmemiş, ancak imza değeri eşleşmiyor.",
           "İmza ayrıntıları", "Durum", "Açıklama", "İmzalayan", "Veren", "Alan", "Zaman", "{{time}} (zaman damgasından)", "{{time}} (imzalayanın belirttiği)", "Zaman damgası", "Yok", "Neden", "Konum", "Kapsam", "Belgenin tamamı", "{{size}} baytın 0 ile {{end}} arası", "Sertifika zinciri", "Geçerlilik: {{from}} - {{to}}", "İptal durumu denetlenmedi.",
           "İmzalı belge", "Bu belge dijital imzalar içeriyor. Kaydetmek dosyayı yeniden yazar ve imzaları geçersiz kılar. Yine de kaydedilsin mi?", "Yine de kaydet"],
    "id": ["Memeriksa tanda tangan digital…", "Tanda tangan tidak dapat diperiksa: {{detail}}", "Stempel waktu dokumen", "Penanda tangan tidak dikenal", "dokumen diubah setelahnya", "Detail", "Tampilkan versi yang ditandatangani", "{{name}} (versi ditandatangani {{number}})",
           "Valid", "Sertifikat tidak dikenal", "Diubah setelah ditandatangani", "Tanda tangan tidak valid", "Tidak dapat diperiksa", "Bidang tanda tangan belum ditandatangani",
           "Tidak ada rantai ke sertifikat akar tepercaya", "Sebuah sertifikat tidak valid pada waktu yang relevan", "Sebuah sertifikat tidak ditujukan untuk penggunaan ini", "Algoritma tidak didukung", "Data tanda tangan tidak dapat dibaca", "Sertifikat penanda tangan tidak ada", "Rentang byte yang ditandatangani tidak valid", "Struktur dokumen tidak dapat dibaca", "Format tanda tangan usang",
           "Konten yang ditandatangani tidak berubah dan sertifikat mengarah ke akar tepercaya.", "Byte yang ditandatangani diubah setelah penandatanganan.", "Byte yang ditandatangani tidak berubah, tetapi nilai tanda tangan tidak cocok.",
           "Detail tanda tangan", "Status", "Penjelasan", "Penanda tangan", "Diterbitkan oleh", "Bidang", "Waktu", "{{time}} (dari stempel waktu)", "{{time}} (dinyatakan oleh penanda tangan)", "Stempel waktu", "Tidak ada", "Alasan", "Lokasi", "Cakupan", "Seluruh dokumen", "Byte 0 sampai {{end}} dari {{size}}", "Rantai sertifikat", "Berlaku dari {{from}} sampai {{to}}", "Pencabutan tidak diperiksa.",
           "Dokumen bertanda tangan", "Dokumen ini berisi tanda tangan digital. Menyimpan akan menulis ulang file sehingga tanda tangan menjadi tidak valid. Tetap simpan?", "Tetap simpan"],
    "ms": ["Menyemak tandatangan digital…", "Tandatangan tidak dapat disemak: {{detail}}", "Cap masa dokumen", "Penandatangan tidak diketahui", "dokumen telah diubah selepas itu", "Butiran", "Tunjukkan versi yang ditandatangani", "{{name}} (versi ditandatangani {{number}})",
           "Sah", "Sijil tidak diketahui", "Diubah selepas ditandatangani", "Tandatangan tidak sah", "Tidak dapat disemak", "Medan tandatangan belum ditandatangani",
           "Tiada rantaian ke sijil akar yang dipercayai", "Sebuah sijil tidak sah pada masa yang berkaitan", "Sebuah sijil tidak bertujuan untuk kegunaan ini", "Algoritma tidak disokong", "Data tandatangan tidak dapat dibaca", "Sijil penandatangan tiada", "Julat bait yang ditandatangani tidak sah", "Struktur dokumen tidak dapat dibaca", "Format tandatangan lapuk",
           "Kandungan yang ditandatangani tidak berubah dan sijil membawa kepada akar yang dipercayai.", "Bait yang ditandatangani telah diubah selepas ditandatangani.", "Bait yang ditandatangani tidak berubah, tetapi nilai tandatangan tidak sepadan.",
           "Butiran tandatangan", "Status", "Penjelasan", "Penandatangan", "Dikeluarkan oleh", "Medan", "Masa", "{{time}} (daripada cap masa)", "{{time}} (dinyatakan oleh penandatangan)", "Cap masa", "Tiada", "Sebab", "Lokasi", "Liputan", "Seluruh dokumen", "Bait 0 hingga {{end}} daripada {{size}}", "Rantaian sijil", "Sah dari {{from}} hingga {{to}}", "Pembatalan tidak disemak.",
           "Dokumen bertandatangan", "Dokumen ini mengandungi tandatangan digital. Menyimpan akan menulis semula fail, menjadikan tandatangan tidak sah. Simpan juga?", "Simpan juga"],
    "vi": ["Đang kiểm tra chữ ký số…", "Không thể kiểm tra chữ ký: {{detail}}", "Dấu thời gian tài liệu", "Người ký không xác định", "tài liệu đã bị thay đổi sau đó", "Chi tiết", "Hiển thị phiên bản đã ký", "{{name}} (phiên bản đã ký {{number}})",
           "Hợp lệ", "Chứng chỉ không xác định", "Đã thay đổi sau khi ký", "Chữ ký không hợp lệ", "Không thể kiểm tra", "Trường chữ ký chưa ký",
           "Không có chuỗi tới chứng chỉ gốc đáng tin cậy", "Một chứng chỉ không hợp lệ tại thời điểm liên quan", "Một chứng chỉ không dành cho mục đích này", "Thuật toán không được hỗ trợ", "Không thể đọc dữ liệu chữ ký", "Thiếu chứng chỉ của người ký", "Phạm vi byte đã ký không hợp lệ", "Không thể đọc cấu trúc tài liệu", "Định dạng chữ ký lỗi thời",
           "Nội dung đã ký không thay đổi và chứng chỉ dẫn tới gốc đáng tin cậy.", "Các byte đã ký đã bị thay đổi sau khi ký.", "Các byte đã ký không thay đổi, nhưng giá trị chữ ký không khớp.",
           "Chi tiết chữ ký", "Trạng thái", "Giải thích", "Người ký", "Cấp bởi", "Trường", "Thời điểm", "{{time}} (từ dấu thời gian)", "{{time}} (do người ký khai báo)", "Dấu thời gian", "Không có", "Lý do", "Địa điểm", "Phạm vi", "Toàn bộ tài liệu", "Byte 0 đến {{end}} trong {{size}}", "Chuỗi chứng chỉ", "Hiệu lực từ {{from}} đến {{to}}", "Chưa kiểm tra thu hồi.",
           "Tài liệu đã ký", "Tài liệu này chứa chữ ký số. Lưu sẽ ghi lại tệp, khiến các chữ ký không còn hợp lệ. Vẫn lưu?", "Vẫn lưu"],
    "sw": ["Inakagua sahihi za kidijitali…", "Sahihi hazikuweza kukaguliwa: {{detail}}", "Muhuri wa muda wa hati", "Mtiaji sahihi asiyejulikana", "hati ilibadilishwa baadaye", "Maelezo", "Onyesha toleo lililotiwa sahihi", "{{name}} (toleo lililotiwa sahihi {{number}})",
           "Halali", "Cheti kisichojulikana", "Imebadilishwa baada ya kutiwa sahihi", "Sahihi batili", "Haiwezi kukaguliwa", "Sehemu ya sahihi isiyotiwa sahihi",
           "Hakuna mnyororo hadi cheti cha mzizi kinachoaminika", "Cheti hakikuwa halali wakati husika", "Cheti hakikusudiwi kwa matumizi haya", "Algorithimu isiyotumika", "Data ya sahihi haisomeki", "Cheti cha mtiaji sahihi hakipo", "Masafa ya baiti yaliyotiwa sahihi ni batili", "Muundo wa hati hausomeki", "Muundo wa sahihi uliopitwa na wakati",
           "Maudhui yaliyotiwa sahihi hayajabadilika na cheti kinaelekea mzizi unaoaminika.", "Baiti zilizotiwa sahihi zilibadilishwa baada ya kutiwa sahihi.", "Baiti zilizotiwa sahihi hazijabadilika, lakini thamani ya sahihi hailingani.",
           "Maelezo ya sahihi", "Hali", "Ufafanuzi", "Mtiaji sahihi", "Imetolewa na", "Sehemu", "Wakati", "{{time}} (kutoka muhuri wa muda)", "{{time}} (kama alivyotaja mtiaji sahihi)", "Muhuri wa muda", "Hakuna", "Sababu", "Mahali", "Upeo", "Hati nzima", "Baiti 0 hadi {{end}} kati ya {{size}}", "Mnyororo wa vyeti", "Halali kuanzia {{from}} hadi {{to}}", "Ubatilishaji haujakaguliwa.",
           "Hati iliyotiwa sahihi", "Hati hii ina sahihi za kidijitali. Kuhifadhi huandika faili upya, na hivyo sahihi zinakuwa batili. Hifadhi hata hivyo?", "Hifadhi hata hivyo"],
    "ja": ["デジタル署名を確認しています…", "署名を確認できませんでした: {{detail}}", "文書タイムスタンプ", "不明な署名者", "文書はその後変更されています", "詳細", "署名済みバージョンを表示", "{{name}}（署名済みバージョン {{number}}）",
           "有効", "不明な証明書", "署名後に変更されています", "無効な署名", "確認できません", "未署名の署名フィールド",
           "信頼されたルート証明書へのチェーンがありません", "該当時点で有効でない証明書があります", "この用途向けではない証明書があります", "サポートされていないアルゴリズム", "署名データを読み取れません", "署名者の証明書がありません", "署名されたバイト範囲が無効です", "文書構造を読み取れません", "古い署名形式",
           "署名された内容は変更されておらず、証明書は信頼されたルートにつながっています。", "署名されたバイトは署名後に変更されました。", "署名されたバイトは変更されていませんが、署名値が一致しません。",
           "署名の詳細", "状態", "説明", "署名者", "発行者", "フィールド", "日時", "{{time}}（タイムスタンプより）", "{{time}}（署名者の申告）", "タイムスタンプ", "なし", "理由", "場所", "範囲", "文書全体", "{{size}} バイト中 0～{{end}}", "証明書チェーン", "有効期間 {{from}}～{{to}}", "失効は確認していません。",
           "署名済み文書", "この文書にはデジタル署名が含まれています。保存するとファイルが書き換えられ、署名は無効になります。保存しますか？", "保存する"],
    "zh": ["正在检查数字签名…", "无法检查签名：{{detail}}", "文档时间戳", "未知签名者", "文档此后又被修改", "详细信息", "显示已签名版本", "{{name}}（已签名版本 {{number}}）",
           "有效", "未知证书", "签名后已修改", "签名无效", "无法验证", "未签名的签名字段",
           "没有通往受信任根证书的链", "某个证书在相关时间点无效", "某个证书不适用于此用途", "不支持的算法", "无法读取签名数据", "缺少签名者的证书", "签名的字节范围无效", "无法读取文档结构", "过时的签名格式",
           "已签名内容未更改，且证书可追溯到受信任的根证书。", "已签名的字节在签名后被更改。", "已签名的字节未更改，但签名值不匹配。",
           "签名详细信息", "状态", "说明", "签名者", "颁发者", "字段", "时间", "{{time}}（来自时间戳）", "{{time}}（签名者声明）", "时间戳", "无", "原因", "位置", "覆盖范围", "整个文档", "第 0 至 {{end}} 字节，共 {{size}}", "证书链", "有效期 {{from}} 至 {{to}}", "未检查吊销状态。",
           "已签名文档", "此文档包含数字签名。保存会重写文件，导致签名失效。仍要保存吗？", "仍然保存"],
    "ko": ["디지털 서명을 확인하는 중…", "서명을 확인할 수 없습니다: {{detail}}", "문서 타임스탬프", "알 수 없는 서명자", "이후 문서가 변경됨", "세부 정보", "서명된 버전 표시", "{{name}} (서명된 버전 {{number}})",
           "유효함", "알 수 없는 인증서", "서명 후 변경됨", "잘못된 서명", "확인할 수 없음", "서명되지 않은 서명 필드",
           "신뢰할 수 있는 루트 인증서로 이어지는 체인이 없음", "관련 시점에 유효하지 않은 인증서가 있음", "이 용도에 맞지 않는 인증서가 있음", "지원되지 않는 알고리즘", "서명 데이터를 읽을 수 없음", "서명자의 인증서가 없음", "서명된 바이트 범위가 잘못됨", "문서 구조를 읽을 수 없음", "오래된 서명 형식",
           "서명된 내용은 변경되지 않았으며 인증서가 신뢰할 수 있는 루트로 이어집니다.", "서명된 바이트가 서명 후 변경되었습니다.", "서명된 바이트는 변경되지 않았지만 서명 값이 일치하지 않습니다.",
           "서명 세부 정보", "상태", "설명", "서명자", "발급자", "필드", "시간", "{{time}} (타임스탬프 기준)", "{{time}} (서명자가 입력)", "타임스탬프", "없음", "사유", "위치", "적용 범위", "문서 전체", "{{size}}바이트 중 0~{{end}}", "인증서 체인", "유효 기간 {{from}} ~ {{to}}", "해지 여부는 확인하지 않았습니다.",
           "서명된 문서", "이 문서에는 디지털 서명이 포함되어 있습니다. 저장하면 파일이 다시 작성되어 서명이 무효화됩니다. 그래도 저장하시겠습니까?", "그래도 저장"],
    "th": ["กำลังตรวจสอบลายเซ็นดิจิทัล…", "ไม่สามารถตรวจสอบลายเซ็นได้: {{detail}}", "การประทับเวลาเอกสาร", "ผู้ลงนามที่ไม่รู้จัก", "เอกสารถูกแก้ไขภายหลัง", "รายละเอียด", "แสดงฉบับที่ลงนาม", "{{name}} (ฉบับที่ลงนาม {{number}})",
           "ถูกต้อง", "ใบรับรองที่ไม่รู้จัก", "ถูกแก้ไขหลังการลงนาม", "ลายเซ็นไม่ถูกต้อง", "ไม่สามารถตรวจสอบได้", "ช่องลายเซ็นที่ยังไม่ได้ลงนาม",
           "ไม่มีสายโยงไปยังใบรับรองรากที่เชื่อถือได้", "ใบรับรองไม่ถูกต้อง ณ เวลาที่เกี่ยวข้อง", "ใบรับรองไม่ได้มีไว้สำหรับการใช้งานนี้", "อัลกอริทึมที่ไม่รองรับ", "ไม่สามารถอ่านข้อมูลลายเซ็นได้", "ไม่มีใบรับรองของผู้ลงนาม", "ช่วงไบต์ที่ลงนามไม่ถูกต้อง", "ไม่สามารถอ่านโครงสร้างเอกสารได้", "รูปแบบลายเซ็นที่ล้าสมัย",
           "เนื้อหาที่ลงนามไม่มีการเปลี่ยนแปลง และใบรับรองเชื่อมโยงไปยังรากที่เชื่อถือได้", "ไบต์ที่ลงนามถูกเปลี่ยนแปลงหลังการลงนาม", "ไบต์ที่ลงนามไม่มีการเปลี่ยนแปลง แต่ค่าลายเซ็นไม่ตรงกัน",
           "รายละเอียดลายเซ็น", "สถานะ", "คำอธิบาย", "ผู้ลงนาม", "ออกโดย", "ช่อง", "เวลา", "{{time}} (จากการประทับเวลา)", "{{time}} (ตามที่ผู้ลงนามระบุ)", "การประทับเวลา", "ไม่มี", "เหตุผล", "สถานที่", "ขอบเขต", "ทั้งเอกสาร", "ไบต์ 0 ถึง {{end}} จาก {{size}}", "สายใบรับรอง", "ใช้ได้ตั้งแต่ {{from}} ถึง {{to}}", "ไม่ได้ตรวจสอบการเพิกถอน",
           "เอกสารที่ลงนามแล้ว", "เอกสารนี้มีลายเซ็นดิจิทัล การบันทึกจะเขียนไฟล์ใหม่ ทำให้ลายเซ็นไม่ถูกต้อง ต้องการบันทึกหรือไม่", "บันทึกต่อไป"],
    "hi": ["डिजिटल हस्ताक्षरों की जाँच हो रही है…", "हस्ताक्षरों की जाँच नहीं हो सकी: {{detail}}", "दस्तावेज़ टाइमस्टैम्प", "अज्ञात हस्ताक्षरकर्ता", "दस्तावेज़ बाद में बदला गया", "विवरण", "हस्ताक्षरित संस्करण दिखाएँ", "{{name}} (हस्ताक्षरित संस्करण {{number}})",
           "मान्य", "अज्ञात प्रमाणपत्र", "हस्ताक्षर के बाद बदला गया", "अमान्य हस्ताक्षर", "जाँच नहीं की जा सकती", "बिना हस्ताक्षर वाला हस्ताक्षर फ़ील्ड",
           "किसी विश्वसनीय रूट प्रमाणपत्र तक कोई शृंखला नहीं", "एक प्रमाणपत्र प्रासंगिक समय पर मान्य नहीं था", "एक प्रमाणपत्र इस उपयोग के लिए नहीं है", "असमर्थित एल्गोरिदम", "हस्ताक्षर डेटा पढ़ा नहीं जा सकता", "हस्ताक्षरकर्ता का प्रमाणपत्र मौजूद नहीं है", "हस्ताक्षरित बाइट सीमा अमान्य है", "दस्तावेज़ की संरचना पढ़ी नहीं जा सकती", "पुराना हस्ताक्षर प्रारूप",
           "हस्ताक्षरित सामग्री अपरिवर्तित है और प्रमाणपत्र एक विश्वसनीय रूट तक जाता है।", "हस्ताक्षरित बाइट हस्ताक्षर के बाद बदले गए।", "हस्ताक्षरित बाइट अपरिवर्तित हैं, लेकिन हस्ताक्षर का मान मेल नहीं खाता।",
           "हस्ताक्षर विवरण", "स्थिति", "स्पष्टीकरण", "हस्ताक्षरकर्ता", "जारीकर्ता", "फ़ील्ड", "समय", "{{time}} (टाइमस्टैम्प से)", "{{time}} (हस्ताक्षरकर्ता द्वारा बताया गया)", "टाइमस्टैम्प", "कोई नहीं", "कारण", "स्थान", "कवरेज", "पूरा दस्तावेज़", "{{size}} में से बाइट 0 से {{end}}", "प्रमाणपत्र शृंखला", "{{from}} से {{to}} तक मान्य", "निरस्तीकरण की जाँच नहीं की गई।",
           "हस्ताक्षरित दस्तावेज़", "इस दस्तावेज़ में डिजिटल हस्ताक्षर हैं। सहेजने पर फ़ाइल फिर से लिखी जाती है, जिससे हस्ताक्षर अमान्य हो जाते हैं। फिर भी सहेजें?", "फिर भी सहेजें"],
    "bn": ["ডিজিটাল স্বাক্ষর যাচাই করা হচ্ছে…", "স্বাক্ষরগুলো যাচাই করা যায়নি: {{detail}}", "নথির টাইমস্ট্যাম্প", "অজানা স্বাক্ষরকারী", "নথিটি পরে পরিবর্তন করা হয়েছে", "বিস্তারিত", "স্বাক্ষরিত সংস্করণ দেখান", "{{name}} (স্বাক্ষরিত সংস্করণ {{number}})",
           "বৈধ", "অজানা সার্টিফিকেট", "স্বাক্ষরের পরে পরিবর্তিত", "অবৈধ স্বাক্ষর", "যাচাই করা যায় না", "স্বাক্ষরহীন স্বাক্ষর ক্ষেত্র",
           "বিশ্বস্ত রুট সার্টিফিকেট পর্যন্ত কোনো শৃঙ্খল নেই", "একটি সার্টিফিকেট প্রাসঙ্গিক সময়ে বৈধ ছিল না", "একটি সার্টিফিকেট এই ব্যবহারের জন্য নয়", "অসমর্থিত অ্যালগরিদম", "স্বাক্ষরের ডেটা পড়া যায় না", "স্বাক্ষরকারীর সার্টিফিকেট নেই", "স্বাক্ষরিত বাইট পরিসর অবৈধ", "নথির কাঠামো পড়া যায় না", "পুরোনো স্বাক্ষর বিন্যাস",
           "স্বাক্ষরিত বিষয়বস্তু অপরিবর্তিত এবং সার্টিফিকেটটি একটি বিশ্বস্ত রুটে পৌঁছায়।", "স্বাক্ষরের পরে স্বাক্ষরিত বাইটগুলো পরিবর্তিত হয়েছে।", "স্বাক্ষরিত বাইটগুলো অপরিবর্তিত, কিন্তু স্বাক্ষরের মান মেলে না।",
           "স্বাক্ষরের বিস্তারিত", "অবস্থা", "ব্যাখ্যা", "স্বাক্ষরকারী", "ইস্যুকারী", "ক্ষেত্র", "সময়", "{{time}} (টাইমস্ট্যাম্প থেকে)", "{{time}} (স্বাক্ষরকারীর উল্লেখ করা)", "টাইমস্ট্যাম্প", "কিছু নেই", "কারণ", "অবস্থান", "আওতা", "সম্পূর্ণ নথি", "{{size}} এর মধ্যে বাইট 0 থেকে {{end}}", "সার্টিফিকেট শৃঙ্খল", "{{from}} থেকে {{to}} পর্যন্ত বৈধ", "প্রত্যাহার যাচাই করা হয়নি।",
           "স্বাক্ষরিত নথি", "এই নথিতে ডিজিটাল স্বাক্ষর আছে। সংরক্ষণ করলে ফাইলটি নতুন করে লেখা হয়, ফলে স্বাক্ষরগুলো অবৈধ হয়ে যায়। তবুও সংরক্ষণ করবেন?", "তবুও সংরক্ষণ করুন"],
    "ta": ["டிஜிட்டல் கையொப்பங்கள் சரிபார்க்கப்படுகின்றன…", "கையொப்பங்களைச் சரிபார்க்க முடியவில்லை: {{detail}}", "ஆவண நேர முத்திரை", "அறியப்படாத கையொப்பமிட்டவர்", "ஆவணம் பின்னர் மாற்றப்பட்டுள்ளது", "விவரங்கள்", "கையொப்பமிட்ட பதிப்பைக் காட்டு", "{{name}} (கையொப்பமிட்ட பதிப்பு {{number}})",
           "செல்லுபடியானது", "அறியப்படாத சான்றிதழ்", "கையொப்பமிட்ட பிறகு மாற்றப்பட்டது", "செல்லாத கையொப்பம்", "சரிபார்க்க முடியாது", "கையொப்பமிடப்படாத கையொப்பப் புலம்",
           "நம்பகமான மூலச் சான்றிதழுக்குச் சங்கிலி இல்லை", "ஒரு சான்றிதழ் தொடர்புடைய நேரத்தில் செல்லுபடியாகவில்லை", "ஒரு சான்றிதழ் இந்தப் பயன்பாட்டிற்கானது அல்ல", "ஆதரிக்கப்படாத வழிமுறை", "கையொப்பத் தரவைப் படிக்க முடியவில்லை", "கையொப்பமிட்டவரின் சான்றிதழ் இல்லை", "கையொப்பமிட்ட பைட் வரம்பு செல்லாதது", "ஆவணக் கட்டமைப்பைப் படிக்க முடியவில்லை", "காலாவதியான கையொப்ப வடிவம்",
           "கையொப்பமிட்ட உள்ளடக்கம் மாறவில்லை, சான்றிதழ் நம்பகமான மூலத்திற்கு இட்டுச் செல்கிறது.", "கையொப்பமிட்ட பைட்டுகள் கையொப்பமிட்ட பிறகு மாற்றப்பட்டன.", "கையொப்பமிட்ட பைட்டுகள் மாறவில்லை, ஆனால் கையொப்ப மதிப்பு பொருந்தவில்லை.",
           "கையொப்ப விவரங்கள்", "நிலை", "விளக்கம்", "கையொப்பமிட்டவர்", "வழங்கியவர்", "புலம்", "நேரம்", "{{time}} (நேர முத்திரையிலிருந்து)", "{{time}} (கையொப்பமிட்டவர் குறிப்பிட்டது)", "நேர முத்திரை", "எதுவுமில்லை", "காரணம்", "இடம்", "உள்ளடக்க வரம்பு", "முழு ஆவணம்", "{{size}} இல் பைட் 0 முதல் {{end}} வரை", "சான்றிதழ் சங்கிலி", "{{from}} முதல் {{to}} வரை செல்லுபடியாகும்", "திரும்பப்பெறுதல் சரிபார்க்கப்படவில்லை.",
           "கையொப்பமிட்ட ஆவணம்", "இந்த ஆவணத்தில் டிஜிட்டல் கையொப்பங்கள் உள்ளன. சேமித்தால் கோப்பு மீண்டும் எழுதப்படும், இதனால் கையொப்பங்கள் செல்லாதவையாகும். இருந்தாலும் சேமிக்கவா?", "இருந்தாலும் சேமி"],
    "ur": ["ڈیجیٹل دستخطوں کی جانچ ہو رہی ہے…", "دستخطوں کی جانچ نہیں ہو سکی: {{detail}}", "دستاویز کا ٹائم اسٹیمپ", "نامعلوم دستخط کنندہ", "دستاویز بعد میں تبدیل کی گئی", "تفصیلات", "دستخط شدہ ورژن دکھائیں", "{{name}} (دستخط شدہ ورژن {{number}})",
           "درست", "نامعلوم سرٹیفکیٹ", "دستخط کے بعد تبدیل کی گئی", "غلط دستخط", "جانچ نہیں ہو سکتی", "بغیر دستخط والا دستخطی خانہ",
           "کسی قابلِ اعتماد روٹ سرٹیفکیٹ تک کوئی زنجیر نہیں", "ایک سرٹیفکیٹ متعلقہ وقت پر درست نہیں تھا", "ایک سرٹیفکیٹ اس استعمال کے لیے نہیں ہے", "غیر معاون الگورتھم", "دستخط کا ڈیٹا پڑھا نہیں جا سکتا", "دستخط کنندہ کا سرٹیفکیٹ موجود نہیں", "دستخط شدہ بائٹ رینج غلط ہے", "دستاویز کا ڈھانچہ پڑھا نہیں جا سکتا", "پرانا دستخطی فارمیٹ",
           "دستخط شدہ مواد تبدیل نہیں ہوا اور سرٹیفکیٹ ایک قابلِ اعتماد روٹ تک جاتا ہے۔", "دستخط شدہ بائٹس دستخط کے بعد تبدیل کیے گئے۔", "دستخط شدہ بائٹس تبدیل نہیں ہوئے، لیکن دستخط کی قدر میل نہیں کھاتی۔",
           "دستخط کی تفصیلات", "حیثیت", "وضاحت", "دستخط کنندہ", "جاری کنندہ", "خانہ", "وقت", "{{time}} (ٹائم اسٹیمپ سے)", "{{time}} (دستخط کنندہ کے مطابق)", "ٹائم اسٹیمپ", "کوئی نہیں", "وجہ", "مقام", "احاطہ", "پوری دستاویز", "{{size}} میں سے بائٹ 0 تا {{end}}", "سرٹیفکیٹ زنجیر", "{{from}} سے {{to}} تک درست", "منسوخی کی جانچ نہیں کی گئی۔",
           "دستخط شدہ دستاویز", "اس دستاویز میں ڈیجیٹل دستخط ہیں۔ محفوظ کرنے سے فائل دوبارہ لکھی جاتی ہے، جس سے دستخط غلط ہو جاتے ہیں۔ پھر بھی محفوظ کریں؟", "پھر بھی محفوظ کریں"],
    "fa": ["در حال بررسی امضاهای دیجیتال…", "بررسی امضاها ممکن نشد: {{detail}}", "مهر زمانی سند", "امضاکننده ناشناس", "سند پس از آن تغییر کرده است", "جزئیات", "نمایش نسخه امضاشده", "{{name}} (نسخه امضاشده {{number}})",
           "معتبر", "گواهی ناشناس", "پس از امضا تغییر کرده", "امضای نامعتبر", "قابل بررسی نیست", "فیلد امضای امضانشده",
           "زنجیره‌ای تا یک گواهی ریشه مورد اعتماد وجود ندارد", "یک گواهی در زمان مربوط معتبر نبود", "یک گواهی برای این کاربرد در نظر گرفته نشده است", "الگوریتم پشتیبانی‌نشده", "داده‌های امضا قابل خواندن نیست", "گواهی امضاکننده وجود ندارد", "بازه بایتی امضاشده نامعتبر است", "ساختار سند قابل خواندن نیست", "قالب امضای منسوخ",
           "محتوای امضاشده تغییر نکرده و گواهی به یک ریشه مورد اعتماد می‌رسد.", "بایت‌های امضاشده پس از امضا تغییر کرده‌اند.", "بایت‌های امضاشده تغییر نکرده‌اند، اما مقدار امضا مطابقت ندارد.",
           "جزئیات امضا", "وضعیت", "توضیح", "امضاکننده", "صادرکننده", "فیلد", "زمان", "{{time}} (از مهر زمانی)", "{{time}} (اعلام‌شده توسط امضاکننده)", "مهر زمانی", "هیچ", "دلیل", "مکان", "پوشش", "کل سند", "بایت 0 تا {{end}} از {{size}}", "زنجیره گواهی", "معتبر از {{from}} تا {{to}}", "ابطال بررسی نشده است.",
           "سند امضاشده", "این سند دارای امضای دیجیتال است. ذخیره کردن فایل را بازنویسی می‌کند و امضاها نامعتبر می‌شوند. با این حال ذخیره شود؟", "با این حال ذخیره کن"],
    "ar": ["جارٍ التحقق من التوقيعات الرقمية…", "تعذّر التحقق من التوقيعات: {{detail}}", "طابع زمني للمستند", "موقّع غير معروف", "تم تعديل المستند لاحقًا", "التفاصيل", "عرض النسخة الموقّعة", "{{name}} (النسخة الموقّعة {{number}})",
           "صالح", "شهادة غير معروفة", "تم التعديل بعد التوقيع", "توقيع غير صالح", "لا يمكن التحقق", "حقل توقيع غير موقّع",
           "لا توجد سلسلة إلى شهادة جذر موثوقة", "لم تكن إحدى الشهادات صالحة في الوقت المعني", "إحدى الشهادات غير مخصصة لهذا الاستخدام", "خوارزمية غير مدعومة", "تتعذر قراءة بيانات التوقيع", "شهادة الموقّع مفقودة", "نطاق البايتات الموقّع غير صالح", "تتعذر قراءة بنية المستند", "تنسيق توقيع قديم",
           "المحتوى الموقّع لم يتغير والشهادة تقود إلى جذر موثوق.", "تم تغيير البايتات الموقّعة بعد التوقيع.", "البايتات الموقّعة لم تتغير، لكن قيمة التوقيع غير مطابقة.",
           "تفاصيل التوقيع", "الحالة", "الشرح", "الموقّع", "صادرة عن", "الحقل", "الوقت", "{{time}} (من الطابع الزمني)", "{{time}} (حسب ما ذكره الموقّع)", "الطابع الزمني", "لا يوجد", "السبب", "الموقع", "النطاق المشمول", "المستند بالكامل", "البايتات من 0 إلى {{end}} من {{size}}", "سلسلة الشهادات", "صالحة من {{from}} إلى {{to}}", "لم يتم التحقق من الإبطال.",
           "مستند موقّع", "يحتوي هذا المستند على توقيعات رقمية. الحفظ يعيد كتابة الملف مما يجعل التوقيعات غير صالحة. هل تريد الحفظ على أي حال؟", "الحفظ على أي حال"],
    "he": ["בודק חתימות דיגיטליות…", "לא ניתן היה לבדוק את החתימות: {{detail}}", "חותמת זמן של מסמך", "חותם לא ידוע", "המסמך שונה לאחר מכן", "פרטים", "הצג את הגרסה החתומה", "{{name}} (גרסה חתומה {{number}})",
           "תקפה", "אישור לא ידוע", "שונה לאחר החתימה", "חתימה לא תקפה", "לא ניתן לבדוק", "שדה חתימה לא חתום",
           "אין שרשרת לאישור בסיס מהימן", "אישור לא היה תקף בזמן הרלוונטי", "אישור אינו מיועד לשימוש זה", "אלגוריתם לא נתמך", "לא ניתן לקרוא את נתוני החתימה", "חסר האישור של החותם", "טווח הבייטים החתום אינו תקף", "לא ניתן לקרוא את מבנה המסמך", "פורמט חתימה מיושן",
           "התוכן החתום לא השתנה והאישור מוביל לבסיס מהימן.", "הבייטים החתומים שונו לאחר החתימה.", "הבייטים החתומים לא השתנו, אך ערך החתימה אינו תואם.",
           "פרטי החתימה", "מצב", "הסבר", "חותם", "הונפק על ידי", "שדה", "זמן", "{{time}} (מחותמת הזמן)", "{{time}} (לפי החותם)", "חותמת זמן", "אין", "סיבה", "מיקום", "כיסוי", "המסמך כולו", "בייטים 0 עד {{end}} מתוך {{size}}", "שרשרת אישורים", "תקף מ-{{from}} עד {{to}}", "ביטול לא נבדק.",
           "מסמך חתום", "מסמך זה מכיל חתימות דיגיטליות. שמירה כותבת את הקובץ מחדש, והחתימות הופכות ללא תקפות. לשמור בכל זאת?", "שמור בכל זאת"],
}


def genest(lijst):
    uit = {}
    for sleutel, tekst in zip(SLEUTELS, lijst):
        doel = uit
        *pad, laatste = sleutel.split(".")
        for deel in pad:
            doel = doel.setdefault(deel, {})
        doel[laatste] = tekst
    return uit


def main():
    talen = sorted(os.listdir(MAP))
    assert len(talen) == 39, talen
    assert sorted(T) == talen, set(T) ^ set(talen)
    for taal, lijst in T.items():
        assert len(lijst) == len(SLEUTELS), (taal, len(lijst))
        pad = os.path.join(MAP, taal, "dialogs.json")
        data = json.loads(open(pad, "rb").read().decode("utf-8"))
        data["signatureVerification"] = genest(lijst)
        tekst = json.dumps(data, indent=2, ensure_ascii=False).replace("\n", "\r\n") + "\r\n"
        open(pad, "wb").write(tekst.encode("utf-8"))
    print(f"{len(T)} locales bijgewerkt, {len(SLEUTELS)} sleutels")


main()
```

Run (vanuit de worktree-root):

```bash
PYTHONIOENCODING=utf-8 python "$TEMP/handtekening-i18n.py" open-pdf-studio/js/i18n/locales && rm "$TEMP/handtekening-i18n.py"
git diff --stat -- open-pdf-studio/js/i18n/locales | tail -n 1
```
Expected: `39 locales bijgewerkt, 48 sleutels` en `39 files changed, 2340 insertions(+)` (60 regels per bestand; verder niets gewijzigd).

- [ ] **Step 3: Tests draaien**

```bash
cd open-pdf-studio && node --test js/pdf/handtekeningen/i18n-sleutels.test.mjs 2>&1 | grep -E "^ℹ (pass|fail)"
npm run test:unit 2>&1 | grep -E "^(#|ℹ) (pass|fail)"
```
Expected: `ℹ pass 1`, `ℹ fail 0`; daarna `fail 0` voor de hele set.

- [ ] **Step 4: Build en commit**

```bash
cd open-pdf-studio && npx vite build > /dev/null 2>&1; echo "vite exit $?"
cd .. && git add open-pdf-studio/js/i18n/locales open-pdf-studio/js/pdf/handtekeningen/i18n-sleutels.test.mjs open-pdf-studio/package.json
git commit -m "i18n(handtekening): teksten voor handtekeningstatus, detailvenster en opslagwaarschuwing in alle talen"
```
Expected: `vite exit 0`.

---

### Task 14: JS — verificatie starten en de handtekeningbalk

**Files:**
- Create: `open-pdf-studio/js/pdf/handtekeningen/weergave.js`
- Create: `open-pdf-studio/js/pdf/handtekeningen/weergave.test.mjs`
- Create: `open-pdf-studio/js/pdf/handtekeningen/verificatie.js`
- Create: `open-pdf-studio/js/solid/stores/handtekeningBarStore.js`
- Create: `open-pdf-studio/js/solid/components/HandtekeningBar.jsx`
- Create: `open-pdf-studio/styles/handtekening.css`
- Modify: `open-pdf-studio/styles.css`, `open-pdf-studio/js/solid/App.jsx`, `open-pdf-studio/js/pdf/loader.js`, `open-pdf-studio/js/ui/chrome/tabs.js`, `open-pdf-studio/package.json`

**Interfaces:**
- Consumes:
  - Tauri-commando `pdf_signature_list({ pad })` → `HandtekeningInfo[]` (camelCase: `nummer`, `veldnaam`, `soort` (`handtekening|documenttijdstempel|leeg-veld|onbekend`), `status: { code, reden? }`, `daarnaGewijzigd`, `integriteit: { uitkomst, reden? } | null`, `vertrouwen: { uitkomst, reden? }`, `detail`, `ondertekenaar`, `uitgever`, `tijdUnix`, `tijdBron` (`tijdstempel|opgegeven|onbekend`), `tijdstempel: { tijdUnix, tsa, integriteit, vertrouwen, zwakAlgoritme } | null`, `dektHeleDocument`, `bereikEinde`, `bestandsgrootte`, `reden`, `plaats`, `contact`, `opgegevenNaam`, `woordenboekOndertekend`, `keten: [{ naam, uitgever, geldigVanUnix, geldigTotUnix }]`, `zwakAlgoritme`); fout `{ code: 'onleesbaar'|'pdf-onleesbaar'|'geen-handtekening', detail? }` (Task 11).
  - *Bij uitvoering van Task 11 toegevoegd:* `zwakAlgoritme` (bool, op de handtekening en op `tijdstempel`): SHA-1 in handtekening, token of gecontroleerde keten; alleen een waarschuwing, `status` en `integriteit` veranderen er niet door. `dektHeleDocument` is ook `true` als na het bytebereik alleen PDF-witruimte staat (`bereikEinde` kan dan kleiner zijn dan `bestandsgrootte`). `detail` kan een extra signaal bevatten, achter een eventuele eigen toelichting met `; ` gescheiden: "de hex-string in het gat van het bytebereik wijkt af van /Contents". Hetzelfde handtekeningwoordenboek bij meer velden staat één keer in de lijst (bij het eerste veld).
  - *Na de derde review van Task 11 (additief):* `lijstAfgekapt` (bool, gelijk op alle regels): het document heeft meer dan 1000 handtekeningvelden en de lijst is onvolledig. `veldnaam` bij een gedeelde `/V`: het veld binnen het bytebereik van de handtekening, anders het eerste. Een interne fout bij één handtekening geeft voor die regel `integriteit`/`status` niet-te-controleren met reden `cms-onleesbaar` en `detail` "interne fout bij het controleren: …". `pdf_signed_revision({ pad, nummer, bereikEinde? })`: `bereikEinde` (optioneel, uit de lijst) laat de Rust-kant controleren dat handtekening `nummer` daar nog eindigt, anders fout `{ code: 'gewijzigd-sinds-lijst' }`. Het antwoord blijft een absoluut pad, nu in de cachemap van de app (`…/ondertekende-versies/`), met per aanroep een unieke naam; het bestand staat in de fs-scope (lezen en `fs.remove`). Bestanden ouder dan zeven dagen ruimt de app bij het opstarten op (na de eindreview; was een dag).
  - *Na de eindreview (additief):* `signalen` op elke regel en op `tijdstempel` (zie Task 11). `weergave.js` vertaalt ze met `signaalSleutels(info)` en `tijdstempelSignaalSleutels(info)` naar `signatureVerification.signals.<code>` (onbekend: `signals.unknown`); `detail` en `subfilter` alleen onder een ingeklapt "Technisch detail". Foutcodes `geen-handtekening`, `onleesbaar` en `gewijzigd-sinds-lijst` hebben eigen teksten (`errors.*`). De balk toont een neutrale regel als het document in de app gewijzigd is (`modifiedInApp`); status en "daarna nog gewijzigd" staan in een eigen, niet inkortende tekstdeel, de naam kort als eerste in.
  - i18n `dialogs:signatureVerification.*` (Task 13).
  - `invoke`, `isTauri` uit `js/core/platform.js`; `state` uit `js/core/state.js`; `i18next` uit `js/i18n/config.js`; `useTranslation` uit `js/i18n/useTranslation.js`.
- Produces:
  - `js/pdf/handtekeningen/weergave.js` (puur): `statusSleutel(info)`, `redenSleutel(info)`, `lijstFoutRedenSleutel(fout)`, `tijdstempelStatusSleutel(tijdstempel)`, `ernst(info)` → `'goed'|'waarschuwing'|'fout'|'neutraal'`, `ernstigste(lijst)`, `heeftIntacteHandtekening(lijst)`, `kanOndertekendeVersieTonen(info)`, `formatTijd(unix, taal, tijdzone?)`, `async heeftHandtekeningvelden(pdfDoc)`.
  - `js/pdf/handtekeningen/verificatie.js`: `async verifieerHandtekeningen(doc, pad = null)`, `toonBalkVoorActiefDocument()`, `sluitBalkVoorActiefDocument()`, `foutTekst(fout)`.
  - Velden op het documentobject (runtime, zoals `pdfaCompliance`): `handtekeningToestand` (`'geen'|'bezig'|'klaar'|'fout'`), `handtekeningen` (array of null), `handtekeningFout` (string), `handtekeningBalkGesloten` (bool), `_handtekeningVerzoek` (teller).
  - `js/solid/stores/handtekeningBarStore.js`: signalen `toestand`, `items`, `foutDetail`; `toonHandtekeningBalk({ toestand, items, fout })`, `verbergHandtekeningBalk()`.
  - `HandtekeningBar.jsx`: balk in `.main-view` direct onder `<PdfABar />`. Knoppen met klassen `handtekening-bar-details` en `handtekening-bar-versie` roepen in Task 15 `openHandtekeningDetails(info)` en `openOndertekendeVersie(nummer)` aan uit `verificatie.js`; deze taak maakt die knoppen al, met een dynamische import.

Gedrag (spec §3.2, §7.3): verificatie start na het laden van elk document (actief of niet), maar alleen als pdf.js handtekeningvelden ziet; de Rust-kant draait op een eigen thread, het openen wacht er niet op. De balk hoort bij het actieve tabblad: wisselen verbergt of toont hem. Een late uitkomst van een eerder verzoek wordt genegeerd (teller). De balk heeft een sluitknop per document.

- [ ] **Step 1: Pure module en test (test faalt eerst)**

`open-pdf-studio/js/pdf/handtekeningen/weergave.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  statusSleutel, redenSleutel, lijstFoutRedenSleutel, tijdstempelStatusSleutel, ernst, ernstigste,
  heeftIntacteHandtekening, kanOndertekendeVersieTonen, formatTijd, heeftHandtekeningvelden,
} from './weergave.js';

const info = (code, extra = {}) => {
  const { reden, ...rest } = extra;
  return { status: reden ? { code, reden } : { code }, ...rest };
};

test('statussleutel per statuscode uit Rust', () => {
  assert.equal(statusSleutel(info('geldig')), 'signatureVerification.status.valid');
  assert.equal(statusSleutel(info('onbekend-certificaat')), 'signatureVerification.status.unknownCertificate');
  assert.equal(statusSleutel(info('gewijzigd-na-ondertekenen')), 'signatureVerification.status.modified');
  assert.equal(statusSleutel(info('ongeldige-handtekening')), 'signatureVerification.status.invalid');
  assert.equal(statusSleutel(info('niet-te-controleren')), 'signatureVerification.status.notVerifiable');
  assert.equal(statusSleutel(info('niet-ondertekend-veld')), 'signatureVerification.status.unsignedField');
  assert.equal(statusSleutel({}), 'signatureVerification.status.notVerifiable');
});

test('redensleutel: reden gaat voor uitleg', () => {
  assert.equal(redenSleutel(info('onbekend-certificaat', { reden: 'geen-keten' })), 'signatureVerification.reasons.noChain');
  assert.equal(redenSleutel(info('niet-te-controleren', { reden: 'verouderd-formaat' })), 'signatureVerification.reasons.legacyFormat');
  assert.equal(redenSleutel(info('geldig')), 'signatureVerification.explanation.valid');
  assert.equal(redenSleutel(info('gewijzigd-na-ondertekenen')), 'signatureVerification.explanation.modified');
  assert.equal(redenSleutel(info('ongeldige-handtekening')), 'signatureVerification.explanation.invalid');
  assert.equal(redenSleutel(info('niet-ondertekend-veld')), null);
  assert.equal(lijstFoutRedenSleutel({ code: 'pdf-onleesbaar', detail: 'x' }), 'signatureVerification.reasons.pdfUnreadable');
  assert.equal(lijstFoutRedenSleutel({ code: 'onleesbaar', detail: 'x' }), null);
});

test('tijdstempelstatus', () => {
  const ts = (uitkomst, vertrouwen) => ({ integriteit: { uitkomst }, vertrouwen: { uitkomst: vertrouwen } });
  assert.equal(tijdstempelStatusSleutel(ts('intact', 'vertrouwd')), 'signatureVerification.status.valid');
  assert.equal(tijdstempelStatusSleutel(ts('intact', 'niet-vertrouwd')), 'signatureVerification.status.unknownCertificate');
  assert.equal(tijdstempelStatusSleutel(ts('gewijzigd', 'niet-bepaald')), 'signatureVerification.status.modified');
  assert.equal(tijdstempelStatusSleutel(ts('ongeldig', 'niet-bepaald')), 'signatureVerification.status.invalid');
  assert.equal(tijdstempelStatusSleutel(ts('niet-te-controleren', 'niet-bepaald')), 'signatureVerification.status.notVerifiable');
});

test('ernst: geldig maar daarna gewijzigd is een waarschuwing', () => {
  assert.equal(ernst(info('geldig')), 'goed');
  assert.equal(ernst(info('geldig', { daarnaGewijzigd: true })), 'waarschuwing');
  assert.equal(ernst(info('onbekend-certificaat')), 'waarschuwing');
  assert.equal(ernst(info('niet-te-controleren')), 'waarschuwing');
  assert.equal(ernst(info('gewijzigd-na-ondertekenen')), 'fout');
  assert.equal(ernst(info('ongeldige-handtekening')), 'fout');
  assert.equal(ernst(info('niet-ondertekend-veld')), 'neutraal');
  assert.equal(ernstigste([info('geldig'), info('ongeldige-handtekening'), info('onbekend-certificaat')]), 'fout');
  assert.equal(ernstigste([]), 'neutraal');
});

test('intacte handtekening en ondertekende versie', () => {
  assert.equal(heeftIntacteHandtekening([{ integriteit: { uitkomst: 'gewijzigd' } }, { integriteit: null }]), false);
  assert.equal(heeftIntacteHandtekening([{ integriteit: { uitkomst: 'intact' } }]), true);
  assert.equal(heeftIntacteHandtekening(null), false);
  assert.equal(kanOndertekendeVersieTonen({ nummer: 0, daarnaGewijzigd: true }), true);
  assert.equal(kanOndertekendeVersieTonen({ nummer: 0, daarnaGewijzigd: false }), false);
  assert.equal(kanOndertekendeVersieTonen({ daarnaGewijzigd: true }), false);
});

test('tijd formatteren', () => {
  const tekst = formatTijd(1_537_049_437, 'en-GB', 'UTC');
  assert.match(tekst, /2018/);
  assert.match(tekst, /22:10/);
  assert.equal(formatTijd(null, 'nl'), null);
  assert.equal(formatTijd(Number.NaN, 'nl'), null);
});

test('handtekeningvelden via getFieldObjects', async () => {
  const doc = (velden) => ({ getFieldObjects: async () => velden });
  assert.equal(await heeftHandtekeningvelden(doc({ a: [{ type: 'text' }], H1: [{ type: 'signature' }] })), true);
  assert.equal(await heeftHandtekeningvelden(doc({ a: [{ type: 'text' }] })), false);
  assert.equal(await heeftHandtekeningvelden(doc(null)), false);
  assert.equal(await heeftHandtekeningvelden({ getFieldObjects: async () => { throw new Error('x'); } }), false);
  assert.equal(await heeftHandtekeningvelden(null), false);
});
```

Voeg in `open-pdf-studio/package.json` aan het eind van `test:unit` toe (na `js/pdf/handtekeningen/i18n-sleutels.test.mjs`):

```
 js/pdf/handtekeningen/weergave.test.mjs
```

Run (vanuit `open-pdf-studio/`):

```bash
node --test js/pdf/handtekeningen/weergave.test.mjs 2>&1 | grep -E "ERR_MODULE_NOT_FOUND|^ℹ fail" | head -2
```
Expected: `ERR_MODULE_NOT_FOUND` (de module bestaat nog niet) en `ℹ fail 1`.

`open-pdf-studio/js/pdf/handtekeningen/weergave.js`:

```js
// Weergave van handtekeningstatussen uit pdf_signature_list: i18n-sleutels,
// ernst en kleine beslissingen. Puur: geen i18n, DOM of Tauri, zodat het met
// node:test te toetsen is. Sleutels zijn relatief aan de namespace `dialogs`.

const V = 'signatureVerification';

const STATUS_SLEUTEL = {
  'geldig': `${V}.status.valid`,
  'onbekend-certificaat': `${V}.status.unknownCertificate`,
  'gewijzigd-na-ondertekenen': `${V}.status.modified`,
  'ongeldige-handtekening': `${V}.status.invalid`,
  'niet-te-controleren': `${V}.status.notVerifiable`,
  'niet-ondertekend-veld': `${V}.status.unsignedField`,
};

const REDEN_SLEUTEL = {
  'geen-keten': `${V}.reasons.noChain`,
  'verlopen': `${V}.reasons.expired`,
  'sleutelgebruik': `${V}.reasons.keyUsage`,
  'algoritme-niet-ondersteund': `${V}.reasons.unsupportedAlgorithm`,
  'cms-onleesbaar': `${V}.reasons.cmsUnreadable`,
  'geen-certificaat': `${V}.reasons.noCertificate`,
  'bytebereik-ongeldig': `${V}.reasons.byteRangeInvalid`,
  'pdf-onleesbaar': `${V}.reasons.pdfUnreadable`,
  'verouderd-formaat': `${V}.reasons.legacyFormat`,
};

const RANG = { neutraal: 0, goed: 1, waarschuwing: 2, fout: 3 };

/** i18n-sleutel voor de status van één handtekening. */
export function statusSleutel(info) {
  return STATUS_SLEUTEL[info?.status?.code] || `${V}.status.notVerifiable`;
}

/** i18n-sleutel voor de uitleg bij de status; null als er niets uit te leggen is. */
export function redenSleutel(info) {
  const code = info?.status?.code;
  const reden = info?.status?.reden;
  if (reden && REDEN_SLEUTEL[reden]) return REDEN_SLEUTEL[reden];
  if (code === 'geldig') return `${V}.explanation.valid`;
  if (code === 'gewijzigd-na-ondertekenen') return `${V}.explanation.modified`;
  if (code === 'ongeldige-handtekening') return `${V}.explanation.invalid`;
  return null;
}

/** i18n-sleutel voor een pdf-onleesbaar-fout van de hele lijst. */
export function lijstFoutRedenSleutel(fout) {
  return fout?.code === 'pdf-onleesbaar' ? REDEN_SLEUTEL['pdf-onleesbaar'] : null;
}

/** Status-sleutel voor een handtekeningtijdstempel ({ integriteit, vertrouwen }). */
export function tijdstempelStatusSleutel(tijdstempel) {
  const uitkomst = tijdstempel?.integriteit?.uitkomst;
  if (uitkomst === 'intact') {
    return tijdstempel?.vertrouwen?.uitkomst === 'vertrouwd'
      ? `${V}.status.valid`
      : `${V}.status.unknownCertificate`;
  }
  if (uitkomst === 'gewijzigd') return `${V}.status.modified`;
  if (uitkomst === 'ongeldig') return `${V}.status.invalid`;
  return `${V}.status.notVerifiable`;
}

/** 'goed' | 'waarschuwing' | 'fout' | 'neutraal' — voor kleur en icoon. */
export function ernst(info) {
  switch (info?.status?.code) {
    case 'geldig': return info.daarnaGewijzigd ? 'waarschuwing' : 'goed';
    case 'onbekend-certificaat': return 'waarschuwing';
    case 'niet-te-controleren': return 'waarschuwing';
    case 'gewijzigd-na-ondertekenen': return 'fout';
    case 'ongeldige-handtekening': return 'fout';
    case 'niet-ondertekend-veld': return 'neutraal';
    default: return 'waarschuwing';
  }
}

/** Ernstigste uitkomst van een lijst (voor de kleur van de balk). */
export function ernstigste(lijst) {
  let uit = 'neutraal';
  for (const info of lijst || []) {
    const e = ernst(info);
    if (RANG[e] > RANG[uit]) uit = e;
  }
  return uit;
}

/** Minstens één intacte handtekening? Dan waarschuwen bij gewoon opslaan. */
export function heeftIntacteHandtekening(lijst) {
  return Array.isArray(lijst) && lijst.some((h) => h?.integriteit?.uitkomst === 'intact');
}

/** "Toon ondertekende versie" alleen bij "daarna nog gewijzigd" (spec §7.2). */
export function kanOndertekendeVersieTonen(info) {
  return info?.daarnaGewijzigd === true && Number.isInteger(info?.nummer);
}

/** Tijdstip uit Unix-seconden, of null. */
export function formatTijd(unix, taal, tijdzone) {
  if (typeof unix !== 'number' || !Number.isFinite(unix)) return null;
  const opties = { dateStyle: 'medium', timeStyle: 'short' };
  if (tijdzone) opties.timeZone = tijdzone;
  try {
    return new Intl.DateTimeFormat(taal || undefined, opties).format(new Date(unix * 1000));
  } catch {
    return new Date(unix * 1000).toISOString();
  }
}

/** Heeft het pdf.js-document handtekeningvelden? Goedkoop: alleen het AcroForm. */
export async function heeftHandtekeningvelden(pdfDoc) {
  if (!pdfDoc || typeof pdfDoc.getFieldObjects !== 'function') return false;
  try {
    const velden = await pdfDoc.getFieldObjects();
    if (!velden) return false;
    return Object.values(velden).some((lijst) => Array.isArray(lijst) && lijst.some((v) => v?.type === 'signature'));
  } catch {
    return false;
  }
}
```

```bash
node --test js/pdf/handtekeningen/weergave.test.mjs 2>&1 | grep -E "^ℹ (pass|fail)"
```
Expected: `ℹ pass 7`, `ℹ fail 0`.

- [ ] **Step 2: Store**

`open-pdf-studio/js/solid/stores/handtekeningBarStore.js`:

```js
import { createSignal } from 'solid-js';

// Handtekeningbalk van het actieve document. Toestand: 'verborgen' | 'bezig' | 'klaar' | 'fout'.
const [toestand, setToestand] = createSignal('verborgen');
const [items, setItems] = createSignal([]);
const [foutDetail, setFoutDetail] = createSignal('');

export function toonHandtekeningBalk({ toestand: nieuw, items: lijst = [], fout = '' }) {
  setItems(Array.isArray(lijst) ? lijst : []);
  setFoutDetail(fout || '');
  setToestand(nieuw);
}

export function verbergHandtekeningBalk() {
  setToestand('verborgen');
  setItems([]);
  setFoutDetail('');
}

export { toestand, items, foutDetail };
```

- [ ] **Step 3: Verificatie en koppeling aan het document**

`open-pdf-studio/js/pdf/handtekeningen/verificatie.js`:

```js
// Handtekeningen van een geopend document laten verifiëren (Rust:
// pdf_signature_list) en de balk boven de pagina bijwerken. Start alleen bij
// handtekeningvelden (spec §7.3); het openen wacht hier niet op.
import { state } from '../../core/state.js';
import { invoke, isTauri } from '../../core/platform.js';
import i18next from '../../i18n/config.js';
import { heeftHandtekeningvelden, lijstFoutRedenSleutel } from './weergave.js';
import { toonHandtekeningBalk, verbergHandtekeningBalk } from '../../solid/stores/handtekeningBarStore.js';

function isActief(doc) {
  return state.documents[state.activeDocumentIndex] === doc;
}

/** Leesbare tekst voor een fout van pdf_signature_list of pdf_signed_revision. */
export function foutTekst(fout) {
  const sleutel = lijstFoutRedenSleutel(fout);
  if (sleutel) return i18next.t(`dialogs:${sleutel}`);
  return fout?.detail || fout?.code || String(fout);
}

/** Zet de balk voor het document in het actieve tabblad (of verbergt hem). */
export function toonBalkVoorActiefDocument() {
  const doc = state.documents[state.activeDocumentIndex];
  const toestand = doc?.handtekeningToestand;
  if (!doc || doc.handtekeningBalkGesloten || !toestand || toestand === 'geen') {
    verbergHandtekeningBalk();
    return;
  }
  toonHandtekeningBalk({ toestand, items: doc.handtekeningen || [], fout: doc.handtekeningFout || '' });
}

export function sluitBalkVoorActiefDocument() {
  const doc = state.documents[state.activeDocumentIndex];
  if (doc) doc.handtekeningBalkGesloten = true;
  toonBalkVoorActiefDocument();
}

/**
 * Verifieert de handtekeningen van `doc` in het bestand `pad` (standaard het
 * bestand achter het document). Slaat over zonder handtekeningvelden.
 */
export async function verifieerHandtekeningen(doc, pad = null) {
  if (!doc || !isTauri()) return;
  const bron = pad || doc.saveTargetPath || doc.filePath;
  if (!bron || String(bron).startsWith('__memory__') || !doc.pdfDoc) return;
  const verzoek = (doc._handtekeningVerzoek || 0) + 1;
  doc._handtekeningVerzoek = verzoek;
  const heeft = await heeftHandtekeningvelden(doc.pdfDoc);
  if (doc._handtekeningVerzoek !== verzoek) return;
  if (!heeft) {
    doc.handtekeningToestand = 'geen';
    doc.handtekeningen = null;
    if (isActief(doc)) toonBalkVoorActiefDocument();
    return;
  }
  doc.handtekeningToestand = 'bezig';
  if (isActief(doc)) toonBalkVoorActiefDocument();
  try {
    const lijst = await invoke('pdf_signature_list', { pad: bron });
    if (doc._handtekeningVerzoek !== verzoek) return;
    doc.handtekeningen = Array.isArray(lijst) ? lijst : [];
    doc.handtekeningFout = '';
    doc.handtekeningToestand = 'klaar';
  } catch (e) {
    if (doc._handtekeningVerzoek !== verzoek) return;
    console.warn('[handtekening] verifiëren mislukt:', e);
    doc.handtekeningen = [];
    doc.handtekeningFout = foutTekst(e);
    doc.handtekeningToestand = 'fout';
  }
  if (isActief(doc)) toonBalkVoorActiefDocument();
}
```

In `open-pdf-studio/js/pdf/loader.js`:
1. Voeg na de regel `import { showMessage } from '../bridge.js';` toe:

```js
import { verifieerHandtekeningen } from './handtekeningen/verificatie.js';
```

2. Vervang (in de actieve tak van `loadPDF`):

```js
      // Check for PDF/A compliance and show info bar if applicable
      checkPdfACompliance(doc);
```

door:

```js
      // Check for PDF/A compliance and show info bar if applicable
      checkPdfACompliance(doc);

      // Handtekeningen op de achtergrond verifiëren; de balk volgt vanzelf.
      verifieerHandtekeningen(doc);
```

3. Vervang (in de niet-actieve tak):

```js
      // Not active — still check PDF/A but don't show bar
      checkPdfACompliance(doc);
```

door:

```js
      // Not active — still check PDF/A but don't show bar
      checkPdfACompliance(doc);
      verifieerHandtekeningen(doc);
```

In `open-pdf-studio/js/ui/chrome/tabs.js`:
1. Vervang in `switchToTab`:

```js
  hideFormFieldsBar();
  hidePdfABar();
```

door:

```js
  hideFormFieldsBar();
  hidePdfABar();
  import('../../pdf/handtekeningen/verificatie.js').then(m => m.toonBalkVoorActiefDocument());
```

2. Vervang in `closeTab`:

```js
    import('../../search/find-bar.js').then(m => m.closeFindBar());
```

door:

```js
    import('../../search/find-bar.js').then(m => m.closeFindBar());
    import('../../pdf/handtekeningen/verificatie.js').then(m => m.toonBalkVoorActiefDocument());
```

- [ ] **Step 4: Balk**

`open-pdf-studio/js/solid/components/HandtekeningBar.jsx`:

```jsx
import { Show, For } from 'solid-js';
import { toestand, items, foutDetail } from '../stores/handtekeningBarStore.js';
import { useTranslation } from '../../i18n/useTranslation.js';
import {
  statusSleutel, ernst, ernstigste, formatTijd, kanOndertekendeVersieTonen,
} from '../../pdf/handtekeningen/weergave.js';

// Balk boven de pagina met per handtekening status, ondertekenaar en tijdstip (spec §3.2).
export default function HandtekeningBar() {
  const { t, language } = useTranslation('dialogs');
  const { t: tCommon } = useTranslation('common');
  const v = (sleutel, opties) => t(`signatureVerification.${sleutel}`, opties);

  const naam = (h) => {
    if (h.soort === 'leeg-veld') return h.veldnaam || '';
    if (h.soort === 'documenttijdstempel') {
      return h.ondertekenaar ? `${v('documentTimestamp')} (${h.ondertekenaar})` : v('documentTimestamp');
    }
    return h.ondertekenaar || h.opgegevenNaam || v('unknownSigner');
  };

  const regel = (h) => {
    const delen = [t(statusSleutel(h))];
    if (h.daarnaGewijzigd) delen[0] += ` — ${v('changedAfterwards')}`;
    const wie = naam(h);
    if (wie) delen.push(wie);
    const tijd = formatTijd(h.tijdUnix, language());
    return `${delen.join(' — ')}${tijd ? `, ${tijd}` : ''}`;
  };

  const kleur = () => (toestand() === 'fout' ? 'waarschuwing' : ernstigste(items()));

  const details = (h) => {
    import('../../pdf/handtekeningen/verificatie.js').then(m => m.openHandtekeningDetails(JSON.parse(JSON.stringify(h))));
  };
  const versie = (h) => {
    import('../../pdf/handtekeningen/verificatie.js').then(m => m.openOndertekendeVersie(h.nummer));
  };
  const sluit = () => {
    import('../../pdf/handtekeningen/verificatie.js').then(m => m.sluitBalkVoorActiefDocument());
  };

  return (
    <Show when={toestand() !== 'verborgen'}>
      <div class={`handtekening-bar handtekening-bar-${kleur()}`} role="status">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M2 12.5c1.5-3 3-4.5 4-4.5 1.2 0 .2 3 1.4 3 .9 0 1.6-1.6 2.6-1.6.8 0 .9 1.1 1.8 1.1.5 0 1.1-.4 2.2-1.3M2 14.5h12" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
        </svg>
        <div class="handtekening-bar-regels">
          <Show when={toestand() === 'bezig'}>
            <span class="handtekening-bar-tekst">{v('checking')}</span>
          </Show>
          <Show when={toestand() === 'fout'}>
            <span class="handtekening-bar-tekst">{v('listError', { detail: foutDetail() })}</span>
          </Show>
          <Show when={toestand() === 'klaar'}>
            <For each={items()}>
              {(h) => (
                <div class="handtekening-bar-regel">
                  <span class={`handtekening-bar-stip ${ernst(h)}`} />
                  <span class="handtekening-bar-tekst" title={regel(h)}>{regel(h)}</span>
                  <Show when={kanOndertekendeVersieTonen(h)}>
                    <button class="handtekening-bar-actie handtekening-bar-versie" onClick={() => versie(h)}>
                      {v('showSignedVersion')}
                    </button>
                  </Show>
                  <Show when={h.soort !== 'leeg-veld'}>
                    <button class="handtekening-bar-actie handtekening-bar-details" onClick={() => details(h)}>
                      {v('details')}
                    </button>
                  </Show>
                </div>
              )}
            </For>
          </Show>
        </div>
        <button class="handtekening-bar-close" onClick={sluit} title={tCommon('close')}>&times;</button>
      </div>
    </Show>
  );
}
```

`open-pdf-studio/styles/handtekening.css`:

```css
/* Handtekeningbalk boven de pagina (zelfde maatvoering als de PDF/A-balk) */
.handtekening-bar {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 3px 32px 3px 12px;
  position: relative;
  background: var(--theme-surface, #f3f3f3);
  border-bottom: 1px solid var(--theme-border, #d4d4d4);
  border-left: 3px solid #9e9e9e;
  font-size: 12px;
  color: var(--theme-text, #1a1a1a);
  flex-shrink: 0;
  user-select: none;
}

.handtekening-bar-goed { border-left-color: #22c55e; }
.handtekening-bar-waarschuwing { border-left-color: #e6a700; }
.handtekening-bar-fout { border-left-color: #ef4444; }

.handtekening-bar > svg {
  flex-shrink: 0;
  margin-top: 3px;
}

.handtekening-bar-regels {
  flex: 1;
  min-width: 0;
  max-height: 120px;
  overflow-y: auto;
}

.handtekening-bar-regel {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 22px;
}

.handtekening-bar-stip {
  width: 8px;
  height: 8px;
  flex-shrink: 0;
  background: #9e9e9e;
}

.handtekening-bar-stip.goed { background: #22c55e; }
.handtekening-bar-stip.waarschuwing { background: #e6a700; }
.handtekening-bar-stip.fout { background: #ef4444; }

.handtekening-bar-tekst {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 22px;
}

.handtekening-bar .handtekening-bar-actie {
  background: var(--theme-bg, #ffffff);
  border: 1px solid var(--theme-border, #d4d4d4);
  font-size: 11px;
  color: var(--theme-text, #1a1a1a);
  padding: 2px 10px;
  line-height: 1.4;
  flex-shrink: 0;
}

.handtekening-bar .handtekening-bar-actie:hover {
  background: var(--theme-hover, #e5e5e5);
}

.handtekening-bar .handtekening-bar-close {
  position: absolute;
  right: 8px;
  top: 4px;
  background: none;
  border: none;
  font-size: 16px;
  color: var(--theme-text-secondary, #666666);
  padding: 0 4px;
  line-height: 1;
}

.handtekening-bar .handtekening-bar-close:hover {
  color: #e81123;
}
```

In `open-pdf-studio/styles.css`, na `@import './styles/form-layer.css';`:

```css
@import './styles/handtekening.css';
```

In `open-pdf-studio/js/solid/App.jsx`:
1. Na `import PdfABar from './components/PdfABar.jsx';`:

```jsx
import HandtekeningBar from './components/HandtekeningBar.jsx';
```

2. Vervang in `DesktopApp`:

```jsx
          <PdfABar />
```

door:

```jsx
          <PdfABar />

          <HandtekeningBar />
```

(Geen `cursor`-regels in de CSS: de knoppen houden de standaardcursor, zoals de repo-regels vragen.)

- [ ] **Step 5: Tests, build**

```bash
cd open-pdf-studio && npm run test:unit 2>&1 | grep -E "^(#|ℹ) (pass|fail)"
npx vite build > /dev/null 2>&1; echo "vite exit $?"
grep -c "handtekening-bar" dist/assets/*.css | grep -v ":0" | head -1
```
Expected: `fail 0`; `vite exit 0`; één CSS-bestand met een telling groter dan 0.

- [ ] **Step 6: Commit**

```bash
cd .. && git add open-pdf-studio/js/pdf/handtekeningen/weergave.js open-pdf-studio/js/pdf/handtekeningen/weergave.test.mjs open-pdf-studio/js/pdf/handtekeningen/verificatie.js open-pdf-studio/js/solid/stores/handtekeningBarStore.js open-pdf-studio/js/solid/components/HandtekeningBar.jsx open-pdf-studio/styles/handtekening.css open-pdf-studio/styles.css open-pdf-studio/js/solid/App.jsx open-pdf-studio/js/pdf/loader.js open-pdf-studio/js/ui/chrome/tabs.js open-pdf-studio/package.json
git commit -m "feat(handtekening): handtekeningen verifiëren na openen en status tonen in een balk boven de pagina"
```

---

### Task 15: Detailvenster en "Toon ondertekende versie"

**Files:**
- Create: `open-pdf-studio/js/solid/components/dialogs/HandtekeningDetailDialog.jsx`
- Modify: `open-pdf-studio/js/pdf/handtekeningen/verificatie.js` (twee functies erbij)
- Modify: `open-pdf-studio/js/solid/components/DialogHost.jsx`
- Modify: `open-pdf-studio/styles/handtekening.css`

**Interfaces:**
- Consumes:
  - `HandtekeningInfo` zoals beschreven in Task 14 (JSON uit `pdf_signature_list`).
  - Tauri-commando `pdf_signed_revision({ pad, nummer })` → pad (string) van een tijdelijk PDF-bestand; fout `{ code, detail? }` (Task 11).
  - `weergave.js`: `statusSleutel`, `redenSleutel`, `tijdstempelStatusSleutel`, `formatTijd` (Task 14).
  - `verificatie.js`: `foutTekst` (Task 14).
  - `Dialog.jsx` (verplaatsbaar, Windows-stijl, sluit niet bij klik buiten), `openDialog`/`closeDialog` uit `js/solid/stores/dialogStore.js`, klassen `doc-props-row`, `doc-props-label`, `doc-props-value`, `doc-props-section` uit `styles/dialogs.css`.
  - `createTab(pad)` uit `js/ui/chrome/tabs.js` → `{ doc, index }`; `loadPDF(pad, index)` uit `js/pdf/loader.js`; `updateWindowTitle()` uit `tabs.js`; `showMessage(tekst)` uit `js/bridge.js`.
- Produces (in `verificatie.js`):
  - `openHandtekeningDetails(info)` — opent dialoog `'handtekening-detail'` met `{ info }`.
  - `async openOndertekendeVersie(nummer)` — opent de ondertekende versie van handtekening `nummer` van het actieve document in een nieuw tabblad. Het tabblad is `isUntitled` (niet in recente bestanden of sessie, tijdelijk bestand weg bij sluiten, Opslaan vraagt een doelpad) en heet `"<naam> (ondertekende versie <n>)"`.

Het detailvenster toont (spec §3.2, §7.2): status (met "daarna gewijzigd"), toelichting, ondertekenaar, uitgever, veld, tijdstip met bron, tijdstempel, reden, plaats, dekking, certificaatketen, en altijd "Intrekking niet gecontroleerd."

*Na Task 11 (spec §7.1, extra signalen):* is `woordenboekOndertekend` `false`, dan krijgen reden, plaats, contact, opgegeven naam en een tijdstip met bron `opgegeven` de markering "niet ondertekend"; bij `zwakAlgoritme` (handtekening of `tijdstempel`) een waarschuwing. Teksten: zie de aanvulling bij Task 13.

- [ ] **Step 1: Functies in `verificatie.js`**

Voeg onderaan `open-pdf-studio/js/pdf/handtekeningen/verificatie.js` toe:

```js
/** Detailvenster voor één handtekening (spec §3.2). */
export function openHandtekeningDetails(info) {
  import('../../solid/stores/dialogStore.js').then(m => m.openDialog('handtekening-detail', { info }));
}

/**
 * Opent de bytes tot het einde van het bytebereik van handtekening `nummer` als
 * nieuw, tijdelijk tabblad ("Toon ondertekende versie", spec §7.2).
 */
export async function openOndertekendeVersie(nummer) {
  const doc = state.documents[state.activeDocumentIndex];
  if (!doc || !isTauri()) return;
  const bron = doc.saveTargetPath || doc.filePath;
  try {
    const pad = await invoke('pdf_signed_revision', { pad: bron, nummer });
    if (!pad) return;
    const { createTab, updateWindowTitle } = await import('../../ui/chrome/tabs.js');
    const { loadPDF } = await import('../loader.js');
    const { index } = createTab(pad);
    const nieuw = state.documents[index];
    // Vóór loadPDF: dan slaat het laden recente bestanden over.
    if (nieuw) nieuw.isUntitled = true;
    await loadPDF(pad, index);
    if (nieuw) {
      nieuw.fileName = i18next.t('dialogs:signatureVerification.signedVersionTab', {
        name: doc.fileName,
        number: nummer + 1,
      });
    }
    updateWindowTitle();
  } catch (e) {
    console.warn('[handtekening] ondertekende versie openen mislukt:', e);
    const { showMessage } = await import('../../bridge.js');
    showMessage(i18next.t('dialogs:signatureVerification.listError', { detail: foutTekst(e) }));
  }
}
```

- [ ] **Step 2: Dialoog**

`open-pdf-studio/js/solid/components/dialogs/HandtekeningDetailDialog.jsx`:

```jsx
import { For, Show } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog } from '../../stores/dialogStore.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import {
  statusSleutel, redenSleutel, tijdstempelStatusSleutel, formatTijd,
} from '../../../pdf/handtekeningen/weergave.js';

function Rij(props) {
  return (
    <Show when={props.value !== null && props.value !== undefined && props.value !== ''}>
      <div class="doc-props-row">
        <span class="doc-props-label">{props.label}</span>
        <span class="doc-props-value">{props.value}</span>
      </div>
    </Show>
  );
}

// Details van één handtekening: status, ondertekenaar, tijd, dekking en keten.
export default function HandtekeningDetailDialog(props) {
  const { t, language } = useTranslation('dialogs');
  const { t: tCommon } = useTranslation('common');
  const v = (sleutel, opties) => t(`signatureVerification.${sleutel}`, opties);
  const h = props.data?.info || {};
  const close = () => closeDialog('handtekening-detail');
  const tijd = (unix) => formatTijd(unix, language());

  const status = () => {
    const basis = t(statusSleutel(h));
    return h.daarnaGewijzigd ? `${basis} — ${v('changedAfterwards')}` : basis;
  };
  const toelichting = () => {
    const sleutel = redenSleutel(h);
    const tekst = sleutel ? t(sleutel) : '';
    return h.detail && h.status?.code === 'niet-te-controleren' ? `${tekst} (${h.detail})` : tekst;
  };
  const ondertekenaar = () => {
    if (h.soort === 'documenttijdstempel') {
      return h.ondertekenaar ? `${v('documentTimestamp')} — ${h.ondertekenaar}` : v('documentTimestamp');
    }
    return h.ondertekenaar || h.opgegevenNaam || v('unknownSigner');
  };
  const tijdstip = () => {
    const tekst = tijd(h.tijdUnix);
    if (!tekst) return v('detail.none');
    if (h.tijdBron === 'tijdstempel') return v('detail.timeFromTimestamp', { time: tekst });
    return v('detail.timeClaimed', { time: tekst });
  };
  const tijdstempel = () => {
    if (!h.tijdstempel) return h.soort === 'documenttijdstempel' ? null : v('detail.none');
    const delen = [t(tijdstempelStatusSleutel(h.tijdstempel))];
    if (h.tijdstempel.tsa) delen.push(h.tijdstempel.tsa);
    const wanneer = tijd(h.tijdstempel.tijdUnix);
    if (wanneer) delen.push(wanneer);
    return delen.join(' — ');
  };
  const dekking = () => {
    if (h.soort === 'leeg-veld' || h.bereikEinde === null || h.bereikEinde === undefined) return null;
    if (h.dektHeleDocument) return v('detail.coversWhole');
    return v('detail.coversPart', { end: h.bereikEinde, size: h.bestandsgrootte });
  };

  return (
    <Dialog
      title={v('detail.title')}
      dialogClass="doc-props-dialog handtekening-detail-dialog"
      bodyClass="doc-props-content"
      footerClass="doc-props-footer"
      onClose={close}
      footer={<button onClick={close}>{tCommon('ok')}</button>}
    >
      <div class="doc-props-section">
        <Rij label={v('detail.status')} value={status()} />
        <Rij label={v('detail.explanation')} value={toelichting()} />
      </div>
      <div class="doc-props-section">
        <Rij label={v('detail.signer')} value={ondertekenaar()} />
        <Rij label={v('detail.issuer')} value={h.uitgever} />
        <Rij label={v('detail.field')} value={h.veldnaam} />
        <Rij label={v('detail.time')} value={tijdstip()} />
        <Rij label={v('detail.timestamp')} value={tijdstempel()} />
        <Rij label={v('detail.reason')} value={h.reden} />
        <Rij label={v('detail.location')} value={h.plaats} />
        <Rij label={v('detail.coverage')} value={dekking()} />
      </div>
      <Show when={(h.keten || []).length > 0}>
        <div class="doc-props-section">
          <h3>{v('detail.chain')}</h3>
          <For each={h.keten}>
            {(c) => (
              <Rij
                label={c.naam}
                value={v('detail.validFromTo', { from: tijd(c.geldigVanUnix), to: tijd(c.geldigTotUnix) })}
              />
            )}
          </For>
        </div>
      </Show>
      <p class="handtekening-detail-intrekking">{v('detail.revocationNotChecked')}</p>
    </Dialog>
  );
}
```

- [ ] **Step 3: Registreren en opmaak**

In `open-pdf-studio/js/solid/components/DialogHost.jsx`:
1. Na `import ConfirmDialog from './dialogs/ConfirmDialog.jsx';`:

```jsx
import HandtekeningDetailDialog from './dialogs/HandtekeningDetailDialog.jsx';
```

2. Vervang in `DIALOG_MAP`:

```jsx
  'confirm': ConfirmDialog,
```

door:

```jsx
  'confirm': ConfirmDialog,
  'handtekening-detail': HandtekeningDetailDialog,
```

Voeg onderaan `open-pdf-studio/styles/handtekening.css` toe:

```css
/* Detailvenster: breder dan documenteigenschappen, voor namen en ketens */
.doc-props-dialog.handtekening-detail-dialog {
  width: 560px;
}

.handtekening-detail-dialog .doc-props-label {
  width: 140px;
}

.handtekening-detail-intrekking {
  margin: 4px 0 0 0;
  font-size: 11px;
  color: var(--theme-text-secondary, #666666);
}
```

- [ ] **Step 4: Tests, build, commit**

```bash
cd open-pdf-studio && npm run test:unit 2>&1 | grep -E "^(#|ℹ) (pass|fail)"
npx vite build > /dev/null 2>&1; echo "vite exit $?"
cd .. && git add open-pdf-studio/js/solid/components/dialogs/HandtekeningDetailDialog.jsx open-pdf-studio/js/pdf/handtekeningen/verificatie.js open-pdf-studio/js/solid/components/DialogHost.jsx open-pdf-studio/styles/handtekening.css
git commit -m "feat(handtekening): detailvenster per handtekening en de ondertekende versie in een nieuw tabblad"
```
Expected: `fail 0`; `vite exit 0`. De werking in de app wordt in Task 17 geverifieerd.

---

### Task 16: Waarschuwing bij gewoon opslaan van een ondertekend document

**Files:**
- Modify: `open-pdf-studio/js/pdf/handtekeningen/verificatie.js` (één functie erbij)
- Modify: `open-pdf-studio/js/pdf/saver.js` (`savePDF`)
- Modify: `open-pdf-studio/js/mcp-bridge.js` (`handleSavePdf`)

**Interfaces:**
- Consumes: `heeftIntacteHandtekening(lijst)` uit `weergave.js` (Task 14); `doc.handtekeningen`, `verifieerHandtekeningen(doc, pad)` uit `verificatie.js` (Task 14); i18n `dialogs:signatureVerification.save.{title,message,confirm}` en `common:cancel` (Task 13); `window.__TAURI__.dialog.ask(bericht, { title, kind, okLabel, cancelLabel })` (Tauri dialog-plugin, al in gebruik in `AppMenu.jsx`).
- Produces:
  - `async bevestigOpslaanMetHandtekeningen(doc)` → `true` als opslaan door mag. Vraagt alleen als het document minstens één *intacte* handtekening heeft (spec §3.2: opslaan maakt de handtekeningen ongeldig).
  - `savePDF(saveAsPath = null, opties = {})` — nieuwe optie `opties.zonderHandtekeningVraag` (bool). Na een geslaagde opslag wordt het opgeslagen bestand opnieuw geverifieerd als het document handtekeningen had; de balk toont dan de nieuwe stand en een volgende opslag vraagt niet opnieuw zolang er geen intacte handtekening meer is.

Alle schrijfroutes lopen via `savePDF`: Ctrl+S, Ctrl+Shift+S (`savePDFAs` → `savePDF(pad)`), app-menu, titelbalk, opslaan bij sluiten (`closeTab` → `savePDF()`; annuleren houdt het tabblad open), e-mail en de MCP-brug. De MCP-brug kan geen dialoog beantwoorden en slaat de vraag over (zoals `closeTab` met `dialogAction`). Dit is de enige wijziging aan de saver (spec §3.2).

*Na de eindreview:* bewuste afwijkingen staan in spec §3.2: "Opslaan als" stelt voor een naamloos document de tabbladnaam in een normale map voor; "Opslaan als" naar een ander pad heeft een eigen vraag (origineel blijft ondertekend); e-mail slaat een ongewijzigd document niet op en voegt `saveTargetPath` of `filePath` bij; `closeTab` wisselt bij opslaan vanaf een achtergrondtabblad eerst naar dat tabblad; MCP `app_save_pdf` en `app_close_tab` (met `save`) melden `signaturesInvalidated`.

- [ ] **Step 1: Vraag in `verificatie.js`**

Voeg in `open-pdf-studio/js/pdf/handtekeningen/verificatie.js` de import uit `./weergave.js` aan, zodat de regel luidt:

```js
import { heeftHandtekeningvelden, heeftIntacteHandtekening, lijstFoutRedenSleutel } from './weergave.js';
```

en voeg onderaan toe:

```js
/**
 * Vraagt bevestiging voordat een document met intacte handtekeningen gewoon
 * wordt opgeslagen: de saver herschrijft het bestand, waardoor de
 * handtekeningen ongeldig worden (spec §3.2).
 */
export async function bevestigOpslaanMetHandtekeningen(doc) {
  if (!doc || !heeftIntacteHandtekening(doc.handtekeningen)) return true;
  const titel = i18next.t('dialogs:signatureVerification.save.title');
  const bericht = i18next.t('dialogs:signatureVerification.save.message');
  if (window.__TAURI__?.dialog?.ask) {
    return await window.__TAURI__.dialog.ask(bericht, {
      title: titel,
      kind: 'warning',
      okLabel: i18next.t('dialogs:signatureVerification.save.confirm'),
      cancelLabel: i18next.t('common:cancel'),
    });
  }
  return window.confirm(bericht);
}
```

- [ ] **Step 2: `savePDF`**

In `open-pdf-studio/js/pdf/saver.js`, vervang:

```js
export async function savePDF(saveAsPath = null) {
```

door:

```js
export async function savePDF(saveAsPath = null, opties = {}) {
```

en vervang:

```js
  if (_saveBezig) {
    await _saveBezig.catch(() => {});
    return savePDF(saveAsPath);
  }
  _saveBezig = _savePDFNu(saveAsPath).finally(() => { _saveBezig = null; });
  return _saveBezig;
}
```

door:

```js
  // Ondertekend document: gewoon opslaan maakt de handtekeningen ongeldig.
  if (!opties.zonderHandtekeningVraag) {
    const { bevestigOpslaanMetHandtekeningen } = await import('./handtekeningen/verificatie.js');
    if (!(await bevestigOpslaanMetHandtekeningen(activeDoc))) return false;
  }

  if (_saveBezig) {
    await _saveBezig.catch(() => {});
    return savePDF(saveAsPath, { ...opties, zonderHandtekeningVraag: true });
  }
  const doel = saveAsPath || activeDoc?.saveTargetPath || currentPath;
  _saveBezig = _savePDFNu(saveAsPath).finally(() => { _saveBezig = null; });
  const gelukt = await _saveBezig;
  if (gelukt && activeDoc?.handtekeningen?.length) {
    import('./handtekeningen/verificatie.js')
      .then(m => m.verifieerHandtekeningen(activeDoc, doel))
      .catch(e => console.warn('[handtekening] opnieuw verifiëren na opslaan mislukt:', e));
  }
  return gelukt;
}
```

- [ ] **Step 3: MCP-brug**

In `open-pdf-studio/js/mcp-bridge.js`, in `handleSavePdf`, vervang:

```js
    success = await saverMod.savePDF(path);
```

door:

```js
    // Headless: geen dialoog mogelijk, dus geen vraag over handtekeningen.
    success = await saverMod.savePDF(path, { zonderHandtekeningVraag: true });
```

- [ ] **Step 4: Controleren dat er geen andere aanroep met een tweede argument is**

```bash
cd open-pdf-studio && grep -rn "savePDF(" js --include=*.js --include=*.jsx | grep -v "function savePDF" | grep -v "savePDF()" | grep -v "savePDF(savePath)" | grep -v "savePDF(path, { zonderHandtekeningVraag: true })" | grep -v "savePDF(saveAsPath, {"
```
Expected: geen uitvoer (alle bestaande aanroepen gebruiken nul of één argument).

- [ ] **Step 5: Tests, build, commit**

```bash
npm run test:unit 2>&1 | grep -E "^(#|ℹ) (pass|fail)"
npx vite build > /dev/null 2>&1; echo "vite exit $?"
cd .. && git add open-pdf-studio/js/pdf/handtekeningen/verificatie.js open-pdf-studio/js/pdf/saver.js open-pdf-studio/js/mcp-bridge.js
git commit -m "feat(handtekening): bevestiging vragen voordat gewoon opslaan de handtekeningen ongeldig maakt"
```
Expected: `fail 0`; `vite exit 0`.

De werking in de app en de opslag-rondgang worden in Task 17 geverifieerd.

---

### Task 17: Verificatie in een releasebuild

**Files:** geen wijzigingen; tijdelijke scripts en kopieën buiten de repo.

**Interfaces:**
- Consumes: alles uit Tasks 1–16; corpus en manifest (Task 12); fixtures (Task 3); MCP-tools `app_list_tabs`, `app_open_pdf`, `app_close_tab`; `scripts/verify-opslag-rondgang.mjs` en `.py`.
- Produces: een vastgestelde, werkende releasebuild; geen repo-wijzigingen.

- [ ] **Step 1: Volledige tests met corpus en orakel**

```bash
python scripts/haal-handtekening-testdata.py --controleer
PYTHONIOENCODING=utf-8 python scripts/pades-orakel.py --controleer
cd open-pdf-studio/src-tauri && CARGO_TARGET_DIR="$BUILDMAP" cargo test --lib handtekening -- --nocapture 2>&1 | grep -E "corpus ontbreekt|^test result"
cd .. && npm run test:unit 2>&1 | grep -E "^(#|ℹ) (pass|fail)"
```
Expected: `49 aanwezig, 0 opgehaald, 0 fout`, `18 bestanden gelijk aan het manifest`, `test result: ok.` met `0 failed` en géén `corpus ontbreekt`; `fail 0`.

- [ ] **Step 2: Releasebuild en geïsoleerde app-instantie**

```bash
cd open-pdf-studio && CARGO_TARGET_DIR="$BUILDMAP" npm run tauri:build 2>&1 | grep -E "nsis.*setup.exe$|error\[|^error"
R="$RIGMAP"; rm -rf "$R"; mkdir -p "$R/webview" "$R/localappdata/OpenPDFStudio" "$R/pdf"
printf '{"openFiles":[],"activeIndex":0}' > "$R/localappdata/OpenPDFStudio/session.json"
OPDS_DETACHED=1 OPS_ENABLE_MCP=1 LOCALAPPDATA="$(cygpath -w "$R/localappdata")" \
  WEBVIEW2_USER_DATA_FOLDER="$(cygpath -w "$R/webview")" \
  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9345" \
  "$BUILDMAP"/release/open-pdf-studio.exe --mcp-server --mcp-port 9223 > "$R/app.log" 2>&1 &
for i in $(seq 1 60); do curl -s -m 8 -X POST http://127.0.0.1:9223/mcp -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"app_list_tabs","arguments":{}}}' | grep -q '"result"' && break; sleep 1; done
cp ../testdata/handtekeningen/pades/*.pdf "$R/pdf/"
echo "instantie klaar"
```
Expected: een regel met `setup.exe` (build-exit 1 door alleen de ontbrekende updater-signing is normaal), `instantie klaar`. De instantie heeft een eigen profiel en `LOCALAPPDATA`; de corpusbestanden worden alleen als kopie in `$R/pdf` gebruikt.

- [ ] **Step 3: Commando's tegen het corpus**

Maak `"$TEMP/handtekening-proef.mjs"`:

```js
// pdf_signature_list en pdf_signed_revision in de releasebuild, tegen de kopieën van het corpus.
import { createRequire } from 'module';
import { readFileSync, statSync } from 'fs';
const require = createRequire(import.meta.url);
const playwright = require(process.argv[2]);
const [manifestPad, map] = [process.argv[3], process.argv[4]];
const manifest = JSON.parse(readFileSync(manifestPad, 'utf8'));
const browser = await playwright.chromium.connectOverCDP('http://127.0.0.1:9345');
const page = browser.contexts()[0].pages()[0];
const roep = (cmd, args) => page.evaluate(async ([cmd, args]) => {
  try { return { ok: await window.__TAURI_INTERNALS__.invoke(cmd, args) }; } catch (e) { return { fout: e }; }
}, [cmd, args]);
const regel = (h) => {
  const r = { soort: h.soort };
  if (h.soort === 'leeg-veld') return r;
  r.dekt = h.dektHeleDocument;
  if (h.integriteit) {
    r.integriteit = h.integriteit.uitkomst;
    if (h.integriteit.reden) r.reden = h.integriteit.reden;
  }
  if (h.tijdstempel) r.tijdstempel = h.tijdstempel.integriteit.uitkomst;
  return r;
};
const sorteer = (o) => JSON.stringify(Object.keys(o).sort().reduce((a, k) => ({ ...a, [k]: o[k] }), {}));
let fouten = 0;
for (const b of manifest.bronnen.pades.bestanden) {
  const u = await roep('pdf_signature_list', { pad: `${map}/${b.bestand}` });
  const gemeten = (u.ok || []).map(regel).map(sorteer).join(';');
  const verwacht = b.handtekeningen.map(sorteer).join(';');
  const goed = u.ok && gemeten === verwacht;
  if (!goed) fouten++;
  console.log(`${goed ? 'ok  ' : 'FOUT'} ${b.bestand} ${(u.ok || []).map((h) => h.status.code).join(', ')}${u.fout ? JSON.stringify(u.fout) : ''}`);
}
const versie = await roep('pdf_signed_revision', { pad: `${map}/hello_signed_INCSAVE_signed.pdf`, nummer: 0 });
console.log('ondertekende versie', versie.ok ? statSync(versie.ok).size : JSON.stringify(versie.fout));
console.log('ontbrekend nummer', JSON.stringify(await roep('pdf_signed_revision', { pad: `${map}/pades-bes.pdf`, nummer: 5 })));
console.log(`${fouten} fout(en)`);
process.exit(0);
```

Run (vanuit de worktree-root):

```bash
R="$RIGMAP"
node "$TEMP/handtekening-proef.mjs" "$(pwd)/open-pdf-studio/node_modules/playwright" \
  "$(pwd)/scripts/handtekening-testdata.json" "$(cygpath -m "$R/pdf")"
```
Expected: 18 regels `ok`, waarvan geen enkele status `geldig` (test-CA's staan niet in het rootarchief van Windows); `ondertekende versie 216121` (einde van het bytebereik van de eerste handtekening); `ontbrekend nummer {"fout":{"code":"geen-handtekening"}}`; `0 fout(en)`.

- [ ] **Step 4: Balk, detailvenster en ondertekende versie in de interface**

Maak `"$TEMP/handtekening-ui.mjs"`:

```js
// Opent een document met twee handtekeningen en doorloopt balk, details en ondertekende versie.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const playwright = require(process.argv[2]);
const pad = process.argv[3];
const mcp = async (name, args = {}) => {
  const r = await fetch('http://127.0.0.1:9223/mcp', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: 'tools/call', params: { name, arguments: args } }),
  });
  const j = await r.json();
  const t = j?.result?.content?.[0]?.text;
  try { return JSON.parse(t); } catch { return t ?? j; }
};
const browser = await playwright.chromium.connectOverCDP('http://127.0.0.1:9345');
const page = browser.contexts()[0].pages()[0];
const wacht = async (fn, arg, ms = 30000) => page.waitForFunction(fn, arg, { timeout: ms });

console.log('open', JSON.stringify(await mcp('app_open_pdf', { path: pad })).slice(0, 80));
await wacht(() => document.querySelectorAll('.handtekening-bar-regel').length === 2);
console.log('regels', await page.$$eval('.handtekening-bar-regel', (r) => r.length));
console.log('versieknoppen', await page.$$eval('.handtekening-bar-versie', (r) => r.length));
console.log('stippen', await page.$$eval('.handtekening-bar-stip', (r) => r.map((s) => s.className).join(' | ')));

await page.$eval('.handtekening-bar-details', (b) => b.click());
await wacht(() => !!document.querySelector('.handtekening-detail-dialog'));
console.log('detailvenster rijen', await page.$$eval('.handtekening-detail-dialog .doc-props-row', (r) => r.length));
console.log('intrekkingsregel', await page.$eval('.handtekening-detail-intrekking', (p) => p.textContent.length > 0));
await page.$eval('.handtekening-detail-dialog .modal-footer button', (b) => b.click());
await wacht(() => !document.querySelector('.handtekening-detail-dialog'));

const voor = (await mcp('app_list_tabs')).tabs.length;
await page.$eval('.handtekening-bar-versie', (b) => b.click());
await wacht((n) => document.querySelectorAll('.document-tab-title').length === n + 1, voor);
await wacht(() => document.querySelectorAll('.handtekening-bar-regel').length === 1);
const tabs = (await mcp('app_list_tabs')).tabs;
const nieuw = tabs[tabs.length - 1];
console.log('nieuw tabblad', nieuw.isUntitled, nieuw.fileName);
console.log('versieknoppen in ondertekende versie', await page.$$eval('.handtekening-bar-versie', (r) => r.length));
await mcp('app_close_tab', { index: tabs.length - 1 });

await page.$eval('.handtekening-bar-close', (b) => b.click());
await wacht(() => !document.querySelector('.handtekening-bar'));
console.log('balk gesloten');
process.exit(0);
```

```bash
R="$RIGMAP"
node "$TEMP/handtekening-ui.mjs" "$(pwd)/open-pdf-studio/node_modules/playwright" "$(cygpath -w "$R/pdf/hello_signed_INCSAVE_signed.pdf")"
```
Expected:
- `regels 2`, `versieknoppen 1` (alleen de eerste handtekening reikt niet tot het einde), `stippen waarschuwing | waarschuwing`-achtig (klassen `handtekening-bar-stip waarschuwing`);
- `detailvenster rijen` minstens 6, `intrekkingsregel true`;
- `nieuw tabblad true <naam> (… 1)` en `versieknoppen in ondertekende versie 0`;
- `balk gesloten`.

Het venster is tijdens de proef verplaatsbaar (sleep aan de titel) en sluit niet bij een klik ernaast; controleer dat één keer met de hand in het rig-venster.

- [ ] **Step 5: Waarschuwing bij opslaan**

Maak `"$TEMP/handtekening-opslaan.mjs"`:

```js
// Opslaan van een ondertekend document: eerst geweigerd, dan bevestigd.
import { createRequire } from 'module';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
const require = createRequire(import.meta.url);
const playwright = require(process.argv[2]);
const pad = process.argv[3];
const hash = () => createHash('sha256').update(readFileSync(pad)).digest('hex').slice(0, 16);
const mcp = async (name, args = {}) => {
  const r = await fetch('http://127.0.0.1:9223/mcp', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: 'tools/call', params: { name, arguments: args } }),
  });
  return r.json();
};
const browser = await playwright.chromium.connectOverCDP('http://127.0.0.1:9345');
const page = browser.contexts()[0].pages()[0];
await mcp('app_open_pdf', { path: pad });
await page.waitForFunction(() => document.querySelectorAll('.handtekening-bar-regel').length === 1, null, { timeout: 30000 });
const voor = hash();
const opslaan = async (antwoord) => {
  await page.evaluate((antwoord) => {
    window.__vragen = 0;
    window.__TAURI__.dialog.ask = async () => { window.__vragen++; return antwoord; };
    document.querySelector('button.quick-access-btn[title$="(Ctrl+S)"]').click();
  }, antwoord);
  await new Promise((r) => setTimeout(r, 4000));
  return page.evaluate(() => window.__vragen);
};
console.log('geweigerd: vragen', await opslaan(false), 'bestand gelijk', hash() === voor);
console.log('bevestigd: vragen', await opslaan(true), 'bestand gewijzigd', hash() !== voor);
await page.waitForFunction(() => !document.querySelector('.handtekening-bar-stip.goed') && document.querySelectorAll('.handtekening-bar-regel').length >= 1, null, { timeout: 30000 });
console.log('status na opslaan', await page.$$eval('.handtekening-bar-tekst', (t) => t.map((x) => x.textContent).join(' | ')));
console.log('tweede keer: vragen', await opslaan(true));
process.exit(0);
```

```bash
R="$RIGMAP"
node "$TEMP/handtekening-opslaan.mjs" "$(pwd)/open-pdf-studio/node_modules/playwright" "$(cygpath -w "$R/pdf/pades-bes.pdf")"
```
Expected: `geweigerd: vragen 1 bestand gelijk true`; `bevestigd: vragen 1 bestand gewijzigd true`; een status na opslaan die niet meer intact is (gewijzigd na ondertekenen of niet te controleren); `tweede keer: vragen 0` (geen intacte handtekening meer).

- [ ] **Step 6: Opslag-rondgang**

De saver is ongewijzigd, maar `savePDF` heeft een extra stap; de verplichte opslag-rondgang loopt met de standaardmappen van de scripts (verificatiebestanden worden gekopieerd, nooit overschreven):

```bash
node scripts/verify-opslag-rondgang.mjs 2>&1 | tail -n 2
python scripts/verify-opslag-rondgang.py 2>&1 | tail -n 3
```
Expected: `klaar — N/N kopieën opgeslagen` en een eindoordeel zonder fouten, gelijk aan de laatste referentierun. Documenten zonder handtekeningen krijgen geen vraag, dus de rondgang loopt zonder interactie.

- [ ] **Step 7: Instantie stoppen, opruimen**

Stop alleen het proces dat poort 9223 bezit (nooit op procesnaam):

```bash
P=$(powershell -NoProfile -Command "(Get-NetTCPConnection -State Listen -LocalPort 9223 -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess" | tr -d '\r ')
[ -n "$P" ] && powershell -NoProfile -Command "Stop-Process -Id $P -Force"
rm -f "$TEMP/handtekening-proef.mjs" "$TEMP/handtekening-ui.mjs" "$TEMP/handtekening-opslaan.mjs"
rm -rf "$RIGMAP" "$TEMP/opds-ondertekende-versies"
git status --short
```
Expected: `git status` leeg (op eventuele uitvoer van de opslag-rondgang in genegeerde mappen na).

---

## Na dit plan

- Deel 3 (ondertekenen) gebruikt `verifieer_document` als eigen verifier in de rondgang (spec §9.3) en voegt schrijfdelen toe aan `bytebereik.rs` en de aanvraag aan `tijdstempel.rs`.
- Het bestaande paneel "Digitale handtekeningen" (`js/ui/panels/signatures.js`) toont nog `verified: null`; het kan dezelfde `doc.handtekeningen` gaan gebruiken.
- Eis 1 (geldig in andere PDF-lezers) blijft handmatig (spec §9.5).
