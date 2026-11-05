# Opslaan van een grote tekeningenset (6-11-2026, #629)

Meting met `open-pdf-studio/scripts/meet-opslaan-grote-set.mjs`: 150 A1-bladen,
332 markeringen per blad (49.800 annotaties, elk met een appearance-stroom),
100.053 indirecte objecten, 29,2 MB. Geladen met de echte lader, opgeslagen
met de echte saver onder node 24 (V8, zoals de WebView), pdf-lib in partijen
van 5000 objecten zoals in de app (#581). Mediaan van 3 keer. Alleen de tijd
van `savePDF` telt.

| Scenario | Vóór | Na | Vóór (drukke machine) | Na (drukke machine) |
| --- | --- | --- | --- | --- |
| Zonder bewerking | 8,6 s | 5,2 s | 15,3 s | 8,1 s |
| Eén verplaatste en één nieuwe markering per blad | 9,7 s | 5,5 s | 15,7 s | 8,8 s |

De twee kolommenparen zijn elk onder dezelfde omstandigheden gemeten; de
machine draaide tegelijk andere bouw- en testtaken, dus de absolute tijden
zijn aan de hoge kant.

## Wat de tijd kostte

Profiel (`node --cpu-prof`) van één save, vóór:

- **pdfBron terugzetten via de state-store**: na de save kreeg elk model zijn
  nieuwe bron met `model.pdfBron = bron`. Op een model uit de store is dat
  per model een update met `unwrap` en een `batch`: ruim 2 s bij 50.000
  modellen. Nu op het kale object (`kaalModel` in saver.js); alleen de saver
  leest pdfBron.
- **Vingerafdrukken van de modelvelden** (`veldVingerafdrukken`): elk veld
  door `JSON.stringify` met een replacer, en elk veld gelezen via de proxy
  van de store. Nu leest `planBronnen` het kale object en gaan getallen,
  teksten en waarheidswaarden zonder replacer (dezelfde uitkomst, getest in
  `js/pdf/saver/bron-snelheid.test.mjs`).
- **Tweede vingerafdruk van ongewijzigde woordenboeken** in `bronNaOpslaan`:
  een woordenboek dat de save niet aanraakte, krijgt de vingerafdruk van het
  laden mee.

Wat overblijft (ongeveer gelijk verdeeld): pdf-lib leest het bestand opnieuw
in (~1,5 s), pdf-lib schrijft het weg en comprimeert de objectstromen met
deflate in JavaScript (~1,6 s), en het bronbehoud vergelijkt elke annotatie
met het bestand (~1,5 s). Verder omlaag kan met een snellere deflate (native
in Rust) of door het bestand niet opnieuw in te lezen als de save van een
geopend document komt; beide zijn grotere ingrepen.
