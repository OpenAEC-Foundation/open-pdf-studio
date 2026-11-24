# Tekenwerkbalk terughalen (#1255)

Beeld > Tekenwerkbalk schakelt de strook met teken- en annotatiegereedschappen.
De bestaande knop Gereedschapspalet blijft de symbolenbibliotheek bedienen.
De nieuwe knop blijft beschikbaar zonder geopende PDF en toont de actuele stand.
De bestaande voorkeurenopslag en dockpositie blijven in gebruik.

## Regressie

Vanuit `open-pdf-studio`: `node scripts/test-drawing-toolbar-browser.mjs`.
De echte lintknop en sluitknop worden in Chromium bediend, voor links, rechts,
boven, onder en zwevend. De proef controleert afzonderlijke zichtbaarheid van
beide paletten, opslaan van de voorkeur en herladen in zowel gesloten als geopende
stand. Tegen upstream ontbreekt de herstelknop en faalt de proef.
De proef gebruikt een eigen browserprofiel en Vite-poort zonder HMR.

Een geïnstalleerde Windows/Tauri-app en installer zijn hiermee niet getest.
