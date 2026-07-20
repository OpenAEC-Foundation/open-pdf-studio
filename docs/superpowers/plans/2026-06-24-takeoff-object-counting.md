# Take-Off — Objecten tellen — Implementatieplan

> **Voor agentic workers:** VEREISTE SUB-SKILL: gebruik superpowers:subagent-driven-development (aanbevolen) of superpowers:executing-plans om dit plan taak-voor-taak uit te voeren. Stappen gebruiken checkbox-syntax (`- [ ]`).

**Goal:** De Take-Off uitbreiden met objecttelling — telcategorieën, een tel-tool die `count`-markeringen op de tekening plaatst (kleur-stip+nummer of symbool per categorie), een "Tellingen"-sectie in het Take-Off-paneel, CSV-export, en een AI-hook die telobjecten plaatst.

**Architecture:** Nieuw `count`-annotatietype (punt-annotatie). Een `countStore` houdt categorieën + een reactieve telling per categorie (afgeleid van `doc.annotations`). De tel-tool plaatst markeringen via het bestaande tool-pad (`buildAnnotationProps` → `shape-tool` punt-klik). `rendering.js` tekent ze. Het bestaande `SchedulePanel` krijgt een tweede sectie. MCP `app_create_annotation` leert `count` zodat zowel de UI als de AI ze kan plaatsen.

**Tech Stack:** SolidJS (signals/memos), vanilla JS (tools/rendering), Rust (Tauri MCP-server), Canvas2D.

**Verificatie (geen JS-unit-runner aanwezig):** elke taak wordt geverifieerd via de **test-rig + MCP op 9223** (`app_create_annotation`, `app_list_annotations`, `app_get_annotation`, `app_screenshot_view`) en/of handmatig in het rig-venster. Rig herstarten na Rust-wijzigingen; JS HMR't. Zie memory [[mcp-test-rig]] + [[local-build-onedrive-workaround]].

---

## File Structure

| Bestand | Verantwoordelijkheid | Actie |
|--------|----------------------|-------|
| `js/solid/stores/countStore.js` | Telcategorieën + actieve categorie + reactieve telling per categorie + nummering + CSV | **Create** |
| `js/tools/annotation-creators.js` | `case 'count'` in `buildAnnotationProps` | Modify (~na regel 353) |
| `js/tools/tools/shape-tool.js` | `'count'` toevoegen aan de punt-klik-conditie (regel 67) | Modify |
| `js/annotations/rendering.js` | `case 'count'` in de teken-switch (~na regel 694) | Modify |
| `js/solid/components/ribbon/DrawingTab.jsx` | Tel-tool-knop + actieve-categorie-keuze | Modify |
| `js/solid/components/SchedulePanel.jsx` | "Tellingen"-sectie + categoriebeheer | Modify |
| `js/mcp-bridge.js` | `case 'count'` in `handleCreateAnnotation` | Modify (~regel 1140) |
| `src-tauri/src/mcp_server.rs` | `count` in de `app_create_annotation` type-enum | Modify |
| `js/i18n/locales/nl/ribbon.json` + `en/ribbon.json` | Labels tel-tool/categorieën | Modify |

---

## Task 1: countStore — categorieën + reactieve telling

**Files:**
- Create: `js/solid/stores/countStore.js`

- [ ] **Stap 1: schrijf de store**

```js
import { createSignal, createMemo } from 'solid-js';
import { getActiveDocument } from '../../core/state.js';

const DEFAULT_CATEGORIES = [
  { id: 'deuren',        name: 'Deuren',        color: '#e11d48', markerStyle: 'dot' },
  { id: 'ramen',         name: 'Ramen',         color: '#2563eb', markerStyle: 'dot' },
  { id: 'stopcontacten', name: 'Stopcontacten', color: '#16a34a', markerStyle: 'dot' },
];

const [categories, setCategories] = createSignal([...DEFAULT_CATEGORIES]);
const [activeCategoryId, setActiveCategoryId] = createSignal('deuren');

export const countCategories = categories;
export const activeCountCategoryId = activeCategoryId;
export const activeCountCategory = () => categories().find(c => c.id === activeCategoryId()) || categories()[0] || null;
export function setActiveCountCategory(id) { setActiveCategoryId(id); }

export function addCountCategory(name, color = '#e11d48', markerStyle = 'dot', symbolId) {
  const id = (name || 'cat').toLowerCase().replace(/\s+/g, '-') + '-' + Math.random().toString(36).slice(2, 6);
  setCategories([...categories(), { id, name: name || 'Categorie', color, markerStyle, symbolId }]);
  return id;
}

export function updateCountCategory(id, patch) {
  setCategories(categories().map(c => c.id === id ? { ...c, ...patch } : c));
}

/** Verwijderen geblokkeerd zolang er markeringen in deze categorie staan. */
export function removeCountCategory(id) {
  const doc = getActiveDocument();
  const inUse = (doc?.annotations || []).some(a => a.type === 'count' && a.categoryId === id);
  if (inUse) return false;
  setCategories(categories().filter(c => c.id !== id));
  if (activeCategoryId() === id) setActiveCategoryId(categories()[0]?.id || '');
  return true;
}

/** Volgnummer voor de volgende markering in een categorie (huidig aantal + 1). */
export function nextCountNumber(categoryId) {
  const doc = getActiveDocument();
  return (doc?.annotations || []).filter(a => a.type === 'count' && a.categoryId === categoryId).length + 1;
}

/** Reactieve telling per categorie, afgeleid van de annotaties van het actieve document. */
export const countTallies = createMemo(() => {
  const doc = getActiveDocument();
  const counts = (doc?.annotations || []).filter(a => a.type === 'count');
  const byCat = new Map();
  for (const a of counts) byCat.set(a.categoryId || '(geen)', (byCat.get(a.categoryId || '(geen)') || 0) + 1);
  const rows = categories().map(c => ({ ...c, count: byCat.get(c.id) || 0 }));
  if (byCat.has('(geen)')) rows.push({ id: '(geen)', name: '(geen categorie)', color: '#888888', markerStyle: 'dot', count: byCat.get('(geen)') });
  return rows;
});

export const countTotal = createMemo(() => countTallies().reduce((s, r) => s + r.count, 0));

/** CSV-regels voor de telling (gebruikt door de paneel-export). */
export function countCsvRows() {
  return countTallies().filter(r => r.count > 0).map(r => `Telling,"${r.name}",${r.count},stuks,`);
}
```

- [ ] **Stap 2: verifieer dat het laadt** — rig draait (Vite HMR). In het rig-console (of via een tijdelijke import) `countTallies()` → `[{id:'deuren',count:0},...]`. Geen import-fouten in `app_get_recent_console`/Vite-log.

- [ ] **Stap 3: commit** — `git add js/solid/stores/countStore.js && git commit -m "feat(takeoff): countStore met categorieen en reactieve telling"`

---

## Task 2: `count`-annotatietype — props + punt-klik + MCP

**Files:**
- Modify: `js/tools/annotation-creators.js` (na de `parametricSymbol`-case, ~r353)
- Modify: `js/tools/tools/shape-tool.js:67`
- Modify: `js/mcp-bridge.js` (`handleCreateAnnotation`, ~r1140)
- Modify: `src-tauri/src/mcp_server.rs` (enum van `app_create_annotation`)

- [ ] **Stap 1: props-case in `buildAnnotationProps`** — voeg toe vóór `case 'viewport'`:

```js
    case 'count': {
      const { activeCountCategory, nextCountNumber } = require ? {} : {};
      // ESM: bovenin het bestand importeren (zie stap 1b).
      const cat = _activeCountCategory();
      const n = _nextCountNumber(cat?.id);
      return {
        type: 'count',
        page: getActiveDocument()?.currentPage || 1,
        x: startX, y: startY,
        categoryId: cat?.id || null,
        number: n,
        markerStyle: cat?.markerStyle || 'dot',
        symbolId: cat?.symbolId,
        color: cat?.color || '#e11d48',
        strokeColor: cat?.color || '#e11d48',
        opacity: 1,
      };
    }
```

- [ ] **Stap 1b: import bovenin `annotation-creators.js`** (naast de bestaande imports):

```js
import { activeCountCategory as _activeCountCategory, nextCountNumber as _nextCountNumber } from '../solid/stores/countStore.js';
```

- [ ] **Stap 2: punt-klik in `shape-tool.js`** — regel 67 wordt:

```js
    } else if (isClick && (tool === 'comment' || tool === 'stamp' || tool === 'signature' || tool === 'count')) {
```

(zodat één klik een `count`-markering plaatst i.p.v. een sleep te vereisen).

- [ ] **Stap 3: MCP-case in `handleCreateAnnotation`** (`mcp-bridge.js`, bij de andere `case`-blokken):

```js
    case 'count': {
      if (!_isNum(p.x) || !_isNum(p.y)) return { error: "type 'count' requires numeric props x, y" };
      return { base: {
        type, page,
        x: p.x, y: p.y,
        categoryId: typeof p.categoryId === 'string' ? p.categoryId : null,
        number: _isNum(p.number) ? p.number : 1,
        markerStyle: p.markerStyle === 'symbol' ? 'symbol' : 'dot',
        symbolId: typeof p.symbolId === 'string' ? p.symbolId : undefined,
        color: p.color || '#e11d48',
        strokeColor: p.color || '#e11d48',
        opacity: 1,
      } };
    }
```

- [ ] **Stap 4: enum in `mcp_server.rs`** — voeg `"count"` toe aan de `type`-enum-array in de `app_create_annotation` inputSchema, en noem het in de description (punt-marker: props `x`,`y`,`categoryId`,`number`,`markerStyle`).

- [ ] **Stap 5: rebuild rig** (Rust gewijzigd): kill exe → `CARGO_TARGET_DIR=C:/Users/rickd/AppData/Local/Temp/opds-build-166 cargo build --manifest-path .../src-tauri/Cargo.toml` → herstart exe `--mcp-server`.

- [ ] **Stap 6: verifieer via MCP** — `app_create_annotation {type:'count', props:{x:300,y:300,categoryId:'deuren',number:1}}` → geeft een id; `app_list_annotations` toont een `count` op de pagina; `countTallies()` Deuren = 1.

- [ ] **Stap 7: commit** — `git add ... && git commit -m "feat(takeoff): count-annotatietype via tool en MCP"`

---

## Task 3: Rendering van `count`-markeringen

**Files:**
- Modify: `js/annotations/rendering.js` (na `case 'comment'` blok, ~r694)

- [ ] **Stap 1: teken-case toevoegen**

```js
    case 'count': {
      const cx = annotation.x, cy = annotation.y;
      const col = annotation.color || annotation.strokeColor || '#e11d48';
      ctx.save();
      ctx.globalAlpha = annotation.opacity ?? 1;
      if (annotation.markerStyle === 'symbol' && annotation.symbolId) {
        // Symbool-marker: teken het template gecentreerd op (cx,cy), schaal vast.
        const tpl = getTemplate(annotation.symbolId);
        if (tpl && typeof tpl.draw === 'function') {
          const s = 22; // doelhoogte in px
          ctx.translate(cx, cy);
          ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1;
          tpl.draw(ctx, { width: s, height: s, color: col }, {});
          ctx.setTransform(1, 0, 0, 1, 0, 0);
        }
      } else {
        const r = 9;
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = col; ctx.fill();
        ctx.lineWidth = 1.5; ctx.strokeStyle = '#ffffff'; ctx.stroke();
        ctx.fillStyle = '#ffffff';
        ctx.font = `bold ${Math.round(r * 1.3)}px sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(String(annotation.number ?? ''), cx, cy);
      }
      ctx.restore();
      break;
    }
```

> Symbol-`draw`-signatuur en transform exact volgen zoals de bestaande `case 'parametricSymbol'` render dat doet — controleer die render bij implementatie en spiegel de transform/kleurzetting.

- [ ] **Stap 2: verifieer** — na de MCP-create uit Task 2: `app_screenshot_view` toont een gekleurde stip met "1" op (300,300). Maak een symbool-categorie (Task 5) en plaats een symbool-marker → toont het symbool.

- [ ] **Stap 3: commit** — `git commit -am "feat(takeoff): render count-markeringen (stip+nummer / symbool)"`

---

## Task 4: Tel-tool in de ribbon

**Files:**
- Modify: `js/solid/components/ribbon/DrawingTab.jsx`
- Modify: `js/i18n/locales/nl/ribbon.json`, `en/ribbon.json`

- [ ] **Stap 1: knop + categoriekeuze** — naast de meet-knoppen, volg het bestaande `RibbonButton`-patroon:

```jsx
<RibbonButton size="small" id="tool-count" title={t('drawing.count') || 'Tellen'} icon={countIcon}
  label={t('drawing.count') || 'Tellen'}
  disabled={ro()} active={state.currentTool === 'count'} onClick={() => setTool('count')} />
```

Plus een kleine `<select>` die `countCategories()` toont en `setActiveCountCategory(e.target.value)` aanroept (import uit `countStore.js`). `countIcon`: hergebruik een bestaand icoon of voeg een simpele SVG toe in de ribbon-iconenset.

- [ ] **Stap 2: i18n** — voeg `"count": "Tellen"` toe onder de `drawing`-sectie in `nl/ribbon.json` en `en/ribbon.json`.

- [ ] **Stap 3: verifieer** — in het rig-venster: klik de Tel-knop, kies "Deuren", klik 3× op de tekening → 3 genummerde stippen; categorie wisselen naar "Ramen" → volgende klikken zijn blauw en hernummeren vanaf 1.

- [ ] **Stap 4: commit** — `git commit -am "feat(takeoff): tel-tool + categoriekeuze in ribbon"`

---

## Task 5: "Tellingen"-sectie + categoriebeheer in SchedulePanel

**Files:**
- Modify: `js/solid/components/SchedulePanel.jsx`

- [ ] **Stap 1: imports** — voeg toe:

```js
import { countTallies, countTotal, countCategories, addCountCategory, removeCountCategory, updateCountCategory, setActiveCountCategory } from '../stores/countStore.js';
```

- [ ] **Stap 2: sectie boven de meetstaat** (binnen `schedule-body`, vóór de bestaande `groupedEntries`-`For`):

```jsx
<div class="schedule-group">
  <div class="schedule-group-header">
    <span class="schedule-group-name">Tellingen</span>
    <span class="schedule-group-count">{countTotal()}</span>
  </div>
  <table class="schedule-table">
    <thead><tr><th></th><th>Categorie</th><th>Aantal</th></tr></thead>
    <tbody>
      <For each={countTallies()}>
        {(row) => (
          <tr onClick={() => setActiveCountCategory(row.id)}>
            <td><span style={{ display:'inline-block', width:'10px', height:'10px', background: row.color, 'border-radius':'50%' }} /></td>
            <td>{row.name}</td>
            <td class="schedule-val">{row.count}</td>
          </tr>
        )}
      </For>
    </tbody>
  </table>
</div>
```

- [ ] **Stap 3: categoriebeheer** — een klein invoerveld + knop "＋ Categorie" (`addCountCategory(name)`), per rij een kleur-input (`updateCountCategory(id,{color})`), stijl-keuze dot/symbol, en een "x" die `removeCountCategory(id)` aanroept (geeft `false` + toon melding als er markeringen zijn).

- [ ] **Stap 4: telling mee in CSV** — pas `exportCSV` (in `scheduleStore.js`) zó aan dat het `countCsvRows()` uit `countStore` toevoegt, of voeg een knop "CSV tellingen" toe die `countCsvRows()` exporteert. (Kies één; documenteer in de code-comment.)

- [ ] **Stap 5: verifieer** — open Take-Off; de "Tellingen"-sectie toont per categorie het aantal dat overeenkomt met de geplaatste markeringen; markering verwijderen → telling daalt; CSV bevat de telregels.

- [ ] **Stap 6: commit** — `git commit -am "feat(takeoff): Tellingen-sectie + categoriebeheer in paneel"`

---

## Task 6: Persistentie + "Place on PDF" tel-legenda

**Files:**
- Modify: `js/pdf/saver.js` (controle), `js/solid/components/SchedulePanel.jsx` (`placeOnPdf`)

- [ ] **Stap 1: persistentie verifiëren** — `count`-annotaties zitten in `doc.annotations` en gaan dus mee bij opslaan/herladen. Plaats markeringen, sla op (`app_save_pdf` of UI), heropen → markeringen + telling terug. Als de saver per-type velden whitelijst: voeg `count` + zijn velden (`categoryId,number,markerStyle,symbolId`) toe.

- [ ] **Stap 2: tel-legenda bij "Place on PDF"** — breid `placeOnPdf` uit zodat onder de meetstaat-tabel een tel-legenda komt (categorie · kleur · aantal), of voeg een aparte knop "Plaats telling" toe die een `scheduleTable`-achtige annotatie met `countTallies()` neerzet.

- [ ] **Stap 3: verifieer** — markeringen plaatsen → "Place on PDF" → legenda met juiste aantallen verschijnt op de pagina; opslaan/herladen behoudt alles.

- [ ] **Stap 4: commit** — `git commit -am "feat(takeoff): tellingen persistent + tel-legenda op PDF"`

---

## Task 7: AI-hook — telobjecten plaatsen via detectie

**Files:**
- Modify: assistent-/skill-pad dat `app_create_annotation` aanroept (de 🚪-deurherkenning).

- [ ] **Stap 1:** laat de detectie-skill per gevonden object `app_create_annotation {type:'count', props:{x,y,categoryId:'deuren',number:i,markerStyle:'dot',color:'#e11d48'}}` aanroepen (of `markerStyle:'symbol', symbolId:'door'`). Categorie bestaat al als preset; anders eerst aanmaken.

- [ ] **Stap 2: verifieer** — geef de assistent "tel de deuren": markeringen verschijnen op de PDF en de "Tellingen"-sectie telt ze (= aantal gevonden deuren).

- [ ] **Stap 3: commit** — `git commit -am "feat(takeoff): AI plaatst telobjecten die de take-off telt"`

---

## Zelf-review (uitgevoerd)

1. **Spec-dekking:** categorieën (T1) · `count`-type + tool + MCP (T2) · render stip/symbool (T3) · ribbon-tool (T4) · Tellingen-sectie + beheer (T5) · persistentie + plaatsen op tekening (T6) · AI-hook (T7). Alle spec-onderdelen gedekt. ✔
2. **Placeholders:** geen TBD/TODO; elke code-stap heeft echte code. Eén bewuste verwijzing: symbol-`draw`-signatuur spiegelen aan de bestaande `parametricSymbol`-render (controleren bij uitvoer). ✔
3. **Type-consistentie:** veldnamen `{type:'count', x, y, categoryId, number, markerStyle, symbolId, color}` identiek in T2 (props), T2 (MCP), T3 (render), T5 (telling), T7 (AI). `countStore`-exports (`countTallies`, `activeCountCategory`, `nextCountNumber`, `countCategories`, `addCountCategory`, `removeCountCategory`, `updateCountCategory`, `setActiveCountCategory`, `countTotal`, `countCsvRows`) consistent gebruikt. ✔
