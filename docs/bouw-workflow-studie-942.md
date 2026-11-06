# Gematchte bouwtaken: protocol en testbestanden (#942)

Status 2026-11-06: **productstudie NIET UITGEVOERD**. Dit pakket levert
controleerbare testbestanden en een uitvoerbaar protocol voor
[issue #942](https://github.com/OpenAEC-Foundation/open-pdf-studio/issues/942).
De controle van de bestanden is geen validatie van een product of release.
Er is geen snelheidsranglijst en geen onderbouwde overstapaanbeveling.

## Bestanden en herkomst

Gebruik ongewijzigde kopieën van `fixtures/construction-study/`. De drie PDF's
zijn originele, synthetische vectortekeningen zonder projectgegevens, externe
tekeningen of afbeeldingen. De tekeningen en generator vallen onder
`LICENSE.md` (LGPL-3.0). Het ingesloten Liberation Sans-subset valt onder de
meegeleverde `LICENSE_LIBERATION` (SIL OFL 1.1). Het manifest bevat de
SHA-256 van iedere PDF, het gebruikte bronfont, geometrie en de antwoordsleutel.
Iedere pagina is A3 liggend, zonder rotatie of afwijkende CropBox.

| Bestand | Bladen | Doel |
| --- | --- | --- |
| `revision-a.pdf` | S01, S02 | Oorspronkelijke set |
| `revision-b.pdf` | S01, S03, S02 | Verschoven plan, drie lokale wijzigingen, ingevoegd detailblad |
| `measure-count.pdf` | M01 | Kalibreren, onafhankelijk controleren, oppervlakte en telgroepen |

Dit is een kleine functionele proef. Raster/scans, OCR, beschadigde bestanden,
grote sets, lettertypeproblemen en echte projectcomplexiteit ontbreken bewust.
Gebruik voor latere betrouwbaarheid en grote bestanden het bestaande
[release-testprotocol](release-testprotocol.md) en #629; rapporteer dat als een
aparte proef. Gebruik deze zes lichte pagina's nooit als renderbenchmark.

## Voorbereiding en registratie

1. Gebruik dezelfde Windows-machine voor alle drie producten: Open PDF Studio,
   Bluebeam Revu en PDF-XChange Editor. Installeer uitsluitend met rechtmatige
   toegang; koop of activeer niets automatisch. Leg CPU, RAM, GPU/driver,
   Windows-versie/build, schermresolutie, schaalfactor, invoerapparaat en voeding
   vast in een `environment.json` naast de runregistratie.
2. Noteer per product exacte versie/build, editie, licentiemogelijkheden,
   installerbron, SHA-256 en installatiedatum. Gebruik voor Open PDF Studio de
   **op dat moment gepubliceerde release**, niet een ontwikkelcheckout of
   conceptinstaller. Leg de release-URL vast. Verifieer functies in de werkelijk
   beschikbare editie; vul ontbrekende functies in als `UNSUPPORTED_EDITION`.
3. Noteer taal, eenheden (mm/m²), snapinstellingen, vergelijkingsinstellingen,
   acceleratie, plugins, voorkeuren en achtergrondbelasting. Begin met
   standaardinstellingen, behalve dezelfde taal en metrische eenheden. Leg
   iedere afwijking vast. Geen netwerktijden of verschillende hardware mengen.
4. Registreer per deelnemer een pseudoniem, eerdere productervaring en minuten
   gewenning. Geef per product dezelfde taakbeschrijving en maximaal 15 minuten
   oefentijd op een aparte kopie. Noteer benodigde hulp. De antwoordsleutel is
   alleen voor de beoordelaar, tot de deelnemer de uitvoer heeft ingeleverd.
5. Gebruik drie gemeten herhalingen per taak/product na de oefenronde. Draai de
   productvolgorde per herhaling: OPS/Revu/Editor, Revu/Editor/OPS,
   Editor/OPS/Revu. Houd taakvolgorde vergelijken/meten/tellen gelijk. Bij meer
   deelnemers roteert ook de eerste productvolgorde. Vermeld leereffecten: dezelfde
   tekening wordt herkend; dit is geen geblindeerd gebruikersonderzoek.
6. Iedere taak start in een reeds geopende, lege app met standaard startscherm,
   zonder documenten of vorige taakannotaties. Maak een schone lokale werkkopie
   en lege uitvoermap. Geef de instructie vooraf, start de klok bij 'begin',
   inclusief openen en instellingen. Stop bij opslaan van alle vereiste uitvoer
   en de melding 'klaar'. Limiet: 10 minuten per taak. Noteer timeout/fout/hulp;
   een fout is geen snelle geslaagde uitvoering.
7. Tel per opname: muisklik (dubbelklik = twee), slepen (één), toetsencommando
   inclusief modifiers (één), tekstinvoer per veld (één), scrollgebaar (één).
   Bewaar afzonderlijke aantallen en som. Een beoordelaar controleert de opname
   met toestemming; anders noteer handmatige telling en onzekerheid. Apps mogen
   verschillende routes gebruiken, maar dezelfde uitvoer is vereist.

## Taken en beoordeling

### T1: revisies vergelijken

Open A en B, koppel overeenkomstige bladen, corrigeer de verschuiving en
identificeer inhoudelijke wijzigingen. Lever een PDF met zichtbare markeringen
op B en een lijst met bladpaar, wijziging en locatie; exporteer het eigen
vergelijkingsrapport indien beschikbaar. Een handmatig gemaakte lijst/PDF is
ook toegestaan en telt mee in de tijd. Noteer automatische detectie versus
handmatige correctie afzonderlijk.

Antwoord: A1/B1 = S01; A2/B3 = S02; B2 = nieuw S03. Het plan op B1 is 12 pt
naar rechts en 8 pt omlaag verplaatst; titel, kader en legenda zijn vast gebleven.
Lijn uit op de buitenhoeken van het plan, niet op het kader. De binnenwand is
van x=300 naar x=320 pt verschoven; een raam is toegevoegd bij (370,515,70,10)
en apparatuur verwijderd bij (400,300,40,40), vóór globale verschuiving.
S02 is inhoudelijk exact gelijk. De globale verschuiving is geen vierde lokale
wijziging. Correct: alle drie lokale wijzigingen, het nieuwe blad en beide
bladparen kloppen; onterechte meldingen apart tellen. Het manifest is de
machineleesbare sleutel, coördinaten vanaf linksonder.

### T2: kalibreren en meten

Open M01, kalibreer uitsluitend op de lijn '5000 mm'. Meet daarna de onafhankelijke
CHECK-lijn en de binnenmaat van de R1-rechthoek: breedte, hoogte en oppervlakte.
Sla een PDF op met zichtbare waarden en een tekst/CSV met eenheden. De klok
omvat ook omrekenen als het product alleen andere eenheden kan tonen.

Correct: CHECK 7500 mm, R1 4700 x 5200 mm, 24,44 m². Toleranties zijn
±10 mm per lengte en ±0,10 m² voor oppervlakte. Meet op lijnmiddens.
De toleranties zijn vooraf vastgelegd voor handmatig aanklikken; pas ze niet
achteraf aan een product aan. De nominale schaal is 1:50, maar kalibreren
blijft verplicht. Gebruik CHECK nooit als tweede kalibratie om een fout te maskeren.

### T3: tellen en herindelen

Open een schone M01, tel de cirkels als groep A en de vierkanten als groep B.
Leg de oorspronkelijke totalen vast, verwijder de telling bij A6 (niet het
bronobject) en wijs de telling bij A2 opnieuw toe aan B. Lever een PDF met
zichtbare telmarkeringen en groepslegenda plus de eindtotalen als tekst/CSV.
Een losse handmatig getypte totaaltabel zonder corresponderende markeringen
voldoet niet. Noteer als het product geen echte telgroepen heeft en een
handmatige route nodig is; rapporteer dat los van de automatische route.

Correct: eerst A=6/B=4; na verwijderen A=5/B=4; na herindelen A=4/B=5,
totaal 9. A6 heeft geen telmarkering; A2 behoort tot B. Controleer lidmaatschap
en posities, niet alleen de som. Brontekeningen zelf moeten behouden blijven.

## Opslaan, heropenen en rapporteren

Na de gemeten taak controleert de beoordelaar de uitvoer in een ander
beschikbaar product/viewer op dezelfde machine, met exacte viewer-versie.
Leg deze verificatietijd apart vast. Geen beschikbare tweede viewer betekent
`NOT_VERIFIED`, niet geslaagd. Controleer pagina's, zichtbare markeringen,
waarden/eenheden, groepslegenda en overeenkomst met de tekst/CSV. Heropen ook
in het bronproduct om bewerkbaarheid en groepslidmaatschap te controleren;
een afgevlakte export mag visueel correct zijn maar bewijst geen bewerkbare groepen.
Bewaar originelen, uitvoerhashes, screenshots en eventuele foutlogs per run.

`fixtures/construction-study/runs.csv` bevat negen expliciet ontbrekende
product/taakcombinaties. Kopieer deze voor uitvoering en voeg daarna per
herhaling een rij toe (1, 2, 3); vervang ontbrekende regels niet door nulmetingen.
Lege tijden/aantallen betekenen onbekend. Geldige statussen: `NOT_RUN`,
`COMPLETE`, `FAILED`, `TIMEOUT`, `UNSUPPORTED_EDITION`. Juistheid staat apart
als `PASS`, `FAIL` of `NOT_VERIFIED`; een voltooide taak kan fout zijn.

Rapporteer per product/taak alle drie ruwe tijden, aantal geslaagde pogingen,
mediaan en min/max uitsluitend van correcte, voltooide runs. Geen mediaan bij
minder dan drie correcte runs zonder expliciete waarschuwing voor de kleine
steekproef. Toon mislukkingen en hulp naast de tijden; verwijder geen uitschieters.
Maak geen universele snelheidsclaim uit deze kleine, geleerde taken.

Koppel een waargenomen fout eerst aan bestaand werk: tellen #935/#934,
meten #884 en #982, vergelijken #465. Noteer of de geteste **release** de
bijbehorende fix bevat. Een nieuwe bug krijgt een aparte minimale reproductie
met verwacht/werkelijk gedrag; geen dubbel issue voor hetzelfde probleem.

## Huidige conclusie en resterend werk

Alle productruns ontbreken: deze Linux-werkplek is geen gemeenschappelijke
Windows-testmachine en rechtmatige toegang tot de twee vergelijkingsproducten
is niet vastgesteld. Ook de huidige gepubliceerde OPS-release is in dit
protocol nog niet getest. De fixturetests hieronder zijn de enige uitgevoerde
controles. Promoot daarom nog geen vergelijkende workflowclaim. Welke blocker
als eerste moet worden opgelost en of gebruikers daadwerkelijk overstappen,
blijft onbeantwoord totdat correcte uitvoer, waargenomen fouten en gebruiksdata
beschikbaar zijn. Dit pakket maakt #942 uitvoerbaar maar sluit het issue niet.

## Reproduceren van fixturecontroles

Vanaf de repositoryroot, met Python 3.10+ in een eigen virtuele omgeving:

```sh
python -m pip install -r scripts/construction-study/requirements.txt
python -m unittest discover -s scripts/construction-study -p 'test_*.py' -v
python scripts/construction-study/generate.py --output /tmp/construction-fixtures
pdftoppm -png fixtures/construction-study/measure-count.pdf /tmp/measure-count
```

De tests parsen de opgeslagen PDF's onafhankelijk met pypdf, controleren
SHA-256, paginaformaat, echte lijnlengten en oppervlakte, telobjecten,
bladparen, verschuiving en de drie revisiewijzigingen. Regeneratie moet exact
dezelfde PDF-bytes en hetzelfde manifest opleveren met de vastgelegde versie.
Visuele controle blijft nodig: render alle zes pagina's met Poppler en controleer
leesbaarheid, posities en ontbrekende/clippende tekens. In deze voorbereiding
zijn alle zes pagina's gerenderd en bekeken; een ingesloten font voorkomt
afhankelijkheid van lokale vervangingsfonts.
