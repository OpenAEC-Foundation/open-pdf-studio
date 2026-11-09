# Web-unit (#451): toetsing en stand van zaken

Stand 9 november 2026, op `main` na ronde 8 (`add5fd243`) plus de wijzigingen
van deze ronde. Het ontwerp met de motormetingen staat in
[superpowers/specs/2026-09-23-web-unit-design.md](superpowers/specs/2026-09-23-web-unit-design.md);
dit document toetst wat er gebouwd is aan issue #451 en houdt bij wat er nog
openstaat.

## Kort

De web-unit bestaat sinds #455 als apart bouwdoel (`npm run build:web-unit` →
`open-pdf-studio/dist-web-unit/`) met een custom element `<open-pdf-studio>`,
een iframe-brug, meten met schaal, notities en rechthoeken, en opslaan naar
PDF-bytes. De toetsing vond vooral gaten in de **inbedding**, niet in de
techniek eronder:

- de gebouwde `open-pdf-studio.js` exporteerde niets bruikbaars (een gewone
  Vite-bouw gooit entry-exports weg; er bleef alleen een interne export `_`
  over), dus `import { … } from '…/open-pdf-studio.js'` kon niet;
- de unit gebruikte een **eigen** annotatiemodel (`note` met `contents`,
  `square` met `breedte`/`hoogte`), terwijl het issue hetzelfde model als de
  app eist (`comment` met `text`, `box` met `width`/`height`);
- `lang` en `storage` werden gelezen maar deden niets; de werkbalk was
  hard-Nederlands;
- een opmerking kon je plaatsen maar niet typen (altijd de standaardtekst);
- geen omvangsbewaking, geen thema's, geen `mount()`-API.

Die gaten zijn in deze ronde gedicht (zie "Wat deze ronde veranderde").

## Toetsing per punt uit het issue

| Punt uit #451 | Stand vóór deze ronde | Stand nu |
| --- | --- | --- |
| **Bouwdoel naast de bestaande build** | aanwezig, `vite.web-unit.config.js`, `npm run build` ongemoeid | ongewijzigd |
| **Openen** — van URL of bytes | `src`-attribuut (URL) of `laad(bytes)` | `load(bron)` neemt bytes, `ArrayBuffer`, `Blob`/`File` of URL |
| **Kijken, bladeren, zoomen** | één pagina tegelijk, ◀ ▶, − +, passend | idem; tekenen tijdens weghalen geeft geen paginafout meer |
| **Meten** — schaal, afstand | `scale`-attribuut, kalibreren, afstandsmaat met label | idem + `setScale()`/`getScale()`/`calibrate()`; maat draagt `measureValue`/`measureUnit`/`measurePixels` zoals de app |
| **Meten** — oppervlakte, omtrek, schaalgebieden | meetkunde in `meten.js`, geen gereedschap | **open** |
| **Opmerkingen** — notitie, vormen | notitie (zonder tekstinvoer) en rechthoek | notitie met tekstveld op de plek (Enter bevestigt), rechthoek |
| **Opmerkingen** — tekstvak, ellips, pijl | ontbreken | **open** |
| **Opslaan / teruggeven** | `opslaan()` → bytes, gebeurtenis `opds:opgeslagen` | `exportPdf()` → bytes, `opds:save` |
| **Annotaties lezen als JSON** | `annotaties()`, eigen model | `getAnnotations()` in het app-model, losse kopie |
| **Annotaties als XFDF** | ontbreekt | **open** (de XFDF-code van de app hangt aan de app-state) |
| **Alleen-lezenstand** | `mode="view"` | idem + `readOnly: true` in `mount()`, `setMode()` |
| **Gebeurtenissen** | `opds:geladen`, `opds:gewijzigd`, `opds:opgeslagen`, `opds:fout` | daarnaast `opds:load`, `opds:change`, `opds:save`, `opds:error` met Engelse velden; `onLoad`/`onChange`/`onSave`/`onError` in `mount()` |
| **Inbedden als webcomponent** | `<open-pdf-studio>` | idem + `OpenPdfStudio.mount(el, opties)`; exports van de gebouwde entry werken |
| **Inbedden als iframe** | postMessage-brug in de entry | brug lui geladen; `laad` met een foute URL geeft nu een `laad:fout`-antwoord in plaats van `info: null` |
| **Zelfde annotatiemodel als de app** | nee (eigen soorten en velden) | ja (`measureDistance`, `comment`, `box`); oude namen worden bij inlezen omgezet |
| **Zelfde rendering als de app** | PDF.js; MuPDF-WASM met `engine="mupdf"` | ongewijzigd |
| **Thema** | vaste kleuren | CSS-variabelen (`--opds-*`), `theme="dark"`, `::part(toolbar | button | page | comment-editor)`, `toolbar="none"` voor een eigen werkbalk |
| **Talen** | `lang` gelezen, werkbalk vast Nederlands | eigen kleine teksttabel (en, nl, de, fr; andere talen → Engels), `labels` om teksten te overschrijven |
| **Opslag en rechten** | `storage` gelezen, niets gebouwd | `storage="none"` (standaard) bewaart niets; `storage="local"` bewaart per document pagina en schaal onder de prefix `opds-web-unit:`; `clearStorage()` wist alleen die sleutels |
| **Geen Tauri** | geen Tauri-import, niet bewaakt | bewaakt in `web-unit/bundel-budget.test.mjs` (bron én bouw) |
| **Omvangsbudget** | gehaald, niet bewaakt | bewaakt (zie hieronder) |
| **Luie delen** | PDF.js, pdf-lib en MuPDF al lui | daarnaast de iframe-brug; `preload()` haalt PDF.js vooraf op |
| **`engine="auto"`** | beschreven, niet gebouwd | **open** |

## Omvang

Gemeten met `npm run build:web-unit`; KiB = 1024 bytes, gzip met zlib-standaard.

| Wat | Vóór | Na |
| --- | --- | --- |
| Start: `open-pdf-studio.js` + statische brokken (altijd) | 17,2 KiB / **6,4 KiB gzip** | 27,9 KiB / **10,0 KiB gzip** |
| PDF.js-bibliotheek (bij het eerste document) | 427 KiB / 128 KiB gzip | ongewijzigd |
| PDF.js-worker (idem) | 2.179 KiB / 468 KiB gzip | ongewijzigd |
| Schrijver + pdf-lib (pas bij `exportPdf()`) | 429 KiB / 178 KiB gzip | ongewijzigd |
| MuPDF-inpakcode + wasm (alleen `engine="mupdf"`) | 88 KiB + 9.757 KiB (3.438 KiB brotli) | ongewijzigd |
| Iframe-brug | in de start | 1,0 KiB, lui |
| Hele `dist-web-unit/` (inclusief demo's) | 13 MB | 13 MB |

De start groeide met 3,6 KiB gzip door de Engelse API, de teksttabel, het
opslaan van de stand, het tekstveld voor opmerkingen en de thema-variabelen.
Dat blijft ver onder het ontwerpbudget van 250 kB gzip. Tot er een tekening
staat laadt de gastheer ongeveer 606 KiB gzip (start + PDF.js + worker).

**Bewaking.** `web-unit/bundel-budget.test.mjs` (in `test:unit`):

- op de bron, altijd: de statische importgraaf vanaf `web-unit/src/index.js`
  bevat geen npm-pakket en geen app-module; `opslaan.js` en `iframe-brug.js`
  hangen er niet statisch aan; nergens in de unit komt `@tauri-apps`,
  `core/platform.js`, `core/state.js`, i18next of SolidJS binnen;
- op de bouw, als `dist-web-unit/` er is en niet ouder is dan de bronnen: de
  start blijft onder **48 KiB / 16 KiB gzip**, er hangt geen lui brok (PDF.js,
  pdf-lib, MuPDF, schrijver, brug) aan, de entry exporteert `mount`,
  `OpenPdfStudio`, `EVENTS` en `default`, PDF.js + worker blijft onder
  **640 KiB gzip**, en geen enkel gebouwd script bevat een Tauri-verwijzing.

**Kanttekening.** De PDF.js-worker is met 468 KiB gzip boven de 400 kB uit het
ontwerp gegroeid (nieuwere PDF.js plus de eigen worker-correcties). Dat is
dezelfde worker als in de app; kleiner maken betekent een afgeslankte
PDF.js-bouw en valt buiten deze ronde.

## Wat deze ronde veranderde

Alles in `open-pdf-studio/web-unit/` en `vite.web-unit.config.js`; de app en
`npm run build` zijn niet geraakt.

- `src/model.js` (nieuw): het app-model en de omzetting van de oude namen.
  `annoteren.js` maakt nu `comment`/`box`, `opslaan.js` schrijft via het model
  (notitievak 24 × 24 pt zoals de app).
- `src/element.js`: Engelse API (`load`, `exportPdf`, `getAnnotations`,
  `setAnnotations`, `setScale`, `getScale`, `calibrate`, `page`, `pageCount`,
  `zoomTo`, `setMode`, `setTool`, `labels`, `author`, `preload`,
  `clearStorage`, `destroy`); de Nederlandse namen blijven werken. Elke
  gebeurtenis gaat onder beide namen uit. Tekstveld voor opmerkingen. Thema's.
  Een gewijzigd attribuut (bijvoorbeeld `mode`) zet de pagina en zoom niet
  meer terug; een schaal die vóór het eerste document gezet wordt, blijft
  staan.
- `src/index.js`: `mount()`, `OpenPdfStudio` (ook als `globalThis`), luie
  iframe-brug.
- `src/api.js`: `toolbar`, `theme`, `EVENTS`, `engelsDetail`,
  `attributenUitOpties`.
- `src/teksten.js`, `src/opslag.js` (nieuw).
- `vite.web-unit.config.js`: `preserveEntrySignatures: 'exports-only'` en de
  voorbeeldpagina als extra invoer.
- `voorbeeld/index.html` (nieuw): de kleinste zinnige gastheer.
- Tests: `src/inbedden.test.mjs` en `bundel-budget.test.mjs` (nieuw, in
  `test:unit`); `demo-e2e.mjs` loopt nu ook het tekstveld van de opmerking en
  de voorbeeldpagina na (laden, gebeurtenissen, app-model, schaal, export per
  pagina, alleen-lezenstand, `storage="local"`).

## Controle

- `node --test web-unit/src/*.test.mjs web-unit/bundel-budget.test.mjs`: 70 tests, alle groen.
- `npm run test:web-unit` (headless Chromium tegen de dev-server): vóór en na
  deze ronde **ALLES GOED**; na deze ronde met de extra stappen 10–16.
- Dezelfde controle tegen de gebouwde `dist-web-unit/` (via `vite preview`):
  **ALLES GOED**.

## Wat er nog openstaat

Op volgorde van belang voor een gastheer die de unit in productie wil zetten:

1. **Een gedeelde saver-kern met de app.** De unit schrijft de woordenboeken
   nog met een eigen kleine schrijver (`opslaan.js`) volgens dezelfde
   conventies; elke wijziging aan die conventies moet op twee plekken. Het
   model is nu gelijk, de schrijver nog niet.
2. **Bestaande annotaties in het document.** PDF.js tekent ze mee, maar ze
   komen niet in de laag: de gastheer ziet ze niet in `getAnnotations()` en de
   gebruiker kan ze niet wijzigen.
3. **Selecteren, verplaatsen en verwijderen** van annotaties in de unit
   (nu alleen via `setAnnotations()` door de gastheer).
4. **Oppervlakte, omtrek en schaalgebieden**; tekstvak, ellips en pijl.
5. **XFDF** in en uit (de app-code hangt aan de app-state; een pure kern
   afsplitsen hoort bij punt 1).
6. **`engine="auto"`** met de drempelmeting uit het ontwerp.
7. **Doorlopend scrollen** en de tekstlaag (selecteren en zoeken).
8. **Een kleinere PDF.js-worker** (zie de kanttekening bij de omvang).
9. **Meer talen** in de teksttabel; nu en, nl, de en fr.
