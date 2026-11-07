# Geheugen van pdf-lib bij gesloten documenten (#988)

## Probleem en wijziging

pdf-lib 1.17.1 bewaart alle `PDFName`- en `PDFRef`-instanties in twee globale
sterke Maps. Het sluiten van een document maakt die objecten niet vrij. De
nieuwe Vite-plugin vervangt uitsluitend deze twee pools, vóór het uitvoeren
van de dependency. De originele `.of()`-methoden, naamdecodering en vooraf
geïnitialiseerde constante namen blijven intact.

Elke pool bewaart een WeakRef per sleutel. Zolang een document een object
gebruikt, levert `.of()` dezelfde instantie terug. Een FinalizationRegistry
ruimt de sleutel op nadat het object verzameld is. De opruimcallback houdt
alleen sleutel en WeakRef vast, nooit het object. Een callback verwijdert
uitsluitend zijn eigen entry: een vertraagde callback kan geen nieuwe
instantie met dezelfde sleutel verwijderen. Bij vervanging wordt de oude
registratie afgemeld.

De patch geldt voor productie (Rollup) én dependency-optimalisatie in dev
(esbuild), voor desktop, hosted en de losse web-unit. De twee dependency-
bronbestanden worden op exacte SHA-256 gecontroleerd; een gewijzigde bron
vereist herkwalificatie. `node_modules` wordt niet gewijzigd. Node-tools die
rechtstreeks de CommonJS-dependency laden, krijgen deze browserpatch niet.

## Compatibiliteit en grenzen

Beide API's zijn vereist. Volgens de [MDN compatibiliteitsgegevens voor WeakRef](https://github.com/mdn/browser-compat-data/blob/main/javascript/builtins/WeakRef.json)
en [FinalizationRegistry](https://github.com/mdn/browser-compat-data/blob/main/javascript/builtins/FinalizationRegistry.json)
zijn objectverwijzingen ondersteund vanaf Chromium/Android WebView 84 en
Safari 14.1 (Firefox 79). Feature-detectie is doorslaggevend voor WebKitGTK;
er wordt geen niet-geteste distributieversie beloofd. Oudere engines vallen
veilig terug op de oorspronkelijke sterke Map: de geheugenmitigatie geldt
daar niet, maar lookup en documentintegriteit blijven behouden.

Garbage collection en finalizers zijn niet deterministisch. Dit is geen
harde heaplimiet en geen garantie dat geheugen direct bij sluiten wordt
teruggegeven. Nog levende documenten, onafgeronde taken en andere caches
kunnen objecten terecht vasthouden. De wijziging introduceert geen nieuwe
annulering van lopende parses of limiet op decoderpiekgeheugen. Een native
Tauri-WebView-meting met heap-snapshots en afzonderlijke worker-RSS blijft
nodig voor volledige acceptatie van #988; Chromium-bewijs vervangt die niet.

## Reproduceerbare controles

Vanuit `open-pdf-studio`:

```
node --test scripts/pdf-lib-intern-pools.test.mjs
node scripts/pdf-lib-intern-browser.mjs
```

De eerste controle test ook een vertraagde finalizer, vervanging en ontbrekende
API's. Vervolgens worden echte documenten aangemaakt, opgeslagen en geparsed:
twee blijven leven, drie andere worden na elkaar vrijgegeven. Elk document
heeft 6.000 verschillende namen en een eigen bereik referentienummers.
WeakRefs controleren het verzamelen van zowel namen als referenties.
Lookup (ook een hex-gecodeerde naam), pagina's kopiëren en save/reopen blijven
werken. Dezelfde proef tegen de ongewijzigde dependency bevestigt dat beide
objectsoorten vastgehouden worden. De test houdt zelf geen namen of
referenties van het open document vast: de vergeleken instanties komen na de
GC uit diens eigen woordenboek, zodat identiteit alleen uit het open document
kan volgen.

Een tweede proef meet de omvang van beide pools zelf (via een testhaakje op
de module-variabele `pool`): naast één open document worden twaalf documenten
met elk 2.000 eigen namen en referenties geopend en weer losgelaten. Met de
patch blijven beide pools op de levende set (circa 2.000 sleutels), zonder
patch groeien ze met elk gesloten document mee (circa 26.000). De proeven
gebruiken dezelfde partijgrootte als de app (`pdf-lib-snelheid.js`, 5.000
objecten per tik); met de pdf-lib-standaard duurde de reeks ruim een minuut.

Er is geen expliciete opruimstap bij het sluiten van een tabblad nodig en die
zou ook onjuist zijn: de app houdt pdf-lib-documenten alleen tijdelijk vast
(per opslag- of paginabewerking), niet per tabblad, en het leegmaken van een
pool zou een nog levend document een andere instantie voor dezelfde naam
geven. Zodra een pdf-lib-document onbereikbaar is, mag de GC zijn namen en
referenties opruimen.

Lokale Node 24-proef, bytes heapUsed na geforceerde GC, 6 november 2026:

| ronde | met patch | ongewijzigde dependency |
| --- | ---: | ---: |
| 1 | 19.921.896 | 17.588.816 |
| 2 | 21.200.976 | 21.852.888 |
| 3 | 21.245.728 | 25.159.424 |

De zwakke administratie heeft overhead. Het bewijs is vooral dat dode
instanties verzameld kunnen worden terwijl levende identiek blijven; deze
kleine synthetische proef bewijst geen algemene RSS-winst.

De browsercontrole start zelf een geïsoleerde Vite-server (poort 32888),
tijdelijke optimizer-cache en headless Chromium, zonder HMR. Hij sluit
uitsluitend die eigen processen. In Chromium 147.0.7727.15 zijn namen en
referenties in alle drie rondes verzameld; twee documenten bleven geldig.
Gemeten JS-heap na GC: 10.299.456 / 10.360.212 / 10.355.800 bytes. Dit is een
browserproef van de werkelijke Vite dependency-route, geen bediening van de
native app of meting van native workers.

Verder is één bestaande typefout op upstream main hersteld: de al gebruikte
telannotatie `count` ontbrak in `AnnotationType`. Zonder die aanvulling faalde
`tsc` op de selectiekader-tak uit de recente integratie. Het gedrag van
selectie of tellen verandert hierdoor niet.

Aanvullende lokale controles: volledige unitlijst 7.596 geslaagd, 34
omgevingsafhankelijke skips, 0 fouten; TypeScript zonder fouten na de
`count`-typeaanvulling; 25 projectcontroles geslaagd. Vite desktop, hosted en
web-unit bouwen alle drie succesvol. De vier nieuwe regressietests zijn
ook afzonderlijk met de ongewijzigde dependency als controle uitgevoerd.
Native installer- en Tauri-lifetimekwalificatie zijn nog niet afgerond.

## Platformcontrole van de testhulp

De eerste Windows-CI-run kon `pdf-lib` niet vinden in de esbuild-testbundel.
De test gebruikte een URL-`pathname` als bestandssysteempad: op Windows heeft
dat een extra slash voor de schijfletter; spaties blijven ook URL-gecodeerd.
Alle omzettingen in de test gebruiken nu Node `fileURLToPath`. Dezelfde
fout is lokaal gereproduceerd in een tijdelijke map met een spatie: de oude
test faalt met `Could not resolve "pdf-lib"`, de aangepaste test slaagt in
alle vier gevallen. De 29 regressie- en projectcontroles slagen ook. Dit is
geen claim dat de nieuwe Windows-CI-run al is afgerond.
