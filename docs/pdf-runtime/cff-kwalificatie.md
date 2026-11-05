# PDF.js CFF-kwalificatie (#730)

Besluit op 2026-10-26: voorlopig PDF.js **6.4.299** behouden. De npm-registry
meldt dezelfde versie als nieuwste gepubliceerde `pdfjs-dist`, met gitHead
`d0991a0d53f3bb3a7307e3b83f279c1d117aafb3`. Er is dus nog geen reguliere
release-update met de onderstaande fixes. Een merge in de bronrepository is
geen geteste upgrade van onze browser/Tauri-bundel.

| Upstream | Status | Relevantie voor kwalificatie |
| --- | --- | --- |
| [22324](https://github.com/mozilla/pdf.js/pull/22324) | merged 24 oktober, `850b3908630716e515dbe47db017c4a050b9d424` | gedeelde CFF Private DICT/Subrs en controle op cumulatieve dictionarygrootte |
| [22326](https://github.com/mozilla/pdf.js/pull/22326) | merged 24 oktober, `374fdcdbed7597f70ec18f9adda3d16158c1c856` | glyph 0 bij volledig gevulde CFF-fonts; behoud van lege glyphs en FDSelect |
| [22328](https://github.com/mozilla/pdf.js/pull/22328) | merged 24 oktober, `ab4b7f91ee3275adc14e970d948b3b9ed0dd537f` | extra operands bij stack-clearing operators, inclusief subroutinegevallen |

Er is geen npm-override, handbewerking van de geminificeerde worker of onbewezen
snelheidsclaim toegevoegd. De generieke decoderfixture van #729 is geen
CFF-fontregressietest. De bestaande Unicode-exporttests kwalificeren deze
readerwijzigingen evenmin; zij dekken een andere writerroute.

#730 blijft open tot een gepinde kandidaat is vergeleken met 6.4.299. Vereist:

- eigen of aantoonbaar herdistribueerbare fonts/PDF's met hashes en licenties;
- gedeelde Private DICT/Subrs, 65.535 glyphs inclusief glyph 0 en lege/SEAC-glyphs,
  extra width-operands en subroutines, plus correcte fonts als controles;
- dezelfde render- en tekstextractieproeven in Chromium en de Tauri-webview,
  met onafhankelijke referentie, tijd en piekgeheugen;
- de bestaande Unicode-, OCR- en save-roundtripcontroles;
- vastgelegde kandidaatcommit/release en besluit over release-upgrade of een
  onderhoudbare bronpatch. Een losse upstream-unit-test vervangt dit niet.

Voor nu is **wachten met dependency-adoptie** de onderbouwde keuze. Dit document
sluit het kwalificatie-issue niet en bewijst geen lokaal gereproduceerde CFF-fout.
