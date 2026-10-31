// Agenttaken (#556) door de echte plug-in-API heen: een kleine synthetische
// extensie dient vanuit een lintopdracht een taak in, zonder dat het
// assistentvenster opengaat; een MCP-client haalt de taak op via de handlers
// van de brug en antwoordt per taak-id; het resultaat gaat in één
// ongedaan-maakstap het document in. Daarna de aansluiting over de lagen: de
// brug, de Rust-lijst, de metatabel, tools.json, de manifest en de README.

import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
import { readFileSync } from 'node:fs';

register('./plugin-api-stubs.mjs', import.meta.url);

const laad = (pad) => import(new URL(pad, import.meta.url).href);
const { createPluginApi } = await laad('./plugin-api.js');
const { agentTaken, handleAgentTaskPending, handleAgentTaskResult } = await laad('./agent-tasks.js');
const { extensieOpdrachten, opdrachtId } = await laad('./extension-commands.js');
const relay = await laad('../assistant-mcp-relay.js');

const staat = globalThis.__stubState;
const undo = () => globalThis.__undoAanroepen ?? [];

// De laadhaken houden het proces in leven: een belofte die nooit afloopt, laat
// de test anders hangen in plaats van falen. Daarom een grens per wachtstap.
function binnen(belofte, ms = 2000) {
  let timer;
  const grens = new Promise((_, weiger) => { timer = setTimeout(() => weiger(new Error(`not settled within ${ms} ms`)), ms); });
  return Promise.race([belofte, grens]).finally(() => clearTimeout(timer));
}

// Een document zoals de app het bijhoudt, met genoeg om te toetsen.
function maakDocument(id, extra = {}) {
  return {
    id, fileName: `${id}.pdf`, numPages: 2, currentPage: 1,
    pdfDoc: { numPages: 2, fingerprints: [`vinger-${id}`, null] },
    pageRotations: {}, measureScale: { pixelsPerUnit: 2, unit: 'mm', method: 'manual', scaleRatio: 50 },
    annotations: [], _annotationPagesReady: new Set([1, 2]),
    ...extra,
  };
}

function zetDocumenten(...docs) {
  staat.documents = docs;
  staat.activeDocumentIndex = docs.length ? 0 : -1;
}

const SCHEMA = {
  type: 'object',
  properties: {
    walls: {
      type: 'array',
      items: {
        type: 'object',
        properties: { x1: { type: 'number' }, y1: { type: 'number' }, x2: { type: 'number' }, y2: { type: 'number' } },
        required: ['x1', 'y1', 'x2', 'y2'],
      },
    },
  },
  required: ['walls'],
};

// De synthetische extensie: één linttab met één knop die een taak indient
// en het resultaat na eigen controle toepast.
function activeerExtensie(id) {
  const api = createPluginApi(id);
  const taken = [];
  api.registerRibbonTab({ id: 'main', label: 'Plattegrond', groups: [{ id: 'g', label: 'Herkennen', items: [
    { type: 'action', id: 'recognize', label: 'Herken', onRun: () => {
      const doc = api.getDocumentInfo();
      const taak = api.submitAgentTask({
        kind: 'floorplan.recognize', documentId: doc.id, page: doc.currentPage,
        context: { units: 'mm' }, resultSchema: SCHEMA, requireScale: true,
      });
      taken.push(taak);
      return { taskId: taak.taskId };
    } },
  ] }] });
  // De extensie controleert de geometrie zelf vóór het toepassen.
  async function verwerk(taak) {
    const { result } = await binnen(taak.result);
    const geldig = result.walls.every((w) => [w.x1, w.y1, w.x2, w.y2].every((v) => v >= 0 && v <= 1000));
    if (!geldig) throw new Error('geometry outside the page');
    return taak.applyAnnotationBatch(result.walls.map((w, i) => ({
      op: 'create', annotation: { id: `${taak.taskId}-wall-${i}`, type: 'line', page: taak.page,
        startX: w.x1, startY: w.y1, endX: w.x2, endY: w.y2 },
    })));
  }
  return { api, taken, verwerk, opdracht: opdrachtId(id, 'recognize') };
}

test('een lintopdracht dient een taak in zonder assistentvenster; de MCP-client antwoordt; één ongedaan-maakstap', async () => {
  const doc = maakDocument('doc-a');
  zetDocumenten(doc);
  let assistentGeopend = 0;
  relay.registerAssistantSubmit(() => { assistentGeopend++; });
  const ext = activeerExtensie('nl.test.agent');
  assert.equal(ext.api.features.agentTasks, true);

  const uit = await extensieOpdrachten.voerUit(ext.opdracht, { source: 'ui' });
  assert.equal(uit.ok, true, JSON.stringify(uit));
  const [taak] = ext.taken;
  assert.equal(uit.result.taskId, taak.taskId);
  // Geen chatbericht, geen venster, geen vraag in de assistent-relay.
  assert.equal(assistentGeopend, 0);
  assert.deepEqual(relay.takePendingQuestion(), { ok: true, question: null });
  assert.deepEqual(relay.getAssistantMessages(), { ok: true, messages: [] });

  const opgehaald = await handleAgentTaskPending({});
  assert.equal(opgehaald.task.id, taak.taskId);
  assert.equal(opgehaald.task.extensionId, 'nl.test.agent');
  assert.deepEqual(opgehaald.task.context, { units: 'mm' });
  assert.equal(opgehaald.task.document.id, 'doc-a');
  assert.match(opgehaald.task.document.sourceFingerprint, /^vinger-doc-a:2:\d+$/);
  assert.deepEqual(opgehaald.task.document.scale, { document: { pixelsPerUnit: 2, unit: 'mm', scaleRatio: 50 }, regions: [] });
  assert.equal(JSON.stringify(opgehaald).includes('doc-a.pdf'), false, 'geen bestandsnaam naar de agent');
  assert.equal(ext.api.getAgentTaskAvailability().available, true);

  // Een ongeldig resultaat komt niet bij de extensie aan.
  const fout = await handleAgentTaskResult({ id: taak.taskId, result: { walls: [{ x1: 0, y1: 0, x2: 10 }], extra: 1 } });
  assert.equal(fout.code, 'INVALID_RESULT');
  assert.equal(doc.annotations.length, 0);

  const voor = undo().length;
  const klaar = ext.verwerk(taak);
  assert.equal((await handleAgentTaskResult({ id: taak.taskId, result: { walls: [{ x1: 0, y1: 0, x2: 100, y2: 0 }, { x1: 100, y1: 0, x2: 100, y2: 80 }] } })).ok, true);
  const batch = await binnen(klaar);
  assert.equal(batch.createdIds.length, 2);
  assert.deepEqual(doc.annotations.map((a) => [a.type, a.page]), [['line', 1], ['line', 1]]);
  const stappen = undo().slice(voor);
  assert.deepEqual(stappen.filter((s) => s === 'begin' || s === 'end'), ['begin', 'end'], 'één ongedaan-maakstap');
  assert.equal(stappen.filter((s) => s.startsWith('add:')).length, 2);
  assert.equal(assistentGeopend, 0);
  ext.api._cleanup();
});

test('een schaalwissel of tabbladwissel annuleert de taak; er komen geen annotaties bij', async () => {
  const doc = maakDocument('doc-b');
  const ander = maakDocument('doc-c');
  zetDocumenten(doc, ander);
  const ext = activeerExtensie('nl.test.agent-schaal');
  await extensieOpdrachten.voerUit(ext.opdracht, { source: 'ui' });
  await extensieOpdrachten.voerUit(ext.opdracht, { source: 'ui' });
  const [eerste, tweede] = ext.taken;
  const verwerkt = ext.verwerk(eerste);
  assert.equal((await handleAgentTaskPending({})).task.id, eerste.taskId);

  doc.measureScale = { pixelsPerUnit: 4, unit: 'mm', method: 'manual', scaleRatio: 100 };
  // In de app volgt een effect de schaal; onder node roepen we de controle aan.
  agentTaken.controleer();
  await assert.rejects(binnen(verwerkt), (e) => e.code === 'SCALE_CHANGED');
  assert.equal(tweede.status, 'cancelled');
  const laat = await handleAgentTaskResult({ id: eerste.taskId, result: { walls: [{ x1: 0, y1: 0, x2: 1, y2: 1 }] } });
  assert.equal(laat.code, 'TASK_NOT_RUNNING');
  assert.equal(laat.reason, 'SCALE_CHANGED');

  // Een nieuwe taak; dan naar het andere tabblad.
  await extensieOpdrachten.voerUit(ext.opdracht, { source: 'ui' });
  const derde = ext.taken[2];
  staat.activeDocumentIndex = 1;
  assert.equal((await handleAgentTaskPending({})).task, null, 'ophalen controleert eerst');
  assert.equal(derde.status, 'cancelled');
  assert.equal(derde.snapshot().code, 'DOCUMENT_SWITCHED');
  assert.equal(doc.annotations.length + ander.annotations.length, 0);
  ext.api._cleanup();
});

test('zonder bevestigde schaal weigert de extensie met requireScale; vervangen bron maakt een voltooid resultaat oud', async () => {
  const doc = maakDocument('doc-d', { measureScale: null });
  zetDocumenten(doc);
  const ext = activeerExtensie('nl.test.agent-bron');
  const geweigerd = await extensieOpdrachten.voerUit(ext.opdracht, { source: 'ui' });
  assert.equal(geweigerd.ok, false);
  assert.match(geweigerd.error, /confirmed measurement scale/);
  // Een gekalibreerd gebied op de pagina telt als bevestigde schaal.
  doc.annotations.push({ id: 'schaal-1', type: 'scaleRegion', page: 1, x: 0, y: 0, width: 500, height: 500, pixelsPerUnit: 3, unit: 'mm', scaleString: '1:50' });
  assert.equal((await extensieOpdrachten.voerUit(ext.opdracht, { source: 'ui' })).ok, true);
  const [taak] = ext.taken;
  const opgehaald = await handleAgentTaskPending({ kind: 'floorplan.recognize' });
  assert.equal(opgehaald.task.document.scale.regions[0].scaleString, '1:50');
  assert.equal((await handleAgentTaskResult({ id: taak.taskId, result: { walls: [] } })).ok, true);
  await binnen(taak.result);
  // Pagina's ingevoegd: pdf.js laadt een nieuw document, dus een andere bron.
  doc.pdfDoc = { numPages: 3, fingerprints: ['vinger-doc-d', null] };
  doc.numPages = 3;
  assert.throws(() => taak.applyAnnotationBatch([{ op: 'create', annotation: { id: 'x', type: 'line', page: 1 } }]),
    (e) => e.code === 'STALE_TASK' && e.reason === 'SOURCE_CHANGED');
  assert.equal(doc.annotations.length, 1, 'alleen het schaalgebied');
  ext.api._cleanup();
});

test('uitladen van de extensie haalt de luisteraars weg en annuleert openstaand werk', async () => {
  zetDocumenten(maakDocument('doc-e'));
  const ext = activeerExtensie('nl.test.agent-uit');
  await extensieOpdrachten.voerUit(ext.opdracht, { source: 'ui' });
  const [taak] = ext.taken;
  const gemeld = [];
  taak.onStatus((s) => gemeld.push(s.status));
  ext.api._cleanup();
  assert.deepEqual(gemeld, []);
  assert.equal(taak.status, 'cancelled');
  await assert.rejects(binnen(taak.result), (e) => e.code === 'EXTENSION_UNLOADED');
  assert.equal(extensieOpdrachten.heeft(ext.opdracht), false, 'de lintopdracht is weg');
  assert.throws(() => ext.api.submitAgentTask({ kind: 'floorplan.recognize', documentId: 'doc-e', page: 1, resultSchema: SCHEMA }),
    (e) => e.code === 'EXTENSION_INACTIVE');
  assert.deepEqual(await handleAgentTaskPending({}), { ok: true, task: null, waiting: 0 });
  // Een nieuwe versie van dezelfde extensie werkt gewoon weer.
  const opnieuw = activeerExtensie('nl.test.agent-uit');
  assert.equal((await extensieOpdrachten.voerUit(opnieuw.opdracht, { source: 'mcp' })).ok, true);
  assert.equal((await handleAgentTaskPending({})).task.id, opnieuw.taken[0].taskId);
  opnieuw.api._cleanup();
  assert.equal(opnieuw.taken[0].status, 'cancelled');
});

// ─── Aansluiting over de lagen ───────────────────────────────────────────────

const REPO = new URL('../../../', import.meta.url);
const lees = (pad) => readFileSync(new URL(pad, REPO), 'utf8').replace(/\r\n/g, '\n');
const TOOLS = [
  ['app_agent_task_pending', 'mcp:agent-task-pending', 'handleAgentTaskPending', 'Take pending agent task', 'agent_task_pending_tool'],
  ['app_agent_task_result', 'mcp:agent-task-result', 'handleAgentTaskResult', 'Answer agent task', 'agent_task_result_tool'],
];

function rustDescriptor(bron, functie) {
  const start = bron.indexOf(`fn ${functie}(`);
  assert.ok(start >= 0, `${functie} in mcp_server.rs`);
  const open = bron.indexOf('json!(', start) + 'json!('.length;
  let diepte = 0;
  let i = open;
  for (; i < bron.length; i++) {
    const c = bron[i];
    if (c === '"') { i++; while (bron[i] !== '"') { if (bron[i] === '\\') i++; i++; } continue; }
    if (c === '{' || c === '[') diepte++;
    if (c === '}' || c === ']') { diepte--; if (diepte === 0) break; }
  }
  return JSON.parse(bron.slice(open, i + 1));
}
const sorteer = (v) => (Array.isArray(v) ? v.map(sorteer)
  : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorteer(v[k])])) : v);

test('brug, Rust-lijst, dispatch, metatabel, tools.json, manifest en README lopen gelijk', () => {
  const brug = lees('open-pdf-studio/js/mcp-bridge.js');
  const rs = lees('open-pdf-studio/src-tauri/src/mcp_server.rs');
  const meta = lees('open-pdf-studio/src-tauri/src/mcp_tool_meta.rs');
  const tools = JSON.parse(lees('mcp-stdio/tools.json'));
  const manifest = JSON.parse(lees('mcpb/manifest.json'));
  for (const [naam, kanaal, handler, titel, functie] of TOOLS) {
    const regel = brug.split('\n').find((r) => r.includes(`'${kanaal}'`));
    assert.ok(regel, `${kanaal} in HANDLERS`);
    assert.match(regel, new RegExp(`import\\('\\./plugins/agent-tasks\\.js'\\)\\.then\\(\\(m\\) => m\\.${handler}\\(p\\)\\)`));
    assert.match(rs, new RegExp(`"${naam}"\\s+=> tool_app_request\\(state, "${kanaal}",\\s+&arguments, Duration::from_secs\\(10\\)\\)\\.await,`));
    assert.ok(meta.includes(`voegt_toe("${naam}", "${titel}"),`), `${naam} in de metatabel`);
    assert.ok(rs.includes(`            ${functie}(),\n`), `${functie}() staat in de lijst`);
    const def = rustDescriptor(rs, functie);
    assert.equal(def.name, naam);
    const verwacht = sorteer({ ...def, annotations: { title: titel, readOnlyHint: false, destructiveHint: false, openWorldHint: false } });
    assert.deepEqual(tools.find((t) => t.name === naam), verwacht, `${naam} in tools.json`);
    const inManifest = manifest.tools.find((t) => t.name === naam);
    assert.ok(inManifest && def.description.startsWith(inManifest.description.replace(/\.$/, '')), `${naam} in de manifest`);
  }
  // Direct na de assistent-relay; de telling van het publieke profiel.
  const i = tools.findIndex((t) => t.name === 'app_assistant_history');
  assert.deepEqual(tools.slice(i + 1, i + 3).map((t) => t.name), TOOLS.map((t) => t[0]));
  assert.equal(tools.length, 90);
  assert.match(rs, /assert_eq!\(arr\.len\(\), 90\);/);
  const leesmij = lees('mcp-stdio/README.md');
  assert.match(leesmij, /\(90 public tools:/);
  assert.match(leesmij, /\*\*`app_agent_task_pending`\*\* → \*\*`app_agent_task_result`\*\*/);
  // De agent krijgt nooit iets uit het assistentvenster: agent-tasks.js kent de relay en het paneel niet.
  const bron = lees('open-pdf-studio/js/plugins/agent-tasks.js');
  const zonderCommentaar = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(zonderCommentaar(bron), /assistant-mcp-relay|AssistantPanel|submitAssistantMessage|setOpen/);
  const api = lees('open-pdf-studio/js/plugins/plugin-api.js');
  assert.match(api, /agentTasks: true/);
  assert.match(api, /_cleanup\(\) \{\s*const waarschuwingen = scope\.ruimOp\(\);[\s\S]*?agentTaken\.ruimOp\(agentEigenaar\);/);
  assert.doesNotMatch(zonderCommentaar(api), /assistant-mcp-relay/);
});

test('de documentatie voor extensies beschrijft de agenttaken', () => {
  const doc = lees('open-pdf-studio/docs/plugin-page-analysis-api.md');
  assert.match(doc, /^## Agent tasks$/m);
  for (const woord of ['submitAgentTask', 'getAgentTaskAvailability', 'applyAnnotationBatch', 'app_agent_task_pending',
    'app_agent_task_result', 'STALE_TASK', 'EXTENSION_UNLOADED', 'resultSchema']) {
    assert.ok(doc.includes(woord), woord);
  }
});
