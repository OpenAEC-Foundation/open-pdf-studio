# Vector-PDF-zoomonderzoek — 29 juli 2026

## Scope

Onderzocht op branch `codex/research-improvement-vector` met:

- `MV-03_Mechanische ventilatie, 3e verdieping ontwerp ACH van 1,5 naar 2,0.pdf`, pagina 1;
- `NKD1a_opm_aw.pdf`, pagina 2;
- een vers app-proces per run;
- de zoomreeks 100%, 150%, 200% en 300%;
- screenshot-hashes, renderlogboek en app-/worker-RSS per stap.

De ruwe JSON-resultaten en PNG's staan buiten de repository in:

`C:\Users\rickd\Documents\GitHub\verification-files\performance\vector-zoom-baseline`

## Correctie van de meetmethode

Een deel van de vroege verkennende runs is niet gebruikt voor de conclusies.
Daar waren twee redenen voor:

1. een rechtstreeks gestart debugproces kon nog aan een andere lokale
   dev-frontend gekoppeld zijn;
2. een tegel met dezelfde CSS-zoom is niet automatisch schermscherp. Bij een
   device-pixel-ratio van 1,5 moet een 200%-weergave bijvoorbeeld minstens op
   renderschaal 3 zijn opgebouwd.

De definitieve benchmark:

- draait uitsluitend tegen de research-frontend op poort 3042;
- bepaalt het app-proces via de MCP-poort;
- accepteert boven de 4096-pixelgrens alleen een tegel waarvan de vastgelegde
  `renderScale` de gevraagde zoom maal device-pixel-ratio dekt;
- verwerpt time-outs, ontbrekende screenshots en visueel identieke zoombeelden.

Daarom zijn alleen de hieronder genoemde gecontroleerde runs beslissend.

## Bevindingen en wijzigingen

### 1. Eén scene-probe per zware pagina

Commit: `a3f619f4`

Voor dezelfde pagina startten vier tegels gelijktijdig dezelfde scene-extractie.
Na overschrijding van het commandobudget vielen alle vier terug op een volledige
PDFium-parse. De scene-coördinator deelt nu één probe en één bekende foutstatus
per pagina.

Resultaat: vier gelijktijdige probes zijn teruggebracht tot één.

### 2. Extreme fallback op één affinity-worker

Commit: `bad13f56`

Een extreme pagina werd door vier workers afzonderlijk geparsed. De fallback
voor zulke pagina's blijft nu op één worker. Normale en middelzware pagina's
houden het bestaande gespreide workerpad.

Het oorspronkelijke diagnoseprofiel piekte rond 5,16 GB worker-RSS. De
definitieve MV-runs blijven rond 1,33 GB: ongeveer 74% minder workergeheugen.

### 3. Resolutiebewuste zoomtegelcache

Commit: `c1496f84`

150% en 200% kunnen op een scherm met schaalfactor 1,5 dezelfde power-of-two
cachebucket krijgen. Voorheen kon de eerste tegel op renderschaal 1,5 onder die
bucket worden opgeslagen en later op 200% worden hergebruikt. Dat beeld was te
laag in resolutie en kon de nieuwe aanvraag bovendien steeds `stale` maken.

De cache:

- registreert nu de werkelijke `renderScale`;
- hergebruikt een tegel alleen als die de gevraagde schermresolutie dekt;
- dedupliceert identieke gelijktijdige aanvragen zonder de actieve aanvraag
  ongeldig te maken;
- vervangt een te kleine tegel veilig en sluit de oude bitmap;
- prewarmt adaptief: voldoende voor de volgende gebruikelijke zoom, zonder
  altijd de volledige bovengrens van de bucket te renderen.

## Definitieve resultaten

Alle tijden zijn medianen van verse processen. De adaptieve eindvariant is
vergeleken met een eveneens scherpe referentie die altijd de volledige
power-of-two-bucket rendert.

### MV-03, pagina 1

| Metriek | Volledige bucket (5 runs) | Adaptief (3 runs) | Verschil |
|---|---:|---:|---:|
| Openen | 13.845 ms | 13.425 ms | 3,0% sneller |
| Volledig initial-ready | 13.853 ms | 13.434 ms | 3,0% sneller |
| Scherp op 150% | 1.149 ms | 1.072 ms | 6,7% sneller |
| Scherp op 200% | 956 ms | 941 ms | 1,6% sneller |
| Scherp op 300% | 1.178 ms | 1.169 ms | 0,8% sneller |
| Zoomreeks 150–300% | 3.272 ms | 3.225 ms | 1,4% sneller |
| Worker-RSS | 1.339,7 MB | 1.329,7 MB | 0,7% lager |

In de gecontroleerde toestand vóór de resolutiefix liep 200% reproduceerbaar
tegen de limiet van 120 seconden. De eindvariant levert die stap mediaan in
941 ms: meer dan 99% minder wachttijd voor dit concrete foutpad.

Eén van de drie eindruns had op 300% een cold-renderuitschieter van 4.919 ms.
De andere twee waren 1.169 en 1.163 ms. Dit blijft zichtbaar in de ruwe
resultaten en wordt niet weggefilterd.

### NKD1a, pagina 2

| Metriek | Volledige bucket (5 runs) | Adaptief (3 runs) | Verschil |
|---|---:|---:|---:|
| Openen | 1.025 ms | 1.013 ms | 1,2% sneller |
| Volledig initial-ready | 1.062 ms | 1.054 ms | 0,8% sneller |
| Scherp op 150% | 2.901 ms | 2.759 ms | 4,9% sneller |
| Scherp op 200% | 917 ms | 942 ms | 2,7% langzamer |
| Scherp op 300% | 1.301 ms | 1.172 ms | 9,9% sneller |
| Zoomreeks 150–300% | 5.651 ms | 5.041 ms | 10,8% sneller |
| Worker-RSS | 508,3 MB | 492,4 MB | 3,1% lager |

De kleine afwijking op de afzonderlijke 200%-stap valt binnen de runspreiding.
Over de volledige scherpe zoomreeks is de eindvariant 10,8% sneller en gebruikt
zij minder geheugen. Er is dus geen meetbare regressie op dit bestand.

## Conclusie

De drie productwijzigingen blijven behouden:

- de dubbele scene-analyse is verwijderd;
- extreme pagina's vermenigvuldigen hun parsegeheugen niet meer over vier workers;
- zoomtegels worden alleen hergebruikt als hun echte pixeldichtheid volstaat.

Voor het zware MV-bestand is het vastlopende 200%-pad teruggebracht tot ongeveer
één seconde en het workergeheugen met circa 74% verlaagd. Voor NKD1a verbetert
de totale scherpe zoomreeks met circa 11%. Het openen van MV blijft met ongeveer
13,4 seconden de grootste resterende kandidaat voor een volgende, afzonderlijke
hypothese.

## Vervolgmeting: HiDPI-grens en extreme pagina's

De volgende afzonderlijke fase vond een fout in zowel productroute als
benchmark. De 4096px-limiet van de whole-page-bitmap werd alleen met de
CSS-zoom vergeleken. Op een scherm met device-pixel-ratio 1,5 kon een
whole-page-bitmap daardoor bij 100% als scherp gelden, terwijl daarvoor
renderschaal 1,5 nodig was.

De aanpassing:

- vergelijkt `zoom × devicePixelRatio` met de whole-page-limiet;
- gebruikt boven die grens een zichttegel in plaats van nog een volledige,
  maar onvermijdelijk te laag bemonsterde pagina op te bouwen;
- slaat de extra whole-page-run alleen over voor de bestaande extreme
  contentklasse boven 6 MB;
- laat middelzware pagina's op het bestaande progressieve pad;
- past dezelfde HiDPI-eis toe in de benchmark, zodat een onscherpe
  whole-page-bitmap niet meer als voltooid wordt geteld.

### MV-03

Drie verse processen gaven:

| Metriek | Mediaan |
|---|---:|
| Openen | 13.621 ms |
| Scherp op 100% | 4.539 ms |
| Scherpe zoomreeks 150–300% | 3.215 ms |

De 100%-tijd bevat de conservatieve stabilisatiewacht van de benchmark.
De workertrace laat voor het eigenlijke renderwerk één zichtregio van circa
1,65 s zien. Het oude pad bouwde twaalf whole-page-regio's op in circa 3,2 s
en bereikte desondanks niet de vereiste HiDPI-renderschaal. Het renderwerk is
daarmee ongeveer 48% korter en het resultaat haalt nu aantoonbaar
renderschaal 1,5.

De 150–300%-reeks blijft praktisch gelijk aan de vorige geldige MV-mediaan:
3.215 ms tegenover 3.225 ms.

### NKD1a

Voor NKD is een directe A/B met drie verse processen per variant uitgevoerd,
onder exact dezelfde aangescherpte HiDPI-eis:

| Variant | Openen | Scherpe zoomreeks 150–300% |
|---|---:|---:|
| Ongewijzigde productroute | 1.075 ms | 7.287 ms |
| Klassebeperkte HiDPI-route | 1.068 ms | 7.298 ms |

Het verschil in de zoomreeks is 0,15% en daarmee praktisch nul. De
productroute voor dit middelzware bestand is bewust ongewijzigd. De eerder
genoemde 5.041 ms is niet rechtstreeks vergelijkbaar: die meting kon op
HiDPI een te laag bemonsterde whole-page-bitmap accepteren.

### Onderzochte maar verworpen varianten

Deze varianten zijn niet behouden:

- semantische lagen uitstellen: sneller terugkeren uit openen, maar de eerste
  zoomreeks liep op tot 8–11 s;
- de twee annotatie-opvragen delen: openen daalde in een probe van circa
  13,4 s naar 9,3 s, maar de zoomreeks liep op tot circa 9,2 s en een
  heropen-run kon een leeg tussenbeeld vastleggen;
- ook 100% voorverwarmen: dit schoof de 300%-voorwarming naar achteren en
  verslechterde de 150–300%-reeks naar 4.929 ms.

Alleen de klassebeperkte HiDPI-zichttegel en de aangescherpte meetcontrole
zijn daarom behouden.

## GIS-style coverage-cache voor herhaald zoomen

De volgende fase richt zich specifiek op de gebruikssituatie waarin een
zichtregio eenmaal scherp is opgebouwd en daarna vaak tussen 150% en 300%
wordt gezoomd.

De wijziging:

- selecteert tegels op volledige dekking van de zichtbare PDF-regio in plaats
  van alleen op een exacte zoombucket;
- bouwt de brede 150%-regio, wanneer die binnen de 4096px-aslimiet past, op
  met voldoende pixeldichtheid voor 300%;
- houdt zo'n scherpe coverage-tegel actief bij zowel in- als uitzoomen;
- slaat de 150ms beeldbevriezing over wanneer de bestaande tegel de
  toekomstige viewport aantoonbaar scherp en volledig dekt;
- valt bij grotere viewports terug op het bestaande, begrensde renderpad.

De bestaande end-to-endbenchmark vereist per zoomstap minimaal 800ms zonder
nieuwe renderactiviteit. Daardoor kan die benchmark geen interactietijd onder
100ms onderscheiden. Voor deze fase is aanvullend een warme live-meting
uitgevoerd: na het gereedkomen van de eerste scherpe coverage-tegel zijn per
bestand twintig opeenvolgende sprongen 150% â†” 300% uitgevoerd. Een stap telt
alleen als de juiste zoom actief is en de zichtbare PDF-regio volledig wordt
gedekt op minstens `zoom Ã— devicePixelRatio`; daarna wordt nog een frame van
17ms afgewacht.

| Bestand | Stappen | Mediaan | p95 | Minimum | Maximum | Cachemissers |
|---|---:|---:|---:|---:|---:|---:|
| MV-03, pagina 1 | 20 | 38,9 ms | 47,2 ms | 27,2 ms | 62,1 ms | 0 |
| NKD1a, pagina 2 | 20 | 31,4 ms | 32,4 ms | 30,5 ms | 67,6 ms | 0 |

In beide metingen bleef exact dezelfde coverage-tegel actief over alle
zoomstappen. De warme in- en uitzoominteractie blijft daarmee ruim onder de
doelgrens van 100ms. De eerste render van een nog niet gecachte zichtregio
blijft afhankelijk van de complexiteit van de PDF; deze fase verplaatst dat
werk niet naar iedere volgende zoomstap.
