# Digitale handtekeningen met certificaten — ontwerp

Issue: #374. Status: ontwerp, ter review.

## 1. Doel

Een PDF cryptografisch ondertekenen met een certificaat en bestaande
handtekeningen verifiëren. Nu plaatst de knop Handtekening alleen een
afbeelding; er is geen cryptografische handtekening.

Acceptatie-eisen uit de issue:

1. Een ondertekend bestand valideert als geldig in minstens twee andere
   PDF-lezers.
2. Het bestand na ondertekenen wijzigen laat de status omslaan.
3. Eigen annotaties die vóór het ondertekenen zijn toegevoegd, blijven intact.

## 2. Beslissingen

| Onderwerp | Keuze | Reden |
|---|---|---|
| Omvang | Ondertekenen en verifiëren als één brok | Delen de CMS-laag; verifiëren is de enige manier om ondertekenen te toetsen |
| Crypto | Pure Rust (RustCrypto: `cms`, `x509-cert`, `rsa`, `sha2`) | Geen systeemafhankelijkheden; raakt de bouwketen van Windows, macOS, Linux en Android niet |
| PKCS#12 | Eigen lezer op RustCrypto-onderdelen | Bestaande crates schieten tekort, zie §5 |
| Na ondertekenen | Ondertekenen is een eindpunt: "Ondertekend opslaan als…" | De saver herschrijft het bestand volledig; een incrementele saver is een project op zich |
| Vertrouwen | Rootarchief van het besturingssysteem | Zelfde uitkomst als andere programma's op dezelfde machine |
| Certificaatbron | Alleen `.p12`/`.pfx`-bestand | Eén weg, identiek op alle platforms |
| Tijdstempel | RFC 3161, standaard aan | Zonder tijdstempel is een handtekening na het verlopen van het certificaat niet meer te verifiëren |
| Later gewijzigd | Feit melden, niet oordelen | Zie §7.2 |

## 3. Gebruikersflow

### 3.1 Ondertekenen

1. Knop **Digitaal ondertekenen** in het tabblad Opmerkingen, direct naast de
   bestaande (beeld)handtekening. De tooltip legt het verschil uit.
2. Heeft het document niet-opgeslagen wijzigingen, dan eerst de vraag om op te
   slaan. Ondertekenen werkt op het bestand zoals het op schijf staat. Daarmee
   zitten alle eerder toegevoegde annotaties in het ondertekende bestand
   (eis 3), zonder de saver aan te passen.
3. Dialoog: `.p12`/`.pfx` kiezen, wachtwoord, en daarna direct zichtbaar
   waarmee je tekent: naam, uitgever, geldig van/tot, sleutelgebruik.
4. Zichtbaar of onzichtbaar. Zichtbaar: een rechthoek op de pagina trekken; de
   weergave toont naam, datum en reden. Velden: reden, plaats, contact.
5. **Ondertekend opslaan als…**: doelpad kiezen. Het bronpad is niet toegestaan.
6. Het ondertekende bestand opent in een nieuw tabblad, met zijn
   verificatiestatus zichtbaar.

### 3.2 Verifiëren

Bij het openen van een document met handtekeningen verschijnt een balk boven de
pagina met per handtekening de status, de ondertekenaar en het tijdstip. Een
detailvenster toont certificaatketen, tijdstempel en de reden van de status.

Opslaan van een document met handtekeningen via de gewone opslag vraagt eerst
bevestiging: opslaan maakt de handtekeningen ongeldig. Dit is de enige
aanraking van de bestaande saver.

Bewuste afwijkingen en aanvullingen rond opslaan, die bij de uitwerking nodig
bleken:

- **Standaardmap van "Opslaan als".** Een naamloos document (ook het tabblad
  van een ondertekende versie) staat in een tijdelijk bestand. "Opslaan als"
  stelt dan de tabbladnaam met `.pdf` voor, in de map van het origineel (bij
  een ondertekende versie) of anders in de documentenmap, niet in de tijdelijke
  map.
- **"Opslaan als" naar een ander pad** stelt een eigen vraag: het origineel
  blijft ondertekend, de nieuwe kopie niet.
- **E-mail.** Verzenden per e-mail slaat een ongewijzigd document niet eerst
  op (dat zou het bestand herschrijven en de handtekeningen ongeldig maken) en
  voegt het echte bestand bij: `saveTargetPath` als het document uit een
  werkkopie rendert, anders `filePath`.
- **Sluiten vanaf een achtergrondtabblad.** Kiest de gebruiker bij het sluiten
  van een gewijzigd achtergrondtabblad voor opslaan, dan wisselt `closeTab`
  eerst naar dat tabblad (opslaan en de vraag over handtekeningen werken op het
  actieve document) en daarna terug naar het vorige tabblad.
- **MCP.** De brug kan geen vraag beantwoorden en slaat haar over. `app_save_pdf`
  meldt dan `signaturesInvalidated: true` als het document handtekeningen had
  die door het opslaan niet meer gelden; `app_close_tab` met `save: true` doet
  hetzelfde.
- **Balk na bewerken in de app.** De status geldt voor het bestand op schijf.
  Is het document in de app gewijzigd, dan meldt de balk dat in een neutrale
  regel.

## 4. Architectuur

Alles wat met bytes en cryptografie te maken heeft, gebeurt in Rust. JS doet
alleen dialoog, balk en detailvenster.

### 4.1 Tauri-commando's

| Commando | Invoer | Uitvoer |
|---|---|---|
| `pdf_certificate_info` | pad `.p12`, wachtwoord | naam, uitgever, geldigheid, sleutelgebruik, sleuteltype |
| `pdf_sign` | bronpad, doelpad, pad `.p12`, wachtwoord, veld (pagina + rechthoek, of onzichtbaar), reden/plaats/contact, tijdstempel-URL of geen | doelpad |
| `pdf_signature_list` | pad | lijst per handtekening: soort, status (§7.1), ondertekenaar, tijdstip, tijdstempel, dekking, reden |
| `pdf_signed_revision` | pad, handtekeningnummer | tijdelijk bestand met de bytes van de ondertekende versie |

### 4.2 Rust-modules

Nieuwe map `src-tauri/src/handtekening/`:

| Module | Eén verantwoordelijkheid |
|---|---|
| `pkcs12.rs` | `.p12` openen: MAC controleren, ontsleutelen, sleutel + certificaten eruit |
| `bytebereik.rs` | plaatshouders schrijven, `/ByteRange` berekenen, het gat vinden, in-place patchen |
| `incrementeel.rs` | incrementele toevoeging schrijven (objecten, xref, trailer) |
| `cms_bouw.rs` | CMS SignedData (CAdES, detached) bouwen, tijdstempel toevoegen |
| `tijdstempel.rs` | RFC 3161-verzoek, antwoord controleren |
| `verifieer.rs` | handtekeningen lezen, integriteit/dekking/vertrouwen per soort |
| `vertrouwen.rs` | rootarchief laden (eenmalig, gecachet), keten bouwen en valideren |
| `status.rs` | pure afleiding van de getoonde status uit de losse controles |

Elke module is zonder de andere te testen; `status.rs` en `bytebereik.rs` zijn
volledig puur.

## 5. PKCS#12-lezer

### 5.1 Waarom een eigen lezer

Gemeten op 31 testbestanden van pyca/cryptography plus drie eigen exports
(§9.2):

- RustCrypto `pkcs12` 0.1.0 ontsleutelt niet (`// todo: add decryption
  support` in de broncode).
- `p12` 0.6.3 verwerkt 1 van de 31 bestanden volledig. Op een SHA-256-MAC
  breekt hij af via een `debug_assert`; in een releasebouw valt die weg en
  meldt hij "verkeerd wachtwoord" bij een geldig bestand.

### 5.2 Wat de lezer moet ondersteunen

Elk punt komt voor in echte testbestanden:

| Onderdeel | Varianten |
|---|---|
| Versleuteling | PBES1 3DES (Windows-export), PBES1 RC2-40 (oude bestanden), PBES2 PBKDF2 + AES-256-CBC met PRF HMAC-SHA1 én HMAC-SHA256, onversleuteld |
| MAC | HMAC-SHA1, HMAC-SHA256 |
| Wachtwoord | gewoon, leeg, afwezig (PKCS#12 onderscheidt leeg en afwezig) |
| Inhoud | meerdere certificaten; vriendelijke namen, ook Unicode |
| Sleutelkeuze | het certificaat dat bij de privésleutel hoort, via `localKeyId`, anders via de publieke sleutel |

Foutmeldingen, altijd met een concrete oorzaak:

- verkeerd wachtwoord (MAC klopt niet);
- bestand bevat geen privésleutel;
- niet-ondersteund versleutelingsalgoritme (met naam van het algoritme);
- sleuteltype niet ondersteund (alleen RSA, zie §10).

Geen paniek, geen `unwrap` op invoer uit het bestand.

## 6. Ondertekenen

### 6.1 Voorwaarden

Geweigerd met een duidelijke melding:

- versleuteld brondocument;
- bronpad gelijk aan doelpad;
- sleutel geen RSA;
- certificaat zonder sleutelgebruik `digitalSignature` of `nonRepudiation`.

### 6.2 Werkwijze

Het precaire deel gaat over bytes, niet over objecten.

1. Lees het bronbestand ongewijzigd in; ontleed het met `lopdf` om
   objectnummers, de pagina en een eventueel bestaand AcroForm te vinden.
2. Bouw de incrementele toevoeging:
   - `/Sig`-woordenboek met `/Contents` als gat van vaste lengte (nullen) en
     `/ByteRange` als plaatshouder met vaste breedte
     (`[0 0000000000 0000000000 0000000000]`), `/M` met het tijdstip,
     `/SubFilter /ETSI.CAdES.detached` en `/Filter` volgens ISO 32000-1 §12.8;
   - samengevoegd handtekeningveld en widget (`/FT /Sig`, `/V` naar het
     `/Sig`-woordenboek, `/Rect`, `/P`);
   - een nieuwe revisie van de pagina (of van zijn `/Annots`-array als die
     indirect is) met de widget erbij;
   - AcroForm met het veld in `/Fields` en `/SigFlags 3`: een nieuwe revisie
     van het AcroForm-object, of van de Catalog als het AcroForm daarin inline
     staat;
   - bij zichtbaar: een weergavestroom met naam, datum en reden, in Helvetica
     met WinAnsi-codering. Tekens buiten WinAnsi krijgen dezelfde
     vervangingsregel als in de saver (`toWinAnsiText`), overgezet naar Rust,
     zodat een naam met een euroteken of accent overal gelijk verschijnt.
3. Schrijf de xref van de toevoeging in dezelfde vorm als de laatste xref van
   het bronbestand (tabel of stroom), met `/Prev`, `/Size`, `/Root` en `/Info`
   overgenomen.
4. Schrijf bron + toevoeging naar het doelbestand.
5. Zoek het gat, bereken de echte `/ByteRange` en patch die in-place — exact
   even lang, aangevuld met spaties.
6. Bereken SHA-256 over het bestand met het gat eruit.
7. Bouw CMS SignedData, detached, met als ondertekende attributen
   `contentType`, `messageDigest` en `signingCertificateV2`. Geen
   `signingTime` (PAdES: het tijdstip staat in `/M`). Handtekening: RSA
   PKCS#1 v1.5 met SHA-256. De certificaatketen uit het `.p12` gaat mee.
8. Tijdstempel: RFC 3161-verzoek over de handtekeningwaarde, token als
   onondertekend attribuut `signatureTimeStampToken`.
9. Hex-codeer de CMS en schrijf hem in het gat; de rest blijft nullen.

### 6.3 Grootte van het gat

Het gat moet vastliggen vóór het hashen. Grootte = geschatte CMS (certificaten
uit het `.p12` + handtekening) + 8 KB voor het tijdstempel + marge. Past de
uiteindelijke CMS niet, dan één nieuwe poging met een dubbel zo groot gat.
Past hij dan nog niet: foutmelding, doelbestand verwijderd.

### 6.4 Tijdstempeldienst

Standaard `https://freetsa.org/tsr` (getest op 16-09-2026: antwoord "Granted"),
instelbaar in de voorkeuren. Onbereikbaar of foutief antwoord: vraag of je
zonder tijdstempel wilt doorgaan. Nooit stil zonder tijdstempel.

## 7. Verifiëren

### 7.1 Controles per handtekening

Drie onafhankelijke assen:

**Integriteit** — vier uitkomsten:

- *intact*: digest klopt én handtekeningwaarde klopt;
- *gewijzigd*: digest wijkt af — de ondertekende bytes zijn veranderd;
- *ongeldig*: digest klopt, handtekeningwaarde niet — de bytes zijn niet
  veranderd, de handtekening zelf deugt niet;
- *niet te controleren*: onleesbaar, geen certificaat, of niet-ondersteund
  algoritme.

Per soort:

- `ETSI.CAdES.detached` en `adbe.pkcs7.detached`: hash over het bytebereik
  gelijk aan `messageDigest`, én de handtekeningwaarde klopt met de publieke
  sleutel van de ondertekenaar over de ondertekende attributen. Een kloppende
  digest alleen is niet genoeg; `malformed-rsa-digestinfo.pdf` heeft een
  kloppende digest en een ongeldige handtekening. Dat is *ongeldig*, niet
  *gewijzigd*: het bestand zeggen dat het na ondertekenen gewijzigd is, zou
  onwaar zijn.
- `ETSI.RFC3161` (documenttijdstempel): hash over het bytebereik gelijk aan de
  `messageImprint` in het tijdstempel, én de handtekening van de
  tijdstempeldienst klopt. Een controle op `messageDigest` geeft hier vals alarm
  (vastgesteld op het testcorpus). Getoond als "Documenttijdstempel", niet als
  persoon.
- Andere SubFilters: niet te controleren (verouderd formaat).

**Dekking**: reikt het bytebereik tot het einde van het bestand? Alleen
PDF-witruimte (NUL, tab, LF, FF, CR, spatie; ISO 32000-1 §7.2.2) na het
bereik telt niet als toevoeging: `\r\n` na het bereik laat het hele document
gedekt, `\n%` niet.

Extra signalen, zonder invloed op integriteit of status:

- De hex-string in het gat van het bytebereik is een andere dan `/Contents`
  van het handtekeningwoordenboek (bijvoorbeeld een geleend bytebereik): een
  melding in de toelichting. De integriteit gaat over `/Contents`.
- Het gebruikte exemplaar van het handtekeningwoordenboek ligt buiten het
  eigen bytebereik: reden, naam, plaats, contact en `/M` worden als niet
  ondertekend getoond.
- Een zwakke hash (SHA-1) in de handtekening, een tijdstempel of een
  gecontroleerde certificaathandtekening in de keten: een waarschuwing.

Hetzelfde handtekeningwoordenboek bij meer velden (bijvoorbeeld twee velden
met dezelfde `/V`) telt als één handtekening, bij het eerste veld in
formuliervolgorde.

**Vertrouwen** (alleen bij een intacte handtekening): keten naar het
rootarchief, elk certificaat geldig op het relevante tijdstip, sleutelgebruik
klopt. Ontbreekt de extensie sleutelgebruik, dan is het gebruik onbeperkt
(X.509). Relevant tijdstip: de tijd uit een gecontroleerd tijdstempel; zonder
tijdstempel de huidige tijd. Het tijdstip in `/M` is door de ondertekenaar
zelf opgegeven en telt niet als bewijs.

Keten en sleutelgebruik in detail (RFC 5280, vereenvoudigd):

- Ketenbouw diepte-eerst met terugstappen: kandidaten die op het tijdstip
  geldig zijn eerst; het eerste pad naar het rootarchief dat volledig klopt,
  wint. Anders de reden van het meest gevorderde pad. Hoogstens 10
  certificaten per pad, 100 handtekeningcontroles en 1000 knopen
  (paduitbreidingen) per beoordeling. Een kandidaat met hetzelfde onderwerp
  en dezelfde publieke sleutel als een certificaat dat al in het pad staat,
  wordt overgeslagen; kandidaten met dezelfde naam en sleutel naast elkaar
  (kruiscertificaat, verlopen en geldige versie) blijven elk een mogelijkheid,
  met één gedeelde handtekeningcontrole. Is een budget op, dan telt wat
  gevonden is; een "geen keten" krijgt dan de melding "ketenzoektocht
  afgebroken op het zoekbudget" in de toelichting.
- Ondertekenaar: sleutelgebruik (indien aanwezig) digitalSignature of
  nonRepudiation. Uitgebreid sleutelgebruik (indien aanwezig) moet
  anyExtendedKeyUsage, emailProtection, documentSigning of een
  documentondertekenings-OID van een leverancier bevatten, of clientAuth
  zonder serverAuth; anders "sleutelgebruik".
- Tijdstempeldienst (RFC 3161 §2.3): uitgebreid sleutelgebruik kritiek en
  uitsluitend timeStamping.
- Tussencertificaten: basicConstraints CA en keyCertSign (als sleutelgebruik
  aanwezig is); pathLenConstraint wordt afgedwongen. Een v1-certificaat
  zonder extensies mag alleen het anker zijn; van het anker worden
  basicConstraints en sleutelgebruik niet geëist.
- Uitgebreid sleutelgebruik van tussencertificaten: de doorsnede over alle
  tussencertificaten (zonder extensie of met anyExtendedKeyUsage: geen
  beperking) moet de rol toestaan, met dezelfde regel als bij de ondertekenaar
  of met timeStamping voor een tijdstempeldienst; anders "sleutelgebruik".
- Onbekende kritieke extensies (alles buiten sleutelgebruik, basicConstraints,
  uitgebreid sleutelgebruik, subjectAltName, certificatePolicies,
  policyConstraints, inhibitAnyPolicy, AKI en SKI) → "sleutelgebruik". Dus ook
  nameConstraints (§10); beleidsregels worden niet uitgewerkt.
- Rootarchief: op Windows het archief `ROOT` van de gebruiker, rechtstreeks
  en alleen-lezen gelezen zonder filter op huidige geldigheid of TLS. Per
  wortel gelden de doelen volgens Windows, per rol getoetst bij het anker: een
  wortel die alleen tijdstempels mag, is geen anker voor een ondertekenaar en
  omgekeerd ("sleutelgebruik"). Zijn de doelen niet te lezen, dan valt de
  wortel weg. Een wortel met een uitschakeldatum (Windows-eigenschap 104) is
  alleen anker voor tijdstippen en bladen van vóór die datum, zonder datum
  helemaal niet; een datum met doelen (eigenschappen 126/127) sluit bladen
  met een latere notBefore voor die doelen uit ("sleutelgebruik").
  Certificaten uit `Disallowed` (gebruiker en computer) zijn nooit anker of
  tussencertificaat. De doelen van een wortel en het uitgebreide
  sleutelgebruik van het blad zijn aparte toetsen; beide moeten de rol
  toestaan. Wortels die Windows pas bij eerste gebruik automatisch
  binnenhaalt en nog niet lokaal heeft, ontbreken. Op andere platforms het
  platformarchief (of uitsluitend `SSL_CERT_FILE`/`SSL_CERT_DIR` als die gezet
  zijn), zonder doelen per wortel; op Linux bevat dat vaak alleen wortels voor
  TLS-servers. Eén keer per sessie geladen; mislukt dat met een paniek, dan
  blijft het archief de hele sessie leeg.

### 7.2 Getoonde status

`status.rs` leidt de status af uit de drie assen:

| Integriteit | Vertrouwen | Getoonde status |
|---|---|---|
| intact | vertrouwd | **Geldig** |
| intact | niet vertrouwd | **Onbekend certificaat** (+ reden: geen keten, verlopen, sleutelgebruik, algoritme niet ondersteund) |
| gewijzigd | — | **Gewijzigd na ondertekenen** |
| ongeldig | — | **Ongeldige handtekening** |
| niet te controleren | — | **Niet te controleren** (+ reden: PDF onleesbaar, bytebereik ongeldig, CMS onleesbaar, geen certificaat, algoritme niet ondersteund, verouderd formaat) |

Dekking staat los daarvan. Bij elke *intacte* handtekening die niet tot het
einde reikt, komt achter de status: **— het document is daarna nog
gewijzigd**. Dus ook bij "Onbekend certificaat"; anders zou dat feit juist
verdwijnen bij de bestanden waar het het meest telt.

"Feit melden, niet oordelen": een toevoeging na het ondertekenen komt ook voor
in geldige documenten (tweede goedkeuring, LTV-gegevens, documenttijdstempel).
Die krijgen geen alarm. Maar vervalsingen die de getoonde reden of weergave
veranderen, zien er net zo uit en worden daarom nooit gewoon "Geldig" genoemd.
Bij "daarna nog gewijzigd" staat de knop **Toon ondertekende versie**, die de
bytes tot het einde van het bytebereik opent (`pdf_signed_revision`). Die
versie komt als bestand in de cachemap van de app; de app ruimt bij het
opstarten versies op die ouder zijn dan zeven dagen, zodat een tabblad dat in
een andere instantie nog open staat zijn bestand niet kwijtraakt.

Het detailvenster vermeldt altijd: "Intrekking niet gecontroleerd."

### 7.3 Prestatie

Verificatie start alleen als het document handtekeningvelden heeft. Ze draait
in een Rust-thread, hasht in stromen, en houdt het openen van het document niet
op; de balk verschijnt zodra de uitkomst er is.

Grenzen: hooguit 1000 handtekeningvelden per document (daarna heet de lijst
onvolledig), en een handtekeningwoordenboek dat bij veel velden hoort, wordt
één keer gelezen. De ketenbouw controleert hooguit 2000
certificaathandtekeningen per document, over alle handtekeningen samen;
daarna zijn volgende ketens niet vertrouwd met het signaal "zoekbudget op".
Objectstromen worden begrensd uitgepakt (64 MiB per stroom, 256 MiB samen);
een grotere stroom wordt overgeslagen.

Vaste redenen en signalen (zoals een afwijkend gat in het bytebereik of een
ontbrekend `messageDigest`) gaan als machineleesbare codes naar de UI, die ze
vertaalt. De Nederlandse technische tekst staat alleen ingeklapt onder
"Technisch detail".

Bestanden vanaf 64 MiB worden in het geheugen afgebeeld (`memmap2`) in plaats
van ingelezen; kleinere bestanden worden ingelezen. Bekend risico van de
afbeelding: kort een ander proces (of de app zelf bij opslaan) het bestand in
terwijl de verificatie loopt, dan kan het lezen op Linux en macOS het proces
met SIGBUS laten stoppen; op Windows weigert het systeem dat inkorten zolang de
afbeelding bestaat, zodat opslaan op dezelfde plek tijdelijk mislukt. Daarom
geldt de afbeelding alleen voor grote bestanden, waar een volledige kopie het
geheugen het zwaarst belast.

## 8. Foutafhandeling

- Elke fout in een handtekening blijft beperkt tot die handtekening; de andere
  worden gewoon gecontroleerd en het document opent normaal.
- Een PDF die niet te ontleden is, geeft "Niet te controleren", nooit een crash.
- Een leeg handtekeningveld (zonder waarde) wordt getoond als "Niet ondertekend
  veld".
- Een mislukte ondertekening laat nooit een half doelbestand achter.

## 9. Testen

### 9.1 Unit-tests (Rust, zonder bestanden)

- `bytebereik.rs`: plaatshouder heeft vaste breedte; berekend bereik sluit
  precies het gat uit; patchen verandert de bestandslengte niet.
- `status.rs`: elke rij uit de tabel in §7.2.
- `pkcs12.rs`: afleiding van het wachtwoord (leeg vs afwezig).

### 9.2 Testcorpus

Bestanden van derden worden niet in de repo opgenomen. Een script
`scripts/haal-handtekening-testdata.py` haalt ze op, vastgepind op commit, en
controleert elk bestand op SHA-256 uit het manifest
`scripts/handtekening-testdata.json`, dat per bestand ook de verwachte uitkomst
bevat. Doel:
`testdata/handtekeningen/`, opgenomen in `.gitignore`. Tests die het corpus
nodig hebben, slaan over met een duidelijke melding als het ontbreekt.

| Bron | Commit | Licentie | Inhoud |
|---|---|---|---|
| pyca/cryptography `vectors/cryptography_vectors/pkcs12` | `2ad2c2b06e` | Apache-2.0 of BSD-3-Clause | 31 `.p12`; sleutels zijn EC, dus alleen voor de lezer |
| esig/dss `dss-pades/src/test/resources/validation` | `c8aea1f909` | LGPL-2.1 | selectie van 18 PDF's |

De sleutels in het pyca-corpus zijn EC. Ze toetsen de lezer; ondertekentests
gebruiken de eigen RSA-fixtures hieronder.

Eigen fixtures, wel in de repo (wegwerpcertificaten, uitsluitend voor tests,
opnieuw aangemaakt met tien jaar geldigheid), onder
`src-tauri/tests/fixtures/pkcs12/`:

| Bestand | Herkomst | Formaat |
|---|---|---|
| `windows-export-3des.p12` | Windows `Export-PfxCertificate` | PBES1 3DES, MAC SHA-1 |
| `certutil-3des.p12` | Windows `certutil -exportPFX` | PBES1 3DES, MAC SHA-1 |
| `openssl3-aes256.p12` | OpenSSL 3 | PBES2 AES-256-CBC, MAC SHA-256 |

Verwachte uitkomsten voor de PAdES-selectie, per as. De tests toetsen
integriteit en dekking, niet de eindstatus: de certificaten in dit corpus komen
van test-CA's die niet in het rootarchief staan, dus de eindstatus is daar
normaal "Onbekend certificaat".

Integriteit en dekking van de CAdES-handtekeningen zijn vastgesteld met een
onafhankelijk orakel (handtekeningen uitgelezen met PDFium, CMS met OpenSSL),
niet alleen afgeleid uit de bestandsnamen. Uitzondering: dat orakel controleert
alleen `messageDigest`, dus de integriteit van **documenttijdstempels** is nog
niet onafhankelijk bevestigd. Die rijen volgen het DSS-corpus en worden
bevestigd zodra de imprint-controle bestaat.

| Bestand | Handtekeningen | Verwachte integriteit | Dekking |
|---|---|---|---|
| `pades-bes.pdf` | 1 CAdES | intact | hele document |
| `doc-firmado-T.pdf` | 1 CAdES | intact | hele document |
| `doc-firmado-LT.pdf` | 1 CAdES | intact | niet tot het einde (LTV-gegevens toegevoegd) |
| `pades3_Baseline_B.pdf` | 2 CAdES + 2 documenttijdstempels | alle intact | alleen de laatste tot het einde |
| `doc-firmado.pdf` | CAdES + documenttijdstempel | beide intact | laatste tot het einde |
| `pades-5-signatures-and-1-document-timestamp.pdf` | 5 CAdES + documenttijdstempel | alle intact | laatste tot het einde |
| `hello_signed_INCSAVE_signed.pdf` | 2 CAdES | beide intact | tweede tot het einde |
| `hello_signed_INCSAVE_signed_EDITED.pdf` | 2 CAdES | eerste intact, **tweede gewijzigd** | — |
| `modified_after_signature.pdf` | 1 CAdES | intact | **niet tot het einde** |
| `pades-spoofing-replaced-reason.pdf` | 1 CAdES | intact | niet tot het einde → nooit gewoon "Geldig" |
| `pades-alter-signature-appearance-modify-stream.pdf` | 2 CAdES | intact | niet tot het einde → nooit gewoon "Geldig" |
| `pades-signed-annot-added.pdf` | leeg veld + 1 CAdES | "Niet ondertekend veld" + intact | niet tot het einde |
| `malformed-rsa-digestinfo.pdf` | 1 | **ongeldig** (digest klopt, handtekeningwaarde niet) | — |
| `pades-bes-no-certificates.pdf` | 1 | niet te controleren (geen certificaat) | — |
| `pades-unsupported-signature-algorithm.pdf` | 1 | niet te controleren (algoritme) | — |
| `BadEncodedCMS.pdf` | 1 | niet te controleren (CMS onleesbaar) | — |
| `malformed-pades.pdf` | — | niet te controleren, geen crash | — |
| `encrypted.pdf` | 1 CAdES | intact | hele document |

### 9.3 Rondgang in Rust

Met de eigen fixtures:

1. Onderteken een testbestand → eigen verifier: intact, hele document.
2. Wijzig één byte binnen het bytebereik → gewijzigd.
3. Voeg een incrementele toevoeging toe → intact, niet tot het einde.
4. Onderteken het al ondertekende bestand opnieuw → eerste: niet tot het einde;
   tweede: hele document.
5. Het onafhankelijke orakel (PDFium + OpenSSL) draait op elk zelf ondertekend
   bestand en moet dezelfde integriteit vinden — de geautomatiseerde tweede
   lezer.

### 9.4 In de app

- Onderteken een verificatiebestand met annotaties, heropen het ondertekende
  bestand: de annotaties zijn gelijk aan die van het bronbestand (eis 3).
- Opslag-rondgang over alle verificatiebestanden, want de gewone opslag krijgt
  een waarschuwing erbij.

Testnotitie: een testinstantie met een eigen `LOCALAPPDATA` krijgt daarmee
niet ook een eigen cachemap. `app_cache_dir` (waar de ondertekende versies
staan) volgt op Windows de bekende map van het systeem en niet de
omgevingsvariabele `LOCALAPPDATA`; ondertekende versies van een testinstantie
komen dus in de cachemap van de gebruiker terecht.

### 9.5 Handmatig

Eis 1 — geldig in twee andere PDF-lezers — is niet te automatiseren. Er wordt
een ondertekend testbestand opgeleverd; de gebruiker controleert het. De issue
blijft open tot dat bevestigd is.

## 10. Buiten scope

- Ondertekenen met sleutels uit het Windows-certificaatarchief, smartcards en
  tokens (het rootarchief van Windows wordt wel gelezen voor verificatie, §7.1).
- Andere sleuteltypen dan RSA (ECDSA e.a.): duidelijke melding.
- Afbeelding in een zichtbare handtekening; alleen tekst.
- Intrekkingscontrole (OCSP, CRL).
- Naambeperkingen (nameConstraints) in een keten: niet uitgewerkt. Een
  kritieke nameConstraints-extensie wordt niet begrepen, dus zo'n keten is
  nooit vertrouwd en toont "sleutelgebruik" (geen eigen reden). Niet-kritieke
  nameConstraints worden genegeerd.
- Beleidsregels in een keten (certificatePolicies, policy-mapping, vereist
  beleid): gelezen als begrepen extensie, niet uitgewerkt.
- Tijdstempeltokens: alleen de eerste SignerInfo telt; ESSCertID/ESSCertIDv2
  (`signingCertificate`) wordt niet gecontroleerd, de binding met het
  certificaat van de dienst loopt via de sleutel; `accuracy` wordt genegeerd.
  genTime moet in UTC op `Z` eindigen, een fractie alleen met een punt
  (RFC 3161 §2.4.2); anders is het token onleesbaar.
  De dienst wordt beoordeeld op de eigen genTime van het token: met een
  gelekte sleutel van een dienst is een tijd binnen de geldigheid van diens
  certificaat na te maken (restrisico; intrekking valt buiten scope).
- Verschilanalyse van later toegevoegde wijzigingen.
- LTV-gegevens aanmaken (PAdES B-LT, B-LTA).
- Versleutelde documenten ondertekenen (verifiëren kan wel).
- Certificeringshandtekeningen (DocMDP); alleen goedkeuringshandtekeningen.
- Incrementele opslag voor gewone bewerkingen.

## 11. Open punten

- **Wachtwoorden in het pyca-corpus (opgelost).** De `*-pwd.p12`-bestanden
  gebruiken wachtwoord `password`, zoals pyca's eigen testcode; de
  corpusdocumentatie noemt ten onrechte `cryptography`. `java-truststore.p12`
  heeft een leeg wachtwoord. Alle 31 bestanden openen met de eigen lezer; de
  verwachtingen staan in het manifest.
- **Eis 1** wacht op handmatige controle door de gebruiker (§9.5).

## 12. Bouwvolgorde

Verifiëren komt vóór ondertekenen: zonder eigen verifier is ondertekenen niet
te toetsen.

1. `pkcs12.rs` — tegen het corpus en de eigen fixtures.
2. `status.rs` en `bytebereik.rs` — puur, volledig unit-getest.
3. `verifieer.rs` en `vertrouwen.rs` — tegen de PAdES-selectie (§9.2),
   inclusief de imprint-controle die de open rijen bevestigt.
4. `cms_bouw.rs`, `tijdstempel.rs`, `incrementeel.rs` — ondertekenen, getoetst
   met de eigen verifier en het onafhankelijke orakel (§9.3).
5. Tauri-commando's en UI: dialoog, balk, detailvenster, waarschuwing bij
   opslaan.
6. App-toetsen (§9.4) en de opslag-rondgang.
