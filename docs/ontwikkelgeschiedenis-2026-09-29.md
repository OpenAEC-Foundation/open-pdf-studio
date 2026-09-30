# Ontwikkelgeschiedenis — 29 september 2026

Dit bestand bewaart de werkgeschiedenis van de lopende lokale ontwikkelsessie. Het is een samenvatting van besluiten, wijzigingen en controles, geen woordelijk chatarchief. De codewijzigingen staan nog in de lokale werkboom; er is geen commit of push uitgevoerd.

## Doel en richting

De gebruiker wil dat de ontwikkeling doorloopt: openstaande problemen oplossen, een zichtbare **native dev-build** maken, toestemming die in de weg zit aanpakken, bruikbare ODT- en Excel-export leveren, en de MCP-server uitbreiden zodat bestaande PDF-tekst kan worden gewijzigd of vertaald met behoud van de opmaak. De huidige exportwerkzaamheden sluiten aan op [issue #380](https://github.com/OpenAEC-Foundation/open-pdf-studio/issues/380).

## Uitgevoerd

- De MCP-server heeft nieuwe hulpmiddelen om paginatekst met positie en opmaak te lezen en bestaande tekst in een gebonden document te vervangen. Het vervangen verwijdert de oorspronkelijke tekst en tekent de vervanging in het oorspronkelijke vak met overeenkomstige kleur en lettertype waar mogelijk. Als een vervanging niet past of onveilig is, wordt ze geweigerd.
- Er is een beveiliging toegevoegd waardoor een crash van de PDFium-worker niet ook de hoofdapp via een onveilige in-process terugval laat crashen.
- De PDF-save breekt nu af wanneer een pagina al modelannotaties heeft terwijl het laden van de annotaties voor die pagina nog niet voltooid is. De vorige route kon in dat geval bestaande en modelannotaties naast elkaar opslaan en duplicaten maken.
- De gekozen documentreferentie loopt nu vanaf de klik mee naar Save, Save As, de MCP-save en beeld-/rasterexport. Zo kan het asynchroon laden van een module geen export of save van een inmiddels actief geworden ander tabblad starten.
- ODT-export zet tekst om naar bewerkbare alinea's en tabellen; de laatste wijziging voegt doorlopende regels samen tot één alinea. XLSX-export herkent tabellen en geeft elke tabel een eigen werkblad. Export naar beeldformaten en atomair opslaan zijn eveneens in de werkboom aangepast.
- Er is een lokale Linux-app gebouwd: `target/debug/open-pdf-studio`. Het actuele ontwikkelpakket is `target/debug/bundle/deb/Open PDF Studio_2026.39.0_amd64.deb` (amd64). Het pakket is lokaal en zonder updaterhandtekening gebouwd; de frontend is ingebouwd, dus dit is geen Vite/localhost-venster.

## Gecontroleerd

- Een echte PDF is via MCP aangepast van `Offerte:` naar `Aanbod:` en opnieuw opgeslagen. De controle liet behoud van de afbeelding en vectorpaden zien; het pixelverschil lag bij het gewijzigde woord.
- De ODT-export van `test pdf-bestanden/Originele bestanden/Tekst.pdf` is met LibreOffice weer als PDF geopend en visueel nagekeken. De lopende tekst staat als alinea en de begroting als bewerkbare tabel. QA-bestanden staan tijdelijk in `/tmp/open-pdf-office-qa-after.*`.
- Een uit `Technische tekening.pdf` gemaakte XLSX is met `openpyxl` geopend. Het werkboek bevat vijf bladen; het groepsschema staat als tabel van tien rijen en drie kolommen op een eigen blad, inclusief de totaalregel.
- Na de laatste wijziging zijn `pnpm run typecheck`, alle 203 JavaScript-unit-tests, `vite build` en `cargo build -p open-pdf-studio` geslaagd. De Vite-build meldde bestaande bundelwaarschuwingen; de Rust-build meldde één verouderde `tauri_plugin_shell::Shell::open`-aanroep. Eerder waren gerichte Rust/MCP-tests geslaagd; de volledige Rust-MCP-suite had twee omgevingsafhankelijke screenshotfouten wegens ontbrekende PDFium-voorziening in die testomgeving.
- Na de extra opslagwacht is `save-document.test.mjs` geslaagd en de frontend opnieuw gebouwd.
- Na de documentbindingswijziging slaagden de gerichte opslag-, Office- en beeldexporttests, typecontrole, frontendbuild en de Tauri-debugpakketbouw. De pakketbinary is zonder Vite-server gestart; de WebView en vier PDFium-workers meldden zich gereed. De Tauri-tool meldde versieverschillen tussen vier bestaande JS/Rust-plug-inparen; `--ignore-version-mismatches` was voor deze lokale QA-build nodig.

## Vervolg

### Overdracht naar de nieuwe chat

De nieuwe chat `Open PDF Studio` heeft id `01a0edab-3f03-7df1-b3bd-56bfbfc48a5d` en werkt in dezelfde werkboom met de meegenomen gesprekscontext.

- De paginareeks-parser weigert nu ongeldige tekens en ongeldige onderdelen in een samengestelde selectie, zodat bijvoorbeeld `1, 2abc` niet gedeeltelijk wordt geëxporteerd. De gerichte export- en printtests zijn geslaagd.
- De bestaande MCP-testinstantie op poort 9323 toont de ODT- en XLSX-kaarten en hun opties in de echte desktop-UI. Dit controleert de bediening van het exportpaneel; het bewijst nog niet de volledige bestandsdialoog en export in de nieuwste pakketbuild.
- De nieuwe pakketbinary is gestart met de QA-PDF. De WebView en vier PDFium-workers waren gereed terwijl poort 3041 niet draaide. De QA van de daadwerkelijke exportbestanden in deze specifieke pakketbuild blijft open.
- Na de paginareekswijziging zijn alle 203 JavaScript-unit-tests opnieuw geslaagd.
- Een synthetische meting van de tabelherkenning gaf ongeveer 30 ms voor 4.000 tekstvakken en 134 ms voor 20.000; dit onderdeel is op die schaal geen aangetoonde bottleneck.

### Vervolg op 30 september

- De live MCP-testapp heeft `Tekst.pdf` geopend en een schermreferentie van de eerste pagina geleverd. Daarmee is de weergave in de draaiende desktopapp gecontroleerd; een volledige vergelijking met een daadwerkelijk via de UI geëxporteerde 300-DPI-afbeelding staat nog open.
- PNG en JPEG krijgen nu de gekozen fysieke resolutie in respectievelijk de `pHYs`- en JFIF-velden. Een onafhankelijke controle met Pillow las na omzetting 299,9994 DPI (PNG) en 300 DPI (JPEG), met ongewijzigde pixels en afmetingen. TIFF schreef de DPI al weg.
- Typecontrole, alle 203 JavaScript-unit-tests, frontendbuild en Tauri-debugpakketbouw slaagden. Het actuele lokale `.deb`-pakket is op 30 september om 06:24 gebouwd, na deze wijzigingen.

1. De ODT-, XLSX- en beeldexport in de nieuw gebundelde app interactief nalopen, resterende regressies oplossen en de werkboom daarna opnieuw beoordelen.

De mappen `promo/` en `scripts/promo/` bevatten bestaande, losstaande niet-gecommitte wijzigingen en horen niet bij deze werkzaamheden.
