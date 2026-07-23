# Parametrische wapening en voorinstellingen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Toon parametrische symbooleigenschappen vóór plaatsing, gebruik die waarden voor preview en plaatsing, maak wapeningsteksten direct bewerkbaar en ondersteun één tot en met vier vlaggen boven of onder een wapeningsstaaf.

**Architecture:** `parametricSymbolStore` wordt de enige bron voor de actieve symboolkeuze en gevalideerde plaatsingsparameters. Het eigenschappenvenster toont daarvan een synthetische annotatie, terwijl creators dezelfde parameters gebruiken voor preview en definitieve annotaties. Wapeningssjablonen leveren bewerkbare labelgebieden; een generieke inline-editor schrijft een complete `params`-wijziging als één undo-stap.

**Tech Stack:** SolidJS-signalen en componenten, bestaande canvas-symboolrenderer, JavaScript/TypeScript, Node-regressiescripts, Vite.

## Global Constraints

- Er wordt vóór plaatsing geen annotatie aan het document toegevoegd.
- Voorinstellingen blijven strikt gescheiden per `symbolId`.
- Parameterwaarden blijven de enige bron voor zichtbare wapeningstekst en geometrie.
- `wapeningsstaaf` blijft een tweepuntselement.
- Bestaande documenten zonder `markerAantal` renderen exact één vlag.
- Wijzigingen aan een geplaatst label vormen één undo-stap; wijzigingen aan plaatsingsvoorinstellingen vormen geen undo-stap.
- Alleen featurebestanden worden gestaged; bestaande losse werkboomwijzigingen blijven onaangeroerd.

---

### Task 1: Sjabloonbewuste plaatsingsvoorinstellingen

**Files:**
- Modify: `open-pdf-studio/js/types/preferences.ts`
- Modify: `open-pdf-studio/js/core/constants.ts`
- Modify: `open-pdf-studio/js/solid/stores/parametricSymbolStore.js`
- Modify: `open-pdf-studio/js/solid/stores/propertiesStore.js`
- Modify: `open-pdf-studio/js/tools/manager.js`
- Modify: `open-pdf-studio/js/tools/annotation-creators.js`
- Modify: `open-pdf-studio/js/solid/components/SymbolPalette.jsx`
- Create: `open-pdf-studio/scripts/test-parametric-symbol-defaults.mjs`

**Interfaces:**
- Produces: `pendingParams()`, `setPendingSymbolId(symbolId)`, `setPendingParams(params)`, `resolveSymbolParams(symbolId)`.
- Consumes: `getTemplate(symbolId)`, `defaultParams(template)`, `state.preferences.parametricSymbolDefaults`.

- [ ] **Step 1: Schrijf een falende store-/integratietest**

Maak `test-parametric-symbol-defaults.mjs` met bron- en gedragchecks die eisen:

```js
ok(preferencesSource.includes('parametricSymbolDefaults'),
  'voorkeurenschema bevat parametrische symboolwaarden');
ok(storeSource.includes('export function resolveSymbolParams'),
  'store levert gevalideerde effectieve parameters');
ok(managerSource.includes("tool === 'parametricSymbol'"),
  'manager toont voor parametrische plaatsing eigenschappen');
ok(creatorSource.includes('pendingParams()'),
  'creator gebruikt actieve waarden in plaats van kale sjabloondefaults');
```

Stage de store met tijdelijke ESM-stubs voor `solid-js`, `state.js`,
`preferences.js` en `registry.js`. Controleer vervolgens dat twee symbool-id's
verschillende waarden bewaren en dat een ongeldige numerieke waarde terugvalt
op de sjabloonstandaard.

- [ ] **Step 2: Draai de test en bevestig de rode toestand**

Run:

```powershell
node open-pdf-studio/scripts/test-parametric-symbol-defaults.mjs
```

Expected: FAIL omdat `parametricSymbolDefaults`, `resolveSymbolParams` en
`pendingParams` nog ontbreken.

- [ ] **Step 3: Voeg voorkeurenschema en gevalideerde store toe**

Voeg aan `Preferences` en `DEFAULT_PREFERENCES` toe:

```ts
parametricSymbolDefaults: Record<string, Record<string, string | number | boolean>>;
```

```ts
parametricSymbolDefaults: {},
```

Implementeer in `parametricSymbolStore.js` deze publieke stroom:

```js
const [pendingSymbolId, setPendingSymbolIdSignal] = createSignal('door');
const [pendingParams, setPendingParamsSignal] = createSignal({});

export function validateSymbolParams(symbolId, values = {}) {
  const template = getTemplate(symbolId);
  const defaults = defaultParams(template);
  if (!template) return {};
  const result = { ...defaults };
  for (const def of template.params || []) {
    const raw = values[def.key];
    if (raw === undefined) continue;
    if (def.type === 'number') {
      const number = Number(raw);
      if (!Number.isFinite(number)) continue;
      result[def.key] = Math.min(def.max ?? Infinity, Math.max(def.min ?? -Infinity, number));
    } else if (def.type === 'boolean') {
      result[def.key] = raw === true;
    } else if (def.type === 'enum') {
      if ((def.options || []).some((option) => option.value === raw)) result[def.key] = raw;
    } else {
      result[def.key] = String(raw);
    }
  }
  return result;
}

export function resolveSymbolParams(symbolId) {
  return validateSymbolParams(
    symbolId,
    state.preferences.parametricSymbolDefaults?.[symbolId] || {},
  );
}

export function setPendingSymbolId(symbolId) {
  setPendingSymbolIdSignal(symbolId);
  setPendingParamsSignal(resolveSymbolParams(symbolId));
}

export function setPendingParams(values) {
  const symbolId = pendingSymbolId();
  const validated = validateSymbolParams(symbolId, values);
  setPendingParamsSignal(validated);
  state.preferences.parametricSymbolDefaults = {
    ...(state.preferences.parametricSymbolDefaults || {}),
    [symbolId]: validated,
  };
  import('../../core/preferences.js').then((module) => module.savePreferences()).catch(() => {});
}
```

Initialiseer na de functiedefinities één keer met
`setPendingSymbolId('door')`.

- [ ] **Step 4: Verbind palette, eigenschappen en creator**

Laat `SymbolPalette` eerst synchroon `setPendingSymbolId(parametricId)`
uitvoeren en daarna `setTool('parametricSymbol')`.

Breid `showToolDefaults` uit met een optionele override:

```js
export async function showToolDefaults(toolName, overrides = {}) {
  // bestaande synthetic-opbouw en applyDefaultStyle
  Object.assign(synthetic, overrides);
  storeShowProperties(synthetic);
}
```

Voeg in `manager.setTool` vóór de generieke stijlmapping toe:

```js
if (tool === 'parametricSymbol') {
  const symbolStore = await import('../solid/stores/parametricSymbolStore.js');
  const propStore = await import('../solid/stores/propertiesStore.js');
  await propStore.showToolDefaults(tool, {
    symbolId: symbolStore.pendingSymbolId(),
    params: symbolStore.pendingParams(),
  });
  return;
}
```

Routeer `updateAnnotProp('params', next)` voor
`id === '__tool-defaults__' && type === 'parametricSymbol'` naar
`setPendingParams(next)`. Gebruik in `annotation-creators` één lokale
`const params = template ? pendingParams() : {};` voor `realSizeMm`, preview
en het geretourneerde annotatieobject.

- [ ] **Step 5: Draai gerichte tests en commit**

Run:

```powershell
node open-pdf-studio/scripts/test-parametric-symbol-defaults.mjs
node open-pdf-studio/scripts/test-nl-ifc-parametric-components.mjs
node open-pdf-studio/scripts/test-wapeningsstaaf-two-point.mjs
```

Expected: alle checks PASS.

Commit uitsluitend de Task 1-bestanden:

```powershell
git commit -m "feat(symbolen): toon eigenschappen voor plaatsing"
```

---

### Task 2: Eén tot en met vier vlaggen op de wapeningsstaaf

**Files:**
- Modify: `open-pdf-studio/js/symbols/templates/wapening-lijn.js`
- Modify: `open-pdf-studio/scripts/test-nl-ifc-parametric-components.mjs`

**Interfaces:**
- Produces: `markerAantal` op `wapeningsstaafTemplate.params`.
- Produces: `markerCommands(params, layout, bbox)` voor begrensde vlaggeometrie.
- Consumes: bestaande `markerPositie`, `markerRichting` en `lineLayout`.

- [ ] **Step 1: Schrijf falende geometrietests**

Pas de verwachte sleutelreeks aan naar:

```js
'aantal,diameter,lengte,markerAantal,markerPositie,markerRichting'
```

Test voor elk aantal en elke zijde:

```js
for (const markerAantal of [1, 2, 3, 4]) {
  for (const markerRichting of ['boven', 'onder']) {
    const commands = wapeningsstaafTemplate.render({
      aantal: 3, diameter: 8, lengte: 1600,
      markerAantal, markerPositie: 50, markerRichting,
    }, { x: 0, y: 0, width: 320, height: 48 });
    const markers = commands.filter((command) => command.role === 'marker');
    ok(markers.length === markerAantal, `${markerAantal} vlaggen ${markerRichting}`);
    ok(markers.every((command) => command.points.every((point) => point.x >= 0 && point.x <= 320)),
      'vlaggen blijven binnen de staaf');
  }
}
```

- [ ] **Step 2: Draai de test en bevestig de rode toestand**

Run:

```powershell
node open-pdf-studio/scripts/test-nl-ifc-parametric-components.mjs
```

Expected: FAIL omdat slechts één markercommand wordt gemaakt.

- [ ] **Step 3: Implementeer begrensde markergeometrie**

Voeg alleen aan `wapeningsstaafTemplate.params` toe:

```js
{
  key: 'markerAantal', label: 'Aantal vlaggen', labelEn: 'Marker count',
  type: 'number', default: 1, min: 1, max: 4, step: 1,
},
```

Vervang het enkele markercommand door:

```js
function markerCommands(params, layout, bbox, enabled) {
  const count = enabled
    ? Math.min(4, Math.max(1, Math.round(Number(params.markerAantal) || 1)))
    : 1;
  const gap = layout.markerHalfWidth * 0.35;
  const step = layout.markerHalfWidth * 2 + gap;
  const groupWidth = step * (count - 1) + layout.markerHalfWidth * 2;
  const center = Math.max(
    bbox.x + groupWidth / 2,
    Math.min(layout.markerX, bbox.x + bbox.width - groupWidth / 2),
  );
  return Array.from({ length: count }, (_, index) => {
    const markerX = center + (index - (count - 1) / 2) * step;
    return {
      kind: 'polyline', close: true, fill: true, role: 'marker',
      points: [
        { x: markerX - layout.markerHalfWidth, y: layout.markerBaseY },
        { x: markerX, y: layout.markerTipY },
        { x: markerX + layout.markerHalfWidth, y: layout.markerBaseY },
      ],
    };
  });
}
```

Roep dit vanuit `renderLine` aan met `enabled = !isNet`, zodat de nieuwe
keuze alleen voor de wapeningsstaaf geldt en netwapening compatibel blijft.

- [ ] **Step 4: Draai tests en commit**

Run:

```powershell
node open-pdf-studio/scripts/test-nl-ifc-parametric-components.mjs
node open-pdf-studio/scripts/test-wapeningsstaaf-two-point.mjs
```

Expected: alle checks PASS.

Commit:

```powershell
git commit -m "feat(symbolen): voeg meerdere staafvlaggen toe"
```

---

### Task 3: Bewerkbare labelgebieden en generieke inline-editor

**Files:**
- Create: `open-pdf-studio/js/symbols/editable-labels.js`
- Modify: `open-pdf-studio/js/symbols/templates/wapening-lijn.js`
- Modify: `open-pdf-studio/js/symbols/templates/wapeningskorf.js`
- Create: `open-pdf-studio/js/solid/stores/parametricLabelInputStore.js`
- Create: `open-pdf-studio/js/solid/components/ParametricLabelInlineEditor.jsx`
- Create: `open-pdf-studio/js/tools/parametric-symbol-editing.js`
- Modify: `open-pdf-studio/js/tools/tool-dispatcher.js`
- Modify: `open-pdf-studio/js/tools/manager.js`
- Modify: `open-pdf-studio/js/solid/components/DialogHost.jsx`
- Modify: `open-pdf-studio/styles/dialogs.css`
- Create: `open-pdf-studio/scripts/test-parametric-label-editing.mjs`

**Interfaces:**
- Produces: templatefunctie `editableLabels(params, bbox) -> Array<{ id, rect, fields }>` voor `wapeningsstaaf`, `netwapening` en `wapeningskorf`.
- Produces: `findEditableLabel(annotation, x, y)` en `startParametricSymbolInput(annotation, x, y)`.
- Consumes: `updateAnnotProp('params', next)` en bestaande canvas-/schermcoördinaten.

- [ ] **Step 1: Schrijf falende pure labeltests**

Test dat de lijnsjablonen één labelgebied met de juiste velden leveren en de
korf vijf gebieden:

```js
ok(wapeningsstaafTemplate.editableLabels(params, bbox)[0].fields.join(',') ===
  'aantal,diameter,lengte', 'staaflabel koppelt drie velden');
ok(netwapeningTemplate.editableLabels(netParams, bbox)[0].fields.join(',') ===
  'diameter,afstand,lengte', 'netlabel koppelt drie velden');
ok(wapeningskorfTemplate.editableLabels(korfParams, korfBox)
  .map((label) => label.id).join(',') === 'boven,zij,onder,beugel,naam',
  'korf levert vijf bewerkbare labels');
```

Test met een 45° geroteerde wapeningsstaaf dat `findEditableLabel` na inverse
rotatie het label vindt en een punt buiten het label `null` oplevert.

- [ ] **Step 2: Draai de test en bevestig de rode toestand**

Run:

```powershell
node open-pdf-studio/scripts/test-parametric-label-editing.mjs
```

Expected: FAIL omdat `editableLabels` en `findEditableLabel` ontbreken.

- [ ] **Step 3: Voeg het pure labelcontract en hit-testing toe**

Implementeer in `editable-labels.js`:

```js
import { getTemplate } from './registry.js';

export function toLocalPoint(annotation, x, y) {
  const angle = -(Number(annotation.rotation) || 0) * Math.PI / 180;
  const cx = annotation.x + annotation.width / 2;
  const cy = annotation.y + annotation.height / 2;
  const dx = x - cx;
  const dy = y - cy;
  return {
    x: cx + dx * Math.cos(angle) - dy * Math.sin(angle),
    y: cy + dx * Math.sin(angle) + dy * Math.cos(angle),
  };
}

export function findEditableLabel(annotation, x, y) {
  if (annotation?.type !== 'parametricSymbol') return null;
  const template = getTemplate(annotation.symbolId);
  if (typeof template?.editableLabels !== 'function') return null;
  const point = toLocalPoint(annotation, x, y);
  const labels = template.editableLabels(annotation.params || {}, annotation);
  return labels.find(({ rect }) =>
    point.x >= rect.x && point.x <= rect.x + rect.width &&
    point.y >= rect.y && point.y <= rect.y + rect.height) || null;
}
```

Laat beide wapening-lijnsjablonen hun reeds berekende tekstbreedte en
tekstgrootte als `rect` teruggeven. Laat `wapeningskorf` dezelfde `layoutMm`,
`S`, `ox` en `oy` gebruiken als `render`; de veldsets zijn:

```js
[
  { id: 'boven', fields: ['bovenAantal', 'bovenDiameter'] },
  { id: 'zij', fields: ['zijAantal', 'zijDiameter'] },
  { id: 'onder', fields: ['onderAantal', 'onderDiameter'] },
  { id: 'beugel', fields: ['beugelDiameter', 'beugelAfstand'] },
  { id: 'naam', fields: ['naam'] },
]
```

- [ ] **Step 4: Bouw store, editor en vanilla brug**

De store bewaart `active`, `anchor`, `fields`, `values`, `onCommit`,
`onCancel` en `locator`. De Solid-component rendert per sjabloondefinitie:

```jsx
<For each={fields()}>{(field) => (
  <label class="parametric-label-inline-field">
    <span>{field.label}</span>
    <input
      type={field.type === 'number' ? 'number' : 'text'}
      min={field.min}
      max={field.max}
      step={field.step}
      value={values()[field.key]}
      onInput={(event) => setFieldValue(field.key, event.currentTarget.value)}
    />
  </label>
)}</For>
```

Stop `keydown`-propagatie. Enter commit, Escape cancel, Tab normale
focusvolgorde. Klik buiten commit. Laat `requestAnimationFrame` de locator
volgen en annuleer als die `null` teruggeeft.

`startParametricSymbolInput`:

1. zoekt het aangeklikte label;
2. zoekt de paramdefinities bij `label.fields`;
3. maakt de schermlocator voor het geroteerde labelcentrum;
4. opent de store met actuele waarden;
5. commit met één `updateAnnotProp('params', nextParams)`.

Normaliseer bij commit met
`validateSymbolParams(annotation.symbolId, nextParams)`, zodat numerieke
invoervelden geen tekenreeksen in annotaties opslaan.

- [ ] **Step 5: Verbind dubbelklik en levenscyclus**

Voeg in `handleDblClick` vóór comment/stamp toe:

```js
} else if (clicked.type === 'parametricSymbol') {
  state.isDrawing = false;
  if (dblDoc) {
    dblDoc.selectedAnnotations = [clicked];
    dblDoc.selectedAnnotation = clicked;
  }
  showProperties(clicked);
  import('./parametric-symbol-editing.js')
    .then((module) => module.startParametricSymbolInput(clicked, coords.x, coords.y))
    .catch((error) => console.error('[dispatcher] parametric label input error', error));
```

Annuleer de editor in `manager.setTool`, monteer
`ParametricLabelInlineEditor` in `DialogHost` en hergebruik de visuele
variabelen van `.stavenreeks-inline-editor` in `dialogs.css`.

- [ ] **Step 6: Draai tests en commit**

Run:

```powershell
node open-pdf-studio/scripts/test-parametric-label-editing.mjs
node open-pdf-studio/scripts/test-wapeningskorf.mjs
node open-pdf-studio/scripts/test-nl-ifc-parametric-components.mjs
node open-pdf-studio/scripts/test-stavenreeks.mjs
```

Expected: alle checks PASS.

Commit:

```powershell
git commit -m "feat(symbolen): maak wapeningsteksten direct bewerkbaar"
```

---

### Task 4: Volledige regressie, review en PR

**Files:**
- Modify only if a failing test reveals a feature regression in files from Tasks 1–3.
- Verify: all files changed since the branch base.

**Interfaces:**
- Consumes: all interfaces produced by Tasks 1–3.
- Produces: een geverifieerde branch en een concept-PR naar de remote
  standaardbranch.

- [ ] **Step 1: Draai alle gerichte regressietests**

Run:

```powershell
node open-pdf-studio/scripts/test-parametric-symbol-defaults.mjs
node open-pdf-studio/scripts/test-parametric-label-editing.mjs
node open-pdf-studio/scripts/test-nl-ifc-parametric-components.mjs
node open-pdf-studio/scripts/test-wapeningsstaaf-two-point.mjs
node open-pdf-studio/scripts/test-wapeningskorf.mjs
node open-pdf-studio/scripts/test-stavenreeks.mjs
```

Expected: alle scripts eindigen met nul fouten.
De tweepuntstest blijft daarbij de round-tripchecks voor PDF/XFDF,
kopiëren/plakken en parameterbehoud uitvoeren; voeg `markerAantal: 4` en
`markerRichting: 'onder'` toe aan zijn round-tripfixture en verwacht exact
dezelfde waarden na herstel.

- [ ] **Step 2: Draai bestaande unit-, kwaliteits- en productiebouw**

Run vanuit `open-pdf-studio`:

```powershell
npm run test:unit
npm run test:quality
npm run build
```

Expected: alle drie commando's exitcode 0. Een bekende, niet door deze branch
veroorzaakte typecheckfout wordt afzonderlijk gerapporteerd en mag niet als
groene typecheck worden voorgesteld.

- [ ] **Step 3: Controleer diff en werkboomhygiëne**

Run:

```powershell
git diff --check
git status --short
git diff --stat origin/main...HEAD
```

Expected: geen whitespacefouten; alleen featurecommits worden gepubliceerd.
`Cargo.lock`, de lokale worker-binary, caches en lokale configuratiebestanden
blijven buiten staging en commits.

- [ ] **Step 4: Controleer GitHub-toegang en push**

Run:

```powershell
gh --version
gh auth status
git push -u origin codex/parametric-nl-ifc-symbols
```

Expected: CLI beschikbaar, authenticatie geldig en branch met upstream
gepusht.

- [ ] **Step 5: Maak een concept-PR**

Bepaal basisbranch met:

```powershell
gh repo view --json nameWithOwner,defaultBranchRef
```

Maak daarna een concept-PR met titel
`Parametrische NL IFC-symbolen en bewerkbare wapening` en een body met:

- alle toegevoegde parametrische constructiesymbolen;
- tweepuntsstaaf, voorinstellingen en vlaggen;
- aanklikbare wapeningsteksten;
- uitgevoerde tests en bekende niet-featuregerelateerde lokale toestand.

Expected: `gh pr create --draft` geeft een geldige PR-URL terug.
