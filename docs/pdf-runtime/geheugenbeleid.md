# Geheugenbeleid voor de huidige Tauri-app

De renderer gebruikt één controle vóór de bitmapallocatie, gedeeld door
PDFium-sidecar en in-process fallback. `dimensions` controleert eindige positieve
geometrie, afronding en een door de aanroeper opgegeven RGBA-bytebudget. Een
afgewezen render levert `PDF_OUTPUT_LIMIT` of `PDF_INVALID_GEOMETRY`, geen lege
bitmap. Regio's worden vóór het openen van de pagina gecontroleerd.

De budgetten verschillen per aanroeper:

- worker: de bestaande workerpayload, 64 MiB min 32 headerbytes;
- in-process fallback voor het scherm: 512 MiB. Die terugval is er juist voor
  bitmaps die niet in het gedeelde geheugen passen. De paginabitmap-cache rondt
  de schaal op naar een macht van twee boven de as-grens van 4096 px (tot 8192 px
  per as, 256 MiB), en knipsel-tegels van 4096 x 4096 liggen 32 bytes boven de
  workergrens. Met het workerbudget ook hier renderden zulke pagina's niet meer;
- printen, OCR, PNG-export en MCP-referentierenders: geen bytebudget, alleen de
  geometriecontrole. Een A0-pagina op 300 dpi is ruim 500 MiB.

Dit begrenst **niet** het totale procesgeheugen. PDFium kan al tijdens het openen
van een pagina veel geheugen gebruiken. Het overzetten/converteren van pixels
kost bovendien extra buffers. De bestaande workerpool, cache-evictie en
inactiviteitstrimming blijven nodig.

| Pad | Bestaande grens / nieuwe controle | Niet afdwingbaar via huidige adapter |
| --- | --- | --- |
| PDFium-worker | SHM-payload; gedeelde geometriecontrole | Decodebudget per stream; onderbreken van een lopende native decoder |
| PDFium in-process | Schermterugval 512 MiB; print/OCR/export alleen geometrie | Totale native allocatie en decodertijd |
| PDF.js | Browser/worker en eigen canvasbeleid | Apart budget voor xref-, object- en fallback-decoders via publieke API |
| MuPDF WASM | WASM-geheugen en bestaande rendererfouten | Per-stream-budget via huidige JS-adapter |
| Eigen Rust-renderer | Eigen caches en implementatie | Nog geen uniforme decodergrens; geen garantie afgeleid van PDFiumbeleid |

Er is geen nieuwe limiet op PDF-bestandsgrootte. Een klein bestand kan een grote
uitgepakte stream bevatten; inputbytes begrenzen is geen decodebudget. Het
blind overnemen van een 512 MiB bestandslimiet zou grote bouwtekeningen breken.

## Streaming en resterende evaluatie (#728)

De huidige PDFium-adapter geeft een paginahandle aan de renderer. De applicatie
kan de interne contentdecoder niet vervangen door een streaming reader zonder
backendwerk. PDF.js-workertransport is evenmin bewijs dat de hele parser een
begrensd streamingpad gebruikt. Een nieuwe backend moet expliciet aantonen wat
er gebeurt met xref/objectstreams, herstel, geneste resources, misvormde en sterk
gecomprimeerde input. Een uitgeput budget mag geen geslaagde halve pagina worden.

De gedeelde Rust-tests dekken grenswaarden zonder enorme allocaties. Een
representatieve corpusmeting blijft vereist vóór een decoderwijziging: registreer
backendversie, bestandshash, piek-RSS van app én workers, eerste-paginatijd,
volledige rendertijd en annuleringslatentie. Deze wijziging claimt geen gemeten
snelheidswinst of volledige oplossing voor parsergeheugen. #676 is gesloten na de bitmapcontroles; #728 volgt de resterende
backend- en corpusevaluatie.

## Workeruitputting en herstel (#728)

Een response heeft een leesdeadline van 60 seconden en maximaal 16 KiB
protocoltekst. Uitputting levert `PDF_RENDER_TIMEOUT` respectievelijk
`PDF_WORKER_RESPONSE_LIMIT`: dezelfde aanvraag wordt niet op een tweede worker
of in-process PDFium herhaald. Een lege of afgebroken response is eveneens een
fout. Tijdens herstel levert een pool zonder beschikbare workers
`PDF_WORKER_UNAVAILABLE`, zonder paniek of in-process terugval.

Herstel claimt een slot synchroon, serialiseert het opruimen met de exchange-lock,
beëindigt en reapt het oude proces en start daarna een vervanger. Wachtende
callers beheren hun eigen wachtrijteller; herstel zet deze niet op nul. Een
queued caller die een onbeschikbaar slot aantreft start geen tweede herstel.
Ook een mislukte tweede renderpoging laat zijn worker herstellen. Child-handles
hebben kill-on-drop voor mislukte startup en het afsluiten van de pool.

Deze grens geldt voor de responsefase, niet voor wachttijd, het schrijven naar
stdin, totaal-RSS of de hoeveelheid gedecodeerde PDF-data. De in-process routes
voor OCR/print/export hebben hiermee geen decoderdeadline gekregen. #728 blijft
open voor die grenzen en een representatieve geheugenmeting; dit is uitsluitend
een verbetering van de bestaande procesisolatie.
