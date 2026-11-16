# Paginaformaat volgens de eenhedenvoorkeur (#1121)

Het Document-gedeelte van het eigenschappenpaneel en de paginaformaatregel
in Kalibratie volgen nu `scaleUnitSystem`: metrisch, imperiaal of beide.
Er komt geen nieuwe instelling bij. Een wijziging werkt direct door, ook
wanneer het kalibratievenster al open is.

De gedeelde formatter krijgt de afmetingen uit de PDF.js-viewport op schaal 1.
Rotatie en `/UserUnit` zijn daarin al verwerkt en worden niet opnieuw
vermenigvuldigd. Millimeters houden één decimaal, inches twee. Een onbekend
formaat blijft `-`. De bestaande vertaalde labels in alle 40 talen blijven
in gebruik; `mm` en `in` zijn dezelfde eenheidssymbolen als in Pagina-eigenschappen.
Dat laatste venster, de meetgereedschappen en de linialen veranderen niet.

Controles:

- Unit-tests voor Arch D, beide oriëntaties, afwijkende maten, ongeldige
  afmetingen en terugval naar beide eenheden.
- `node scripts/test-page-size-units-browser.mjs`: echte Solid-interface en
  geïmporteerde PDF. Metrisch/imperiaal/beide wisselen zonder heropenen; ook
  het geopende kalibratievenster volgt. Tweede pagina met rotatie 90° en
  UserUnit 2 levert de juiste andere fysieke maat op (30 x 20 inch). Ontbrekende pagina blijft `-`.
- De browsertest wordt in Linux-CI uitgevoerd.

Installer- en geïnstalleerde Windows/macOS-kwalificatie volgen apart;
de concept-PR publiceert geen release.
