# Vertraagde hyperlinknavigatie na integratieronde 16

## Probleem

Na #1162 stopte een oude sprong na het opzoeken van een benoemde bestemming,
het paginanummer en `goToPage`. De daaropvolgende `toonDoelbeeld` wacht echter
ook op de PDF-pagina, de native viewportmodule en zo nodig `setZoom`.
Een vertraagd paginaverzoek kon daardoor alsnog de zoom en schuifpositie van
een nieuwere sprong overschrijven. Bij herladen kan bovendien hetzelfde
DocumentState-object een ander PDF.js-document krijgen.

## Wijziging

De bestaande geldigheidscontrole reist mee naar `toonDoelbeeld` en wordt na
iedere asynchrone grens opnieuw uitgevoerd. De controle vergelijkt ook het
PDF.js-document dat bij de oorspronkelijke klik hoorde. De bestemmingsgeometrie,
schermkalibratie en randweergave van upstream blijven leidend.

## Regressie

`node scripts/test-link-view-browser.mjs` opent een gegenereerde PDF via de
bestandskiezer in Chromium. De test controleert in Single en Continuous:

- aanklikbare FitR-bestemming met correcte zoom en centrering;
- benoemde XYZ-bestemming, gedraaide CropBox en zichtbare rode rand;
- behoud van bestemming en rand na opslaan;
- een vertraagde benoemde bestemming tegenover een nieuwere klik;
- vervanging van het PDF.js-document terwijl een bestemming nog wordt opgezocht.

In Continuous wordt daarnaast de paginalaadstap van `toonDoelbeeld` vertraagd.
De test onderscheidt deze aanvraag van thumbnail-/renderaanvragen via de
oproepstack. Daarna wordt naar een andere pagina met een andere zoom gesprongen.
De oude aanvraag mag zoom en scroll niet meer veranderen.

Op upstream `9fcb57c9a` faalt die laatste controle: zoom 3,055556 in plaats van
1,527778, scroll (917,3426) in plaats van (764,2699). Met de fix slaagt ze.
De test draait ook in Linux CI. Dit is browserbewijs met echte PDF.js-rendering;
de native viewport, een echte documentherlaadactie en de oorspronkelijke
gebruikers-PDF zijn niet end-to-end gekwalificeerd. De test vervangt voor de
herlaadgrens alleen het PDF.js-object in het bestaande tabblad.
