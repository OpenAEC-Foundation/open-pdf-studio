# Auto-schaalgebieden (skill 1) — Implementatieplan

> **Voor agentic workers:** VEREISTE SUB-SKILL: superpowers:subagent-driven-development (aanbevolen) of superpowers:executing-plans om dit plan taak-voor-taak uit te voeren. Stappen gebruiken `- [ ]`.

**Goal:** Een AI-assistent-skill die per viewport de schaal detecteert (vision + ingebedde tekst, geverifieerd) en automatisch een `scaleRegion` plaatst — werkend voor raster én vector.

**Architecture:** Twee nieuwe MCP-tools (`app_extract_text`, `app_render_page`) geven de assistent-brain (Claude Code, vision-capable) de ingebedde pagina-tekst + een hoge-res pagina-PNG op schijf. Een `SKILL.md` orkestreert: render → vision × tekst-detectie → `app_create_annotation(type:'scaleRegion')` per viewport. Plaatsing gebruikt de bestaande scaleRegion-annotatie.

**Tech Stack:** Rust/PDFium (render + tekstextractie), JS MCP-bridge (SolidJS-app), Claude Agent Skill (`SKILL.md`).

**Verificatie (geen unit-runner aanwezig):** via de test-rig + MCP op 9223 (rebuild + herstart na Rust-wijzigingen; JS HMR't). Zie memory [[mcp-test-rig]] + [[local-build-onedrive-workaround]].

---

## File Structure

| Bestand | Verantwoordelijkheid | Actie |
|--------|----------------------|-------|
| `js/mcp-bridge.js` | `handleExtractText` (roept `invoke('extract_page_text')`) + HANDLERS-entry `'mcp:extract-text'` | Modify |
| `src-tauri/src/mcp_server.rs` | tool-defs + dispatch voor `app_extract_text` (bridge) en `app_render_page` (Rust render-naar-file) | Modify |
| `~/.claude/skills/auto-scale-regions/SKILL.md` | de assistent-skill (werkstroom + MCP-recept) | Create |

---

## Task 1: MCP-tool `app_extract_text` (ingebedde tekst + posities)

**Files:**
- Modify: `js/mcp-bridge.js` (nieuwe handler + HANDLERS-entry, naast de andere `handle*`-functies)
- Modify: `src-tauri/src/mcp_server.rs` (tool-def na `app_accounts_fetch`, dispatch-arm na `app_accounts_fetch`)

- [ ] **Stap 1: bridge-handler** — voeg toe in `js/mcp-bridge.js`:

```js
/** Ingebedde tekst + posities van de actieve pagina (PDF-coords) — voor het
 *  tekst-pad van de auto-schaalgebieden-skill. */
async function handleExtractText() {
  const stateMod = await import('./core/state.js');
  const doc = stateMod.getActiveDocument();
  if (!doc?.filePath) return { ok: false, error: 'geen actief document met bestandspad' };
  const platform = await import('./core/platform.js');
  const pageIndex = (doc.currentPage || 1) - 1;
  let items = [];
  try {
    const jsonStr = await platform.invoke('extract_page_text', { path: doc.filePath, pageIndex });
    const parsed = JSON.parse(jsonStr);
    items = Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return { ok: false, error: `extract_page_text faalde: ${e?.message ?? e}` };
  }
  // Elk item: { text, x, y, fontSize, width } in PDF user space (Y-up, baseline).
  return { ok: true, page: doc.currentPage || 1, count: items.length, items };
}
```

- [ ] **Stap 2: HANDLERS-entry** — in het `HANDLERS`-object van `mcp-bridge.js`, naast de andere entries:

```js
  'mcp:extract-text': handleExtractText,
```

- [ ] **Stap 3: tool-def** — in `mcp_server.rs`, in de tools/list-array (na de `app_accounts_fetch`-def):

```rust
            {
                "name": "app_extract_text",
                "description": "Return the embedded text of the LIVE app's current page with positions (PDF user space, Y-up): { ok, page, count, items:[{ text, x, y, fontSize, width }] }. Empty items[] means a scanned/raster page with no embedded text. Feeds the scale-detection skill's text path.",
                "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false }
            },
```

- [ ] **Stap 4: dispatch-arm** — in de match in `mcp_server.rs` (na de `app_accounts_fetch`-arm):

```rust
        "app_extract_text" => tool_app_request(state, "mcp:extract-text", &arguments, Duration::from_secs(20)).await,
```

- [ ] **Stap 5: rebuild rig** (Rust gewijzigd): kill exe → `CARGO_TARGET_DIR=C:/Users/rickd/AppData/Local/Temp/opds-build-166 cargo build --manifest-path .../src-tauri/Cargo.toml` → herstart `--mcp-server` via `Start-Process` (detached).

- [ ] **Stap 6: verifieer via MCP** — open een vector-PDF; `app_extract_text` → `{ ok:true, count>0, items:[{text:"1:100",...}] }`. Open een gescande (raster) PDF → `count:0` (vision-pad nodig).

- [ ] **Stap 7: commit** — `git add ... && git commit -m "feat(mcp): app_extract_text — ingebedde tekst + posities"`

---

## Task 2: MCP-tool `app_render_page` (hoge-res pagina-PNG naar bestand)

**Files:**
- Modify: `src-tauri/src/mcp_server.rs` (nieuwe async tool-functie gemodelleerd op `app_screenshot_view` ~r860; tool-def + dispatch-arm)

- [ ] **Stap 1: render-naar-file-tool** — voeg een functie toe gemodelleerd op de `app_screenshot_view`-handler (zelfde `render_page_to_rgba(doc, page_index, scale, 0)` met `scale = width / page.width()`), maar schrijf de PNG naar een tijdelijk bestand i.p.v. base64. Hergebruik `render_to_png::encode_rgba_to_png_base64` + base64-decode (de `base64`-crate is al dep; controleer in `Cargo.toml`), of voeg `encode_rgba_to_png_bytes` toe in `render_to_png.rs`. Schrijf naar `std::env::temp_dir().join(format!("opds-render-p{}.png", page_index))` en geef het pad terug:

```rust
// (in de tool-functie, na render_page_to_rgba → render_width/height/rgba)
let png_b64 = crate::render_to_png::encode_rgba_to_png_base64(render_width, render_height, &render_rgba)
    .map_err(|e| (jsonrpc_error::INTERNAL_ERROR, format!("encode png: {e}")))?;
let png_bytes = base64::engine::general_purpose::STANDARD.decode(png_b64.as_bytes())
    .map_err(|e| (jsonrpc_error::INTERNAL_ERROR, format!("b64 decode: {e}")))?;
let out_path = std::env::temp_dir().join(format!("opds-render-p{}.png", page_index));
tokio::fs::write(&out_path, &png_bytes).await
    .map_err(|e| (jsonrpc_error::INTERNAL_ERROR, format!("write png: {e}")))?;
let payload = json!({ "path": out_path.to_string_lossy(), "width": render_width, "height": render_height });
```

> Args: `{ path (string), pageIndex (u32), width (u32, default 3000) }`. `width` = render-pixelbreedte; 3000 px geeft leesbare schaal-labels. Hergebruik de `path`/`page_index`/`width`-parsing van `app_screenshot_view`.

- [ ] **Stap 2: tool-def** — in `mcp_server.rs` tools/list:

```rust
            {
                "name": "app_render_page",
                "description": "Render a page of a PDF to a high-resolution PNG file on disk and return its path: { ok, path, width, height }. The assistant Reads that file to 'see' the drawing (vision path of the scale-detection skill). Works for raster and vector pages.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "path":      { "type": "string", "description": "PDF file path (use the active doc's filePath from app_get_viewport_state)." },
                        "pageIndex": { "type": "integer", "description": "0-based page index." },
                        "width":     { "type": "integer", "description": "Render width in pixels (default 3000)." }
                    },
                    "required": ["path", "pageIndex"],
                    "additionalProperties": false
                }
            },
```

- [ ] **Stap 3: dispatch-arm** — let op: dit is een **Rust-native** tool (geen `tool_app_request`); roep direct de nieuwe functie aan zoals `app_screenshot_view` dat doet (zie ~r701 voor het patroon — `app_screenshot_view` heeft z'n eigen Rust-pad, geen bridge). Voeg de arm toe naast `app_screenshot_view`.

- [ ] **Stap 4: rebuild + herstart rig.**

- [ ] **Stap 5: verifieer** — `app_render_page {path:<doc>, pageIndex:0, width:3000}` → `{ ok, path }`; `Read` het pad → leesbaar pagina-beeld (schaal-labels zichtbaar).

- [ ] **Stap 6: commit** — `git commit -am "feat(mcp): app_render_page — hoge-res pagina-PNG naar bestand"`

---

## Task 3: `SKILL.md` — auto-scale-regions

**Files:**
- Create: `~/.claude/skills/auto-scale-regions/SKILL.md`

- [ ] **Stap 1: schrijf de skill**

````markdown
---
name: auto-scale-regions
description: Use in Open PDF Studio when the user wants to automatically place scale regions (schaalgebieden) on a construction drawing with multiple viewports — detects each viewport's scale (vision + embedded text, raster and vector) and drops a scaleRegion per viewport. Triggers like "plaats schaalgebieden", "detecteer de schalen", "auto scale regions".
---

# Auto scale regions on multi-viewport drawings

Drive Open PDF Studio via its MCP server (POST 127.0.0.1:9223 /mcp, JSON-RPC `tools/call`).

## Workflow
1. **Context**: `app_get_viewport_state` → the active doc's `filePath`, `pageNum`, `pageW`, `pageH`.
2. **Image (vision)**: `app_render_page { path, pageIndex: pageNum-1, width: 3000 }` → `path`. Read that PNG to SEE the page.
3. **Text**: `app_extract_text` → `items:[{text,x,y,fontSize,width}]` (PDF coords, Y-up). Empty → scanned/raster page → rely on vision only.
4. **Detect viewports + scales (combine + verify)**:
   - From the image: segment the drawing into viewport regions (title blocks / borders) and read each region's scale label (e.g. `1:100`).
   - From the text: find scale labels (`/\b1\s*:\s*\d+(?:[.,]\d+)?\b/`, "schaal/scale 1:X") + their positions; map each to the viewport region it sits in.
   - Final scale per viewport = the **text** value when a matching label falls inside the region bounds, else the **vision** reading. Normalize to `1:X`. Skip a viewport with no scale found (report it).
5. **Coords**: text positions are already PDF space. Convert vision pixel-bounds → PDF: `pdfX = px / (width/pageW)`, `pdfY = pageH - py/(width/pageW)` (Y-flip; `width` = the render width used).
6. **Place** (direct): for each viewport `app_create_annotation { type:'scaleRegion', props:{ x, y, width, height, scaleString, units:'mm', label } }` (x/y/width/height = viewport bounds in PDF coords).
7. **Report**: list per viewport the placed scale + flag any skipped/uncertain ones.

## Notes
- Units default `mm` (NL construction) unless the label says otherwise.
- Bounds must not overlap between adjacent viewports.
- This is step 1 of the drawing-analysis pipeline; the placed scaleRegions feed later area/length take-off.
````

- [ ] **Stap 2: verifieer dat de skill geladen wordt** — start een Claude Code-sessie (de relay-brain) en bevestig dat `auto-scale-regions` in de skill-lijst staat.

- [ ] **Stap 3: commit** — de SKILL.md staat in `~/.claude` (gitignored); niet in de repo committen. Noteer in de PR-omschrijving dat de skill apart gedeeld wordt.

---

## Task 4: End-to-end verificatie (rig)

- [ ] **Stap 1** — open een multi-viewport constructietekening in de rig.
- [ ] **Stap 2** — voer de skill-werkstroom handmatig via MCP uit (render → Read → extract-text → create scaleRegions), of laat de in-app assistent "plaats schaalgebieden" aanroepen.
- [ ] **Stap 3** — `app_list_annotations` → per viewport een `scaleRegion` met de juiste `scaleString`. Plaats een `measureDistance` binnen een regio → de meting volgt die schaal.
- [ ] **Stap 4** — herhaal met een gescande (raster) tekening → vision-pad plaatst de regio's, antwoord meldt lagere zekerheid.

---

## Zelf-review (uitgevoerd)

1. **Spec-dekking:** `app_extract_text` (T1) · `app_render_page` (T2) · SKILL.md met vision×tekst-combinatie + direct plaatsen (T3) · raster (leeg-tekst → vision) + vector (T1/T4) · scaleRegion-plaatsing (bestaand, T3 stap 6). Alle spec-onderdelen gedekt. ✔
2. **Placeholders:** geen TBD/TODO; concrete code per stap. Eén expliciete verify-note: controleer in `render_to_png.rs`/`Cargo.toml` of de `base64`-decode beschikbaar is, anders `encode_rgba_to_png_bytes` toevoegen. ✔
3. **Type-consistentie:** `extract_page_text`-item-velden `{text,x,y,fontSize,width}` identiek in T1 (bridge) en T3 (skill); `app_render_page` args `{path,pageIndex,width}` identiek in T2-def en T3-aanroep; `scaleRegion`-props `{x,y,width,height,scaleString,units,label}` consistent met de bestaande `_buildCreateProps`. ✔
