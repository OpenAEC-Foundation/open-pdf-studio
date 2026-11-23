# Kleurletters in Feedback en Symboolbibliotheek (#1214)

## Aanleiding en afbakening

De melder gebruikt de AppImage 2026.48.2 op Fedora 44, GNOME/Wayland en
AMD Radeon RX 550. Feedback en Symboolbibliotheek-instellingen bevriezen
met of zonder geopend document; andere voorkeuren werken. De nieuwe log
bevat een assert in `colrv1_configure_skpaint`, bij een kleurstopvector.
Dit wijst op de native kleurletterrenderer; de exacte runtime-/ABI-oorzaak
is hiermee niet bewezen. Dezelfde installatie op een CachyOS-VM faalt niet.

Beide vensters tekenen decoratieve emoji. Feedback gebruikt nu eenvoudige
SVG-gezichtjes zonder tekst/font. De landkeuze toont alleen de bestaande
vertaalde landnaam, zonder vlagglyph. De land-ID's, sentimentwaarden,
vertaalde labels en verzendpayload zijn behouden. De knoppen hebben een
expliciete toegankelijke naam en ingedrukte toestand.

Dit is een gerichte workaround voor deze twee ingebouwde UI-triggers, geen
algemene reparatie van de AppImage-fontstack. Andere kleurletters in
gebruikersinhoud, catalogusnamen of PDF's kunnen dezelfde runtimefout nog
activeren. Er worden geen systeemfonts, renderinstellingen of documenten
gewijzigd. Bevestiging op de getroffen Fedora-installatie blijft nodig.

## Regressie

Vanuit `open-pdf-studio`:

```sh
node scripts/test-dialog-color-fonts.mjs
PROBE_ENGINE=webkit node scripts/test-dialog-color-fonts.mjs
```

De test start een eigen Vite-server zonder HMR en een schoon browserprofiel.
Externe requests worden onderschept: een bibliotheekfixture bevat bewust
een Nederlandse vlag. Er wordt geen feedback verzonden. De echte knoppen
openen de vensters. De test controleert:

- drie SVG-gezichtjes zonder tekstglyphs en met vertaalde toegankelijke namen;
- selecteren, wisselen en uitzetten van sentiment zonder dubbele selectie;
- invoeren en sluiten van Feedback;
- landnaam zonder vlag, werkende landselectie, invoer en drie keer heropenen;
- maximaal één indexrequest per opening en een responsieve pagina.

Op ongewijzigde upstream faalt de test omdat de sentimentknoppen geen SVG
bevatten. Dit reproduceert de onveilige UI-trigger, **niet** de native crash.
De GitHub-workflow herhaalt de test in Chromium en WebKit.

## Native hertest

Open op de getroffen Fedora-machine beide vensters met en zonder PDF.
Selecteer alle drie sentimenten, sluit zonder te verzenden, open de
bibliotheekinstellingen en wissel land. Controleer dat de vensters blijven
reageren en dat de terminal geen COLRv1-assert toont. Noteer de gebruikte
installer/commit en eventuele nieuwe melding. Zolang deze kwalificatie en
de vereiste installerbouw ontbreken blijft de PR een concept.
