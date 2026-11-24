# Ter ondertekening versturen via een eigen ondertekendienst (#1232)

Status: **ontwerp, in de wacht** (24-11-2026): er is meer informatie nodig
voordat er gebouwd wordt. Nog niets gebouwd. Dit document legt vast wat de
koppeling moet doen, hoe ze in de bestaande app past, wat de API van de
dienst wel en niet toelaat, en welke beslissingen de producteigenaar moet
nemen voordat er gebouwd wordt.

De dienst is SignuDoc: open source (MIT), door elke organisatie zelf
gehost. De app praat alleen met de installatie die de gebruiker zelf
opgeeft; er is geen dienst van OpenAEC of van de makers tussen.

## 1. Wat er al is en waar dit bij aansluit

| Onderdeel | Waar | Rol in dit ontwerp |
|---|---|---|
| Goedkeuringsroutes (#651) | `js/approval-routing/` (`model.js`, `core.js`, `providers.js`, `service.js`) | Het model met ontvangers, rollen, volgorde, status per ontvanger en een auditspoor bestaat al. Een provider zegt eerst wat er uitgaat (`outgoing`) en draagt pas over bij `deliver`. |
| Providers `mail-v1` en `local-file-v1` | `js/approval-routing/providers.js` | Beide lokaal. De ondertekendienst wordt de derde provider, `esign-v1`, en de eerste die via het netwerk verstuurt. |
| Certificaathandtekeningen (#374) | `js/pdf/handtekeningen/`, crate `open-pdf-signatures` | Verificatie van het verzegelde bestand dat terugkomt. Het eigen ondertekenen met .p12 blijft wat het is. |
| Vak slepen op de pagina | `js/tools/tools/label-gebied-tool.js` | Velden plaatsen: hetzelfde gebaar als bij een zichtbare handtekening. |
| Sleutelopslag van het besturingssysteem | `src-tauri/src/accounts.rs` (crate `keyring`) | De API-sleutel van de dienst komt hier, nooit in de voorkeuren of in de webview. |
| Netwerk vanuit Rust | `src-tauri/src/central_review_transport.rs` | Voorbeeld van een begrensde HTTP-client met eigen foutmodel. |

Gevolg: dit is **geen nieuw onderdeel naast** de goedkeuringsroute, maar een
provider erin. De gebruiker stelt een aanvraag samen zoals nu (ontvangers,
rollen, volgorde, bericht, vervaldatum), plaatst de velden, en kiest als
manier van versturen de ondertekendienst.

## 2. Wat de API toelaat

Gelezen uit de API-gids van de dienst (`docs/api.md`, versie 1, onder
`/api/v1`). Binnen versie 1 komen er alleen eindpunten, velden en foutcodes
bij; er verandert of verdwijnt niets.

| Onderwerp | Wat de API doet | Gevolg voor de app |
|---|---|---|
| Aanmelden | `Authorization: Bearer sdk_…`. Een sleutel handelt als de beheerder die hem maakte en slaat de tweestapscontrole over. | Zie beslissing A: dit is een beheerderssleutel, bedoeld voor servers. |
| Aanmaken en versturen | `POST /envelopes` met de PDF, ondertekenaars, velden en `send` in één aanroep. Alles of niets: bij een fout blijft er geen half concept achter. | Eén aanroep per verzending. |
| Veilig herhalen | `Idempotency-Key`: dezelfde sleutel binnen 24 uur geeft het eerste antwoord terug. | De app gebruikt de aanvraagverwijzing van de route (`requestRef`) als sleutel; een herhaalde klik of een weggevallen verbinding maakt geen tweede envelop. |
| Velden | Per pagina als fracties van breedte en hoogte vanaf linksboven. Soorten: handtekening, paraaf, datum, naam, tekst, vinkje, getal, keuzelijst, keuzerondje. Elke ondertekenaar heeft minstens één handtekeningveld nodig. | Omrekenen uit app-ruimte is een deling door de paginamaat. Zie 4. |
| Volgorde | Standaard na elkaar; met `step` tekenen ondertekenaars met dezelfde stap tegelijk. Rol `signer` of `approver`. | Past op `sequential`/`parallel` en op de rollen `sign`/`approve` van de route. |
| Grootte | 20 MB per PDF. Op een Vercel-installatie boven 4 MB eerst uploaden via `POST /uploads`. | De app kiest de weg op grootte en op het antwoord (404 op `/uploads` = direct sturen). |
| Status | Envelop: `draft`, `sent`, `completed`, `declined`, `voided`, plus `expired`. Ondertekenaar: `pending`, `notified`, `signed`, `declined`, met `viewedAt`. | Past op de toestanden van de route; zie de tabel in 5. |
| Op de hoogte blijven | Webhooks naar een `https://`-adres, of opvragen: `GET /envelopes/{id}` en `GET /webhook-deliveries?since=`. | Een bureaubladapp kan geen webhook ontvangen. Opvragen dus; zie 5. |
| Resultaat | `GET /envelopes/{id}/files/signed` en `/files/certificate`. | Downloaden en als nieuw document openen. |
| Limieten | 600 verzoeken per 10 minuten per sleutel, 60 enveloppen per 10 minuten, 100 verzendingen per uur. `429` met `Retry-After`. | Opvragen met ruime tussenpozen; `Retry-After` volgen. |
| Verplichte bevestiging | `send.permittedUseConfirmed: true`: de afzender bevestigt dat het een gewone zakelijke overeenkomst is. | De gebruiker moet dit zelf aanvinken; de app vult het nooit stilzwijgend in. |
| Intrekken en herinneren | `POST /envelopes/{id}/void` en `/remind` (hooguit één keer per dag). | Knoppen in het statusvenster van de route. |

## 3. Opzet

```
ApprovalRoutingDialog ──► core.submit() ──► provider esign-v1
                                              │  outgoing(): wat gaat er uit, naar welke host
                                              │  deliver(): één aanroep naar Rust
                                              ▼
                               src-tauri/src/ondertekendienst.rs
                                 - sleutel uit de sleutelopslag van het OS
                                 - HTTPS naar de opgegeven installatie
                                 - begrensde antwoorden, eigen foutcodes
```

- **De sleutel verlaat Rust niet.** De webview geeft het doel en de inhoud
  door; Rust haalt de sleutel uit de sleutelopslag en zet de
  `Authorization`-kop. In logboeken staat hooguit `sdk_…` met de laatste
  vier tekens. De sleutel staat niet in `preferences`, niet in het
  sessiebestand en niet in crashrapporten.
- **Eén toegestane host.** Rust praat alleen met de host uit de
  verbindingsinstelling, alleen over HTTPS, zonder omleidingen te volgen
  naar een andere host. De upload-URL uit `POST /uploads` is de enige
  uitzondering en wordt alleen voor die ene `PUT` gebruikt.
- **Eerst tonen, dan versturen.** `outgoing()` toont voor het versturen:
  naar welke host, welke ontvangers met naam en e-mailadres, welke velden op
  welke pagina's, de bestandsnaam en de SHA-256 van het bestand. Dit is ook
  de plek voor de privacymelding: het document en de gegevens van de
  ondertekenaars verlaten dit apparaat naar die installatie.
- **Zonder verbinding geen provider.** Is er geen installatie ingesteld,
  dan staat `esign-v1` niet in de lijst en is er geen lege of kapotte
  ondertekenstroom te zien.

### Opdrachten in Rust

| Opdracht | Doet |
|---|---|
| `esign_verbinding_zet { url, sleutel }` | Bewaart de URL in de voorkeuren en de sleutel in de sleutelopslag; controleert met `GET /me` en geeft naam en bereik van de sleutel terug. |
| `esign_verbinding_status` | Of er een verbinding is, de host, en de naam van de sleutel. Nooit de sleutel zelf. |
| `esign_verbinding_wis` | Verwijdert de sleutel en de URL. |
| `esign_verstuur { pad, data, idempotentie }` | Maakt de envelop en verstuurt hem; kiest de uploadweg op grootte. |
| `esign_status { id }` | De envelop zoals de API hem geeft. |
| `esign_haal_op { id, soort, doel }` | Schrijft het verzegelde bestand of het certificaat naar `doel`. |
| `esign_trek_in { id, reden }`, `esign_herinner { id }` | Intrekken en herinneren. |

## 4. Velden plaatsen en omrekenen

De gebruiker kiest per ontvanger een veldsoort en sleept een vak op de
pagina. Het vak staat in app-ruimte: de pagina zoals ze getoond wordt, op
schaal 1, oorsprong linksboven, met de draaiing van de pagina en `/UserUnit`
al verwerkt (`paginaViewport`).

De API vraagt fracties van de pagina vanaf linksboven:

```
x = vak.x / paginaBreedte        width  = vak.width  / paginaBreedte
y = vak.y / paginaHoogte         height = vak.height / paginaHoogte
```

met `paginaBreedte` en `paginaHoogte` de maat van de getoonde pagina. In
fracties valt `/UserUnit` weg, omdat teller en noemer dezelfde eenheid
hebben.

**Te bewijzen vóór het bouwen** (staat ook in het issue): of de dienst de
fracties neemt van de pagina zoals ze getoond wordt, of van de ongedraaide
`/MediaBox`. Op een pagina met `/Rotate 90` verschilt dat een kwartslag. De
proef: één PDF met vier pagina's (`/Rotate` 0, 90, 180, 270) en één met
`/UserUnit 2`, op elke pagina een veld linksboven, versturen naar een
testinstallatie en kijken waar het veld staat. Blijkt het de ongedraaide
pagina te zijn, dan komt er een omrekening per draaiing bij; de pure
functie krijgt de draaiing dan als invoer. Ook een `/CropBox` die kleiner is
dan de `/MediaBox` hoort in die proef.

Velden die niet passen op de bestaande rollen:

| Veld van de dienst | In de app |
|---|---|
| `signature`, `initials`, `date`, `name` | Vast aanbod bij een ontvanger met de rol ondertekenen. |
| `text`, `checkbox`, `number` | Tweede stap, als de eerste werkt. |
| `dropdown`, `radio` | Niet in de eerste versie. |

De velden worden bij de aanvraag bewaard (`record.config.fields`), zodat een
vervangende aanvraag ze kan overnemen.

## 5. Status volgen zonder webhook

Een bureaubladapp heeft geen adres waar de dienst naartoe kan sturen. Twee
wegen:

1. **Opvragen (voorstel voor de eerste versie).** Voor elke openstaande
   aanvraag `GET /envelopes/{id}`: bij het openen van het document, bij het
   openen van het statusvenster, op de knop Verversen, en zolang het venster
   open is hooguit eens per minuut. Geen achtergrondproces als de app dicht
   is. Bij 600 verzoeken per 10 minuten is dat ruim binnen de limiet.
2. **Een doorgeefpunt.** Een kleine dienst met een publiek adres ontvangt de
   webhooks, controleert de handtekening (Standard Webhooks, HMAC-SHA256) en
   houdt ze vast tot de app ze ophaalt. Dat is een onderdeel dat iemand moet
   hosten en beheren; alleen zinvol als OpenAEC zelf een installatie
   aanbiedt (beslissing E).

Afbeelding van de toestanden:

| Dienst | Route in de app |
|---|---|
| envelop `sent`, ondertekenaar `pending` | ontvanger: wacht op zijn beurt |
| ondertekenaar `notified` | ontvanger: aan de beurt, uitgenodigd |
| `viewedAt` gevuld | ontvanger: geopend |
| ondertekenaar `signed` (rol `approver`: goedgekeurd) | ontvanger: getekend / goedgekeurd |
| ondertekenaar `declined` | ontvanger: afgewezen, met de reden |
| envelop `completed` | aanvraag: voltooid; resultaat ophalen |
| envelop `voided` | aanvraag: geannuleerd |
| `expired: true` | aanvraag: verlopen |

De app vertaalt de status; de bron blijft de dienst. Elke opgehaalde
toestand komt met tijdstip in het auditspoor van de route, met de vermelding
dat hij van de dienst komt.

## 6. Het resultaat terug in de app

- Bij `completed` haalt de app het verzegelde bestand en het certificaat op
  en biedt aan ze op te slaan naast het bronbestand
  (`<naam> [<verwijzing>] ondertekend.pdf` en `… certificaat.pdf`).
- Het verzegelde bestand opent als nieuw document. Het handtekeningenpaneel
  toont het zegel via de bestaande verificatie. De app claimt daarbij niets
  over juridische geldigheid, zoals bij de goedkeuringsroute al de regel is.
- **Waarschuwen vóór bewerken.** Een wijziging maakt het zegel ongeldig. De
  bestaande melding bij opslaan met handtekeningen
  (`bevestigOpslaanMetHandtekeningen`) dekt dit; het document opent
  daarnaast met een balk die zegt dat het verzegeld is.
- De SHA-256 van het verstuurde en van het teruggekomen bestand staan in
  het auditspoor.

## 7. Markeringen vóór het versturen

Wat de dienst krijgt is een PDF. Markeringen van de app zijn annotaties; of
de dienst die toont en in het verzegelde bestand bewaart, is niet uit de
API-gids op te maken.

Voorstel: de app verstuurt **een afgevlakte kopie** (de bestaande functie
"platgeslagen kopie", `pdf/flattened-copy.js`), zodat wat de ondertekenaar
ziet vastligt in de pagina-inhoud. Het bronbestand blijft bewerkbaar. De
voorvertoning zegt dat er een afgevlakte kopie uitgaat. Dit is beslissing C.

## 8. Fouten

| Antwoord | Wat de gebruiker ziet |
|---|---|
| `401 unauthorized` | De sleutel is onbekend, ingetrokken of verlopen: verbinding opnieuw instellen. |
| `403 forbidden` | De sleutel mag alleen lezen. |
| `413 payload_too_large` | Het bestand is groter dan de installatie toelaat (20 MB). |
| `409 wrong_state` | De envelop is al verstuurd of ingetrokken: status verversen. |
| `422 idempotency_key_reused` | Deze aanvraag is al met andere inhoud verstuurd: een vervangende aanvraag maken. |
| `429 rate_limited` | Te veel verzoeken: de app wacht `Retry-After` en probeert het één keer opnieuw. |
| `503` | De installatie kan geen e-mail versturen: er is niets verstuurd. |
| Geen verbinding | Er is niets verstuurd; de aanvraag blijft een concept. |

Een mislukte verzending laat de aanvraag als concept staan. Door de
`Idempotency-Key` is opnieuw proberen veilig.

## 9. Beslissingen voor de producteigenaar

**Genomen op 24-11-2026:**

- A: de sleutel staat niet in de app maar bij een losse dienst op een
  server (keuze A2). Hoe die dienst eruitziet en wie hem beheert, is nog
  open.
- B: alleen het bureaublad.
- C: markeringen gaan als afgevlakte kopie mee.
- Er is geen testinstallatie. Stap 0 (de proef) en alles vanaf stap 3
  wachten daarop; ook stap 1 verandert door keuze A2, want de app bewaart
  dan zelf geen sleutel.

De afwegingen hieronder blijven staan als achtergrond.

**A. Van wie is de verbinding?**
De sleutel van de dienst is een beheerderssleutel: hij handelt als de
beheerder die hem maakte, slaat de tweestapscontrole over, en de API-gids
zegt uitdrukkelijk hem op een server te bewaren, niet in een browser of een
mobiele app. Een bureaubladapp met de sleutel in de sleutelopslag van het
besturingssysteem zit daar tussenin.

| Keuze | Voor | Tegen |
|---|---|---|
| A1. Per gebruiker, sleutel in de sleutelopslag (voorstel eerste versie) | Geen extra dienst nodig; werkt met elke eigen installatie. | Elke gebruiker die verstuurt heeft een beheerderssleutel nodig, of een gedeelde sleutel van een apart "app"-account. Wie de sleutel heeft, kan alle enveloppen van dat account lezen. |
| A2. Via OpenAEC Accounts en een doorgeefdienst | De sleutel staat op een server; gebruikers melden zich aan zoals ze dat al doen; webhooks worden mogelijk. | Een dienst om te bouwen, hosten en beveiligen. |

Het advies in de API-gids voor A1: een apart beheerdersaccount voor de app
(bijvoorbeeld "Open PDF Studio", met een gedeelde mailbox) en de sleutel
daarvan. Dan versturen alle gebruikers onder die ene naam.

**B. Alleen bureaublad, of ook de gehoste webversie?**
In de browser kan de sleutel nergens veilig staan, en of de dienst
aanroepen vanuit een pagina op een andere host toelaat (CORS), staat niet in
de API-gids. Zonder A2 is dit dus alleen
bureaublad. Voorstel: bureaublad eerst; in de webversie staat de provider
uit met dezelfde melding als andere bureaubladfuncties.

**C. Markeringen: afvlakken, behouden of vragen?**
Voorstel: afvlakken, zie 7. Behouden kan pas als de proef uitwijst dat de
dienst annotaties toont en bewaart.

**D. Aanvulling op of vervanging van wat er is?**
Voorstel: aanvulling. De goedkeuringsroute met mail en lokaal bestand blijft
voor wie geen dienst heeft; het eigen ondertekenen met een certificaat
blijft voor wie zelf tekent. De dienst is er voor ondertekenaars buiten de
organisatie die niets willen installeren.

**E. Biedt OpenAEC een installatie aan?**
Dat is een bedrijfsbeslissing (hosting in de EU, beheer, kosten,
verwerkersovereenkomst) en hoort niet in de app. De app gaat in elk geval
uit van een installatie die de gebruiker zelf opgeeft.

## 10. Opbouw in stappen

Elke stap is op zichzelf bruikbaar en te testen.

| Stap | Inhoud | Klaar als |
|---|---|---|
| 0. Proef | De vier vragen uit het issue beantwoorden op een testinstallatie: coördinaten bij draaiing, `/UserUnit` en `/CropBox`; de groottegrens; wat er met annotaties gebeurt; hosting buiten Vercel. | De uitkomsten staan in dit document. |
| 1. Verbinding | Instelling voor URL en sleutel, sleutelopslag, controle met `GET /me`, wissen. | Zonder verbinding is er niets te zien; met verbinding toont de instelling de host en de naam van de sleutel; de sleutel staat in geen enkel logboek of voorkeurenbestand. |
| 2. Velden | Velden plaatsen bij een aanvraag, bewaren, omrekenen naar fracties (pure functie met tests voor draaiing en `/UserUnit`). | De velden staan na opslaan en heropenen op dezelfde plek. |
| 3. Versturen | Provider `esign-v1`: voorvertoning, bevestiging van toegestaan gebruik, versturen met `Idempotency-Key`, uploadweg boven 4 MB. | Een PDF gaat naar de testinstallatie en de ondertekenaars krijgen hun uitnodiging; twee keer klikken maakt één envelop. |
| 4. Status | Opvragen, afbeelden op de route, intrekken en herinneren. | Het statusvenster toont per ontvanger verstuurd, geopend, getekend, afgewezen, en voor de aanvraag voltooid, geannuleerd, verlopen. |
| 5. Resultaat | Ophalen, opslaan, openen, zegel tonen, waarschuwen vóór bewerken. | Het teruggekomen bestand opent en het zegel valideert. |

Het issue is klaar als een PDF vanuit de app naar een testinstallatie gaat,
door twee ondertekenaars wordt getekend en als verzegeld bestand met geldig
zegel terugkomt, met de velden op de juiste plek op gedraaide pagina's en op
pagina's met `/UserUnit`.

## 11. Wat nodig is om te kunnen beginnen

- Een testinstallatie van de dienst met een beheerdersaccount en een
  werkende e-mailverzending, en een API-sleutel met het bereik lezen en
  schrijven. Zonder die installatie is stap 0 niet te doen en zijn stap 3
  tot en met 5 niet te testen.
- De keuzes A tot en met D.

Stap 1 en 2 kunnen zonder installatie gebouwd en getest worden; alles
daarna niet.
