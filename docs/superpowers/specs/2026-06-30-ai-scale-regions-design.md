# AI-skill: Automatisch schaalgebieden op multi-viewport tekeningen (ontwerp)

**Datum:** 2026-06-30
**Status:** ontwerp, wacht op review

## Doel

Een AI-assistent-skill voor Open PDF Studio die op een tekening met **meerdere viewports** automatisch
per viewport de schaal detecteert — **vision én ingebedde tekst gecombineerd en geverifieerd**, werkend
voor zowel **raster**- als **vector**-gerenderde pagina's — en **direct** een `scaleRegion`-annotatie per
viewport plaatst (achteraf bewerkbaar).

## Context (bestaand)

- `scaleRegion`-annotatie: `app_create_annotation(type:'scaleRegion', {x, y, width, height, scaleString:'1:100', units:'mm', label})`
  — plaatsing + measurement-scope bestaat al (mcp-bridge `_buildCreateProps`, regel ~1256; een nieuwe scaleRegion
  herberekent metingen binnen z'n grenzen).
- `extract_page_text` (Rust, `lib.rs:1795`, geregistreerd als Tauri-command) — ingebedde tekst + posities (PDF-space).
  Nog **niet** via MCP ontsloten.
- `render_to_png` (Rust) — pagina naar PNG; `app_screenshot_view` gebruikt het (canvas/view, base64).
- De in-app assistent draait via de MCP-relay met Claude Code als brain (vision-capable) — geen Anthropic-key nodig.

## Onderdelen

1. **MCP-tool `app_extract_text`** — wrapt `extract_page_text` → `{ pageW, pageH, items:[{text, x, y, width, fontSize}] }`
   in PDF-coords. Voedt het tekst-pad.
2. **MCP-tool `app_render_page`** — rendert de (huidige) pagina naar een **PNG-bestand op schijf** op opgegeven DPI
   en returnt het pad. Voedt het vision-pad (de brain `Read`t het bestand om te "kijken").
3. **`SKILL.md` `auto-scale-regions`** — de assistent-skill. Werkstroom:
   1. `app_render_page` → PNG → de AI bekijkt het (vision): segmenteert de viewport-regio's + leest per regio
      het schaal-label.
   2. `app_extract_text` → schaal-labels ("1:100", "schaal 1:50") + posities (vector). Leeg bij raster → vision-only.
   3. **Combineer + verifieer**: match vision-regio's met tekst-labels; per viewport een definitieve schaal
      (tekst-getal waar beschikbaar, anders vision) + bounds (vision voor de regio-grenzen).
   4. Map bounds → PDF-coords; `app_create_annotation(type:'scaleRegion', …)` per viewport (direct plaatsen).
4. **Coördinaten** — tekst is al PDF-space; vision-pixels → PDF-coords via de render-DPI + `pageH` (Y-flip).

## Dataflow

Gebruiker: *"plaats schaalgebieden"* → assistent kiest de skill → `app_render_page` + `app_extract_text` →
AI detecteert viewports + schalen (vision × tekst, geverifieerd) → `scaleRegion` per viewport → klaar (bewerkbaar).

## Randgevallen

- **Raster (geen ingebedde tekst):** vision-only; meld lagere zekerheid in het assistent-antwoord.
- **Geen schaal-label in een viewport:** viewport overslaan + benoemen — niet gokken.
- **Schaal-formaten:** "1:100", "1 : 100", "schaal 1:50", "scale 1:20", "1:2.5" → normaliseren naar `1:X`.
- **Eenheid:** default `mm` (NL-bouw); uit het label afleiden indien aanwezig.
- **Tegenstrijdige vision/tekst-schaal:** tekst wint mits het label binnen de viewport-bounds valt; anders melden.
- **Aangrenzende viewports:** bounds niet laten overlappen.

## Scope (YAGNI)

**MVP:** huidige pagina, vision + tekst gecombineerd, direct plaatsen.
**Later:** alle pagina's in één run, meet-based fallback (maatlijn → schaal afleiden), zekerheids-/bevestig-UI.

## Skill-locatie

`SKILL.md` in de Claude Code-skill-registry (`~/.claude/skills/auto-scale-regions/`) zodat de relay-brain 'm
kiest wanneer de gebruiker het de in-app assistent vraagt. De skill stuurt de app uitsluitend via MCP.

## Vervolg-skills (roadmap)

Deze skill is **stap 1** van een AI-tekeninganalyse-pijplijn. Volgend sub-project (krijgt een eigen spec):
**view-classificatie + geveloppervlaktes** — classificeer elke viewport als *gevelaanzicht / doorsnede /
plattegrond* (vision), en teken op elke **gevel** automatisch een oppervlakte-element in m², gebruikmakend van
de `scaleRegion` + viewport-detectie uit deze skill.

**Take-off-componenten (vanaf skill 2):** de take-off krijgt drie getypeerde element-soorten — **telling**
(stuks; bestaat al via `countStore`), **lijnvormig** (m1) en **oppervlakte** (m²) — elk als apart component
met een instelbaar *type* (categorie). Skill 2's geveloppervlaktes zijn dus oppervlakte-elementen met type 'gevel'.
Een **oppervlakte**-element kan optioneel een **dak** zijn met een **dakhoek**: dan wordt de gemeten
(geprojecteerde) oppervlakte gecorrigeerd naar het werkelijke schuine dakvlak — `A_werkelijk = A_geprojecteerd / cos(dakhoek)`
(bv. 30° → ×1,155).

**Native PDF-inhoud schedulen:** native elementen die al ín het bestand zitten — **tekst, vectoren én afbeeldingen** —
selecteerbaar maken en als **getypeerd take-off-item** toevoegen (zoals telmarkeringen/categorieën). Bouwt op de
take-off-componenten + `app_extract_text` / draw-command-extractie (`extract_draw_commands_batch`) + image-extractie.

## Testen

Via de test-rig/MCP: open de constructietekening (multi-viewport) → roep de skill aan → controleer met
`app_list_annotations` dat er per viewport een `scaleRegion` met de juiste `scaleString` staat, en dat een
meting bínnen een regio die schaal volgt. Raster-pad: test met een gescande (tekstloze) tekening.
