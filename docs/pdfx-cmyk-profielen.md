# PDF/X-export met een CMYK-drukprofiel

Bij **Bestand → Exporteren → Exporteren als PDF/X** kies je naast de
conformiteit (PDF/X-3 of PDF/X-4) ook een **uitvoerprofiel**:

- **sRGB — geen omzetting** (standaard). De export voegt een sRGB-output-intent,
  TrimBox en PDF/X-metadata toe en laat alle kleuren zoals ze zijn. Dit is
  precies het gedrag van vóór deze functie.
- **Een CMYK-drukprofiel**. De app zet eerst alle RGB-kleur om naar CMYK met dat
  profiel en neemt het profiel daarna op als output-intent. Na de export volgt
  een verslag: wat is omgezet en wat niet, met de reden.

De app levert zelf **geen** CMYK-profiel mee. Het juiste profiel hangt af van
de pers en het papier, en dat weet je drukkerij.

## Een profiel krijgen

1. **Vraag het profiel op bij je drukkerij.** Die weet op welke pers en welk
   papier je werk gedrukt wordt en levert daar een ICC-profiel (`.icc` of
   `.icm`) bij.
2. **Geen drukkerij-profiel?** Branche-organisaties voor drukwerk publiceren
   vrij te gebruiken profielsets voor de gangbare drukcondities (gestreken en
   ongestreken papier, krantenpapier, enzovoort). Kies het profiel dat past bij
   het papier waarop gedrukt wordt.

Alleen een profiel voor een **uitvoerapparaat** met de kleurruimte **CMYK** telt
(in het ICC-kopblok: klasse `prtr`, kleurruimte `CMYK`). Kies je een ander
bestand, dan meldt de app waarom het niet bruikbaar is.

## Waar je het profiel neerzet

Profielen in de kleurmap van het systeem verschijnen vanzelf in de keuzelijst
(ook in submappen):

| Systeem | Map |
|---|---|
| Windows | `%WINDIR%\System32\spool\drivers\color` — rechtsklik op het profiel en kies *Profiel installeren*, dan komt het hier terecht |
| macOS | `/Library/ColorSync/Profiles`, `~/Library/ColorSync/Profiles` of `/System/Library/ColorSync/Profiles` |
| Linux | `/usr/share/color/icc`, `~/.local/share/icc` of `~/.color/icc` |

Staat het profiel ergens anders, kies dan **Bestand kiezen…** onderaan de lijst.
De app onthoudt de laatste keuze.

## Rendering intent

- **Relatief colorimetrisch met zwartpuntcompensatie** (standaard): kleuren die
  de pers kan maken blijven zo dicht mogelijk bij het origineel; kleuren
  daarbuiten worden naar de dichtstbijzijnde drukbare kleur gebracht. Wit blijft
  papierwit, zwart wordt het diepste zwart van het profiel. Goed voor
  tekeningen, logo's en huisstijlkleuren.
- **Perceptueel**: alle kleuren schuiven samen op zodat de onderlinge
  verhoudingen blijven. Soms rustiger bij foto's met veel verzadigde kleuren.

## Wat er wordt omgezet

- Kleuren in tekeningen en tekst (`rg`/`RG` en `sc`/`scn` in RGB) in pagina's,
  Form XObjects, annotatie-uiterlijken en patronen. Grijs blijft grijs.
- Benoemde RGB-kleurruimten in de resources.
- Afbeeldingen in RGB, ICC-RGB en Indexed op RGB-basis (bij Indexed alleen het
  palet). Afbeeldingen die als JPEG binnenkwamen gaan terug als CMYK-JPEG
  (kwaliteit 92); de rest als verliesvrij gecomprimeerde afbeelding.
- Afbeeldingen die in de inhoud zelf staan.
- Kleurverlopen (lineair en radiaal) met een exponentiële of een samengestelde
  functie.
- Transparantiegroepen en de achtergrondkleur van zachte maskers.

RGB met een ingebed ICC-profiel wordt omgezet vanuit dát profiel; gewone RGB
wordt als sRGB gelezen.

## Wat niet, en blijft dus RGB

Het verslag noemt deze gevallen met aantal en reden:

- mesh- en functieverlopen, en verlopen met een bemonsterde of
  PostScript-functie;
- steunkleuren (Separation of DeviceN) met een RGB-alternatief;
- afbeeldingen in JPEG 2000 of met LZW-compressie, en afbeeldingen met een
  kleursleutelmasker;
- de kleuren in annotatie-eigenschappen (`/C`, `/IC`) en standaarduiterlijken
  van formuliervelden; bij afdrukken telt het uiterlijk, en dat wordt wel
  omgezet.

Niet-ingebedde standaardlettertypen blijven een beperking voor een strikte
PDF/X-controle. Wil je zekerheid, exporteer dan eerst als **Raster-PDF** en
daarna als PDF/X.

## Bestandsgrootte en tijd

Omgezette afbeeldingen worden opnieuw opgeslagen, met vier kanalen in plaats
van drie. Een bestand met veel foto's of gescande tekeningen wordt daardoor
groter; groeit het meer dan twee keer, dan staat dat in het verslag. Grote
bestanden kosten ook tijd: de laadmelding telt de pagina's af.

## Webversie

Omzetten naar CMYK gebeurt in de bureaubladapp. In de webversie staat de
PDF/X-export uit en toont de app de melding dat dit alleen in de
bureaubladversie werkt.
