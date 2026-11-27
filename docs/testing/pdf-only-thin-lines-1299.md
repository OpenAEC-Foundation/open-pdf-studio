# Dunne lijnen alleen voor de PDF — issue 1299

De stand Dunne lijnen (Beeld, Ctrl+5 of TL) verandert uitsluitend de PDF-ondergrond. Annotatieranden en arceringen houden hun eigen ingestelde lijndikte. Opgeslagen annotatiegegevens veranderen niet. De bestaande ondergrens bij uitzoomen en tijdelijke begrenzing tijdens slepen blijven gelden.

De fout zat op twee plaatsen: de annotatierenderer gaf de PDF-voorkeur door aan de lijndikteberekening en de arceringen vervingen hun familiedikte door één schermpixel. Beide koppelingen zijn verwijderd. De PDF-renderopdrachten, cache-sleutels en vectorreplay zijn niet gewijzigd.

## Bewijs

Twee nieuwe regressietests voeren de echte state-adapters uit en falen vóór de fix: randen en arceringen worden bij Dunne lijnen smaller. Na de fix zijn de breedtes gelijk bij 25%, 100% en 400% zoom. Bestaande tests voor PDF-opdrachten, bitmap-/tegelcaches, hairline-replay, symbolen en geometrische lijnstijlen blijven gelden.

De Chromium-test `scripts/test-pdf-only-thin-lines-browser.mjs` opent een echte PDF, tekent een dikke rode annotatie en een gearceerd vak, bedient de ribbonknop en vergelijkt de canvaspixels vóór, tijdens en na Dunne lijnen. Zowel één pagina als doorlopende weergave worden gecontroleerd, inclusief ongewijzigde annotatiegegevens. Deze test kwalificeert de browseroverlay; native PDFium-rendering en installers vereisen afzonderlijke kwalificatie.

De volledige unit-suite, typecontrole, directe Vite-build, versiecontrole en runtime/release/Android-configuratietests worden uitgevoerd. De bundelgrens wordt na de build apart gecontroleerd. Bestaande bundeloverschrijding, uitgeschakelde fork-installerworkflow en ontbrekende upstream-beoordeling/mergerechten houden de PR in concept. Er wordt geen release gepubliceerd.
