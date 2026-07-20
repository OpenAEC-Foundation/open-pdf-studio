# Hoeveelheden — Revit-stijl staat — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use `- [ ]` checkboxes.

**Goal:** De "Take-off" wordt "Hoeveelheden": een configureerbare Revit-stijl staat over alle document-elementen, met een tabel + een 5-tab eigenschappen-dialog.

**Architecture:** Pure logica (`js/quantities/categories.js` classificatie + veld-register, `js/quantities/engine.js` filter→sorteer→groepeer→totaliseer) gescheiden van de Solid-laag (`quantitiesStore.js` config-signals + memo's, `SchedulePanel.jsx` tabel, `QuantitiesProperties.jsx` 5-tab dialog).

**Tech Stack:** SolidJS, bestaande annotatie-model, Tauri `extract_page_text` voor native tekst.

**Veld-feiten (uit code-review):** universeel `id,type,page,subject,opacity`; geometrie `x/y/width/height`, `startX/Y endX/Y` (line/arrow/wall/measureDistance), `points[]` (area/perimeter/polyline); kleuren `color/strokeColor/fillColor`; tekst `text,fontSize,fontFamily`; meting `measureValue,measureUnit,measureText`; image `originalWidth/Height`; symbol `symbolId`; count `categoryId,number` → countStore. **Géén layer-veld.** `extract_page_text({path, pageIndex})` → JSON-array `[{x,y,width,height,fontSize,text}]`.

---

### Task 1: Classificatie + veld-register — `js/quantities/categories.js` (nieuw)

Pure module. Categorie per type + `FIELD_REGISTRY[cat] = [{key,label,kind,unit,get}]`.

```js
export const CATEGORY_LABELS = {
  'text-annotation':'Tekst (annotatie)', 'text-built-in':'Tekst (native)',
  'area':'Oppervlakte', 'line-based':'Lijnvormig', 'count':'Telling',
  'symbol':'Symbool', 'image':'Afbeelding', 'other':'Overig',
};
export const CATEGORY_ORDER = ['area','line-based','count','text-annotation','text-built-in','symbol','image','other'];

const TYPE_TO_CATEGORY = {
  textbox:'text-annotation', callout:'text-annotation', comment:'text-annotation', text:'text-annotation',
  measureArea:'area', filledArea:'area', box:'area', circle:'area', ellipse:'area',
  polygon:'area', cloud:'area', cloudPolyline:'area', scaleRegion:'area', redaction:'area', highlight:'area',
  measureDistance:'line-based', measurePerimeter:'line-based', line:'line-based', arrow:'line-based',
  polyline:'line-based', wall:'line-based', spline:'line-based', arc:'line-based', draw:'line-based', measureAngle:'line-based',
  count:'count', parametricSymbol:'symbol', stamp:'symbol', signature:'symbol', image:'image',
};
export function categoryOf(el){ return el.__category || TYPE_TO_CATEGORY[el.type] || 'other'; }

export const TYPE_NAMES = { /* reuse ELEMENT_TYPE_NAMES set from scheduleStore + builtinText:'Tekst' */ };

const F = (key,label,kind,get,unit='') => ({key,label,kind,unit,get});
function areaValue(el){ return (el.type==='measureArea' && typeof el.measureValue==='number') ? el.measureValue : null; }
function lengthValue(el){ return ((el.type==='measureDistance'||el.type==='measurePerimeter') && typeof el.measureValue==='number') ? el.measureValue : null; }
function realArea(el){ const a=areaValue(el); if(a==null) return null; const d=el.dakhoek||0; return d?a/Math.cos(d*Math.PI/180):a; }

const COMMON = [
  F('category','Categorie','text', el=>CATEGORY_LABELS[categoryOf(el)]),
  F('type','Type','text', el=>TYPE_NAMES[el.type]||el.type),
  F('page','Pagina','number', el=>el.page||1),
  F('label','Label','text', el=>el.label||el.subject||''),
  F('color','Kleur','text', el=>el.color||el.strokeColor||el.fillColor||''),
  F('count','Aantal','number', ()=>1),
];
export const FIELD_REGISTRY = {
  'area':[...COMMON, F('area','Oppervlakte','number',areaValue,'m²'), F('dakhoek','Dakhoek','number',el=>el.dakhoek||0,'°'), F('realArea','Werkelijk opp.','number',realArea,'m²')],
  'line-based':[...COMMON, F('length','Lengte','number',lengthValue,'m')],
  'count':[...COMMON, F('countCat','Telcategorie','text',el=>el.__countCatName||el.categoryId||'')],
  'text-annotation':[...COMMON, F('text','Inhoud','text',el=>el.text||''), F('fontSize','Grootte','number',el=>el.fontSize||0,'pt'), F('fontFamily','Lettertype','text',el=>el.fontFamily||'')],
  'text-built-in':[...COMMON, F('text','Inhoud','text',el=>el.text||''), F('fontSize','Grootte','number',el=>Math.round((el.fontSize||0)*10)/10,'pt')],
  'symbol':[...COMMON, F('symbolId','Symbool','text',el=>el.symbolId||el.stampType||'')],
  'image':[...COMMON, F('width','Breedte','number',el=>el.originalWidth||el.width||0,'px'), F('height','Hoogte','number',el=>el.originalHeight||el.height||0,'px')],
  'other':[...COMMON],
};
/** Unie van velden over geselecteerde categorieën, op key (eerste wint). */
export function fieldsForCategories(cats){ const m=new Map(); for(const c of cats) for(const f of (FIELD_REGISTRY[c]||[])) if(!m.has(f.key)) m.set(f.key,f); return [...m.values()]; }
export function fieldByKey(cats,key){ return fieldsForCategories(cats).find(f=>f.key===key); }
```

- [ ] Schrijf `categories.js` met bovenstaande (vul `TYPE_NAMES` met de map uit `scheduleStore.js` ELEMENT_TYPE_NAMES + `builtinText:'Tekst'`).
- [ ] `node --check js/quantities/categories.js` → geen syntaxfouten.

### Task 2: Engine — `js/quantities/engine.js` (nieuw)

```js
import { categoryOf, fieldsForCategories } from './categories.js';
const OPS = { '=':(a,b)=>String(a)===b, '!=':(a,b)=>String(a)!==b, '>':(a,b)=>+a> +b, '>=':(a,b)=>+a>=+b, '<':(a,b)=>+a< +b, '<=':(a,b)=>+a<=+b, 'has':a=>a!=null&&a!=='', 'none':a=>a==null||a==='' };
export function buildSchedule(elements, cfg){
  const cats = cfg.categories?.length ? cfg.categories : [];
  const allFields = fieldsForCategories(cats);
  const colDefs = (cfg.fields||[]).map(k=>allFields.find(f=>f.key===k)).filter(Boolean).map(f=>applyFmt(f,cfg.format?.[f.key]));
  let rows = elements.filter(el=>cats.includes(categoryOf(el))).map(el=>({el, vals:Object.fromEntries(allFields.map(f=>[f.key,f.get(el)]))}));
  for(const flt of (cfg.filters||[])) if(flt.field&&flt.op) rows=rows.filter(r=>OPS[flt.op]?.(r.vals[flt.field], flt.value));
  const levels = (cfg.sort||[]).filter(s=>s.field);
  rows.sort((a,b)=>{ for(const s of levels){ const c=cmp(a.vals[s.field],b.vals[s.field])*(s.dir==='desc'?-1:1); if(c) return c;} return 0;});
  const groupLevel = levels.find(s=>s.group);
  const groups = groupLevel ? groupBy(rows, groupLevel.field, colDefs) : [{key:null, rows, subtotals:subtotal(rows,colDefs)}];
  return { columns:colDefs, groups, grandTotals: subtotal(rows,colDefs), count:rows.length, itemize: cfg.itemize!==false };
}
// helpers: cmp (number vs string aware), groupBy (map by value → {key,rows,subtotals}), subtotal (sum numeric cols where def.total!==false), applyFmt (override label/unit/decimals/align/total)
```

- [ ] Schrijf `engine.js` met de helpers volledig uit.
- [ ] Test `js/quantities/engine.test.mjs`: 3 measureArea (1.0/2.0/3.0 m²) + 2 measureDistance → categorie-filter `['area']`, velden `['type','area']`, group op `category` → 1 groep, subtotaal area=6.0, count=3. `node engine.test.mjs` → PASS.

### Task 3: Config-store — `js/solid/stores/quantitiesStore.js` (nieuw)

Signals: `selectedCategories(['area','line-based','count'])`, `scheduledFields(['type','page','count'])`, `filters([])`, `sortLevels([{field:'category',dir:'asc',group:true,header:true,footer:true}])`, `itemize(true)`, `grandTotals(true)`, `format({})`, `appearance({gridlines:true,outline:false,stripe:false,showTitle:true,showHeaders:true})`, `propertiesVisible(false)`, `builtInText([])`.
- `collectElements()`: `getActiveDocument()?.annotations || []` + (als `text-built-in` geselecteerd) `builtInText()`. Voor count-rijen: annoteer `__countCatName` uit countStore via `categoryId`.
- `scheduleResult = createMemo(()=> buildSchedule(collectElements(), {categories:selectedCategories(), fields:scheduledFields(), filters:filters(), sort:sortLevels(), itemize:itemize(), format:format()}))`.
- `loadBuiltInText()`: `invoke('extract_page_text',{path:doc.filePath,pageIndex:doc.currentPage-1})` → JSON.parse → map naar `{__category:'text-built-in', type:'builtinText', page:doc.currentPage, text,fontSize,x,y}` → `setBuiltInText`.
- Re-export `scheduleVisible/setScheduleVisible/toggleSchedule` (verplaats hierheen of importeer uit scheduleStore — kies: laat scheduleStore enkel visibility houden).

- [ ] Schrijf de store. `node --check`.

### Task 4: Tabel-view — herwerk `js/solid/components/SchedulePanel.jsx`

Vervang body (regels ~127-256, de filters + 3 secties) door: knoppenbalk (Eigenschappen-knop → `setPropertiesVisible(true)`, PDF, CSV) + render `scheduleResult()`:
- titel-rij (als `appearance.showTitle`), kolomkoppen (`columns[].label (+unit)`), per groep: groep-kop (`group.key` + subtotaal-cel), rijen (itemize) met `formatCell(val, col)`, groep-voet subtotaal, eind-grandTotals-rij.
- `formatCell`: number → `toFixed(decimals)` (+ unit), text → as-is.
- Behoud drag-header, Templates-knop optioneel (mag weg). Verwijder import van oude `groupBy/filterType/...` + `allElementsTally/countTallies`; importeer uit quantitiesStore.

- [ ] Herwerk SchedulePanel. Render `<QuantitiesProperties/>` mee onderaan.

### Task 5: 5-tab dialog — `js/solid/components/QuantitiesProperties.jsx` (nieuw)

Windows-stijl modal (kopiëer header/drag-patroon uit SchedulePanel; vierkante hoeken; blijft open bij klik ernaast). `<Show when={propertiesVisible()}>`. Tab-strip: Velden | Filter | Sorteren/Groeperen | Opmaak | Weergave (`createSignal` activeTab).
- **Velden:** categorie-checkboxes (CATEGORY_ORDER × CATEGORY_LABELS → `setSelectedCategories`); twee lijsten — Beschikbaar (`fieldsForCategories(selectedCategories())` minus scheduled) en Ingepland (`scheduledFields`), met →/← en op/neer (herorden array).
- **Filter:** 8 rijen: veld-`<select>` (scheduled) + operator-`<select>` (=,≠,>,≥,<,≤,heeft waarde,heeft geen waarde) + waarde-`<input>` → `setFilters`.
- **Sorteren/Groeperen:** 4 niveaus: veld-`<select>` + asc/desc + checkbox Groeperen(+kop/voet) → `setSortLevels`; checkbox "Elke instantie afzonderlijk" (`itemize`) + "Eindtotalen" (`grandTotals`).
- **Opmaak:** voor elk scheduled veld een rij: kop-`<input>`, eenheid-`<input>`, decimalen-`<input number>`, uitlijning-`<select>`, "bereken totalen"-checkbox → `setFormat`.
- **Weergave:** checkboxes gridlines/outline/stripe/showTitle/showHeaders → `setAppearance`.

- [ ] Schrijf de dialog. `node --check` (via esbuild/transform niet nodig; visuele check in rig).

### Task 6: Styles — `styles/schedule-panel.css`

- [ ] Voeg toe: `.q-tabs` (tab-strip, actief = onderlijn), `.q-tab-body`, twee-koloms veld-lijsten (`.q-fieldlist`), dialog-grid voor filter/sort-rijen. Windows-stijl: vierkant, compacte 11px. Hergebruik bestaande `.modal-*`/`.schedule-*`.

### Task 7: Rig-verificatie (poort 9223 MCP / Vite 3041)

Rig herstarten (js hot-reload uit). Dan via MCP:
- [ ] blank PDF + plaats 3× measureArea, 2× count (2 categorieën), 1 textbox.
- [ ] open Hoeveelheden (ribbon) → screenshot: tabel toont rijen + subtotalen.
- [ ] open Eigenschappen → wissel categorie naar alleen `area`, voeg veld `Oppervlakte` toe, group op Type → screenshot: area-subtotaal klopt.
- [ ] Filter `Oppervlakte > 1` → alleen >1 m² blijft.
- [ ] `loadBuiltInText` op een tekst-PDF → `text-built-in`-rijen verschijnen.

## Bewuste keuzes
- **Geen layer-veld** (bestaat niet op annotaties) — uit de veldenset gelaten.
- Quantity-waarden komen enkel uit `measureValue` (echte, geschaalde metingen); vorm-annotaties zonder meting verschijnen als rij met lege getalcel (eerlijk, geen nep-getallen).
- Native tekst via expliciete `loadBuiltInText` (geen async-in-memo).
- `count`-veld (=1 per rij) levert Revit-stijl tellingen voor élke categorie via groeperen.
