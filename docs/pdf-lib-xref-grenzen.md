# Begrensde pdf-lib XRef-parser (#1093)

De app bundelt pdf-lib 1.17.1 via een gekwalificeerde Vite-patch, zowel in de
productiebouw als in de dependency-optimizer. `node_modules` blijft ongewijzigd.
De bronhashes van beide gewijzigde parsermodules laten een dependency-update
expliciet mislukken totdat de patch opnieuw is beoordeeld.

Een XRef-stream moet precies drie gehele, niet-negatieve `/W`-velden hebben,
ieder maximaal 8 bytes. `/Size` en `/Index` moeten veilige gehele aantallen en
bereiken bevatten. Voor het lezen wordt de totale benodigde hoeveelheid bytes
vergeleken met de daadwerkelijk gedecodeerde streamlengte. Per XRef-stream geldt
een werkgrens van 1.000.000 records en 16 MiB veldlezingen. Dit begrenst ook de
allocatielus bij `/W [0 0 0]`, waarvoor geen streambytes nodig zijn. Bestanden
boven deze grenzen worden bewust geweigerd; de grens is geen PDF-specificatielimiet.

Nulbrede velden blijven geldig: type standaard 1, offset en generatie standaard
0. Velden worden zonder 32-bits bitverschuivingen gelezen; getallen buiten de
veilige JavaScript-integerprecisie worden geweigerd. Een onverwacht einde van de
stream is een fout. De algemene pdf-lib-herstelroute mag XRef-parserfouten niet
inslikken: `PDFDocument.load()` wijst af met `InvalidXRefStreamError`.

De bestaande saver toont de fout, sluit zijn voortgangsvenster en geeft zijn
opslagslot vrij. Hij schrijft pas nadat het laden gelukt is. De browsertest
controleert nul schrijfacties, dezelfde bron/cache, behoud van de gewijzigd-status,
een daaropvolgende annulering zonder schrijfactie en daarna succesvol opslaan en
heropenen van een geldig document.

## Controle

- `node --test scripts/pdf-lib-xref-bounds.test.mjs`: echte dependencybundels
  via beide patchroutes, ongepatchte reproductie met minstens 300.000 leesacties,
  afwijzing met minder dan 2.000 leesacties, ongeldige vormen/waarden/bereiken,
  afgeknotte streams, nulbrede velden, 64-bits veldbreedte met veilige waarde,
  klassieke en gecomprimeerde XRef-streams bij opslaan/heropenen.
- `node scripts/pdf-lib-xref-browser.mjs`: Chromium, echte Vite-optimizer en
  saver; native bestandsschrijven en rendering worden gestubd.
- De regressies lopen in de unitlijst en de Linux-browserstap van CI.

## Afbakening

Dit begrenst de XRef-veldlussen na streamdecodering. Het is geen algemene limiet
voor decompressie, PDF-bestandsgrootte of het totale aantal incrementele revisies.
De native Rust-app valt buiten deze wijziging. Native WebView- en installerproeven
blijven onderdeel van de platformcontrole; de browsertest vervangt die niet.
