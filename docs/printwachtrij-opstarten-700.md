# Openstaande printopdrachten bij het starten (#700)

## Hersteld gedrag

Wanneer de Windows-printer al opdrachten heeft opgevangen voordat Open PDF
Studio wordt geopend, presenteert de app die opdrachten nu bij het starten in
het bestaande printwachtrijvenster. Een bestaand venster wordt getoond en
gefocust; anders wordt het venster aangemaakt. De bekende bestandsnamen blijven
opgeslagen zodat dezelfde opdrachten niet iedere 2,5 seconden opnieuw het
venster openen. Een volgende nieuwe opdracht activeert het venster wel.

Voorheen haalde `startPrintQueueWatcher()` de opdrachten op en markeerde ze
meteen als bekend, zonder het venster te openen. Daardoor kon ook handmatig
starten van de app de achtergebleven opdrachten onzichtbaar laten.

## Reproductie en testbewijs

De regressietest biedt via de Tauri-grens een bestaande `job_100.pdf` aan en
controleert of de echte store de venster-API aanroept. Zonder de wijziging
falen vier van de vijf nieuwe gevallen; het lege/missende-printergeval slaagt.
Met de wijziging slagen alle vijf. De overige gevallen controleren hergebruik
van een bestaand venster, geen herhaald openen bij dezelfde lijst, nieuwe
opdrachten en opnieuw starten van de watcher. De test verwijdert geen bestanden
of printopdrachten en raakt geen Windows-printers of -instellingen aan.

```sh
cd open-pdf-studio
node --test js/solid/stores/print-queue-startup.test.mjs \
  js/solid/stores/print-queue-model.test.mjs \
  js/pdf/printerlijst-afnemers.test.mjs js/pdf/printerlijst-bron.test.mjs
```

57 gerichte tests slagen. De nieuwe suite staat in de reguliere unit-testlijst.
Dit bewijst de storelogica met gesimuleerde IPC en venster-API, geen echte
Windows-installatie of printerdriver.

## Openstaande delen van #700

Dit is een deeloplossing. De app wordt nog **niet automatisch gestart** door
een printopdracht als zij gesloten is. Daarvoor is een afzonderlijke listener
of portmonitor nodig. Een listener moet onder de interactieve gebruiker draaien,
het bestaande single-instance-pad benutten en snelle opdrachten samen tonen.
Installeren, aanpassen en verwijderen hoort bij het bestaande expliciete
installatie-/elevatiepad, niet bij een automatische ontwikkeltest.

Het huidige bestandspoortmodel gebruikt één `spool/latest.pdf`. Alleen elke
paar seconden pollen garandeert niet dat twee snel opeenvolgende opdrachten
behouden blijven: de volgende opdracht kan hetzelfde bestand al overschrijven.
Een robuuste listener vereist daarom ook een gecontroleerde overdracht per
opdracht (bijvoorbeeld een geschikte portmonitor), niet alleen een extra
opstartcommando. Onderzoek dit vóór een belofte dat nooit opdrachten verloren gaan.

Nog te kwalificeren in een Windows-VM: gesloten app, al draaiende app, twee
snelle opdrachten, nog vergrendeld bestand, uitloggen/inloggen, installeren en
verwijderen, ontbrekende executable en falend starten/tonen van het venster.
Bij fouten moeten bewaarde opdrachten beschikbaar blijven met een zichtbare
melding. Het huidige pad heeft nog geen betrouwbare bevestiging dat het
wachtrijvenster werkelijk zichtbaar is; de wijziging claimt die garantie niet.

Ook de huidige typecontrole is niet groen op upstream main: in
`selection-helpers.ts` levert de `count`-tak TS2678 op doordat `AnnotationType`
`count` nog niet bevat. De betreffende correctie staat al in
[PR #989](https://github.com/OpenAEC-Foundation/open-pdf-studio/pull/989).
Deze deeloplossing dupliceert die wijziging niet. Issue #700 blijft open.
