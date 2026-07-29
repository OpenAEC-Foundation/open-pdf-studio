# Vector-PDF zoom performance research

## Doel

Verlaag de zichtbare wachttijd bij inzoomen en pannen in grote vector-PDF's,
zonder renderkwaliteit, stabiliteit of geheugengebruik te verslechteren.

De primaire verificatiebestanden zijn:

- `MV-03_Mechanische ventilatie, 3e verdieping ontwerp ACH van 1,5 naar 2,0.pdf`
- `NKD1a_opm_aw.pdf`

## Succescriterium

Een productiewijziging blijft alleen behouden wanneer dezelfde benchmark op
beide bestanden:

- minimaal 10% reproduceerbare verbetering laat zien in de primaire metric;
- geen statistisch relevante verslechtering op het andere bestand veroorzaakt;
- geen zichtbare renderregressie veroorzaakt;
- geen onaanvaardbare stijging in piekgeheugen veroorzaakt.

De primaire metric is de tijd vanaf een zoomopdracht tot de eerste scherpe,
juiste weergave van het zichtbare gebied. Open-tijd en tijd tot volledige
pagina-opbouw zijn secundaire metrics.

## Meetprotocol

Elke kandidaat wordt vergeleken met dezelfde ongewijzigde nulmeting.

Per PDF:

1. Start de development-build schoon.
2. Open het bestand en wacht tot de actieve pagina stabiel is.
3. Meet een vaste reeks op de relevante zware pagina:
   100% naar 150%, 200% en 300%, gevolgd door een pan en terug naar 100%.
4. Voer minimaal vijf meetruns uit, waarvan de eerste als koude run apart
   wordt gerapporteerd.
5. Rapporteer mediaan en p95 voor:
   queue-wachttijd, page-load/parse, native render, IPC-overdracht,
   bitmapconversie en totale zichtbare latency.
6. Registreer piek-RSS van hoofdproces en PDF-workers.
7. Vergelijk de uiteindelijke render met de nulmeting op dezelfde viewport.

MCP bestuurt de app en verzamelt de bestaande performance-uitvoer. Wanneer
een fase nog niet afzonderlijk meetbaar is, mag eerst alleen meetinstrumentatie
worden toegevoegd. Instrumentatie verandert geen enginebeleid.

## Gefaseerde hypotheses

Elke fase test precies één hoofdhypothese. Een volgende fase start pas nadat
de vorige wijziging is behouden of volledig is teruggedraaid.

### Fase 0 — nulmeting

Leg de huidige zoomlatency, taakverdeling en het geheugenprofiel vast. Er
wordt nog geen rendergedrag gewijzigd.

### Fase 1 — taakprioriteit en annulering

Hypothese: niet-zichtbare of achterhaalde renders blokkeren werk voor de
actieve viewport. Test eerst of queue-wachttijd een materieel deel van de
zoomlatency vormt. Voeg alleen dan prioritering of cancellation toe.

### Fase 2 — adaptieve worker-affinity

Hypothese: MV-03 verliest tijd en geheugen doordat meerdere workers dezelfde
zware pagina laden, terwijl NKD1a mogelijk profiteert van parallelle tegels.
Vergelijk één warme worker met de bestaande spreiding en kies per gemeten
page-profiel.

### Fase 3 — tegelpublicatie

Hypothese: het herhaald maken van een volledige `ImageBitmap` na een gewijzigde
tegel veroorzaakt merkbare main-thread- en geheugenlatency. Vergelijk de
huidige accumulator met directe compositie van afzonderlijke tegels.

### Fase 4 — PDFVM-scene-index

Hypothese: iedere tegel scant te veel scenechunks. Voeg alleen een ruimtelijke
index toe wanneer profiling bevestigt dat chunkselectie/replay dominant is.
Painter's order en de bestaande renderuitvoer blijven behouden.

### Fase 5 — scene-resources

Hypothese: herhaald decoderen van afbeeldingen en opnieuw opbouwen van clips
is dominant op pagina's die fase 4 niet voldoende versnelt. Cache resources
per scene, uitsluitend na afzonderlijk bewijs.

## Kwaliteits- en terugdraairegels

- Eén gedragswijziging per benchmarkcommit.
- Eerst een falende performance- of gedragstest, daarna minimale productiecode.
- Een kandidaat zonder overtuigende winst wordt teruggedraaid.
- Geen brede refactor tijdens het onderzoek.
- Geen wijziging van de standaardengine zonder corpusbrede renderverificatie.
- Geen merge of pull request voordat de twee primaire PDF's én de bestaande
  regressiesuite slagen.

## Verwachting

De voorafgaande statische analyse geeft als onderzoekshypothese:

- NKD1a: 25–45% kortere zichtbare zoomlatency;
- MV-03: 40–65% kortere zichtbare zoomlatency.

Dit zijn geen acceptatieclaims. De nulmeting en gefaseerde A/B-metingen bepalen
welke winst daadwerkelijk haalbaar is.
