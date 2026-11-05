# Schaalvoorinstellingen vanuit het lint (#972)

De 19 imperial-voorinstellingen uit #885 zijn aanwezig sinds commit bbee9994f,
maar het kalibratievenster was alleen via het contextmenu van een meetlijn
bereikbaar. Zonder meetlijn kon de gebruiker de voorinstellingen niet openen.

Open een PDF en ga naar **Tekenen & annotatie → Meten → Kalibreren**.
De knop opent direct **Schaalverhouding**. De lijst bevat zowel de bestaande
metrische verhoudingen als architectural- en engineering-notaties in inches
per voet. Een imperial-keuze stelt de uitvoereenheid op voet; de gebruiker
kan deze daarna aanpassen. De contextmenu-route voor een referentielijn
blijft beschikbaar. Zonder PDF of bij een alleen-lezen PDF staat de knop uit.

## Verificatie

`node scripts/calibration-access-e2e.mjs http://127.0.0.1:32872`

De proef gebruikt een eigen Chromium-context en een gegenereerde PDF. Op
ongewijzigde main ontbreekt de lintknop. Met de wijziging controleert de proef
de linttoegang, de twee methode-tabbladen, annuleren, alleen-lezenstatus,
architectural/engineering/metrische/aangepaste schalen, de berekende meetwaarde,
herladen van de opgeslagen schaal en undo/redo. Bestaande unittests controleren
alle 19 imperial-verhoudingen, hun labels en /UserUnit-conversies.

De nieuwe toegang hergebruikt bestaande vertalingen in alle 40 talen.
Er is geen verpakte native WebView getest; installerkwalificatie blijft vereist.
