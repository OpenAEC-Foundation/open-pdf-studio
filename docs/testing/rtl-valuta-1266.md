# RTL-valutabedragen — #1266

## Afgebakende correctie

PDF.js 6.4.299 geeft het blok Currency Symbols (U+20A0–U+20CF) standaard
het sterke bidi-type L. Unicode 17.0 kent dit hele blok type ET toe. In een
Hebreeuwse/Arabische regel komen bedrag en valutateken daardoor in de
verkeerde logische volgorde terecht. De correctie neemt alleen deze ene
classificatieregel over uit de tabel van Mozilla PDF.js #22593,
commit `98100629a8ab3c6625c82a5ab5b9a82457f415f3` (`src/core/bidi_tables.js`).

De bredere Unicode-tabellen en vormafhankelijke spiegeling uit die upstream
wijziging worden niet overgenomen. Bestaande patches #957 en #1078 blijven
actief. Tekens buiten dit blok en expliciete ToUnicode-haakjes worden niet
aangepast. De patch weigert gewijzigde, gedeeltelijke of dubbele invoer.

## Reproductie en regressie

Zelf gegenereerde PDF-fixtures met expliciete ToUnicode-mapping testen:

| Visuele PDF-invoer | Verwachte logische extractie |
| --- | --- |
| `דבלב ₪ 100 ריחמה` | `המחיר 100 ₪ בלבד` |
| `€ 50 ريعس` | `سعير 50 €` |
| `5‰ לש רועיש` | `שיעור של 5‰` |
| `abc 100 EUR` | `abc 100 EUR` |

De baseline heeft alle productiepatches behalve #1266. Hij reproduceert
beide valutafouten en behoudt de twee controles. De aangepaste worker geeft
voor alle vier de volledige verwachte tekst en richting terug, zowel met
als zonder normalisatie. Dit wordt voor legacy én modern gecontroleerd.

```bash
cd open-pdf-studio
node --test scripts/pdfjs-bidi-currency.test.mjs scripts/pdfjs-bidi-marks.test.mjs scripts/pdfjs-bidi-glyphs.test.mjs
node scripts/test-bidi-currency-browser.mjs
node scripts/draai-unit-tests.mjs
node node_modules/typescript/bin/tsc --noEmit
node scripts/meet-bundel.mjs
node node_modules/vite/bin/vite.js build --config vite.web-unit.config.js
```

De browsertest gebruikt de echte app met een eigen Vite-server zonder HMR.
Hij vergelijkt de baseline en de fix voor tekstextractie, zoeken naar de
hele zin via `performSearch`, tekstselectie en Ctrl+C, DOCX en ODT. Elke
pagina moet zichtbaar inkt bevatten; PNG-hashes moeten voor en na gelijk
zijn. De controle draait ook in Linux-CI. De native Tauri-WebView,
installerkwalificatie en de overige releasepoorten blijven apart vereist.

## Oplevergrenzen

De bestaande entry-bundelgrens van 4230 KiB faalt al op upstream main en
wordt apart behandeld in PR #1258. Geen grens is verruimd. Installer-Actions
op de persoonlijke fork zijn uitgeschakeld; zonder installerkwalificatie
blijft de PR concept. Geen release publiceren.

Chat-ID: `01a109f0-a849-7782-8641-0b091eb29747`.
