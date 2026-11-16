# Formuliervelden in de schermlaag (#1101)

De interactieve Tauri-weergave bestaat uit een paginabitmap en de HTML-formulierlaag
van PDF.js. Een opgeslagen widget-weergave mag niet ook in de bitmap staan:
na het typen van een nieuwe waarde bleef de oude weergave anders zichtbaar onder
het invoerveld. `render_annotations(false)` schakelt PDFiums afzonderlijke
formulierstap niet uit.

Welke velden de HTML-laag tekent, bepaalt wat de bitmap mag bevatten. Tekstvelden,
keuzelijsten, selectievakjes en keuzerondjes staan in de HTML-laag en dus niet in
de bitmap. Handtekeningvelden en drukknoppen tekent die laag niet: PDF.js toont een
handtekeningveld alleen met een eigen canvas, en een drukknop is daar een kale link.
Die velden blijven in de bitmap, anders verdwijnt bijvoorbeeld een zichtbare
handtekening van het scherm.

PDFium tekent velden alleen in zijn formulierstap, en die stap tekent alle velden.
`pdfium-worker/src/screen_widgets.rs` verbergt daarom voor één schermrender de
bewerkbare velden (de Hidden-vlag) en zet ze daarna terug. Heeft een pagina geen
handtekening of drukknop, dan blijft de formulierstap uit en verandert er niets.
Het bestand zelf en de andere renderpaden (afdrukken, export, vergelijken) zien de
vlaggen ongewijzigd. De worker en de in-process schermterugval
(`render_page_to_rgba_opts`) gebruiken hetzelfde bestand.

Zoomtegels gebruiken een transformatie, en de formulierstap kent geen
transformatie. Vóór #1101 misten tegels daarom alle velden, ook handtekeningen.
Nu tekent de tegelrender het stuk onder elke handtekening of drukknop nog eens
zoals een hele pagina (paginamaat op schaal, verschoven oorsprong), één keer met en
één keer zonder die velden, en neemt alleen de pixels over die verschillen. De
rest van de tegel houdt zijn eigen pixels. De rasterexport van zware pagina's
gebruikt dezelfde workertegels (`raster-export.js`): die krijgt nu handtekeningen
en drukknoppen mee, de bewerkbare velden nog steeds niet (zoals voor #1101).

De algemene uitvoerfunctie `render_page_to_rgba` blijft alle formuliergegevens
tekenen: afdrukken, OCR, PNG-export en MCP hebben geen interactieve
formulierlaag. Vergelijken behoudt zijn eigen renderpad met formuliergegevens.

De miniaturen in het paginapaneel hebben ook geen formulierlaag. Het gewone pad
(`render_thumbnail`) tekent alle velden. Voor zware pagina's vraagt het paneel
`render_pdf_page` met `forms: true` (een eigen sleutel in de bitmapcache), en
hergebruikt het de schermbitmap alleen op een pagina zonder bewerkbare velden
(`js/pdf/formulierlaag-scherm.js`). De miniatuur uit opgeslagen vectoropdrachten
bevat geen velden en wordt op een pagina met velden overgeslagen. Een miniatuur
toont de opgeslagen waarde uit het bestand, niet een waarde die net is getypt en
nog niet bewaard.

Regressietests gebruiken een synthetische AcroForm, zonder gebruikersdocument:
een tekstveld, een handtekeningveld en een drukknop, elk met een eigen kleur. Ze
vergelijken de echte schermpixels met dezelfde pagina zonder tekstveld, bij schaal
1 en 2, vier extra draaiingen en /Rotate 0 en 90. Het tekstveld mag niet in de
bitmap staan, handtekening en drukknop wel, ook in tegels (ook een tegel die de
handtekening half bedekt). Na de schermrender tekenen de uitvoerpaden het
tekstveld nog steeds. De JS-tests (`formulierlaag-scherm.test.mjs`) toetsen de
indeling van de velden, de vlag voor de miniaturen en dat een afdruk elk veld
precies één keer tekent.

De melding over verschoven statische labels is hiermee nog niet afzonderlijk
bevestigd. De oorspronkelijke bankcheque is niet nodig voor de tests en is niet
opgevraagd. Een eventuele resterende uitlijningsfout vraagt om een nieuw,
synthetisch voorbeeld met dezelfde veldinstellingen.

Amerikaanse papierformaten bestaan al: Letter, Legal en Tabloid in de
papierkeuzelijsten, en ANSI A–E en ARCH A–E/E1 in de gedeelde lijst
`us-papierformaten.js`. ANSI B heeft hetzelfde formaat als Tabloid. De melding
vereist daarvoor geen tweede implementatie.
