# Ontwerp: macOS-releasekwaliteit voor versie 1.78

Status: goedgekeurd ontwerp, nog niet geïmplementeerd

Doelbranch: `codex/mac-quality-178`, gebaseerd op `origin/main`

Gerelateerde GitHub-items: PR #251 en issues #291, #208, #252 en #276

## Aanleiding

De huidige `main` bevat al meerdere verbeteringen die na de basis van PR #251 zijn toegevoegd: platformcorrecte sidecar-namen, een gebundelde macOS-PDFium-library, Developer ID-signing, notarisatie en een recentere `tao`-versie. PR #251 rechtstreeks mergen zou deze nieuwere oplossingen deels vervangen door oudere buildlogica. De PR roept onder andere Cargo opnieuw aan vanuit `build.rs`, terwijl het huidige buildscript dit bewust vermijdt wegens de target-lock van de bovenliggende Cargo-build.

De resterende problemen zijn kleiner en duidelijk af te bakenen:

- een verse macOS-clone mist de genegeerde `libpdfium.dylib`, waardoor lokale dev- en releasebuilds zonder handmatige download falen;
- het hoofdvenster is aanvankelijk verborgen en wordt pas later door de frontend getoond, een patroon dat op macOS 26 eerder tot een onzichtbaar of onresponsief venster leidde;
- de bestaande releasechecks bewijzen nog niet dat de gebouwde app werkelijk start, een zichtbaar venster heeft en na initialisatie blijft draaien;
- aangeleverde 1.67-crashrapporten tonen `SIGABRT` door een Rust-panic in de macOS-launchcallback. Ze tonen geen `CODESIGNING`-termination. De huidige signing- en runtimewijzigingen moeten daarom met een echte macOS-26-starttest worden bewezen;
- een aangeleverde verificatie-PDF bevat een beeldconstructie die op de laatste pagina niet in de app verschijnt. Hiervoor ontbreekt een kleine, herhaalbare regressiefixture;
- diagnostiek bij startup-problemen bevat onvoldoende fase-informatie om build-, native-library-, venster- en frontendproblemen snel te onderscheiden.

## Doelen

1. `npm run tauri:dev` en `npx tauri build` werken op een verse macOS-clone zonder handmatige native-library-stap.
2. Lokale builds en CI gebruiken exact dezelfde gepinde native dependency en checksumcontrole.
3. De hoofdwindow wordt zichtbaar aangemaakt en is niet afhankelijk van een latere frontend-`show()` om bruikbaar te worden.
4. Een GitHub Actions-job op macOS 26 bouwt de universal app, controleert de inhoud en voert een echte start-smoketest uit.
5. Nightly- en releasebuilds controleren signing, notarisatie en stapling voordat een artifact als bruikbaar geldt.
6. Startupdiagnostiek registreert lokale, privacyvriendelijke fasemarkers en foutketens zonder documentinhoud of volledige documentpaden.
7. Het ontbrekende-beeldprobleem krijgt een minimale, niet-vertrouwelijke regressiefixture en een automatische renderassertie.
8. Versievelden worden gezamenlijk verhoogd van 1.77.0 naar 1.78.0.
9. Windows- en Linux-releasegedrag blijft intact, inclusief de Windows-sidecar-signing, WebView2-bootstrapper en `WebView2Loader.dll`.

## Niet-doelen

- PR #251 integraal rebasen of de duizenden gegenereerde bestanden uit die PR in deze releaseopschoning meenemen.
- Native libraries voor alle platformen opnieuw organiseren.
- De PDFium-versie boven de huidige, al gevalideerde release verhogen.
- Automatische crashtelemetrie of stille verzending van gebruikersdata toevoegen.
- De originele aangeleverde verificatie-PDF in de repository opnemen.
- Android-signing wijzigen. APK- en AAB-signing blijven een afzonderlijke releasewerkstroom met één blijvende productiesleutel.

## Overwogen aanpakken

### 1. Gerichte integratie op actuele `main` - gekozen

Alleen ontbrekende macOS-build-, startup-, diagnostiek- en regressietestonderdelen worden toegevoegd. Bestaande platformfixes blijven behouden. Dit geeft de kleinste reviewbare wijziging en de laagste regressiekans.

### 2. Universele macOS-library in Git committen

Dit maakt een verse clone direct bouwbaar en is eenvoudig, maar vergroot iedere clone met ongeveer 14 MB en maakt dependency-updates minder controleerbaar. De al bestaande Linux- en Windows-binaries worden in deze wijziging niet als precedent gebruikt om nog een binary toe te voegen.

### 3. PR #251 rechtstreeks mergen

Niet gekozen. De PR is gebaseerd op een oude `main`, bevat inmiddels achterhaalde platformfixes, gebruikt een oudere native-libraryrelease, heeft een onbetrouwbaar pad voor universal builds en verwijdert relevante Windows-signingstappen.

## Ontwerp

### Native dependencyvoorbereiding

Er komt één klein Node-script onder `open-pdf-studio/scripts/` met twee verantwoordelijkheden:

1. op macOS bepalen of `src-tauri/binaries/macos-universal/libpdfium.dylib` met de verwachte metadata aanwezig is;
2. bij ontbreken de gepinde universal archive downloaden, SHA-256 controleren, alleen het vereiste bestand uitpakken en het resultaat atomair op zijn definitieve plaats zetten.

De URL, upstreamversie, archive-SHA-256, archivepad en lokale doelnaam staan bij elkaar in een afzonderlijk, importeerbaar manifest. Het script gebruikt een tijdelijke map binnen de buildomgeving en hernoemt pas na succesvolle checksum- en bestandstypecontrole. Na installatie schrijft het atomair een klein markerbestand met versie en geverifieerde archivehash. Alleen de combinatie van dylib en overeenkomende marker geldt als geldige cache; een los of verouderd bestand wordt opnieuw voorbereid. Een mislukte download, checksumafwijking of ontbrekend archive-element levert een korte fout met hersteladvies en een niet-nul exitcode op. Een reeds geldige cache veroorzaakt geen netwerkverkeer.

`predev` en `prebuild` roepen dit script aan vóór de bestaande worker-build. De macOS-workflow gebruikt dezelfde npm-route; de dubbele handgeschreven `curl`/`tar`-stap verdwijnt. Windows en Linux krijgen een expliciete, geteste no-op en behouden hun huidige binaries en releasepaden.

Er komt geen Cargo-aanroep in `build.rs`. Dat script blijft uitsluitend de reeds gebouwde sidecar naar de Tauri-naam kopiëren.

### Vensterstart

Het hoofdvenster wordt zichtbaar aangemaakt. De bestaande frontend-call die het venster na de eerste paint toont, wordt verwijderd of idempotent gemaakt zodat hij geen noodzakelijke startupstap meer is. De neutrale bestaande achtergrondkleur blijft zichtbaar tijdens de korte frontendinitialisatie, zodat dit geen zwart of transparant startvenster oplevert.

De startupcode legt de volgende lokale fasen vast:

- proces gestart;
- Tauri-builder aangemaakt;
- setup-hook gestart;
- resource-directory gevonden;
- PDFium geladen of gecontroleerd gedegradeerd;
- hoofdvenster aanwezig en zichtbaar;
- frontend gereed.

De frontend meldt gereedheid één keer via een smalle Tauri-command nadat de eerste render is voltooid. Rust logt daarop de fase `frontend-ready`; dezelfde marker is het synchronisatiepunt voor de start-smoketest. Een fout in een optionele renderdependency blijft niet-fataal. Een fout die starten onmogelijk maakt, bevat de laatste voltooide startupfase en de volledige Rust-foutketen.

### Lokale diagnostiek

Diagnostiek wordt lokaal opgeslagen in de Tauri-logdirectory met rotatie en een kleine maximale bewaartermijn. Standaard bevat het rapport:

- appversie en buildtype;
- besturingssysteem en CPU-architectuur;
- startupfasen en tijden;
- aanwezigheid en laadresultaat van de native renderlibrary en worker;
- panic- en foutketeninformatie;
- signingstatus die de app zelf veilig kan waarnemen.

Documentinhoud, annotaties en volledige bestandspaden worden niet opgeslagen. Als een pad nodig is voor diagnose, wordt alleen de extensie en een eenrichtingshash opgenomen. Export is uitsluitend een bewuste gebruikersactie via Help en produceert een leesbaar tekstbestand of zip met logbestanden en een korte privacyverklaring.

### PDF-renderregressie

De aangeleverde verificatie-PDF wordt alleen lokaal gebruikt om de onderliggende objectconstructie te bepalen. Daarna wordt een minimale synthetische PDF-fixture gemaakt met uitsluitend die constructie en niet met de originele tekst, afbeeldingen of metadata.

De regressietest rendert de relevante pagina en controleert minimaal:

- dat het verwachte beeldgebied niet volledig wit of transparant is;
- dat het aantal niet-achtergrondpixels boven een stabiele ondergrens ligt;
- dat de fixture zonder panic of ontbrekende-resourcefout opent;
- dat de bestaande renderregressies niet veranderen buiten een kleine, vastgelegde tolerantie.

Als de oorzaak in Form XObjects, masks, clipping, optionele content of resource-overerving ligt, wordt de test op het kleinste relevante PDF-objectniveau gehouden. Daardoor blijft de fixture klein en verklaart de test precies welke constructie wordt ondersteund.

### macOS-26 CI en releasecontrole

Een gerichte PR-job draait op de officiële Apple Silicon `macos-26` runner wanneer native build-, Tauri-, render- of workflowbestanden wijzigen. De job:

1. installeert Node en Rust met beide Apple-targets;
2. voert de gedeelde native-dependencyvoorbereiding uit;
3. bouwt beide workerarchitecturen en de universal app;
4. controleert met platformtools dat hoofdprogramma, worker en PDFium-library de vereiste architecturen bevatten;
5. controleert dat de gebundelde resourcepaden bestaan;
6. gebruikt voor de PR-smoketest een expliciete ad-hoc signature;
7. start de `.app`, wacht op de frontend-readymarker, verifieert procesoverleving en controleert via een klein Swift/CoreGraphics-hulpprogramma dat minstens één on-screen hoofdvenster van de bundle bestaat;
8. sluit de app gecontroleerd af en faalt bij een nieuw crashrapport.

Nightly en release blijven de huidige Developer ID-omgeving gebruiken. Direct na bundling controleren zij daarnaast:

- `codesign --verify --deep --strict` op de `.app`;
- de verwachte signing identity en hardened runtime;
- Gatekeeper-beoordeling;
- stapling/notarisatiestatus van app en DMG;
- de universal architecturen en vereiste resources;
- dezelfde start-smoketest op de gebouwde app.

De huidige Tauri-interface blijft leidend: `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD` en `APPLE_SIGNING_IDENTITY` voor signing; `APPLE_ID`, `APPLE_PASSWORD` en `APPLE_TEAM_ID` voor notarisatie. Geheimen worden nooit geprint of beschikbaar gemaakt aan fork-PR's.

### Bouwdocumentatie

De README noemt Node 20+, Rust stable, CMake en Xcode Command Line Tools als macOS-prerequisites. De bouwinstructies leggen uit dat native renderlibraries automatisch en checksum-gecontroleerd worden voorbereid, waar de lokale cache staat en hoe een ontwikkelaar die cache veilig opnieuw laat opbouwen. De documentatie bevat geen handmatige downloadstap en geen verwijzing naar een gebruikersspecifiek bestandspad.

### Kwaliteitsgrenzen

De integratie-PR blijft beperkt tot bovengenoemde onderdelen. Verwijdering van omvangrijke historische buildartefacten wordt een afzonderlijke onderhouds-PR. Voor gewijzigde code zijn de volgende checks verplicht:

- Rust-formattering, Clippy op de gewijzigde workspacecrates en gerichte Rust-tests;
- TypeScript-typecheck en bestaande frontendbuild;
- Node-tests voor platformselectie, geldige cache, checksumfout en atomische installatie;
- regressietest voor de synthetische beeldfixture;
- configuratieasserties voor WebView2, platformresources, sidecars en vensterzichtbaarheid;
- macOS-26 build- en startsmoke.

## Foutafhandeling en herstel

- Een native downloadfout laat bestaande geldige bestanden ongemoeid.
- Een checksumfout verwijdert uitsluitend de tijdelijke download en meldt de verwachte en ontvangen hash.
- Een ontbrekende PDFium-library laat de app starten in gedegradeerde modus, maar laat build- en releasechecks falen.
- Een ontbrekende sidecar schakelt de workerpool lokaal uit met een duidelijke melding; releasechecks beschouwen dit als fout.
- Een mislukte notarisatie of stapling houdt nightly/release tegen.
- Een startupcrash bewaart de laatst voltooide startupfase en leidt tot een mislukte smoketest.

## Versie en GitHub-afhandeling

Alle gezaghebbende versievelden gaan gezamenlijk naar 1.78.0. Na groene lokale checks en groene PR-CI wordt de gerichte integratie-PR gemerged. PR #251 krijgt een onderhoudersreactie die aangeeft welke ideeën al op `main` stonden, welke gericht zijn overgenomen en waarom de PR niet integraal is gemerged; relevante bijdrage-attributie blijft behouden.

Issues worden alleen gesloten met bewijs. Als code of workflowlogica aantoonbaar uit PR #251 wordt aangepast, krijgt de bijbehorende commit een `Co-authored-by`-regel; anders blijft de bijdrage zichtbaar via de afsluitende PR-reactie en een link vanuit de integratie-PR.

De issuecriteria zijn:

- #291 na een groene build vanuit een schone macOS-omgeving zonder handmatige download;
- #208 na een macOS-26-test die een zichtbaar, interactief venster bevestigt;
- #252 en #276 na een gesigneerde en genotariseerde 1.78-nightly die op macOS 26 start zonder nieuw crashrapport.

## Acceptatiecriteria

- Een schone macOS-clone doorloopt `npm install` en `npm run tauri:dev` zonder handmatige PDFium-stap.
- `npx tauri build --target universal-apple-darwin` produceert een universal app en DMG met de juiste worker en renderlibrary.
- De app toont op macOS 26 een hoofdvenster, blijft minimaal tien seconden draaien en sluit gecontroleerd af.
- PR-builds gebruiken geen productiesigninggeheimen; nightly/release zijn geldig gesigneerd, genotariseerd en gestapled.
- De synthetische beeldfixture rendert het bedoelde beeldgebied en faalt vóór de bijbehorende rendererfix.
- Startupdiagnostiek bevat fase en foutketen, maar geen documentinhoud of volledige documentpaden.
- Windows-config bevat nog steeds `embedBootstrapper` en `WebView2Loader.dll`; de Windows-sidecar wordt nog vóór bundling gesigneerd.
- Linux-build- en renderchecks blijven groen.
- Alle versievelden zijn 1.78.0 en onderling consistent.
- PR #251 en de vier Mac-issues zijn met toetsbaar bewijs bijgewerkt.
