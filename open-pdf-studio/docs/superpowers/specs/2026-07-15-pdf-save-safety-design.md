# Ontwerp: veilige PDF-opslag, cache-invalidatie en bestandsvergrendeling

Datum: 2026-07-15  
Status: ter beoordeling  
Repository: Open PDF Studio

## Aanleiding

De huidige desktop-opslag schrijft de nieuwe PDF-bytes rechtstreeks over het doelbestand. Bij een onderbroken of mislukte schrijfoperatie kan het bestaande bestand daardoor gedeeltelijk worden overschreven. Na een geslaagde opslag verwijdert `invalidate_pdf_cache` bovendien niet alle Rust-rendercaches voor het bestand, waardoor een volgende render verouderde inhoud kan tonen. Op Unix-achtige systemen bewaart `lock_file` alleen een open bestandshandle en wordt geen echte advisory lock aangevraagd.

Deze wijziging maakt de opslagtransactie crashbestendiger, centraliseert de cache-invalidatie en zorgt dat de bestaande cross-platform lock-API op elk ondersteund desktopplatform daadwerkelijk vergrendelt.

## Doelen

- Een bestaand PDF-bestand blijft intact zolang de nieuwe inhoud niet volledig en succesvol naar schijf is geschreven.
- Een geslaagde opslag vervangt het doelbestand met één platformgeschikte atomaire operatie.
- Alle backendcaches die op het opgeslagen pad zijn gebaseerd worden na een geslaagde vervanging leeggemaakt.
- Een opgeslagen PDF wordt niet opnieuw uit een verouderde document-, pixmap-, tile-, thumbnail- of paginatypecache geladen.
- `lock_file` gebruikt op Unix een echte niet-blokkerende exclusieve advisory lock.
- De gebruikersinterface maakt onderscheid tussen een mislukte opslag en een geslaagde opslag waarbij alleen het herstellen van de lock is mislukt.
- De wijzigingen worden eerst met gerichte regressietests vastgelegd.

## Niet-doelen

- Geen versiegeschiedenis, automatisch back-upbestand of herstelinterface toevoegen.
- Geen herontwerp van PDF-serialisatie, annotatie-opbouw of Save As-gebruikersinterface.
- Geen pluginbeveiliging, CI-uitbreiding, algemene dead-code-opruiming of releasewerk in deze tranche.
- Geen versiebump, commit, push of installerpublicatie als onderdeel van deze ontwerpstap.

## Huidige gegevensstroom

`js/pdf/saver.js` serialiseert de actieve PDF volledig in het geheugen. Vervolgens geeft de frontend de lock vrij, schrijft `js/core/platform.js` de bytes rechtstreeks met de Tauri filesystem-plugin naar het doelpad, herstelt de lock en roept daarna `invalidate_pdf_cache` aan. Pas daarna worden de frontend-bytecache en de opgeslagen status bijgewerkt.

Deze volgorde heeft drie zwakke plekken:

1. De directe schrijfoperatie kan het vorige bestand beschadigen voordat een fout bekend is.
2. De frontend coördineert schrijven, locken en invalidatie als losse opdrachten, waardoor gedeeltelijk succes niet eenduidig kan worden gerapporteerd.
3. De gerichte invalidatie verwijdert alleen de byte-, documenthandle-, thumbnail- en paginatypecache. De Pdfium-documentcache, pixmapcache en tile-scene-cache blijven buiten beschouwing.

## Voorgestelde architectuur

### Eén backendopdracht voor de desktop-opslag

De Tauri-backend krijgt één `save_pdf_atomically`-opdracht met deze state-afhankelijkheden:

```text
fn save_pdf_atomically(
  request: tauri::ipc::Request,
  locked_files: State<LockedFiles>,
  generations: State<DocumentGenerations>,
  bytes_cache: State<PdfBytesCache>,
  handle_cache: State<DocHandleCache>,
  thumbnail_cache: State<ThumbnailCache>,
  page_type_cache: State<PageTypeCache>,
  tile_scene_cache: State<TileSceneCache>,
  pdfium_cache: State<PdfiumDocCache>,
  pixmap_cache: State<PixmapCacheState>
) -> Result<SaveOutcome, String>
```

De opdracht bestuurt de volledige desktoptransactie. De PDF-bytes worden als raw `Uint8Array`-IPC-body verstuurd. Hierdoor wordt een grote PDF niet eerst omgezet in een JSON-array met afzonderlijke getallen. Tauri ondersteunt voor een raw body geen gewone JSON-argumenten; daarom stuurt de frontend `targetPath` en het optionele `previousPath` percent-encoded mee in de headers `X-OPS-Target-Path` en `X-OPS-Previous-Path`. De backend decodeert en valideert deze headers voordat hij de body accepteert.

`js/core/platform.js` krijgt hiervoor een gerichte wrapper `savePdfAtomically(targetPath, previousPath, bytes)`. Die wrapper gebruikt rechtstreeks `window.__TAURI__.core.invoke(command, bytes, { headers })`; de algemene `invoke`-wrapper blijft ongewijzigd voor JSON-opdrachten.

De raw-bodyroute is alleen beschikbaar op desktop. De frontend gebruikt haar bij `isTauri() && !isMobile()`. De bestaande webdownload en mobiele opslagroute blijven functioneel ongewijzigd; mobiele atomaire vervanging valt buiten deze desktoptranche.

De backend voert voor een desktopopslag deze stappen uit:

1. Lees de raw body en decodeer `targetPath` en `previousPath` uit de headers. `targetPath` moet na decodering een niet-leeg absoluut bestandspad met een bestaande bovenliggende map zijn; `previousPath` is leeg voor een nieuw document en anders eveneens absoluut. Een lege raw body wordt geweigerd.
2. Valideer het doelpad, maak er een absoluut fysiek pad van en bereken de genormaliseerde interne padsleutel.
3. Maak met `create_new` een uniek bestand `.<bestandsnaam>.ops-save-<pid>-<random>.tmp` in dezelfde map als het doelbestand.
4. Schrijf de raw body rechtstreeks vanuit de geleende byteslice, roep `flush` aan en synchroniseer het tijdelijke bestand met `sync_all`.
5. Geef bij een gewone Save de door Open PDF Studio gehouden lock op het doelpad zo laat mogelijk vrij. Bij Save As blijft de lock op `previousPath` actief totdat het nieuwe doel succesvol is vervangen.
6. Vervang of maak het doelbestand met `atomic_replace_file`.
7. Synchroniseer op Unix de bovenliggende map met `sync_all`, zodat ook de directorywijziging duurzaam wordt vastgelegd.
8. Verhoog de documentgeneratie van het doelpad en verwijder alle padgebonden backendcaches. Bij Save As worden ook de lock en caches van het afwijkende `previousPath` vrijgegeven.
9. Open het nieuwe doelbestand en herstel de lock op het doelpad.
10. Verwijder een overgebleven tijdelijk bestand bij iedere fout vóór de vervanging.
11. Retourneer een gestructureerde uitkomst in plaats van alleen `true` of `false`.

Het tijdelijke bestand staat bewust in dezelfde map als het doelbestand. Daarmee blijft de uiteindelijke vervanging binnen hetzelfde bestandssysteem en kan een atomaire rename/replace worden gebruikt.

### Platformspecifieke vervanging

Op Unix gebruikt `atomic_replace_file` `std::fs::rename` binnen dezelfde map. De rename vervangt het bestaande directory-item atomair. Daarna opent de backend de bovenliggende map read-only en roept `sync_all` aan. Een fout in deze laatste duurzaamheidsstap kan de reeds uitgevoerde rename niet terugdraaien en wordt daarom als waarschuwing geretourneerd.

Op Windows gebruikt `atomic_replace_file` `MoveFileExW` met `MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH`. Deze combinatie werkt zowel voor een bestaand als een nog niet bestaand doel in dezelfde map. Een gewone `std::fs::rename` wordt niet gebruikt, omdat die niet betrouwbaar over een bestaand Windows-doelbestand heen vervangt. Aan de bestaande `windows-sys` dependency wordt uitsluitend de feature `Win32_Storage_FileSystem` toegevoegd.

Save As gebruikt dezelfde transactie. Als `previousPath` van `targetPath` verschilt, wordt het bronbestand niet gewijzigd en blijft zijn lock tijdens het schrijven en vervangen van het doel actief. Pas na een geslaagde vervanging verhuist de actieve lock van het bronpad naar het doelpad. Bij een fout blijft het brondocument daardoor exact in zijn eerdere lock- en cachestatus.

### Gestructureerde opslaguitkomst

De backend retourneert exact het volgende schema. De Rust-typen krijgen `#[serde(rename_all = "camelCase")]`, zodat de getoonde veld- en codewaarden ook de IPC-waarden zijn:

```text
SaveOutcome {
  saved: bool,
  generation: u64,
  warnings: Vec<SaveWarningCode>
}

SaveWarningCode =
  | lockNotRestored
  | durabilityNotConfirmed
  | cacheCleanupIncomplete
```

Betekenis:

- Een fout vóór de vervanging verwerpt de opdracht met `Err`; er wordt dan geen `SaveOutcome` geretourneerd. Het bestaande doelbestand is nog intact en de frontend houdt het document gewijzigd.
- Iedere succesvolle `Ok(SaveOutcome)` heeft `saved = true`. De frontend werkt dan de bytecache bij en markeert het document als opgeslagen.
- `generation` is de nieuwe backendgeneratie voor het opgeslagen doelpad en wordt gebruikt om resultaten en caches van vóór de opslag als verouderd te herkennen.
- `lockNotRestored` betekent dat de nieuwe PDF geldig op schijf staat, maar een andere actor het herstellen van de lock verhinderde. De frontend toont een conflictwaarschuwing en registreert voor het document `fileLockState = 'lost'` totdat een latere lockpoging lukt.
- `durabilityNotConfirmed` betekent dat de inhoud wel is vervangen, maar de aanvullende directorysync niet kon worden bevestigd.
- `cacheCleanupIncomplete` betekent dat de generatie al veilig is verhoogd, maar één of meer oude cache-items niet konden worden vrijgegeven. Nieuwe renders mogen die oude generatie niet gebruiken; de waarschuwing betreft geheugenopruiming, niet de geldigheid van het opgeslagen bestand.

Een fout na de vervanging wordt altijd als `saved = true` met één of meer waarschuwingcodes gemodelleerd, omdat terugrollen dan niet betrouwbaar kan worden beloofd. De codes worden in de frontend vertaald; de backend stuurt geen kant-en-klare Engelstalige gebruikersmelding.

## Cache-invalidatie

Er komt één interne functie `invalidate_path_caches(path_key, states)`, die alle caches met gegevens voor die padsleutel verwijdert. Zowel `save_pdf_atomically` als de bestaande publieke opdracht `invalidate_pdf_cache` gebruiken deze functie, zodat de regels niet uiteenlopen.

Daarnaast krijgt ieder documentpad een monotone generatie in `DocumentGenerations`. Alle backendcaches nemen `(path_key, generation)` op in hun sleutel. Een renderopdracht leest de generatie eenmaal aan het begin en gebruikt die waarde voor iedere cachelookup en -insert van die opdracht. Direct na een geslaagde bestandsvervanging verhoogt de save-opdracht de generatie voordat een nieuwe frontendrender wordt gestart. Een render die vóór de opslag begon kan daarna nog afronden of een item onder de oude generatie invoegen, maar een volgende lookup gebruikt de nieuwe generatie en kan dat item niet vinden.

De functie wist voor de genormaliseerde padsleutel alle generaties uit:

- `PdfBytesCache`;
- `DocHandleCache`;
- `ThumbnailCache`;
- `PageTypeCache`;
- `TileSceneCache`;
- `PdfiumDocCache`;
- alle entries in `PixmapCacheState` waarvan de sleutel bij het document hoort.

`TileSceneCache` gebruikt niet langer een samengestelde vrije tekstsleutel met het pad als prefix. De cache krijgt een gestructureerde sleutel met afzonderlijke velden voor padsleutel, generatie, metadata, pagina en rotatie. `PixmapCache` krijgt een `remove_path`-methode die zowel de map als de FIFO-volgorde opschoont. De overige cachetypen krijgen hetzelfde expliciete `remove_path`-gedrag.

Padnormalisatie gebeurt in `normalize_path_key` vóór iedere cachelookup, cache-insert en locklookup:

1. maak het pad absoluut;
2. canonicaliseer het volledige pad als het bestaat;
3. canonicaliseer bij een nieuw Save As-doel de bestaande bovenliggende map en voeg de bestandsnaam daarna weer toe;
4. gebruik op Unix de resulterende `PathBuf` zonder letterkastwijziging;
5. verwijder op Windows een eventueel extended-pathprefix, normaliseer separators naar `\\` en vergelijk de sleutel case-insensitief door Unicode-lowercasing.

Het fysieke pad voor I/O blijft een `PathBuf`; alleen de interne sleutel wordt naar tekst omgezet. Daarmee verandert padnormalisatie geen bestandsnaam die aan het besturingssysteem wordt aangeboden.

De generatieverhoging en invalidatie vinden uitsluitend na een geslaagde vervanging plaats. Bij een mislukte schrijf- of replace-operatie blijven caches van het nog geldige bestaande bestand beschikbaar. Als het vrijgeven van oude items onverwacht faalt nadat de generatie al is verhoogd, bevat de uitkomst `cacheCleanupIncomplete`; oude items kunnen dan geheugen vasthouden maar niet meer als cachehit dienen.

Ook de frontend krijgt een centrale `rebaseDocumentAfterSave(doc, savedBytes, generation)`-functie. Deze functie:

- vervangt de entry in `originalBytesCache` door de opgeslagen bytes;
- bouwt `doc.pdfDoc` opnieuw op uit die bytes en wist `_sharedPdfLibDoc` en `_sharedPdfLibDocPromise`;
- verwijdert voor het pad de entries uit `_BITMAP_JS_CACHE`, de low-resolutioncache, page-bitmapcache, tilecache, vector-commandcache, paginatypecache en progressive-contentcache;
- wist de globale snap- en elementdetectiecaches, omdat hun huidige API geen padsleutel heeft;
- wist en vernieuwt de thumbnails van het actieve document;
- verhoogt de bestaande frontend-rendergeneraties en activeert één nieuwe render van de huidige pagina.

De asynchrone bitmap- en tilecaches houden per bestand een generatie bij en controleren die opnieuw voordat een laat `ImageBitmap`-resultaat wordt ingevoegd. De bestaande rendergeneratietokens worden bij opslag verhoogd, zodat een resultaat van vóór de opslag het huidige canvas niet alsnog kan overschrijven. De helper verandert de dirty-status niet. Als alleen het opnieuw opbouwen van `doc.pdfDoc` faalt, blijft de bevestigde schijfopslag geldig, worden de nieuwe bytes wel gecachet en toont de frontend `documentRefreshFailed`; het document wordt niet ten onrechte opnieuw als onopgeslagen aangemerkt.

De bestaande regel dat één fysiek pad maximaal één open documenttab heeft wordt op dezelfde genormaliseerde padsleutel afgedwongen. Bij het sluiten van die tab roept de frontend `release_pdf_path(path)` aan. Deze backendopdracht verhoogt de generatie, verwijdert alle padgebonden caches en geeft de gehouden lock vrij. De frontend wist dezelfde padgebonden browsercaches. Dit voorkomt dat grote documenthandles en pixmaps tot het einde van de applicatiesessie blijven leven en voorkomt dat het sluiten van een syntactisch dubbel pad een nog gebruikte lock vrijgeeft.

## Bestandsvergrendeling

De bestaande Windows-implementatie met beperkte share mode blijft functioneel gelijk, maar wordt achter een kleine interne lock-helper geplaatst zodat opslag en de publieke lock-opdrachten dezelfde logica gebruiken.

Op Unix opent de backend het bestand en vraagt daarna met `fs2::FileExt::try_lock_exclusive` een niet-blokkerende exclusieve advisory lock aan. `fs2 = "0.4"` wordt alleen onder `target.'cfg(unix)'.dependencies` toegevoegd. De `File` blijft in `LockedFiles` staan zolang de lock actief is. Bij unlock roept de backend `fs2::FileExt::unlock` aan voordat de handle wordt verwijderd.

Lock-sleutels gebruiken dezelfde padnormalisatie als de caches. Zo kan hetzelfde bestand niet tweemaal onder syntactisch verschillende paden in de lock-map terechtkomen.

## Frontendgedrag

`writeBinaryFile` blijft beschikbaar voor niet-PDF-bestanden, de webfallback en de bestaande mobiele route. De desktop-PDF-saveflow roept via `savePdfAtomically` de nieuwe raw-IPC-opdracht aan en voert niet langer zelf de losse reeks `unlockFile` → `writeBinaryFile` → `lockFile` → `invalidate_pdf_cache` uit.

De frontend verwerkt een opslagresultaat als volgt:

- Alleen na een `Ok(SaveOutcome)` met `saved = true` worden de nieuwe bytes gecachet, `rebaseDocumentAfterSave` gestart en de dirty-status gewist.
- Lock-, duurzaamheids- en cache-opruimwaarschuwingen worden na een geslaagde opslag afzonderlijk en via i18n getoond.
- Bij een verworpen backendopdracht blijft de dirty-status staan en blijven de huidige in-memory bytes behouden.
- Save As wijzigt `filePath`, `fileName` en `saveTargetPath` pas nadat `saved = true` is ontvangen.
- Een mislukte opslag mag niet stil worden genegeerd; cache-invalidatiefouten worden niet langer met een lege `catch` onderdrukt.
- Bij Save As geeft de frontend zowel het oude documentpad als het nieuwe doelpad door, zodat de backend de oude lock alleen na succes vrijgeeft.

## Foutafhandeling en herstel

- Kan het tijdelijke bestand niet worden aangemaakt of volledig worden geschreven, dan blijft het doel onaangeroerd.
- Faalt de vervanging, dan blijft het bestaande doel onaangeroerd en wordt het tijdelijke bestand verwijderd.
- Lukt het verwijderen van een tijdelijk bestand niet, dan wordt dit gelogd met alleen het lokale pad en de systeemfout; het overschrijft niet de oorspronkelijke foutmelding.
- Is het doelbestand extern vergrendeld, dan krijgt de gebruiker de bestaande begrijpelijke melding en blijft het document gewijzigd.
- Is de vervanging geslaagd maar lockherstel niet, dan staat de nieuwe inhoud op schijf, wordt dit als opgeslagen-met-waarschuwing behandeld en krijgt het document `fileLockState = 'lost'`.
- Panics worden niet gebruikt voor te verwachten I/O-fouten. Backendfouten bevatten voldoende context, maar geen PDF-inhoud of persoonlijke tokens.

## Teststrategie

De implementatie volgt test-first ontwikkeling. Productiecode wordt pas aangepast nadat de relevante test aantoonbaar faalt om de huidige situatie.

### Rust-unit- en integratietests

1. Een succesvolle opslag vervangt de oude bytes volledig.
2. Een gesimuleerde fout tijdens schrijven laat het oude bestand byte-voor-byte intact.
3. Een gesimuleerde replace-fout laat het oude bestand intact en ruimt het tijdelijke bestand op.
4. Save As naar een nog niet bestaand doel maakt precies het verwachte bestand aan.
5. Padnormalisatie levert voor equivalente paden dezelfde cachesleutel op.
6. Gerichte invalidatie verwijdert entries uit alle zeven padgebonden caches en laat entries van een ander document staan.
7. Een render die vóór opslag start en na invalidatie in de cache invoegt, kan onder de nieuwe documentgeneratie geen cachehit veroorzaken.
8. Een fout na succesvolle vervanging retourneert `saved = true` met de juiste waarschuwingcode.
9. Save As laat bij een fout de lock en caches van het bronpad intact en verhuist die pas na succes naar het doelpad.
10. Op Unix kan een tweede proces of onafhankelijke filehandle de exclusieve advisory lock niet verkrijgen zolang de eerste lock actief is; na unlock lukt dit wel.
11. De bestaande Windows-locktest bevestigt dat een conflicterende schrijf/delete-open faalt zolang Open PDF Studio de lock houdt.
12. De raw IPC-body wordt zonder JSON-deserialisatie als byteslice naar het tijdelijke bestand geschreven.

Voor foutinjectie worden schrijf-, replace-, sync- en lockstappen achter kleine interne functies of traits geplaatst. De tests hoeven daardoor geen schijfvolle machine, abrupt procesverlies of timingrace te simuleren.

### Frontendtests

1. Een succesvolle `SaveOutcome` werkt de bytecache bij en wist de dirty-status.
2. Een backendfout houdt de dirty-status en wijzigt Save As-documentmetadata niet.
3. `saved = true` met `lockNotRestored` markeert de PDF als opgeslagen, zet `fileLockState = 'lost'` en toont een afzonderlijke waarschuwing.
4. Een desktop-Tauri-save gebruikt raw IPC naar de atomaire backendopdracht en niet de directe filesystem-write.
5. Save As-documentmetadata en de oude lock veranderen pas na bevestigd succes.
6. Frontendcachegeneraties voorkomen dat een laat bitmap- of tileresultaat van vóór opslag opnieuw wordt ingevoegd of getoond.
7. De webfallback blijft een download starten en gebruikt geen desktopopdracht.
8. De mobiele Tauri-route behoudt haar bestaande opslaggedrag.
9. Een fout bij het opnieuw opbouwen van `doc.pdfDoc` na bevestigde opslag toont `documentRefreshFailed`, maar zet de dirty-status niet terug.

De bestaande build- en unittests blijven onderdeel van de verificatie. Daarnaast worden de nieuwe gerichte Rust-tests, frontendtests, typecheck en formattercontrole uitgevoerd. Reeds bestaande, niet door deze tranche veroorzaakte formatter- of toolchainproblemen worden afzonderlijk gerapporteerd en niet stil als opgelost aangemerkt.

## Implementatievolgorde

1. Testhelpers en falende Rust-tests voor atomaire vervanging toevoegen.
2. `atomic_replace_file` en de tijdelijke-bestandstransactie implementeren.
3. Falende tests voor padsleutels, documentgeneraties en complete padinvalidatie toevoegen en deze infrastructuur implementeren.
4. Falende lockcontentietests toevoegen en Unix-locking corrigeren.
5. De raw-IPC Tauri-opdracht en de geserialiseerde `SaveOutcome` registreren.
6. Falende frontendtests voor de opslaguitkomsten en late cache-resultaten toevoegen.
7. `savePdfAtomically` en de centrale frontendcache-invalidatie implementeren.
8. De desktop-PDF-saveflow op de nieuwe opdracht aansluiten en de losse desktopstappen verwijderen.
9. `release_pdf_path` bij tab-close aansluiten.
10. Gerichte tests, volledige beschikbare testsets, build, typecheck en formattercontrole draaien.
11. De uiteindelijke diff controleren op scope, tijdelijke bestanden, loggegevens en onbedoelde wijzigingen.

## Acceptatiecriteria

- Geen desktopproductiestap schrijft een bestaande PDF nog rechtstreeks over via de Tauri filesystem-plugin.
- Bij iedere vóór-vervanging geïnjecteerde fout blijft het bestaande bestand exact intact.
- Na opslag kan geen bekende backend- of frontendcache nog oude inhoud voor hetzelfde documentpad en de nieuwe generatie leveren.
- Unix-lockcontentietests bewijzen dat `lock_file` daadwerkelijk vergrendelt.
- Dirty-status en Save As-metadata veranderen alleen nadat de backend bevestigt dat de nieuwe PDF op schijf staat.
- Gedeeltelijk succes na vervanging wordt als opgeslagen-met-waarschuwing behandeld, niet als volledig mislukte opslag.
- De browserdownloadflow blijft werken.
- De mobiele opslagroute blijft werken en wordt niet ongemerkt naar raw IPC omgezet.
- De bestaande Tauri Windows-bundelconfiguratie voor de runtimebootstrapper en loaderbibliotheek blijft ongewijzigd en geldig.
- Er vindt in deze tranche geen versiebump of release plaats.

## Technische grondslag

- [Tauri 2: raw request bodies en commandheaders](https://v2.tauri.app/develop/calling-rust/)
- [Windows `MoveFileExW`: vervangen en write-through](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-movefileexw)

## Vervolgtranches

Na afronding van deze tranche worden de resterende kwaliteitsbevindingen in afzonderlijke, toetsbare wijzigingen aangepakt:

1. plugin-idvalidatie, pluginrechten en veilige opslag van persoonlijke API-sleutels;
2. typefouten, CI-quality gates en reproduceerbare regressietests voor recent verwerkte issues;
3. bevestigde dead code, gegenereerde buildartefacten en verouderde documentatie opruimen.

Deze scheiding houdt de opslagveiligheidswijziging reviewbaar en voorkomt dat security-, CI- en opschoonwerk de foutafhandeling van de save-transactie vertroebelt.
