# PDF.js: 32-bits kleurfuncties (#949)

PDF.js 6.4.299 leest Type 0-samples met een signed bitshift. Daardoor worden
`0x80000000` en `0xffffffff` negatief en verdwijnen grijze vlakken in zwart.
De workerpatch neemt uitsluitend de unsigned shift over uit
[Mozilla PR 22380](https://github.com/mozilla/pdf.js/pull/22380), gemerged als
`f70fabbe791d151b720451c239564237855814a5`. De dependency blijft exact 6.4.299;
de backport wordt samen met de bestaande patches vóór de assethash toegepast.
De pakketversie is 2026.45.8. Verwijder de patch pas na kwalificatie van een
PDF.js-release die de oplossing bevat.

Dezelfde patchketen levert de legacy-worker voor de app (inclusief PDF.js-
afdrukpaden) en de moderne worker voor de web-unit. Development serveert dezelfde
gepatchte bytes. Gedeelde `node_modules` worden niet gewijzigd. De patch weigert
ontbrekende, gewijzigde, dubbele of gemengde patchplaatsen.

## Reproduceerbare controle

Vanuit `open-pdf-studio`:

```sh
node --test scripts/pdfjs-sampled-functions.test.mjs
node scripts/sampled-function-probe.mjs original
node scripts/sampled-function-probe.mjs patched
node node_modules/vite/bin/vite.js build
node node_modules/vite/bin/vite.js build --config vite.web-unit.config.js
node scripts/sampled-function-probe.mjs shipped /absoluut/pad/naar/uitgeleverde-worker.js
```

De fixturegenerator maakt één pagina van 100 × 100 punten, met een axiaal
DeviceGray-verloop of een Separation-steunkleurtransformatie. Beide gebruiken
dezelfde Type 0-functie. De probe rendert via de publieke PDF.js-API naar een
echt canvas en vergelijkt pixels op x=10,50,90 en y=50. Wanneer `pdftoppm`
aanwezig is, rendert Poppler dezelfde bytes onafhankelijk; maximaal twee
8-bits intensiteitsstappen verschil zijn toegestaan. Zonder Poppler blijven de
numerieke pixelverwachtingen actief en vermeldt de probe `Poppler=false`.

Lokaal met Poppler: de oorspronkelijke 32-bits worker geeft `0,0,0` voor beide
gevallen. De gepatchte worker geeft `141,192,243` voor het verloop en
`140,191,242` voor de steunkleurvlakken. De 8-, 16- en 24-bits controlegevallen
blijven correct. De decodertest controleert bovendien beide werkervarianten op
exacte normalisatie naar `2^31/(2^32-1)` en `1`.

Dit bewijst PDF.js-workerdecodering en canvasrendering. Het is geen kwalificatie
van PDFium/MuPDF, native Rust-rendering, een fysieke printer of alle mogelijke
kleurprofielen. De installer- en platformcontroles blijven afzonderlijke gates.
