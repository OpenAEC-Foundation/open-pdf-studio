# Tijdelijk pannen met de spatiebalk

Bij een geopend document: houd **Spatie** ingedrukt en sleep met de
linkermuisknop in het PDF-gebied. Het gekozen gereedschap en de selectie
blijven behouden. Laat de muisknop los om opnieuw te slepen; laat Spatie los
om terug te keren naar het gereedschap. Een resterende muisbeweging of klik
van dat pan-gebaar maakt geen annotatie en volgt geen PDF-link.

Dit gebruikt dezelfde panlogica als de middelmuisknop, zowel voor enkele
pagina's als voor doorlopende, boek- en naast-elkaarweergaven. **Ctrl+wiel**
zoomt al in en uit, ook met een tekengereedschap actief.

Spatie blijft beschikbaar voor tekstvelden, formulierinvoer, bewerkbare tekst
en gefocuste knoppen. Dialoogvensters en lopende teken-, sleep-, verplaats- of
draaibewerkingen starten geen tijdelijke pan. Vergelijkingsweergaven houden
hun eigen bediening. Focusverlies, een verborgen venster, een verloren
pointervangst of een geannuleerd gebaar beëindigt de pan. De handcursor geldt
alleen in het PDF-gebied.

## Controle

- `node --test js/tools/space-pan.test.mjs`: eigenaarschap van het gebaar,
  toetsherhaling, invoerbewaking, loslaten, verloren focus/vangst, tabwissel,
  linkklikken en geen neveneffecten op andere muisgebaren.
- `node scripts/test-space-pan-browser.mjs`: echte PDF in Chromium, slepen in
  vier weergaven, Spatie vóór de muisknop loslaten, behoud van gereedschap en
  annotaties, Ctrl+wiel en tekstinvoer.

De browsertest opent een eigen tijdelijke browser en gebruikt een synthetische
PDF. De geïnstalleerde Windows- en macOS-webviews zijn hiermee niet gekwalificeerd.
