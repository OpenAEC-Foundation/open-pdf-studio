# Claude Desktop-extensie voor Open PDF Studio (#253) — ontwerp

## Doel

Een gebruiker installeert Open PDF Studio in Claude Desktop met één klik, en de
extensie kan worden ingediend voor de extensiebibliotheek van Claude. Daarvoor
moet de app zijn MCP-server op verzoek van de gebruiker aanzetten, moet elk
gereedschap annotaties dragen, en moet er een MCPB-bundel (`.mcpb`) met
privacybeleid en documentatie zijn.

## Uitgangspunten

- De MCP-server blijft lokaal (127.0.0.1). Er gaat geen bestand naar een
  externe dienst; de extensie is een doorgeefluik tussen Claude Desktop en de
  draaiende app.
- Aanzetten is een bewuste keuze van de gebruiker: een instelling, standaard
  uit.
- De ontwikkelroute (startvlag `--mcp-server` + `OPS_ENABLE_MCP=1`, of een
  debug-build) blijft werken zoals nu, met alle gereedschappen. De testrig
  hangt ervan af.

## Onderdelen

### 1. Instelling in de app

Voorkeuren › Algemeen krijgt een groep **AI-koppeling (MCP)**:

- selectievakje *Sta AI-assistenten toe deze app te bedienen* —
  `preferences.mcpEnabled`, standaard `false`;
- poort — `preferences.mcpPort`, standaard `9223`;
- statusregel: *Actief op 127.0.0.1:9223*, *Uit*, of de foutmelding (bijv.
  poort bezet);
- korte uitleg: wat het doet, dat het lokaal blijft.

`js/core/mcp-koppeling.js` past de instelling toe via het Tauri-commando
`mcp_instellen { aan, poort }`: bij het opstarten (na `loadPreferences`) en na
Opslaan in het voorkeurenvenster. Alle 39 talen krijgen de nieuwe teksten.

### 2. Rust: aan/uit tijdens het draaien

`mcp_server` krijgt twee profielen:

| Profiel | Hoe gestart | Gereedschappen |
|---|---|---|
| `Publiek` | via de instelling (`mcp_instellen`) | alles behalve ontwikkel- en interne gereedschappen |
| `Ontwikkeling` | startvlag + `OPS_ENABLE_MCP=1`, of debug-build | alles, zoals nu |

- `mcp_instellen` bindt de poort synchroon (een bezette poort komt als fout
  terug in de statusregel), start de server met graceful shutdown en bewaart
  de stop-sleutel in een globale `Mutex`. Uitzetten stuurt het stopsignaal.
- Draait de server al via de startvlag, dan laat `mcp_instellen` hem met rust
  en meldt de status *actief via startvlag*.
- `mcp_status` geeft `{ actief, poort, bron, fout }` voor de statusregel.

**Beveiliging.** Nu de server door gewone gebruikers aan kan, weigert de
handler verzoeken met een `Origin`-kop die niet lokaal is, en een `Host`-kop
die niet `127.0.0.1:<poort>` of `localhost:<poort>` is. Zo kan een website de
app niet via de browser besturen (ook niet via DNS-rebinding). De stdio-brug
stuurt geen `Origin`.

### 3. Annotaties en profielen per gereedschap

Een nieuwe tabel `src-tauri/src/mcp_tool_meta.rs`: per gereedschap een
Engelse `title`, `readOnlyHint`, `destructiveHint` en het profiel.
`handle_tools_list(profiel)` filtert op profiel en voegt
`annotations: { title, readOnlyHint, destructiveHint, openWorldHint: false }`
toe. Een `tools/call` naar een gereedschap buiten het profiel geeft een
duidelijke fout.

Indeling (62 gereedschappen):

- **Alleen lezen** (`readOnlyHint: true`) — opvragen en weergave: o.a.
  `app_list_annotations`, `app_get_annotation`, `app_list_tabs`,
  `app_get_page_count`, `app_get_takeoff`, `app_list_commands`,
  `app_screenshot_view`, `app_get_viewport_state`, `app_get_current_tool`,
  `app_assistant_history`, en de weergavegereedschappen (zoom, pagina, tab
  wisselen, passend maken, weergavemodus, selecteren, gereedschap kiezen,
  PDF openen). Weergave wijzigt geen gegevens.
- **Toevoegend** (`readOnlyHint: false, destructiveHint: false`) — o.a.
  `app_create_annotation`, `app_new_blank_pdf`, `app_snippet_cut`,
  `app_snippet_paste`, `app_place_schedule`, `app_merge_pdf`,
  `app_symbol_scale`, `app_assistant_ask/pending/answer`, `app_mouse_move`,
  `app_scroll`.
- **Wijzigend** (`destructiveHint: true`) — o.a. `app_update_annotation`,
  `app_delete_annotation`, `app_undo`, `app_redo`, `app_close_tab`,
  `app_save_pdf`, `app_set_measure_scale`, `app_snippet_flatten`,
  `app_titleblock`, en de generieke besturing `app_run_command`,
  `app_click_element`, `app_mouse_click`, `app_mouse_drag`, `app_key`,
  `app_type`. Claude vraagt bij deze gereedschappen altijd toestemming.
- **Alleen in Ontwikkeling** — ontwikkelgereedschappen: `app_get_recent_console`,
  `app_zoom_anchor_test`, `app_clear_caches`, `app_wheel_zoom`, `app_ui_state`,
  `app_set_window_size`, `list_test_pdfs`, `screenshot_page`, `screenshot_all`,
  `get_pdf_metadata`; en de interne OpenAEC-accountkoppeling
  `app_ai_complete`, `app_accounts_status`, `app_accounts_fetch` (die laatste
  is een generieke API-aanroep met methode-parameter — precies het patroon dat
  de beoordeling afwijst).

Publiek profiel: 49 gereedschappen.

Een Rust-test eist dat elk gereedschap in de tabel staat (en omgekeerd), dat
elk publiek gereedschap annotaties heeft, en dat
`mcp-stdio/tools.json` gelijk is aan de publieke `tools/list`
(`OPDS_MCPB_TOOLS_SCHRIJVEN=1` schrijft hem opnieuw).

**Risico.** De generieke besturing (`app_run_command`, muis, toetsenbord) staat
op verzoek van de gebruiker in het publieke profiel. De beoordeling wijst
alles-in-één-gereedschappen soms af; ze dragen daarom `destructiveHint: true`
en een smalle beschrijving. Wijst de beoordeling ze af, dan verhuizen ze naar
het ontwikkelprofiel — één regel in de tabel.

### 4. De stdio-brug (`mcp-stdio/server.mjs`)

Blijft één bron voor Claude Code (handmatige configuratie) en de extensie.
Nieuw:

- **Terugval als de app niet draait.** `initialize` wordt dan lokaal
  beantwoord, `tools/list` uit het meegeleverde `tools.json`, en een
  `tools/call` geeft een resultaat met `isError: true` en de instructie
  *Start Open PDF Studio en zet Instellingen › AI-koppeling aan*. Zo is de
  extensie niet leeg als Claude Desktop eerder start dan de app, en werkt ze
  zodra de app draait.
- De logica wordt testbaar opgesplitst: `maakBrug({ endpoint, tools, fetch })`
  → `verwerk(regel)`; het stdio-deel blijft een dunne schil.

### 5. De bundel (`mcpb/`)

- `mcpb/manifest.json` — `manifest_version: "0.3"`, `name: open-pdf-studio`,
  `display_name: Open PDF Studio`, versie gelijk aan de app (via
  `scripts/bump-version.js`), `server.type: node`, `entry_point:
  server/index.js`, `mcp_config.env.OPS_MCP_PORT: ${user_config.port}`,
  `user_config.port` (number, standaard 9223, 1024–65535), `compatibility`
  (darwin/win32/linux, node ≥ 18), `tools` (naam + beschrijving uit
  `tools.json`), `privacy_policies`, `homepage`, `documentation`, `support`,
  `repository`, `license: MIT`, `icon: icon.png`, `keywords`.
- `mcpb/README.md` — installatie, de instelling in de app, drie
  voorbeeldopdrachten, **Privacy Policy**-sectie (verplicht).
- `mcpb/scripts/pack.mjs` — zet in `mcpb/build/` de manifest, het icoon,
  `server/index.js` (kopie van de brug) en `server/tools.json` klaar, werkt de
  `tools`-lijst en versie in de manifest bij, valideert en pakt met
  `npx @anthropic-ai/mcpb pack` in tot `open-pdf-studio.mcpb`.
- `release.yml` krijgt een job `mcpb` (na `create-release`) die de bundel
  maakt en aan de release hangt. De release telt dan één asset meer.

### 6. Website en indienen

- De website-sessie maakt twee pagina's: een privacybeleid voor de
  AI-koppeling (gegevensverzameling, gebruik en opslag, delen met derden,
  bewaartermijn, contact) en een documentatiepagina. Hun URL's staan in de
  manifest.
- Het indienformulier voor desktopextensies vult de gebruiker zelf in; ik lever
  een document met alle antwoorden (naam, tagline, beschrijving, use cases,
  testinstructies).

## Testen

- Node: brug-unit-tests (terugval, doorsturen, foutmelding, notificaties),
  manifest-test (tools-lijst gelijk aan `tools.json`, versie gelijk aan de app).
- Rust: annotatie- en profieltests; `tools.json`-gelijkheid; Origin/Host-check.
- Live: rig met de instelling aan (publiek profiel: 49 tools, ontwikkeltool
  geweigerd), uit (server weg), poort bezet (fout in status); brug tegen de
  rig; `mcpb validate` en `mcpb pack` slagen.

## Buiten scope

- De app automatisch starten vanuit de extensie.
- Een externe (remote) connector.
- Het indienen zelf.
