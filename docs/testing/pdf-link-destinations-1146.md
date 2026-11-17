# Hyperlinkbestemmingen en randen (#1146)

Een gegenereerde PDF met een rode gestreepte hyperlink naar `/FitR` reproduceert
beide problemen op main: de rand ontbreekt en de zoom blijft 1,5 in plaats van
2,455; het doelgebied staat circa 193 pixels horizontaal en 227 pixels verticaal
naast het midden. De bestaande navigatie gebruikte alleen de verticale positie.

De linklaag gebruikt nu de volledige bestemming: `/FitR` past het doelgebied,
`/XYZ` neemt de expliciete zoom over en de Fit-varianten passen de pagina/breedte/
hoogte. De PDF.js-viewport verwerkt CropBox en rotatie. De scrollpositie wordt op
beide assen ingesteld; de native viewport gebruikt zijn bestaande pan-/zoom-API.
Asynchrone navigatie controleert documentidentiteit en een volgnummer zodat een
oude aanvraag geen nieuwere sprong of ander tabblad kan overschrijven.

PDF.js-bordergegevens worden als SVG-rand getekend, inclusief kleur, dikte,
streeppatroon en onderstreping. Links zonder kleur of met nulbreedte blijven
onzichtbaar. De linkannotatie en zijn bestemming worden niet opnieuw geschreven;
de bestaande saver behoudt de oorspronkelijke woordenboeken.

Kwalificatie: `node scripts/test-link-view-browser.mjs` opent een echte PDF via
de bestandskiezer, klikt de hyperlink en controleert uitsnede, zoom en centrum
in Continuous en Single. Ook benoemde XYZ-bestemmingen, een geroteerde CropBox
en behoud van rand/bestemming na opslaan worden gecontroleerd. Gerichte unit-
en PDF-rondgangtests controleren tevens nulcoördinaten/zoom, Fit-varianten en
onzichtbare/gestreepte/onderstreepte randen.

Beperkingen: de melding bevat geen voorbeeldbestand. Dit bewijst standaard PDF-
bestemmingen en standaardranden; een eigen appearance-stream, afgeronde of
3D-rand van een ander programma is hiermee niet visueel gekwalificeerd. De
browserkwalificatie is geen geïnstalleerde Windows/macOS-test van de native
viewport. `/FitB`, `/FitBH` en `/FitBV` gebruiken de paginaomvang, niet de strakke
begrenzing van getekende inhoud.

Lokale projectcontroles: bestaande volledige suite 8610 tests (8576 geslaagd,
34 overgeslagen, nul fouten); daarnaast alle 28 gerichte linktests geslaagd,
waaronder de vijf nieuwe geometrie-/randtests. TypeScript, productiebuild,
versiecontrole v2026.47.18 en diffcontrole zijn geslaagd.
