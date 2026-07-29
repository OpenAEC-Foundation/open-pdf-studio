# GIS-style PDF zoom cache

## Doel

Maak herhaald zoomen en terugzoomen op grote vector-PDF's scherp binnen
100 ms zodra de benodigde beeldinformatie eenmaal is gerenderd. Het huidige
beeld mag tijdens interactie direct compositor-geschaald worden, maar de
100 ms-meting eindigt pas wanneer de zichtbare viewport op voldoende
device-pixelresolutie wordt getoond.

De verificatiebestanden blijven:

- `MV-03_Mechanische ventilatie, 3e verdieping ontwerp ACH van 1,5 naar 2,0.pdf`;
- `NKD1a_opm_aw.pdf`.

## Geconstateerde oorzaak

De huidige tile-cache gebruikt maximaal acht grote regio's en zoekt alleen op
een exacte combinatie van zoom-bucket en gesnapte regio-oorsprong. Hij vraagt
niet welke bestaande tegel:

1. het huidige zichtgebied volledig omvat; en
2. voldoende fysieke renderresolutie heeft.

Daardoor kan een reeds scherpe tegel niet generiek worden hergebruikt bij
terugzoomen of bij een andere zoom die door dezelfde tegel wordt gedekt.
Een cache-miss start na 150 ms opnieuw native rasterwerk. De zwaarste pagina
valt bovendien vóór de bestaande vectorscene terug doordat herhaalde
Form-objecten tot meer dan het extractiebudget worden uitgeklapt.

## Ontwerp

### 1. Viewport-cover als cachecontract

Een tegel wordt beschreven door:

- document, pagina en rotatie;
- rechthoek in PDF-punten;
- fysieke renderschaal;
- bitmapafmetingen en geheugenlast;
- laatste gebruiksmoment.

Een tegel is direct bruikbaar wanneer zijn PDF-rechthoek de volledige zichtbare
PDF-rechthoek omvat en `renderScale >= zoom * devicePixelRatio`. De lookup is
niet afhankelijk van de zoom waarop de tegel oorspronkelijk is gemaakt.
Bij meerdere kandidaten wint eerst de kleinste voldoende resolutie en daarna
de kleinste oppervlakte.

Dit maakt beide richtingen symmetrisch: een brede, scherpe tegel kan voor
150%, 200% en 300% worden gebruikt zolang dekking en resolutie voldoende zijn.

### 2. Tile cover en level-of-detail

De pagina krijgt een reguliere tegelmatrix per fysieke renderschaal. Iedere
tegel heeft een stabiele `(level, x, y)`-identiteit. De viewport wordt naar de
tegelmatrix geprojecteerd en vraagt alleen de doorsnijdende tegels op, met één
ring voor de waarschijnlijke volgende pan.

Tijdens een cache-miss blijft een reeds beschikbare parent- of child-tegel
zichtbaar. Alleen ontbrekende of onvoldoende scherpe tegels zijn dirty.
Een zoomwissel maakt bestaande tegels dus niet automatisch ongeldig.

De eerste implementatiefase verandert alleen selectie en hergebruik van
bestaande regiobitmaps. Een vaste tegelmatrix wordt pas geactiveerd wanneer de
A/B-meting bewijst dat coverage-lookup winst geeft en de native backend niet
door extra regio-aanroepen verslechtert.

### 3. Achtergrondopwarming

Na een stabiele viewport wordt uitsluitend het waarschijnlijke zoompad
opgewarmd:

- de huidige viewport plus een kleine rand;
- voldoende resolutie voor de hoogste eerstvolgende zoomstand;
- lagere zoomstanden gebruiken dezelfde tegel door downsampling;
- gebruikersinteractie heeft altijd voorrang en annuleert speculatief werk.

De cache gebruikt een bytebudget in plaats van alleen een itemaantal. Hiermee
blijft de geheugenlast voorspelbaar op HiDPI-schermen.

### 4. Retained vectorscene als afzonderlijke vervolgfase

De structurele backendverbetering bewaart ieder herhaald Form-object eenmaal
en indexeert plaatsingen als instanties met transform en bounding box. Een
packed ruimtelijke index levert alleen instanties die de gevraagde tegel raken.
De gevonden instanties worden in oorspronkelijke PDF-tekenvolgorde afgespeeld.

Deze fase is afzonderlijk omdat zij PDF-semantiek raakt. Zij wordt pas gebouwd
nadat de frontend-cachemeting vaststelt hoeveel latency nog door native
rasterisatie wordt veroorzaakt.

## Interactiepad

1. Zoominput verandert onmiddellijk de cameratransform.
2. De bestaande canvas-snapshot verschijnt in hetzelfde frame.
3. De viewport wordt omgerekend naar PDF-punten en fysieke renderschaal.
4. De cache zoekt coverage in plaats van een exacte zoomsleutel.
5. Bij een hit wordt de scherpe bitmap in de eerstvolgende animation frame
   getoond.
6. Bij een miss blijven parent/child-data zichtbaar en worden alleen dirty
   gebieden met viewportprioriteit aangevraagd.
7. Na rust wordt één toekomstige zoomdekking opgewarmd.

## Meetpoorten

Een productiewijziging blijft alleen behouden wanneer:

- een cache-hit bij 150→300 en 300→150 mediaan maximaal 100 ms tot scherpe
  viewport kost;
- de volledige 150–300–150-reeks na opwarming minimaal 80% sneller is;
- een koude cache niet meer native renderwerk start dan de huidige route;
- cache-RSS binnen een expliciet bytebudget blijft;
- beide verificatie-PDF's visueel gelijk blijven;
- bestaande zoom-, cache- en renderregressietests slagen.

Iedere fase krijgt één benchmarkcommit. Een fase zonder meetbare winst wordt
teruggedraaid voordat de volgende begint.

