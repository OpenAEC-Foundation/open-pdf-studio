# PDF.js 6.4.299 — lokale controle

De app gebruikt nu exact `pdfjs-dist` 6.4.299. `package.json` en `package-lock.json` zijn samen bijgewerkt. De geïnstalleerde release levert de worker, CMaps, standaardfonts en WASM-bestanden aan de Vite-build; de gebundelde worker meldt eveneens versie 6.4.299. Release: https://github.com/mozilla/pdf.js/releases/tag/v6.4.299.

Controle op 5 oktober 2026:

- Alle 205 JavaScript-unit-tests slaagden; TypeScript `tsc --noEmit` slaagde.
- De productie-frontendbuild slaagde. De bestaande Vite-waarschuwingen over gemengde statische en dynamische imports bleven bestaan.
- De eerste pagina van `test pdf-bestanden/Originele bestanden/Tekst.pdf` is met PDF.js 6.4.299 en Canvas gerenderd op 596 × 842 pixels; tekstextractie gaf 93 items. De gerenderde pagina is visueel gecontroleerd.
- De native debugbinary en het lokale Debian-pakket zijn opnieuw gebouwd. Pakket: `target/debug/bundle/deb/Open PDF Studio_2026.39.0_amd64.deb`. Voor deze lokale build is uitsluitend de updater-artifactstap uitgeschakeld.

De aanvullende Playwright-browsertest kon niet starten doordat de bijbehorende Chromium-binary in deze omgeving ontbreekt. De rendercontrole hierboven gebruikt de echte PDF.js-release, maar vervangt geen volledige interactieve WebView-test.
