# Mengmodus in het eigenschappenpaneel (#1262)

De zestien mengmodi bestonden al in het Opmaak-lint, de weergave en de
PDF-opslag (#614/#624). Onder Eigenschappen → Weergave ontbrak de bediening.

De nieuwe keuzelijst gebruikt dezelfde modustabel en vertalingen. De
properties-store leest de opgeslagen modus, toont verschillen bij een
meervoudige selectie en schrijft via het bestaande wijzigingspad met undo.
Een tekstmarkering zonder expliciete modus toont Multiply, overeenkomstig
de bestaande weergave; alleen selecteren wijzigt het model niet.

Een vergrendelde annotatie, ook binnen een gemengde selectie, blokkeert de
keuze. Links, schaalbalken en de synthetische gereedschapsstandaarden tonen
geen mengmodus: deze wijziging betreft bestaande annotaties. Het bestaande
voorkeurenschema bewaart geen mengmodus voor volgende tekeningen.

## Regressie en controles

- `node --test js/solid/stores/mengmodus-paneel.test.mjs`: vóór de wijziging
  mislukken drie van de vijf tests; daarna slagen alle vijf. Alle zestien
  modi, tekstvak/tekstmarkering, gemengde selectie, undo/redo, vergrendeling
  en zichtbaarheid worden via de echte store getest.
- `node scripts/test-mengmodus-paneel-browser.mjs`: echte keuzelijst met alle
  zestien opties; rechthoek en tekstvak, gemengde selectie, bulk-undo/redo,
  vergrendeling en PDF opslaan/heropenen via de echte saver en lader.
  De test draait ook in de bestaande Linux-CI. De taalvoorkeur staat vóór
  de start vast, zodat de voorkeurslader de test niet van taal laat wisselen.
- Volledige unit-suite, TypeScript, versieconsistentie, runtime/releaseconfig,
  annotatie- en mengmodus-rondgangen en de Vite-bouw worden afzonderlijk
  gecontroleerd; de exacte uitkomsten staan in de PR.

De bestaande overschrijding van het opstartbundelbudget op upstream main
wordt apart behandeld in #1258. De grens is niet aangepast en de oplossing
uit die PR is niet gekopieerd.

Een geïnstalleerde Tauri-kwalificatie is niet door de browsertest vervangen.
De PR blijft concept zolang installer/native-controles geblokkeerd zijn.
Een eventuele kwalificatierelease blijft een ongepubliceerd concept.

Chat-ID: `01a109f0-a849-7782-8641-0b091eb29747`.
Werkbranch: `feat/properties-blend-mode-1262`.
