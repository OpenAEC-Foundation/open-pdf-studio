# Take-Off — Objecten tellen (ontwerp)

**Datum:** 2026-06-24
**Status:** ontwerp, wacht op review

## Doel

De bestaande Take-Off (een meetstaat) uitbreiden met **objecttelling**: telcategorieën
definiëren, **telmarkeringen op de tekening plaatsen** (per categorie een gekleurde stip+nummer
óf een symbool), de **aantallen per categorie bekijken** in het Take-Off-paneel, exporteren, en de
AI-skill "Herken deuren" **telobjecten automatisch op de PDF laten plaatsen** die de take-off telt.

## Context (bestaand)

- `js/solid/stores/scheduleStore.js` — verzamelt meet-annotaties (`measureDistance/Area/Perimeter/Angle`),
  groepeert + totaliseert, CSV-export, templates.
- `js/solid/components/SchedulePanel.jsx` — modeless paneel "Take-Off"; "Place on PDF" maakt een
  `scheduleTable`-annotatie.
- Annotaties via `createAnnotation({type, ...})` (`js/annotations/factory.js`), gerenderd in
  `js/annotations/rendering.js`, en aanmaakbaar via MCP `app_create_annotation`.
- Symbolen: `js/solid/components/SymbolPalette.jsx` + `js/symbols/templates/*`.

## Onderdelen

1. **Telcategorieën** — per document een lijst `{id, name, color, markerStyle: 'dot'|'symbol', symbolId?}`.
   Nieuw `js/solid/stores/countStore.js`. Beheer-UI in het paneel (toevoegen / hernoemen / kleur /
   stijl / verwijderen). Enkele presets (Deuren, Ramen, Stopcontacten) + vrij toe te voegen.
2. **Annotatietype `count`** — `{type:'count', page, x, y, categoryId, color, number, markerStyle, symbolId?}`.
   Toegevoegd aan de factory, de rendering, en de `app_create_annotation`-enum.
3. **Tel-tool** — ribbon-knop bij Meten/Take-Off + keyboard-shortcut. Actieve categorie kiezen → klik op
   de tekening plaatst een `count`-marker in de stijl van die categorie. Elke klik = +1; volgnummer per categorie.
4. **Rendering** — `rendering.js` tekent `count`: gekleurde stip + nummer, óf het symbool (geschaald) + nummer.
   Selecteerbaar/verplaatsbaar/verwijderbaar zoals andere annotaties.
5. **Take-Off-paneel — sectie "Tellingen"** — per categorie: kleur/symbool, naam, aantal (N). Klik op een rij
   selecteert/springt naar de markeringen. Staat naast de bestaande meetstaat in hetzelfde paneel.
6. **Staat + export** — `countStore` telt `count`-annotaties per categorie via een reactieve memo (los van
   `scheduleStore`, dat de metingen blijft verzorgen); CSV-export krijgt telregels; "Place on PDF" krijgt
   optioneel een tel-legenda. Het Take-Off-paneel toont beide stores: meetstaat + tellingen.
7. **AI-integratie** — de skill 🚪 "Herken deuren" plaatst via `app_create_annotation(type:'count', categoryId:'deuren', …)`
   echte telobjecten op de PDF; de take-off telt ze automatisch. Generaliseerbaar naar andere objecttypen.
8. **Persistentie** — `count`-annotaties worden met het document opgeslagen (zoals andere annotaties);
   categorieën per document, met optioneel hergebruik als preset in `preferences`.

## Dataflow

Categorie actief → tel-tool → klik → `createAnnotation({type:'count', categoryId, …})` → `doc.annotations`
→ rendering tekent → reactieve memo telt → paneel werkt bij.
AI-pad: detectie → `app_create_annotation(count)` → dezelfde stroom.

## Randgevallen

- Marker verwijderen → telling daalt (reactief).
- Categorie verwijderen terwijl er markers zijn → geblokkeerd; eerst de markers verwijderen of hercategoriseren.
- Nummering per categorie in plaatsingsvolgorde; automatisch her-nummeren bij verwijderen is optioneel (later).
- Multi-page: telling per categorie over alle pagina's, met paginakolom in de lijst.

## Scope (YAGNI)

**MVP:** stip- én symbool-markers, categoriebeheer (naam/kleur/stijl), "Tellingen"-sectie in het paneel,
markers plaatsen op de tekening, CSV-export, AI-deuren-hook.
**Later:** dichtheidstelling, subcategorieën, geavanceerde legenda-opmaak, automatische her-nummering.

## Testen

Via de test-rig/MCP: `app_create_annotation(type:'count')` → controleer de telling in `scheduleStore`/paneel,
de rendering en de CSV. Handmatig: tel-tool-UX en categoriebeheer.
