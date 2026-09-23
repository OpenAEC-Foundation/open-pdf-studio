# Web-unit: een kleine, in te bedden kijker met meten en opmerkingen

Ontwerp, 23 september 2026.

## Aanleiding

De bureaubladversie is de volledige gereedschapskist. Een platform dat een
tekening wil tonen — een projectomgeving, een BIM-portaal, een klantportaal —
heeft daar een fractie van nodig: openen, kijken, meten, een opmerking
achterlaten en het resultaat teruggeven. Zo'n platform wil dat *in* zijn eigen
pagina, niet in een apart programma.

De voorkant draait technisch al in een browser. `js/core/platform.js` heeft
webtakken achter `isTauri()` en `npm run build` levert een gewone webbundel. Wat
ontbreekt is (a) een bundel die klein genoeg is om in te bedden en (b) een API
waarmee de gastheer hem aanstuurt.

Dit ontwerp beschrijft die unit: wat hij kan, hoe je hem inbedt, welke
tekenmotor hij gebruikt, hoeveel hij mag wegen, en waar zijn gegevens blijven.

## Wat er vandaag is — gemeten

Alle cijfers hieronder zijn gemeten op 23 september 2026 in deze worktree, op
één machine, in headless Chromium (software-rasterisatie). De bladen uit de
verificatieset zijn generiek aangeduid.

### De webbundel van vandaag

`npx vite build` levert **28 MB** in `dist`, verdeeld als:

| Onderdeel | Omvang | Opmerking |
| --- | --- | --- |
| `assets/index-*.js` (3 brokken) | 3.574 kB rauw, **1.131 kB gzip** | de entry — wordt altijd geladen |
| `assets/index-*.css` | 261 kB rauw, 38 kB gzip | idem |
| `assets/mupdf-wasm-*.wasm` | 9.757 kB rauw, 4.480 kB gzip, **3.437 kB brotli** | wordt vandaag nooit opgehaald |
| `assets/pdf.worker-*.js` | 1.931 kB rauw, 378 kB gzip | bij het eerste document |
| `assets/fontkit.es-*.js` | 699 kB rauw, 323 kB gzip | lui, bij opslaan met lettertypen |
| 312 taalbrokken (39 talen × 8 naamruimten) | 3.343 kB rauw | **al lui** — bij start hooguit 2 talen |
| `public/pdfjs/` (meegekopieerd) | 6.8 MB | waarvan 1,5 MB cmaps en 0,8 MB standaardlettertypen daadwerkelijk gebruikt worden; de rest (viewer, locales, demo-PDF, bronkaart) is ballast |
| 34 PNG's | 0,2 MB | symbolen/sjablonen — minder dan verwacht |

De entry is dus niet groot door plaatjes of talen, maar door **code**. Toegerekend
naar bronbestanden (via een build met bronkaarten) zit er 7.720 kB broncode in
de drie `index`-brokken:

| Bron | kB |
| --- | --- |
| `js/solid/components` (ribbon, ~57 dialogen, panelen) | 1.306 |
| `js/pdf` (loader, renderer, saver, printen, CAD) | 790 + 212 + 155 |
| `node_modules/pdfjs-dist` | 780 |
| `node_modules/pdf-lib` | 758 |
| `js/annotations` (+ `rendering`) | 664 + 139 |
| `js/tools` (+ `tools`) | 431 + 237 |
| `js/mcp-bridge.js` | 118 |
| `js/symbols/data` + `templates` | 146 + 131 |

De oorzaak is bekend: `App.jsx` importeert alles statisch, `DialogHost.jsx`
trekt ~57 dialogen mee (inclusief CAD-import, CAD-export en printen), de ribbon
alle tien tabbladen, en `ui/setup.js` alle 33 gereedschappen. Er staat geen
enkele `lazy()` in de boom. Voor de bureaubladversie is dat een verdedigbare
keuze; voor een ingebedde unit niet.

### Wat er vandaag echt werkt in een browser

Gemeten met een headless browser tegen de dev-server (bewijs in
`%TEMP%\opds-webunit-uitvoer\probe-web.txt` en `01-opstart.png`,
`02-na-openen.png`):

**Werkt.** De app start (`#app-root` gevuld na ~1,0–3,9 s), de volledige
bureaublad-UI verschijnt, de bestandskiezer opent, een A0-blad laadt en tekent
met PDF.js op een canvas van 5055×3576, het eigenschappenpaneel toont het juiste
paginaformaat (1188,9 × 841,0 mm). Voorkeuren komen uit en gaan naar
`localStorage['pdfEditorPreferences']`. Meten, annoteren en opslaan-naar-download
zitten alle drie in modules zonder Tauri-afhankelijkheid.

**Werkt niet, of stil.** De kern van het probleem is één regel in
`js/core/platform.js`:

```js
export async function invoke(cmd, args = {}) {
  if (!isTauri()) return null;   // geen fout — stil null
  ...
}
```

Alles wat op de Rust-kant leunt geeft dus `null` in plaats van een fout, en
degradeert stil. Gemeten en nagelopen:

- **Rendering**: `engine-router.js` kiest tussen twee Rust-commando's en is in
  de browser irrelevant; `render-route.js` stuurt alles naar PDF.js. PDFium,
  de Skia-kern, de worker-sidecar, de tegelweg en de vectorweg bestaan niet op
  het web.
- **Bestandssysteem**: openen kan alleen via `<input type="file">`; het
  "bestandspad" is daarna een *naam*. `readBinaryFile` leest uit een
  module-lokale cache, `writeBinaryFile` wordt een download. `fileExists()`
  geeft altijd `false`.
- **Slepen en neerzetten van een PDF is stuk**: `js/ui/setup.js` leest
  `file.path`, wat in een gewone browser `undefined` is.
- **Openen via URL bestaat niet**: er is geen `?file=`-route; de enige
  URL-opener gaat via een Rust-commando.
- **Sessieherstel is uitgeschakeld**: `restoreLastSession()` begint met
  `if (!isTauri()) return;`, en de opgeslagen "paden" zijn toch enkel namen.
- **De laadindicator blijft hangen**: na het openen van een zwaar blad bleef
  "Loading PDF…" staan terwijl de tekening er al stond (zie `02-na-openen.png`),
  en de overlay-canvassen (`annotation-canvas`, `text-highlight-canvas`) stonden
  nog op 300×150.
- **Tauri-only, zonder web-equivalent**: printen (zichtbare fout), OCR,
  CAD-import/-export, handtekeningverificatie, comprimeren, PDF/X, IFC,
  bijlagen, schermafdrukken, plugins, updater, MCP-brug, virtuele printer.
- **Wel nette terugval**: XFDF-export (download), bevestigingsdialogen
  (`confirm()`), miniaturen (PDF.js), tekstlaag (PDF.js), volledig scherm
  (Fullscreen-API), leespositie en meetschaal (beide `localStorage`).

Conclusie: "draait in een browser" klopt technisch, maar het is de
bureaublad-UI in een browser — met dode knoppen, een stille Rust-laag en een
bundel van 3,6 MB voordat er iets op het scherm staat.

### De tekenmotor: PDF.js tegenover MuPDF-WASM

Beide motoren zitten al in de bundel. `js/pdf/mupdf-renderer.js` (107 regels) is
compleet maar **dode code** — de enige verwijzing ernaar roept alleen
`closeDocument()` aan. De meting hieronder is de eerste keer dat hij echt werk
doet.

Meetopzet: één pagina, identieke uitvoermaat (1500×1062 px voor "eerste beeld",
2625×1857 px voor de zoomslag naar 175 %), verse pagina per motor, JS-heap
gemeten met `--enable-precise-memory-info`. De uitvoer van beide motoren is
visueel identiek gecontroleerd (`bench-*-pdfjs.png` naast `bench-*-mupdf.png`).

**Blad A — A0 (1189 × 841 mm), vector, 8,7 MB, installatietekening**

| | PDF.js | MuPDF-WASM |
| --- | --- | --- |
| document openen + pagina 1 | 0,25 s | — (geen aparte stap) |
| **tijd tot eerste beeld** | **27,5 s** | **7,2 s** |
| **zoomslag naar 175 %** | **15,0 s** | **7,4 s** |
| JS-heap erbij | **+1.145 MB** | **+27 MB** |

**Blad B — A0, vector met veel mesh-arceringen, 0,5 MB, tabellenblad**

| | PDF.js | MuPDF-WASM |
| --- | --- | --- |
| **tijd tot eerste beeld** | **19,3 s** | **0,34 s** |
| **zoomslag naar 175 %** | **62,1 s** | **0,21 s** |
| JS-heap na afloop | 35 MB | 65 MB |

**Downloadomvang per motor**

| | rauw | gzip | brotli |
| --- | --- | --- | --- |
| PDF.js — worker | 1.931 kB | 378 kB | — |
| PDF.js — bibliotheek (in de entry) | ~780 kB bron | — | — |
| PDF.js — cmaps + standaardlettertypen | 2,3 MB | op aanvraag, per bestand enkele kB | — |
| MuPDF — inpakcode | 87 kB | 23 kB | ~18 kB |
| MuPDF — wasm | 9.757 kB | 4.480 kB | **3.437 kB** |

En ter controle, dezelfde A0 door de **huidige app** in de browser (dus PDF.js
via de normale weg, inclusief UI en fit-schaal): **26,6 s** tot er beeld staat.
Dat bevestigt de motormeting; de weg eromheen kost nauwelijks extra.

**Kanttekening.** Headless Chromium rastert canvas-2D op de processor. Op een
machine met GPU-versnelde canvas is PDF.js sneller dan hier gemeten. De
verhouding blijft echter overeind: MuPDF rekent in WASM, óók op de processor, en
wint op blad B met een factor 60 en op blad A met een factor 3,8 — met
veertigmaal minder geheugen.

## De keuze

### Motor

**PDF.js is de basismotor, MuPDF is de zware-bladenmotor op aanvraag.**

- PDF.js is er toch al: hij levert de pagina-structuur, de tekstlaag (selecteren
  en zoeken), links en formuliervelden. Dat kan MuPDF in deze opzet niet.
- MuPDF kost 3,4 MB brotli — te veel voor élke inbedding, maar niets vergeleken
  met 27 seconden wachten op een A0.

Daarom in de unit een attribuut `engine` met drie standen:

- `pdfjs` (standaard) — alleen PDF.js; kleinste eerste lading.
- `mupdf` — haalt de wasm meteen op en rastert daarmee; PDF.js blijft voor
  structuur en tekstlaag.
- `auto` — begint met PDF.js, meet de eerste hele-pagina-render, en schakelt
  over op MuPDF zodra die boven een drempel (standaard 1.500 ms) uitkomt. De
  drempel is de directe vertaling van de meting hierboven: bladen die in één
  tel klaar zijn, hebben de 3,4 MB niet nodig.

`auto` is beschreven maar wordt **niet** in de eerste snede gebouwd; `pdfjs` en
`mupdf` wel. Zie "Wat er nog ontbreekt".

### Scope van de unit

**Wel:** een document openen (URL of bytes), bladeren en zoomen, tekst
selecteren, meetschaal zetten (kalibreren of vaste verhouding), afstand,
oppervlakte en omtrek meten, opmerkingen plaatsen (tekstvak, notitie, rechthoek,
ellips, lijn, pijl), een alleen-lezenstand, en het resultaat teruggeven als
PDF-bytes of als annotatielijst.

**Niet:** paginabeheer (invoegen, verwijderen, draaien, samenvoegen), printen,
CAD-import en -export, tekstherkenning, digitale handtekeningen, het
symbolenpalet en de sjablonen, hoeveelhedenstaten, de vergelijkweergave,
formulieren invullen, redigeren, de MCP-brug, plugins en de updater. Die blijven
in de bureaubladversie.

**Buiten dit ontwerp:** meerdere gebruikers tegelijk, een serverdeel, hosting.
De unit is en blijft een clientcomponent die de gastheer inbedt.

### Omvangsbudget

| Post | Budget | Wanneer geladen |
| --- | --- | --- |
| unit-script (entry, gzip) | **≤ 250 kB** | altijd |
| stijl (gzip) | ≤ 15 kB | altijd |
| PDF.js-worker (gzip) | ≤ 400 kB | bij het eerste document |
| taal | ≤ 10 kB per taal | alleen de gevraagde taal |
| MuPDF (brotli) | 3.437 kB | alleen bij `engine="mupdf"` of `auto` boven de drempel |
| cmaps / standaardlettertypen | per document enkele kB | alleen als het document ze nodig heeft |

Alles bij elkaar is de eerste lading dus **onder 700 kB gzip** tot er beeld
staat, tegen 1.169 kB gzip (entry + stijl) vóór er íets gebeurt in de huidige
bundel — en zonder de 57 dialogen, de ribbon en de gereedschapskist die daar
inzitten.

## Inbeddings-API

### Als webcomponent

```html
<script type="module" src="/web-unit/open-pdf-studio.js"></script>

<open-pdf-studio
    src="/api/tekeningen/123.pdf"
    scale="1:100"
    unit="mm"
    lang="nl"
    engine="pdfjs"
    mode="edit"
    tools="measure,comment,shape">
</open-pdf-studio>
```

**Attributen** (alle ook als property te zetten; een property wint van het
attribuut):

| Naam | Waarde | Standaard |
| --- | --- | --- |
| `src` | URL van de PDF | — |
| `scale` | meetschaal, `"1:100"` of een getal in eenheden per punt | leeg (uit het document) |
| `unit` | `mm`, `cm`, `m`, `in`, `ft` | `mm` |
| `lang` | taalcode uit de 39 bestaande | `en` |
| `engine` | `pdfjs`, `mupdf`, `auto` | `pdfjs` |
| `mode` | `view` (alleen lezen) of `edit` | `edit` |
| `tools` | kommalijst uit `measure`, `comment`, `shape` | alle drie |
| `page` | beginpagina (1-gebaseerd) | `1` |
| `zoom` | `fit`, `fit-width` of een percentage | `fit` |
| `storage` | `local` (localStorage) of `none` | `none` |

**Properties en methoden**

```js
const unit = document.querySelector('open-pdf-studio');

await unit.laad(bytes);            // Uint8Array/ArrayBuffer i.p.v. src
await unit.opslaan();              // -> Uint8Array met de annotaties ingebakken
unit.annotaties();                 // -> gewone objecten (zelfde model als de app)
unit.zetAnnotaties(lijst);         // vervangt de laag
unit.meetschaal;                   // get/set {pixelsPerUnit, unit}
unit.pagina;                       // get/set
unit.zoomNaar('fit-width' | 1.75);
```

**Gebeurtenissen** — `CustomEvent`, bubbelt niet, `detail` zoals aangegeven:

| Naam | `detail` |
| --- | --- |
| `opds:geladen` | `{ paginas, breedtePt, hoogtePt, schaal }` |
| `opds:gewijzigd` | `{ aantal, laatste }` — bij elke annotatiemutatie |
| `opds:opgeslagen` | `{ bytes, aantalAnnotaties }` |
| `opds:fout` | `{ code, bericht }` |

### Als iframe

Voor gastheren die de unit liever afschermen (eigen origin, eigen
geheugengrens) is er dezelfde unit in een pagina, aangestuurd met
`postMessage`. Eén afspraak, in beide richtingen:

```js
{ opds: 1, id: '<willekeurig>', type: '<naam>', ...velden }
```

De gastheer stuurt `laad`, `opslaan`, `zetSchaal`, `gaNaarPagina`, `zetModus`,
`zetAnnotaties`. De unit antwoordt met hetzelfde `id` en `type: '<naam>:klaar'`
of `type: '<naam>:fout'`, en stuurt ongevraagd `geladen`, `gewijzigd`,
`opgeslagen` en `fout`. De unit accepteert alleen berichten waarvan de origin
in het attribuut `host-origin` staat; zonder dat attribuut accepteert hij niets
en stuurt hij alleen naar `'*'`-loze, expliciet opgegeven origins.

De hele afspraak zit in één pure module (`web-unit/src/api.js`) die geen DOM
nodig heeft — juist zodat hij met gewone unit-tests te controleren is.

## Opslag en rechten in de browser

Er is geen bestandssysteem. De unit gaat daarom uit van "de gastheer bezit de
gegevens":

- **Het document** komt binnen als URL (de unit doet één `fetch` met
  `credentials: 'same-origin'`) of als bytes van de gastheer. De unit schrijft
  nooit zelf terug naar een server.
- **Het resultaat** gaat terug als bytes via `opslaan()` of het
  `opds:opgeslagen`-bericht. Wat de gastheer daarmee doet is aan de gastheer.
- **Voorkeuren, leespositie en meetschaal** slaat de unit standaard **niet** op
  (`storage="none"`): niets in `localStorage`, niets in cookies. Met
  `storage="local"` bewaart hij ze onder één sleutel met een vaste prefix
  (`opds-web-unit:`), zodat de gastheer ze in één handeling kan wissen.
- **Geen telemetrie, geen netwerkverkeer** behalve het ophalen van `src`, de
  PDF.js-worker, de wasm (indien gevraagd) en de taalbestanden — alle vier van
  dezelfde origin als het unit-script.

## Bouwdoel en indeling

Een **apart** bouwdoel naast de bestaande build. `npm run build`,
`vite.config.js` en de bureaubladversie blijven onaangeraakt.

```
open-pdf-studio/
  vite.config.js                 (ongewijzigd — de bureaubladversie)
  vite.web-unit.config.js        (nieuw — outDir dist-web-unit)
  web-unit/
    src/
      api.js            afspraak: attributen lezen, gebeurtenissen, postMessage  (puur)
      meten.js          schaal, afstand, oppervlakte, omtrek, formatteren        (puur)
      opslaan.js        annotaties -> PDF-bytes via pdf-lib                      (puur)
      viewer.js         PDF.js/MuPDF, pagina's, zoom
      annoteren.js      overlaylaag: slepen, tekenen, selecteren
      element.js        het custom element <open-pdf-studio>
      index.js          entry: registreert het element en de iframe-brug
    demo/index.html     één pagina die laadt, meet, becommentarieert, opslaat
```

`web-unit/src/api.js`, `meten.js` en `opslaan.js` zijn pure modules zonder DOM
en zonder `state`; die worden met `node --test` gedekt en staan in de
`test:unit`-lijst. De demopagina wordt met een playwright-controle nagelopen die
de drie handelingen echt uitvoert en de teruggegeven bytes met pdf-lib
controleert.

### Waarom niet de bestaande modules hergebruiken

`js/pdf/saver.js` (3.205 regels), `js/annotations/rendering.js` (3.200 regels)
en `js/annotations/measurement.js` hangen alle drie aan de globale `state` en
aan de rest van de app. Ze meenemen betekent de bundel meenemen. De unit
gebruikt daarom:

- `pdfjs-dist` en `pdf-lib` rechtstreeks;
- `js/pdf/mupdf-renderer.js` **ongewijzigd** — die module heeft geen enkele
  afhankelijkheid van de app;
- een eigen, kleine schrijver die **exact dezelfde conventies in het bestand
  gebruikt** als de bureaubladversie.

Die laatste is het gevoelige punt. De afspraak, afgelezen uit
`js/pdf/saver.js`, is:

| Wat | In het bestand |
| --- | --- |
| afstandsmaat | `/Subtype /Line`, `/IT /LineDimension`, `/OPS_Subtype (measureDistance)`, `/L [x1 y1 x2 y2]`, vector-`/AP` |
| meetschaal | `/Measure << /Subtype /RL /R (1 pt = <f> <eenheid>) /X [ << /C <f> /D 1 /U (<eenheid>) >> ] >>` op de annotatie |
| opmerking | `/Subtype /Text` met `/Contents`, `/T`, `/C` |
| tekstvak | `/Subtype /FreeText` met vector-`/AP` |
| vorm | `/Subtype /Square` of `/Circle`, `/IC` voor vulling, `/BS` voor de rand |

Zolang de unit zich daaraan houdt opent een op het web bewerkte tekening
identiek in de bureaubladversie. Het blijft dubbele code; zie "Wat er nog
ontbreekt".

## Eerste snede

1. Bouwdoel `web-unit` met een eigen Vite-config en een eigen `outDir`, zodat
   `npm run build` en de Tauri-app bit voor bit hetzelfde blijven.
2. Het element `<open-pdf-studio>` met `src`, `scale`, `unit`, `lang`, `engine`,
   `mode`, `tools`, `page`, `zoom`, `storage`; de methoden `laad`, `opslaan`,
   `annotaties`, `zetAnnotaties`; de vier gebeurtenissen.
3. De iframe-brug met de `postMessage`-afspraak.
4. Kijken en navigeren met PDF.js; `engine="mupdf"` via de bestaande
   `mupdf-renderer.js`.
5. Meten: kalibreren op een bekende lengte of een vaste verhouding, en
   afstandmeting met label.
6. Opmerkingen: notitie en rechthoek.
7. Opslaan met pdf-lib volgens de conventietabel hierboven.
8. Eén demopagina en de tests.

## Wat er buiten deze snede valt

- `engine="auto"` met de drempelmeting.
- Oppervlakte, omtrek en schaalgebieden (de meetkunde is er, de gereedschappen
  nog niet).
- Tekstvak en ellips in de schrijver.
- Tekstselectie en zoeken (de PDF.js-tekstlaag is er, maar is nog niet
  aangesloten).
- Een gedeelde saver-kern met de bureaubladversie. Zolang die er niet is, moet
  elke wijziging aan de conventietabel op **twee** plekken gebeuren. Dat is de
  grootste schuld die deze snede aangaat, en de eerste die ingelost moet worden
  voordat een klant de unit in productie zet.
- Een eigen taallading voor de unit: de 39 talen zijn al lui, maar hangen aan
  `js/i18n/config.js`, dat i18next meebrengt. De unit heeft daar een eigen,
  kleinere lader voor nodig.
