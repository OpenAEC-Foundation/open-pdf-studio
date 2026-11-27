# Handtekeningafbeelding importeren — #1267, onderdeel 2

## Probleem en afbakening

Op upstream `7168c6d64d995c683b1722569b30214642e3364b` kon alleen een met de muis/pen getekende handtekening worden opgeslagen. Digitaal ondertekenen kon die opgeslagen afbeeldingen gebruiken, maar bood geen PNG/JPEG-bestandskeuze.

Beide dialogen krijgen dezelfde afbeeldingsimport via de bestaande platformbestandskeuze. De import bewaart een afbeelding in de bestaande handtekeningenlijst (maximaal vijf), toont hem in Opgeslagen en selecteert hem direct in de digitale ondertekening. De import wijzigt geen PDF voordat de gebruiker de handtekening plaatst of ondertekent. PNG-transparantie en beeldverhouding blijven behouden. Bestanden boven 10 MB worden geweigerd; beelden met een zijde boven 1024 pixels worden proportioneel verkleind. Bij ongeldige bytes, decodeerfouten of een vol opslagquotum blijft de oude lijst bewaard. Sluiten tijdens de bestandskeuze of het laden annuleert de import.

Dit voegt een zichtbare handtekeningafbeelding toe. Certificaten aanmaken (onderdeel 1) en batchbewerkingen (onderdeel 3) zijn niet gewijzigd. De bestaande cryptografische ondertekening blijft verantwoordelijk voor het certificaat en de PDF-handtekening.

## Regressieproef

Vanuit `open-pdf-studio`:

```sh
node --test js/annotations/signature-image.test.mjs js/annotations/signature-storage.test.mjs js/solid/components/dialogs/SignatureDialog.test.mjs
node scripts/signature-image-e2e.mjs
```

De browserproef start en sluit een eigen Vite-server zonder HMR en een eigen Chromium. Hij importeert echte PNG/JPEG-bytes via de dialogen en controleert:

- PNG-alfa, beeldverhouding en plaatsing als handtekeningannotatie;
- beschikbaarheid en automatische selectie in Digitaal ondertekenen, plus blauwe afbeeldingspixels in de echte `tekenWeergave`-uitvoer;
- quota-, formaat- en decodeerfouten zonder verlies van opgeslagen handtekeningen;
- annuleren en sluiten tijdens de bestandskeuze zonder late opslag;
- verkleinen van grote PNG/JPEG naar 1024 pixels met behoud van verhouding en alfa;
- gedeelde opslag en verwijderen na heropenen van beide dialogen.

De vijf nieuwe unit-tests draaien in de bestaande unit-suite. De browserproef draait mee in Dialog regression op Linux. Bestaande tekenpadtests blijven actief. Er zijn geen nieuwe vertaalvelden: bestaande afbeeldings-, blader- en foutlabels uit alle taalbestanden worden hergebruikt.

## Kwalificatie

Dit is browserkwalificatie van de frontend, geen geïnstalleerde Tauri- of cryptografische certificaatproef. De native bestandskeuze en een echte ondertekening met geïmporteerd beeld moeten nog op een installer worden doorlopen. De PR blijft concept zolang vereiste installer-/native-controles of het bestaande startbundelbudget niet slagen. Geen release publiceren.
