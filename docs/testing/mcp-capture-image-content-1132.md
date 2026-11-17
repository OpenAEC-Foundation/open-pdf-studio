# MCP-afbeeldingsresultaten (#1132)

`app_capture_region` en `app_screenshot_view` stuurden afbeeldingen alleen als
base64 in een JSON-tekstblok. Clients die uitsluitend MCP-afbeeldingsblokken aan
het model doorgeven, konden de opname daardoor niet zien.

De native server voegt bij een geslaagde inline opname een `image`-blok toe met
`data` en `mimeType`. PNG en JPEG gebruiken het werkelijk geretourneerde MIME-type.
Het eerste tekstblok blijft het volledige oorspronkelijke JSON-resultaat, inclusief
base64, zodat bestaande clients blijven werken. Dit verdubbelt de base64 in het
antwoord; bestaande limieten op opnameafmetingen blijven gelden.

Een opname met `path` blijft een bestandsexport met alleen metadata. Laat `path`
weg om een inline afbeelding te ontvangen. `app_screenshot_view` heeft geen
`path`-parameter. Andere gereedschappen behouden hun bestaande resultaatvorm.
Capturefouten krijgen `isError: true` en geen afbeeldingsblok.

Bij `forbidden path` noemt de server de actuele toegestane en geweigerde patronen
uit de bestaande bestandsscope. Het antwoord vermeldt ook dat vensterrechten,
OS-rechten en expliciete weigeringen blijven gelden. De diagnose verleent geen
rechten en garandeert niet dat ieder genoemd patroon beschrijfbaar is. TEMP,
Pictures en Documents krijgen niet automatisch toegang. De gebruiker kan een
bestemming kiezen via Home > Screenshot > Save; een agent kan een reeds toegestane
bestemming hergebruiken of zonder `path` werken.

## Regressiecontroles

- De oorspronkelijke tekstverpakking faalt op drie van vier gerichte tests:
  PNG-afbeeldingsblok, JPEG/PNG-regio en foutmarkering. De compatibiliteitstest slaagt.
- Vijf Rust-tests controleren afbeeldingsblokken, ongewijzigde legacy JSON,
  MIME-type, bestandsexport, foutgevallen, andere tools, lege beelden en diagnose
  met zowel bestaande als lege scopes. CI draait deze in de volledige Tauri-crate.
- De stdio-brugtest controleert dat beide contentblokken ongewijzigd aankomen.
- Een browserproef maakt een echte blanco PDF, vangt PNG/JPEG-regio's en een
  documentweergave op, verwerkt de antwoorden met de echte Rust-resultaatfunctie
  en decodeert de afbeeldingen opnieuw in Chromium. Dit is geen kwalificatie van
  een geïnstalleerde Windows-app of een specifieke externe MCP-client.

Vanaf de repositoryroot:

```sh
cargo test --locked -p open-pdf-studio --lib mcp_server::capture_result::tests
cargo test --locked -p open-pdf-studio --lib mcp_server::tests::tools_json_van_de_brug_is_actueel
node --test mcp-stdio/brug.test.mjs
node python/scripts/generate-tools.mjs --check
```

Daarnaast: volledige JS-unittests, TypeScript, productiebuild en versiecontrole.
De ingebouwde catalogue-test vereist dezelfde numerieke representatie (`32.0`)
voor de bestaande zoomgrens in het JSON-bestand. De ontbrekende declaratie van
`Preferences.ocrLanguage` is toegevoegd om de bestaande typecontrole te laten slagen.

Protocolreferentie: [MCP image content](https://modelcontextprotocol.io/specification/2025-06-18/server/tools#image-content).

Installerkwalificatie blijft apart: de installerworkflow in de persoonlijke fork
is uitgeschakeld. Een concept-PR en een ongepubliceerde conceptrelease zijn geen
gekwalificeerde installer en geen upstream merge.
