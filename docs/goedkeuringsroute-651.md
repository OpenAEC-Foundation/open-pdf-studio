# Goedkeurings- en ondertekenroute met ontvangerstatus (#651)

Dit document legt vast wat er in de app al bestond voor goedkeuringsroutes,
hoe dat zich verhoudt tot de acceptatiecriteria van #651, wat er in deze
eerste lokale versie bij is gekomen en wat er nog openstaat.

## 1. Uitgangssituatie (audit vóór deze wijziging)

Wat er al was:

| Onderdeel | Waar | Wat het doet |
|---|---|---|
| Goedkeuringsroute `local-file-v1` | `js/approval-routing/model.js`, `service.js`, `ApprovalRoutingDialog.jsx`, MCP-gereedschap `app_approval_routing` (`src-tauri/src/mcp_server.rs`), extensie-API `approvalRouting` | Concept van de opgeslagen PDF (SHA-256), ontvangers (naam, e-mail), opeenvolgend of parallel, vervaldatum, controlegebieden; vrijgeven als ZIP-pakket voor handmatige overdracht; ontvangstbewijzen (JSON) van ontvangers importeren; annuleren en vervangen; hashketen als audit. |
| Certificaathandtekeningen (#374) | `js/pdf/handtekeningen/` + crate `open-pdf-signatures` | Ondertekenen met .p12/.pfx als incrementele toevoeging; verificatie in het handtekeningenpaneel. |
| Delen / verzenden (#952) | `js/pdf/delen.js`, `src-tauri/src/email.rs` | Mailconcept met de PDF als bijlage (Simple MAPI op Windows, `xdg-email` op Linux, deelvenster op Android, Web Share of `mailto:` in de browser). Alleen onderwerp en bijlage, geen ontvangers of tekst. |
| Gedeelde beoordelingsmappen (#237/#806) | `js/review/` | Markeringen samen beoordelen via een gedeelde map; geen ontvangers- of statusmodel per document. |
| Melding bij exportverlies | `js/pdf/export-verlies-inhoud.js` | Waarschuwt wat er bij export verloren gaat. |

Toetsing aan de acceptatiecriteria van #651, vóór deze wijziging:

| Criterium | Stand | Toelichting |
|---|---|---|
| Een concept verstuurt of uploadt niets tot de gebruiker expliciet verstuurt | **Voldaan** | `local-file-v1` deed nooit iets via het netwerk; vrijgeven vroeg een bevestigde hash. Maar er was ook geen echte verzendweg: alleen een ZIP-download. |
| Identiteit ontvanger, documentversie en statusgeschiedenis zichtbaar | **Deels** | Naam/e-mail, SHA-256 en een lijst gebeurtenissen waren zichtbaar. Geen rol per ontvanger, geen status per ontvanger (alleen per aanvraag), geen "wie is aan de beurt", geen documenthash per gebeurtenis. |
| Afgewezen, verlopen, geannuleerd en vervangen zijn verschillende toestanden | **Deels** | De toestanden bestonden, maar "vervangen" kon alleen handmatig naar een andere aanvraag; een gewijzigd document vervangde lopende aanvragen niet. |
| Voltooide documenten en een auditrecord exporteren zonder vaste login | **Deels** | Het auditpakket (PDF + request.json + samenvatting) kon zonder login worden geëxporteerd. Teruggekomen (ondertekende) kopieën konden niet worden geïmporteerd of bewaard; er was dus geen "voltooid document". |
| De UI onderscheidt getekende handtekening, elektronische goedkeuring en certificaatvalidatie en claimt geen juridische geldigheid | **Deels** | De tekst noemde de verschillen en claimde niets, maar het onderscheid met de certificaathandtekening van #374 was niet uitgewerkt. |

Verdere tekortkomingen:

- Aanvragen stonden in de **voorkeuren van de app**, niet bij het document:
  ze gingen niet mee met het bestand en waren op een andere computer weg.
- Geen **bericht** aan de ontvangers, geen **rol** (beoordelen, goedkeuren,
  ondertekenen), geen handtekening-/parafeervakken.
- Geen **providerabstractie**: alleen de ZIP-overdracht, vast ingebouwd.
- Geen **voorvertoning van het uitgaande verzoek** (ontvangers, onderwerp,
  tekst, bijlage); alleen van de PDF.
- Geen manier om een **teruggekomen of ondertekende kopie** aan de aanvraag
  te koppelen.

## 2. Wat deze versie toevoegt

Een lokale eerste versie, zonder clouddienst of account.

### Model (versie 2, `js/approval-routing/model.js`)

- Ontvangers met **rol**: `review`, `approve` of `sign`. Bij `sign` horen de
  beslissingen `signed`/`rejected`, anders `approved`/`rejected`.
- **Bericht** aan de ontvangers, **bestandsgrootte** van de verzonden versie
  naast de SHA-256, en velden met een **soort**: controlegebied voor iedereen,
  handtekening- of parafeervak alleen voor een ondertekenaar. De velden zijn
  aanwijzingen in de aanvraag; de PDF verandert niet (het formulierveldmodel
  van de app wordt niet aangeraakt).
- Gebeurtenis **`dispatch`**: elke overdracht aan de provider, alleen naar wie
  aan de beurt is (opeenvolgend: de volgende; parallel: iedereen zonder
  beslissing), met de hash van de bijlage.
- **Vervangen door een gewijzigd document** (`supersede` met
  `reason: 'document-changed'`), naast vervangen door een andere aanvraag.
- **Status per ontvanger**: `pending`, `approved`, `rejected`, `signed`,
  `expired`, `cancelled`, `superseded`. Wie nog niet besliste, volgt een
  verlopen, geannuleerde of vervangen aanvraag; na een afwijzing stopt de
  route en wordt de vraag aan de rest `cancelled`. Daarnaast per ontvanger:
  aan de beurt, verstuurd op, beslist op.
- Een gemelde beslissing heeft altijd **bewijs**: een gemeld antwoord
  (`reply`), een ontvangstbewijs (`receipt-file`) of een teruggekomen kopie
  (`copy`). Een handtekening vraagt een kopie.
- **Koppelen van teruggekomen kopieën** (`matchCopy`, `findCopyMatches`):
  `exact` (dezelfde bytes), `incremental` (de verzonden bytes met een
  incrementele toevoeging erachter, zoals een certificaathandtekening van
  #374) of alleen op de **aanvraagverwijzing** `REQ-XXXXXXXX` in de
  bestandsnaam (`reference`, inhoud niet te controleren; vraagt expliciete
  bevestiging). Een kopie die nergens op past, wordt geweigerd.
- Versie-1-records blijven precies zo geldig; de bestaande tests zijn
  ongewijzigd groen.

### Stappen (`js/approval-routing/core.js`)

`prepare → preview → submit → recordDecision / importReceipt`, plus
`cancel`, `supersede`, `supersedeChanged`, `recordExpiry`, `list` en
`exportPackage`. Alleen **`submit`** roept de provider aan. Submit controleert
dat de bevestigde hash die van de bekeken bijlage is, speelt de gebeurtenissen
eerst droog af en legt ze pas vast nadat de provider de overdracht deed; faalt
de provider, dan verandert er niets.

### Providers (`js/approval-routing/providers.js`)

Een provider geeft eerst het exacte uitgaande verzoek (`outgoing`: ontvangers,
onderwerp, tekst, bijlage met naam, grootte en SHA-256) en draagt pas bij
`deliver` over. Ingebouwd:

- **`mail-v1`**: het mailprogramma opent een concept met de PDF als bijlage,
  ontvangers, onderwerp `Titel [REQ-…]` en de tekst, via dezelfde weg als
  Delen / verzenden (`verzendBijlagePerMail` in `js/pdf/delen.js`;
  `email_pdf` in `email.rs` kreeg optioneel `to` en `body`, met
  adrescontrole). De gebruiker verstuurt het concept zelf in het
  mailprogramma. Zonder bijlageweg: mailconcept met ontvangers en tekst plus
  het bestand in de bestandsbeheerder (desktop) of als download (browser).
- **`local-file-v1`**: het bekende overdrachtspakket als bestand.

Beide moeten **expliciet worden ingeschakeld** (voorkeur
`approvalRouting.providers`); de oude schakelaar `enabled` blijft gelden voor
`local-file-v1`. Bij opeenvolgend ondertekenen krijgt de volgende ontvanger de
laatst teruggekomen kopie die aantoonbaar op de verzonden versie voortbouwt,
zodat handtekeningen zich opstapelen.

### Bewaren bij het document (`document-store.js`, `save-hook.js`)

- Aanvragen staan in de PDF als privésleutel `/OPS_ApprovalRequests` in de
  catalogus (JSON, net als `/OPS_StylePresets`), en komen bij openen terug in
  `doc.goedkeuringen`. Oudere aanvragen uit de voorkeuren blijven zichtbaar
  ("bewaard in de app-instellingen").
- Een beslissing of nieuwe aanvraag markeert het document als gewijzigd,
  maar telt **niet** als nieuwe documentversie
  (`_alleenGoedkeuringGewijzigd`). Een echte save van een **inhoudelijk**
  gewijzigd document (undo-geschiedenis of `markDocumentModified`) vervangt
  de lopende aanvragen; afgeronde, afgewezen, verlopen en geannuleerde
  aanvragen houden hun eindtoestand. Verlopen aanvragen krijgen bij opslaan
  hun `expire`-gebeurtenis. Een herstelmomentopname verandert geen toestand.
- De exacte verzonden bytes en teruggekomen kopieën staan op hash in het
  geheugen en op de desktop in `approval-sources/` in de app-datamap.
- Een teruggekomen kopie wordt als **bijlage** van het document bewaard
  (`… - REQ-… - <ontvanger> (signed).pdf`), en gaat mee in het
  auditpakket (`returned/`).

### Venster (`ApprovalRoutingDialog.jsx`)

Verplaatsbaar Windows-venster met drie tabbladen: **Voorbereiden**
(providers, titel, versie, provider, volgorde, vervaldatum, bericht,
ontvangers met rol, velden), **Status en geschiedenis** (documentversie met
SHA-256 en grootte, verwijzing, provider en aflevering, ontvangerstabel met
rol/status/beurt/verstuurd/beslist, uitgaand verzoek met paginavoorvertoning
en bevestiging, Versturen, beslissing vastleggen met teruggekomen kopie,
annuleren, vervangen, auditpakket exporteren, geschiedenis met wanneer / wat /
wie / details / documenthash) en **Ontvangstbewijs** (de bestaande
ontvangerskant van het pakket). Bovenaan staat het onderscheid tussen
getekende handtekening, elektronische goedkeuring en certificaathandtekening,
zonder claim van juridische geldigheid. Alle teksten in alle 40 talen
(Nederlands en Engels vertaald, de rest Engels als terugval).

## 3. Acceptatiecriteria na deze wijziging

| Criterium | Stand |
|---|---|
| Niets verstuurd of geüpload tot expliciet versturen | Voldaan; getest (`core.test.mjs`: alleen `submit` roept de provider aan, een verkeerde bevestiging of falende provider legt niets vast). Ook dan opent alleen een concept; de gebruiker verstuurt zelf. |
| Identiteit, documentversie en statusgeschiedenis zichtbaar | Voldaan in het venster: ontvangerstabel en geschiedenis met documenthash per gebeurtenis. Identiteit blijft een label (niet geverifieerd). |
| Afgewezen, verlopen, geannuleerd, vervangen verschillend | Voldaan, per aanvraag en per ontvanger; vervangen ook automatisch bij een gewijzigd opgeslagen document. Getest. |
| Voltooid document en auditrecord exporteren zonder login | Voldaan: teruggekomen kopieën worden bewaard (bijlage + `approval-sources/`), het auditpakket bevat bron, kopieën, record en samenvatting. |
| Onderscheid handtekeningsoorten, geen juridische claim | Voldaan in de teksten (venster en mail); getest op aanwezigheid in en/nl. |

## 4. Wat nog openstaat

- **Live controle in de app** (niet uitgevoerd): venster, mailconcept met
  ontvangers en tekst via MAPI en `xdg-email`, opslaan en heropenen van een
  document met aanvragen, bijlage van een teruggekomen kopie.
- **MCP en extensie-API**: het schema van `app_approval_routing` is niet
  uitgebreid. `draft` maakt nu versie-2-aanvragen (standaard `local-file-v1`,
  rol `approve`); de nieuwe acties `preview`, `match` en `decision` en de
  velden `provider` en `message` zijn er alleen voor het venster en de
  extensie-API. Uitbreiden vraagt ook `mcp-stdio/tools.json`, de MCPB-manifest
  en de Python-laag bij te werken.
- **Herinneringen**: er is geen planner die herinneringen verstuurt; een
  herinnering is nu "opnieuw versturen" (een nieuwe `dispatch` naar wie aan de
  beurt is).
- **Handtekeningvelden als echte PDF-velden**: velden blijven aanwijzingen in
  de aanvraag. Ze als `/Sig`-formuliervelden in de verzonden PDF zetten
  verandert de bytes (en dus de hash); dat vraagt een aparte "verzendversie".
- **Gegevens van eerdere aanvragen in de verzonden PDF**: een opgeslagen PDF
  bevat de geschiedenis van eerdere aanvragen (namen, e-mailadressen). Het
  venster waarschuwt; een verzendversie zonder die sleutel zou de bytes (en
  bestaande handtekeningen) veranderen.
- **Opruimen** van `approval-sources/` in de app-datamap gebeurt nog niet.
- **Detectie van wijzigingen buiten de app**: vervangen gebeurt bij opslaan in
  de app; een document dat elders is gewijzigd, wordt niet automatisch als
  nieuwe versie herkend. Een rand: bewerken, ongedaan maken en dan alleen
  een beslissing vastleggen kan bij opslaan als inhoudelijke wijziging tellen
  wanneer het document tussendoor niet schoon was.
- **Andere providers** (bijvoorbeeld een gedeelde map zoals #237/#806 of een
  externe dienst) kunnen via `createProviders` worden toegevoegd; er is er nu
  geen.
- Een **zijpaneel** voor de status (naast het venster) is er niet; de status
  en geschiedenis staan in het tabblad van het venster.
