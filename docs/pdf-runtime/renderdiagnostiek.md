# Renderdiagnostiek (#677)

De normale Tauri-invoke-route observeert hele PDFium-pagina's, regio's en de
eigen Rust-schermrenderer. Een afgewezen aanvraag wordt een gestructureerde
bevinding; een ongeldige RGBA-response wordt geweigerd voordat de caller pixels
kan publiceren. Codes bevatten geen willekeurige backendfouttekst of PDF-inhoud.

De statusbalk toont het aantal bevindingen. Klikken navigeert door de betrokken
pagina's en toont de code met hersteladvies. Plugins lezen dezelfde snapshot via
`getDocumentInfo().renderDiagnostics`; MCP via `app_get_viewport_state` onder
`renderDiagnostics`. Er is geen nieuw toolnummer of wijzigend MCP-commando.

De snapshot bevat `fidelity: not-certified`, een expliciete dekkingsbeschrijving
en per pagina backend, kwaliteit en bevindingen. De native aanroep vertelt niet
of het een preview of definitieve render is: kwaliteit blijft dus `unknown`.
Een geslaagde fallback verwijdert eerdere fouten niet. Cachegebruik bewaart de
bevindingen; pagina-/documentinvalidatie verwijdert ze en verhindert late updates
uit een vorige generatie. Opslag is begrensd op 128 documenten, 1024 pagina's per
document en 16 verschillende bevindingen per pagina. Evictie impliceert geen
foutvrij document.

## Nog niet afgedekt

De bestaande backends leveren geen volledige lijst met stil overgeslagen
resources. De UI meldt daarom geen gecertificeerde volledigheid. PDF.js-browser-
decoderwaarschuwingen, verborgen native fallbackfouten en precieze object/regio-
locaties vragen aanvullende backendinstrumentatie. Er is geen globale console-
interceptie: die zou fouten niet betrouwbaar aan een document toewijzen.

De tests dekken geweigerde buffers, budgetfouten, herstel/fallback, preview/final-
provenance, cachebehoud en verouderde async-meldingen. Een synthetisch gemelde
`incomplete`-status test het contract, niet een werkelijke backenddecoder. #677 is gesloten; #729 volgt de resterende decoderinstrumentatie.

## Echte decoderfixture (#729)

`open-pdf-studio/scripts/fixtures/decoder-omissions/unsupported-xobject.pdf` is
zelf gegenereerd, zonder bronmateriaal van derden. SHA-256:
`a001cd9db787d11ad08fcfca14d5a75dd526707c04652f36ab09091ec120bce8`.
De pagina bevat een geldige zwarte rechthoek en daarna een XObject met een
ongeldige subtype-naam. Er is geen veronderstelde juiste weergave van dat
ongeldige object: de rechthoek dient als controle voor overige pagina-inhoud.

Op PDF.js 6.4.299 voltooit de normale render met de rechthoek. Met
`stopAtErrors: true` voltooit de render eveneens, maar is zelfs de rechthoek wit.
`check-decoder-omissions.mjs` reproduceert dit met de echte Node/canvas-backend.
`check-decoder-omissions-browser.mjs` bevestigt dezelfde uitkomst met de echte
Chromium-canvas en PDF.js-worker. Deze optie is dus niet ingeschakeld in de viewer en wordt niet gebruikt als
volledigheidstest. Een geslaagde operatorlijst is evenmin voldoende bewijs.

`python3 scripts/check-decoder-omissions-native.py` gebruikt de geleverde
Linux-PDFium-library rechtstreeks, vermeldt zijn hash en controleert dezelfde
zwarte pixel. `FPDF_RenderPageBitmap` retourneert geen resourcewaarschuwingen.
Poppler (`pdftoppm`) toont de zwarte rechthoek en meldt onafhankelijk
`Unknown XObject subtype 'Unsupported'`; de referentieafbeelding is bekeken.
De native probe is geen end-to-endtest van de Tauri-UI.

De fixture bewijst dat requestdiagnostiek deze klasse niet dekt. De runtime
rapporteert daarom nog geen verzonnen `incomplete`-waarschuwing. Voor #729 blijft
backendwerk nodig: een per-document/page waarschuwing vanuit PDF.js/PDFium,
plus Tauri-integratietests voor deze decoderfixture. Globale console-interceptie en een
succesvolle tweede renderer leveren geen betrouwbare certificering.

De bestaande UI/API/MCP-snapshot bewaart nu ook de stabiele codes
`PDF_RENDER_TIMEOUT`, `PDF_WORKER_RESPONSE_LIMIT` en `PDF_WORKER_UNAVAILABLE`.
Backendfouttekst en bestandsinhoud komen niet in deze codes terecht.
