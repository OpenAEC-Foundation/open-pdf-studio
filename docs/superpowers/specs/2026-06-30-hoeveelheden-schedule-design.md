# Hoeveelheden — Revit-stijl staat (ontwerp)

**Datum:** 2026-06-30
**Status:** goedgekeurd (volledige 5-tab scope), klaar voor plan

## Doel

De "Take-off" wordt **"Hoeveelheden"**: een Revit-stijl staat over **álle elementen** in het document
(annotaties én native PDF-inhoud). Twee delen: een **tabel** (data-view) + een **Eigenschappen-dialog
met 5 tabbladen** die de tabel configureert. Verenigt de eerdere take-off-backlog (getypeerde componenten
telling/lijnvormig/oppervlakte, native-content-schedulen, alle-elementen-telling) in één systeem.

## Architectuur

1. **Classificatie + veld-register** (`js/quantities/categories.js`) — pure functies:
   `categoryOf(el)` → categorie-key; `FIELD_REGISTRY[category]` → lijst velden
   `{ key, label, unit, kind:'number'|'text', get(el) }`. Eén register, géén per-type UI-code.
2. **Schedule-engine** (`js/quantities/engine.js`) — `buildSchedule(elements, config)` →
   `{ columns, groups:[{ key, rows, subtotals }], grandTotals }`. Past **filter → sorteer → groepeer →
   opmaak** toe. Puur (testbaar zonder UI).
3. **Config-store** (`js/solid/stores/quantitiesStore.js`) — Solid-signals voor de config (categorieën,
   velden, filters, sort/group, opmaak, weergave) + memo's die de engine aanroepen. Persisteert als
   template in preferences.
4. **Tabel-view** (`SchedulePanel.jsx`, herwerkt) — rendert `groups` met kolommen, groep-koppen/voeten,
   (sub)totalen; knoppen: **Eigenschappen**, PDF, CSV.
5. **Eigenschappen-dialog** (`QuantitiesProperties.jsx`) — 5 tabbladen
   (Velden / Filter / Sorteren-Groeperen / Opmaak / Weergave), Windows-stijl modal (vierkante hoeken,
   verplaatsbaar, blijft open bij klik ernaast).

## Categorieën

`text-annotation` (textbox, callout, comment, text) · `text-built-in` (native PDF-tekst) ·
`area` (measureArea, filledArea, box, circle, ellipse, polygon, cloud, scaleRegion) ·
`line-based` (measureDistance, measurePerimeter, line, arrow, polyline, wall, spline, arc) ·
`count` (count) · `symbol` (parametricSymbol, stamp, signature) · `image` (image).
"Alle categorieën" = unie.

## Velden (per categorie)

Gemeenschappelijk: Categorie, Type, Pagina, Laag, Kleur, Label.
- **area:** Oppervlakte (m²), Omtrek (m1) — plus **Werkelijk opp.** bij type 'dak' met dakhoek:
  `A / cos(α)`.
- **line-based:** Lengte (m1).
- **text-annotation / text-built-in:** Inhoud, Lettertype, Grootte.
- **image:** Breedte, Hoogte.
- **count:** telt; per-rij = 1 markering.

## De 5 tabbladen

- **Velden** — categorie-selectie ("Multiple Categories"-achtige dropdown) + beschikbaar ↔ ingepland
  (met volgorde, op/neer).
- **Filter** — tot 8 AND-regels: veld + operator (=, ≠, >, ≥, <, ≤, heeft waarde, heeft geen waarde) + waarde.
- **Sorteren/Groeperen** — tot 4 niveaus sorteren/groeperen; per niveau kop/voet/lege regel; eindtotalen;
  "elke instantie afzonderlijk" (itemize).
- **Opmaak** — per ingepland veld: kop-tekst, eenheid, afronding (decimalen), uitlijning, "bereken totalen".
- **Weergave** — rasterlijnen, randen, streep-rijen, titel/koppen tonen, lettertype. Windows-stijl, compact.

## Native content (text-built-in / image)

`text-built-in`-rijen komen uit `extract_page_text` (Rust, bestaat al). image-rijen uit image-annotaties +
(later) geëxtraheerde native afbeeldingen. Native tekst/afbeeldingen verschijnen als gewone rijen met hun
eigen velden — selecteerbaar/telbaar zoals annotaties.

## Randgevallen

- Lege selectie / geen elementen → lege tabel met melding.
- Niet-numeriek veld in een totaal → totaal overslaan.
- Ontbrekende eigenschap → lege cel (geen crash).
- Dak zonder dakhoek → Werkelijk opp. = Oppervlakte (α = 0).

## Scope (YAGNI)

**Volledig (deze ronde):** alle 5 tabbladen + tabel + classificatie/velden + native `text-built-in`
via `extract_page_text`.
**Later:** native afbeelding-extractie, voorwaardelijke opmaak, per-kolom CSV-mapping fijnslijpen.

## Testen

Rig/MCP: blank + annotaties → open Hoeveelheden → Eigenschappen: kies categorie, velden, filter, groepeer →
tabel klopt (rijen/kolommen/(sub)totalen). Engine los: unit-test `buildSchedule` met fixture-elementen.
