# Gelokaliseerde fontnamen bij PDF-export (#1066)

De vervolgmelding van 19 november 2026 toont `BIZ UDゴシック` in de
lettertypekeuze. De eerdere reparatie (#1068, opgenomen via #1080) behandelt
TTC-gezichten, PDF-resources en glyph-offsets. De native zoekindex bewaarde
echter slechts één Engelse familienaam. Een Japanse naam uit de Windows-lijst
kon daardoor `not-found` opleveren voordat de insluitketen werd aangeroepen.

## Wijziging

De index bewaart alle ondersteunde familienaamrecords (name-ID 1 en 16),
inclusief gelokaliseerde Windows- en Unicode-namen. Engelse Windows-namen
blijven de voorkeur houden als canonieke naam. Beide naamvormen vinden
hetzelfde bestand en TTC-gezicht. De bestaande stijlkeuze, terugval naar de
gewone stijl, OS/2-insluitrechten en controle bij het lezen blijven gelden.
Volledige fontnamen en PostScript-namen worden geen familiealias.
Ongeldige naamrecords worden overgeslagen zonder geldige aliases te verliezen.

## Regressiebewijs

De native tests gebruiken de bestaande kleine TTF/TTC-fixtures met aangepaste
naamtabellen; er worden geen Windows-fontbestanden meegeleverd of geïnstalleerd.
Drie nieuwe tests faalden op de oorspronkelijke code en slagen na de wijziging:

- Engelse en Japanse familienaam vinden hetzelfde tweede TTC-gezicht.
- Unicode-, Windows encoding 10- en legacy-familienamen behouden de stijlkeuze.
- Een gelokaliseerde naam omzeilt geen insluitbeperking.

Een vierde test behandelt ongeldige lengtes, oneven UTF-16 en ongeldige
surrogaten naast een geldige Japanse alias. De bestaande negen native tests
blijven actief. De workflow `installed-fonts.yml` voert deze productiemodule
automatisch uit op Linux, Windows en macOS.

Daarnaast worden de bestaande browserinsluiting, volledige JavaScript-suite,
TypeScript-controle, productiebuild en runtime-/releasecontroles uitgevoerd.
De PR bevat de exacte uitslagen.

## Grenzen

De gemelde Windows 11-installatie, de exacte BIZ UDGothic-collectie en de externe
PDF-lezer zijn hier niet beschikbaar. De fixture bevestigt het lookupdefect
achter de zichtbare Japanse naam, maar vervangt geen controle met die installatie.
Vraag bij een resterend probleem om een klein opgeslagen voorbeeld-PDF en de
exacte fontbestandsnaam/versie en installer. De fix is geen wijziging van
licentiebeleid en geen claim dat iedere eerdere melding hiermee is opgelost.
