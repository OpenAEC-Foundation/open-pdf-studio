# Vakjesvelden en validatie — issue 1306

Een gegenereerde PDF met een comb-veld van twee tekens reproduceerde het probleem:
na het invoeren van één cijfer verscheen ten onrechte een melding dat twee tekens
verplicht waren. MaxLen is een bovengrens. De veld-CSS gebruikte bovendien niet
de vakjesbreedte en uitlijning die PDF.js beschikbaar stelt.

De wijziging gebruikt die breedte en uitlijning, ook bij zoomen en gedeeltelijk
gevulde rechts uitgelijnde velden. Het veld groeit niet meer bij focus. Een comb
is op zichzelf geen numerieke beperking. Expliciete PDF-validatie en bestaande
datumherkenning blijven behouden. Een ongeldige waarde wordt eenmaal per bewerking
gemeld; na bevestiging kan de gebruiker verder. De waarde blijft staan en wordt
met aria-invalid gemarkeerd. Een nieuwe bewerking activeert de controle opnieuw.

## Regressiecontrole

Vanuit open-pdf-studio:

- `node --test js/pdf/form-layer/blur-validation.test.mjs`: drie tests voor
  bevestiging, bewerkingen en tijdelijk onderdrukte validatie.
- `node scripts/test-comb-fields-browser.mjs`: echte Chromium/PDF.js-controle in
  single en continuous modus. Eén teken in twee vakjes; letters zonder expliciete
  numerieke beperking; acht cijfers; rechts uitgelijnde tekst; schaal 1 en 1,75;
  ongewijzigde focusbreedte; expliciete bereikvalidatie; focus verlaten na bevestiging;
  opslaan en opnieuw laden. Vóór de fix faalt de eerste MaxLen-assertie; erna slaagt
  de hele controle. De screenshot is visueel gecontroleerd.
- De browsercontrole is toegevoegd aan Linux-CI; de drie tests aan de unitlijst.
- Aanvullend: volledige unitlijst, TypeScript, productiebuild, bundelbudget,
  versieconsistentie en de runtime/release/Android-configuratietests.

Het oorspronkelijke formulier van de melder is niet beschikbaar; de regressie
gebruikt een zelfstandig gegenereerd formulier. Geïnstalleerde Tauri/PDFium- en
installerkwalificatie blijven apart nodig. Er wordt geen release gepubliceerd.

## CI-vervolg 27 november

De klembordbrowsercontrole faalde op exact vergelijken van 29,999999999999993
met 30. Lokaal gereproduceerd. Alleen de twee relatieve groepsafstanden krijgen
een tolerantie van 1e-9 PDF-punt; de andere controles blijven ongewijzigd. Alle
zeven browserscenario's slagen opnieuw, ook via de echte Rust-broker (53
uitwisselingen). Productiebuild, bundelbudget en versiecontroles opnieuw groen.
