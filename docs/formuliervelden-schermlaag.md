# Formuliervelden in de schermlaag (#1101)

De interactieve Tauri-weergave bestaat uit een paginabitmap en de HTML-formulierlaag
van PDF.js. Een opgeslagen widget-weergave mag niet ook in de bitmap staan:
na het typen van een nieuwe waarde bleef de oude weergave anders zichtbaar onder
het invoerveld. `render_annotations(false)` schakelt PDFiums afzonderlijke
formulierstap niet uit.

De worker tekent voor schermpagina’s geen formuliergegevens. Hetzelfde geldt voor
de in-process schermterugval (`render_page_to_rgba_opts`). Zoomtegels gebruiken
al een transformatie zonder formulierstap. De algemene uitvoerfunctie
`render_page_to_rgba` blijft formuliergegevens tekenen: afdrukken, miniaturen,
OCR, PNG-export en MCP hebben geen interactieve formulierlaag. Vergelijken
behoudt zijn eigen renderpad met formuliergegevens.

Regressietests gebruiken een synthetische AcroForm, zonder gebruikersdocument.
Ze vergelijken de echte schermpixels met dezelfde pagina zonder widget, bij
schaal 1 en 2 en vier rotaties. De tekening moet identiek blijven. Dezelfde
opgeslagen widget moet in de uitvoerrender en in vergelijktegels juist zichtbaar
blijven. De schermtegeltest controleert ook het gebied van het invoerveld.

De melding over verschoven statische labels is hiermee nog niet afzonderlijk
bevestigd. De oorspronkelijke bankcheque is niet nodig voor de tests en is niet
opgevraagd. Een eventuele resterende uitlijningsfout vraagt om een nieuw,
synthetisch voorbeeld met dezelfde veldinstellingen.

Amerikaanse papierformaten bestaan al: Letter, Legal en Tabloid in de
papierkeuzelijsten, en ANSI A–E en ARCH A–E/E1 in de gedeelde lijst
`us-papierformaten.js`. ANSI B heeft hetzelfde formaat als Tabloid. De melding
vereist daarvoor geen tweede implementatie.
