# Bestemming van interne links markeren (#1296)

Een klik op een doorsnede- of detailverwijzing toont tijdelijk alle bijbehorende nummers en bladnummers in rood. Het paar verwijst terug naar het bronblad: `3 / S2.01` op S1.01 zoekt `3 / S1.01`, zodat een andere `3` niet wordt gemarkeerd. Bij meerdere doelpagina's verschijnt een keuzelijst; pijltjes, Home/End, Enter en Escape werken. Een volgende klik verwijdert de markeringen.

De pure herkenning is gebaseerd op het voorstel van de melder. De implementatie corrigeert de normalisatie van paginalabels, bewaart alle treffers en deelt lopende tekstextracties per PDF-proxy. Afgebroken navigatie, een vervangen PDF en het wisselen van document kunnen geen verouderde keuzelijst of markering plaatsen. Mislukte tekstextractie blijft opnieuw probeerbaar; de bestaande linkbestemming blijft beschikbaar. Bladwijzers en navigatie zonder bronrechthoek behouden hun bestaande gedrag. Markeringen wijzigen geen opgeslagen annotaties.

## Controles

- 48 gerichte tests voor linkbestemmingen, beeld/zoom, navigatie en herkenning; tien tests in `link-doelmarkering.test.mjs`, inclusief verschillende lettergroottes, hetzelfde blad, alle 45 treffers, CropBox, gedeelde extractie, annuleren en opnieuw proberen.
- `node scripts/test-link-target-marks-browser.mjs`: echt PDF-bestand in Chromium, losse pagina's en doorlopend scrollen. Controleert gekoppelde markeringen, meerdere treffers/pagina's, toetsenbord, omgekeerde verwijzing met verschillende lettergroottes, volgende klik, ongewijzigde annotaties, opruimen van een oude keuzelijst en vertraagde extractie versus een nieuwe sprong. Toegevoegd aan Linux-CI. Screenshot visueel gecontroleerd: alleen de twee juiste paren rood.
- Bestaande `test-link-view-browser.mjs`: klikbare FitR, benoemde XYZ, geroteerde CropBox, behouden linkranden/opslag en navigatieraces blijven werken in beide weergaven.
- TypeScript, directe Vite-productiebuild, versiecontrole en 34 configuratietests voor runtime, release en Android.
- De eerste volledige run vond een vast interfacelettertype in de nieuwe keuzelijst. Dit is vervangen door `var(--ui-font)`; de lettertypecontrole slaagt. De volledige suite is daarna opnieuw gedraaid: 9139 geslaagd, 41 overgeslagen en één bundelbudgetfout. Het bestaande entry-bundelbudget van 4230 KiB blijft overschreden (4247,8 KiB; upstream main was al 4241,1 KiB). Het budget is niet verhoogd.

## Grenzen en oplevering

Tekstherkenning vereist selecteerbare PDF-tekst; geen nieuwe OCR. Het eerste gebruik leest paginatekst in volgorde en kan bij grote documenten langer duren. Alleen het PDF-gebied krijgt daarbij een voortgangscursor. De tekstcache wordt opnieuw opgebouwd bij een nieuwe PDF-proxy. De heuristiek voor bladnummers en nabijgelegen tekst kan ongebruikelijke tekenconventies missen; dan blijft gewone navigatie mogelijk.

De browsercontrole kwalificeert de PDF.js-route. Geïnstalleerde Tauri/PDFium-apps en platforminstallers zijn hiermee niet gekwalificeerd. De PR blijft concept zolang bundelcontrole, installerkwalificatie en verplichte beoordeling ontbreken. De fork-installerworkflow wordt bij push geprobeerd; er wordt alleen een ongepubliceerde kwalificatie-draft aangemaakt, geen release gepubliceerd.

Versie: `2026.48.45`. Chat: `01a109f0-a849-7782-8641-0b091eb29747`. Werkbranch: `feat/link-target-marks-1296`.
