# Lege generatie in een klassieke xref-tabel (#1246)

Een PDF kan leesbare objecten hebben terwijl de generatiekolom van een klassieke
xref-regel leeg is. Op upstream `72dcb0967` faalt pdf-lib 1.17.1 met beide bestaande
productiepatches bij `parseRawInt`. PDF.js kan dezelfde pagina's wel openen.

De gekwalificeerde parserpatch herstelt uitsluitend een lege generatie vóór een
`n`-markering op dezelfde regel. Het objectnummer, de offset, de objectkop en het
al ingelezen object moeten overeenkomen. De generatie wordt uit die objectkop
gelezen, ook als die niet nul is. Vrije regels, verkeerde offsets, ontbrekende of
ongeldige objecten en andere onleesbare velden worden niet geraden.

Zodra herstel nodig was, moeten alle aantallen in de tabel kloppen, moet de trailer
aanwezig zijn en moeten alle in-use-regels naar gelezen objecten wijzen. De extra
kopcontrole leest maximaal 64 bytes per object; de lege kolom maximaal 32 bytes.
De bronbytes worden nooit gewijzigd. De bestaande beperkingen van xref-stromen
(#1093) en de selectie van actieve xref-stromen blijven gelden. Er is geen algemene
catch toegevoegd die parserfouten inslikt.

## Controles

- `node --test scripts/pdf-lib-classic-xref.test.mjs`: niet-lege fixture met twee
  tekstpagina's en een vierkante annotatie met generatie 7. Beide bundelroutes
  (Vite-optimizer en productietransformatie), intacte/lege/meervoudig lege velden,
  identieke indirecte objecten, opslaan met klassieke tabellen en objectstromen,
  heropenen en pixelgelijke MuPDF-weergave inclusief annotaties.
- Dezelfde suite weigert verkeerde offsets, een vrije regel met ontbrekende
  generatie, een afgebroken veld, een ontbrekend object, ontbrekende tabelregels
  en een ontbrekende trailer. Leestellingen blijven begrensd en bronbytes intact.
- `node --test scripts/pdf-lib-xref-bounds.test.mjs scripts/pdf-lib-xref-wees.test.mjs`:
  bestaande schadelijke breedtes/EOF, normale xref-stromen en verweesde stromen.
- `node scripts/test-classic-xref-browser.mjs`: echte loader, gedeeld pdf-lib-document,
  annotatieloader, saver en heropenen. Alleen native bestandstoegang is vervangen
  door een geheugenbestand. Fouten en annulering schrijven niets en behouden cache,
  bron en gewijzigd-status; een daaropvolgende save slaagt. De legacy PDF.js-route
  controleert tekst en pagina-inhoud pixelgelijk. De annotatielaag is voor die
  pixelvergelijking uitgeschakeld omdat de saver appearances opnieuw aanmaakt;
  het aantal annotaties blijft behouden. De onafhankelijke MuPDF-test hierboven
  vergelijkt ook annotatiepixels bij rechtstreeks pdf-lib-opslaan.

Dit is een gerichte herstelroute voor ontbrekende generaties, geen algemene
PDF-reparatie. Native verpakte Tauri-UI en installers moeten nog worden
gekwalificeerd; de browserproef vervangt die controles niet.
