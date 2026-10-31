# Plugin page analysis and persistent annotations

The plugin API provides an opt-in foundation for drawing analysis. Check
`api.features.pageAnalysis`, `api.features.annotationBatch`, and
`api.features.pluginDocumentEvents` before calling the methods below.

All page numbers are 1-based. Coordinates are annotation-space units: the
page viewport at scale 1, with origin at the displayed top-left. The page
rotation and CropBox are included in the conversion functions.

```js
const controller = new AbortController();
const document = api.getDocumentInfo(); // { id, name, pageCount, currentPage }
const page = await api.getPageInfo(document.currentPage, { signal: controller.signal });
const scale = api.getScaleAt(document.currentPage, 100, 100);
// scale is null until a calibration source is available; pixelsPerUnit is
// measured in annotation-space pixels per unit of scale.unit.
const { text, edges, points } = await api.readPageContent(document.currentPage, {
  signal: controller.signal,
});
const tile = await api.renderPageTile(document.currentPage,
  { x: 0, y: 0, width: 1024, height: 1024 },
  { scale: 1, signal: controller.signal });
// tile.blob is image/png. Each rendered tile is limited to 2048 pixels per
// side and 4 million pixels total. Request neighboring tiles for large sheets.
```

`getPageInfo` returns `width`, `height`, `rotation`, `documentId`,
`pdfToAnnotation(x, y)`, and `annotationToPdf(x, y)`. `readPageContent`
returns positioned text and vector points/edges. Empty vectors on a scanned
sheet are expected; use raster tiles for image-based recognition. Requests
reject on cancellation or a document switch. Callers should abort obsolete
requests and avoid retaining all pages' analysis results at once.

Annotations are inserted through a single validated undo transaction:

```js
await api.waitForPageAnnotations(pageNum);
api.applyAnnotationBatch([
  { op: 'create', annotation: {
    id: 'ceiling-1', type: 'ceilingSystem', page: pageNum,
    x: 80, y: 120, width: 400, height: 220,
    params: { orientation: 90, origin: [80, 120] },
  } },
  { op: 'update', id: 'ceiling-2', changes: { params: { orientation: 0 } } },
  { op: 'delete', id: 'ceiling-3' },
]);
```

The page must be loaded before editing, or the batch throws without changing
the document. Invalid pages, duplicate or missing IDs, non-finite numbers,
and non-serializable values also reject the whole batch. IDs and types cannot
be changed by update. The result contains `createdIds`, `updatedIds`, and
`deletedIds`. For changes to a nested parameter object, supply its complete
new value. The normal undo/redo and modified-state machinery is used.

Register an annotation type with `render(ctx, annotation)` and a finite
`getBounds(annotation)` (or `x`, `y`, `width`, `height` on the object). A
render-only handler is saved as a standard PDF annotation: its normal renderer
supplies a visible appearance for other viewers, while its JSON model is
stored for reopening and continued editing here. Custom data should remain
JSON-compatible and below 2 MB per annotation. A handler using the older
`serializeToPdf` page-baking hook keeps its existing behavior and does not
participate in this structured round trip.

`api.onDocumentEvent(type, listener)` supports `documentChanged`,
`pageChanged`, and `scaleChanged`; it returns an unsubscribe function. The
host also removes subscriptions when the plugin is unloaded. Read the current
state once on activation because listeners only receive subsequent changes.

## View navigation and selection

Check `api.features.viewNavigation` before calling these methods. They let an
extension go from its own list (rooms, objects) to the drawing without GUI
automation or private modules. Pass the `id` from `api.getDocumentInfo()`.

```js
const doc = api.getDocumentInfo();
await api.navigateToPage({ documentId: doc.id, page: 2 });
await api.selectAnnotations({ documentId: doc.id, ids: ['room-1', 'room-2'], focus: true });
const result = await api.focusAnnotation({ documentId: doc.id, annotationId: 'room-1', page: 1 });
if (!result.ok) console.warn(result.code, result.message);
```

- `navigateToPage({ documentId, page })` shows a valid page of the active
  document. Asking for the current page does nothing (and keeps the selection).
- `selectAnnotations({ documentId, ids, focus })` selects existing annotations
  through the normal selection and property-panel workflow. They must be on
  one page; the view goes to that page when needed. `focus: true` centres
  their bounds in the view.
- `focusAnnotation({ documentId, annotationId, page })` navigates to one
  annotation, selects it and centres it. With `page`, the annotations of that
  page are loaded first when needed, and the annotation must be on that page.

Every call resolves to `{ ok: true, documentId, page, ... }` or to
`{ ok: false, code, message }`. Codes: `invalidArgument`, `documentClosed`,
`documentNotActive`, `documentChanged`, `invalidPage`, `annotationNotFound`
(with `missing`), `annotationHidden` and `annotationLocked` (with `ids`),
`multiplePages`, `pageMismatch` and `superseded`. A failed call does not
change the selection.

The document identity is checked again after every wait. Switching or closing
the document while a call is pending makes it fail with `documentChanged` or
`documentClosed`; nothing is selected in the document that is now active. A
newer call from the same extension supersedes an older one that is still
pending. These methods never change annotation geometry, layers, saved
content or other tabs. Selecting through them notifies the listeners from
`registerSelectionListener`, just like a click on the page.

## Agent tasks

Check `api.features.agentTasks` before calling these methods. An extension
can hand a structured task (for example "recognise the floor plan on this
page") to an MCP agent and get a structured result back, without a chat
message and without importing host modules.

```js
const doc = api.getDocumentInfo();
const controller = new AbortController();
const task = api.submitAgentTask({
  kind: 'floorplan.recognize',          // [a-z0-9][a-z0-9.-]{0,63}
  documentId: doc.id,                   // must be the active document
  page: doc.currentPage,
  context: { units: 'mm', walls: [] },  // only the fields the agent may see
  resultSchema: {
    type: 'object',
    properties: {
      walls: { type: 'array', items: { type: 'object',
        properties: { x1: { type: 'number' }, y1: { type: 'number' },
                      x2: { type: 'number' }, y2: { type: 'number' } },
        required: ['x1', 'y1', 'x2', 'y2'] } },
    },
    required: ['walls'],
  },
  requireScale: true,                   // refuse without a confirmed scale
  timeoutMs: 300000,                    // 1 s to 1 h, default 10 min
  signal: controller.signal,
});
task.onStatus(s => showProgress(s.status));   // pending, running, completed, failed, cancelled
try {
  const { result } = await task.result;
  const operations = validateWalls(result.walls, task.page);  // your own geometry checks
  task.applyAnnotationBatch(operations);                       // one undo step
} catch (error) {
  console.warn(error.code, error.message);
}
```

`submitAgentTask` validates the request and returns a handle at once:
`taskId`, `kind`, `documentId`, `page`, `result` (a promise), `status`,
`snapshot()`, `onStatus(listener)` (returns an unsubscribe function),
`cancel()` and `applyAnnotationBatch(operations)`. Invalid requests throw an
error with a `code`: `INVALID_ARGUMENT`, `INVALID_SCHEMA`,
`DOCUMENT_NOT_FOUND`, `DOCUMENT_NOT_ACTIVE`, `INVALID_PAGE`,
`SCALE_REQUIRED`, `TOO_MANY_TASKS` (at most 8 pending or running tasks per
extension), `CANCELLED` (the signal was already aborted) or
`EXTENSION_INACTIVE`.

**What the agent sees.** At submission the task records the document id,
page, page count, a source fingerprint, the in-app page rotation and the
confirmed scale (the document scale plus the calibrated areas on the page).
The agent receives these, the `context` object and the `resultSchema`,
nothing else: no conversation, no file name, no other tasks. `context` must
be a plain JSON object of at most 64 fields and 256 KB; it is copied at
submission.

**Result schema.** A strict subset of JSON Schema: `type`, `properties`,
`required`, `additionalProperties`, `items`, `enum`, `const`, `minimum`,
`maximum`, `minLength`, `maxLength`, `minItems`, `maxItems`, `description`
and `title`. Any other keyword is refused, so nothing is silently left
unchecked. The root must be an object. Objects refuse fields that the schema
does not list unless `additionalProperties` is `true` or a schema. The host
checks every result before the extension sees it; a result that does not
match goes back to the agent with the errors, and after three rejected
attempts the task fails with `INVALID_RESULT`.

**Status and errors.** `task.result` resolves to `{ taskId, result }` or
rejects with an error whose `code` is one of: `CANCELLED` (`cancel()` or the
signal), `TIMEOUT`, `AGENT_ERROR` (the agent reported that it cannot do the
task; `agentCode` holds its code), `INVALID_RESULT`, `EXTENSION_UNLOADED`,
`DOCUMENT_SWITCHED`, `DOCUMENT_CLOSED`, `SOURCE_CHANGED` (pages inserted,
deleted or replaced, find and replace), `PAGE_CHANGED` (the page rotated or
gone) and `SCALE_CHANGED`. Switching or closing the document, or changing its
source, page or scale, cancels a pending or running task; a late answer from
the agent is refused. Navigating to another page does not.

**Applying.** A result is a proposal. Validate the geometry, then call
`task.applyAnnotationBatch(operations)` with the operations of
`api.applyAnnotationBatch`. It works once, only after `completed`, and only
on the task's page: created annotations must have that `page`, updated and
deleted annotations must be on it, and an update cannot change `page`. The
document identity is checked again: if the document is no longer active or
its source, page rotation or scale differs from submission, it throws
`STALE_TASK` (with `reason`) and nothing changes. Otherwise the batch is one
undo step.

**Availability and retries.** `api.getAgentTaskAvailability()` returns
`{ available, lastPollAgeMs, pending, running }`; `available` is true when an
MCP agent asked for tasks in the last 30 seconds. Tasks only go to an MCP
agent: they are never routed to another AI provider, and they are never
retried automatically. To retry, submit a new task.

**Unloading.** When the extension is deactivated or reloaded, its status
listeners are removed first, then its pending and running tasks are
cancelled with `EXTENSION_UNLOADED`, and completed results that were not
applied can no longer be applied.

**The agent side.** An MCP client takes the oldest task with
`app_agent_task_pending` (optionally `{ kind }`); the task becomes `running`
and no other client gets it. It answers that exact task with
`app_agent_task_result { id, result }` or `{ id, error: { message, code } }`.
Answers to an unknown, unclaimed or finished task are refused with
`UNKNOWN_TASK`, `TASK_NOT_CLAIMED` or `TASK_NOT_RUNNING`; a task whose
document changed is refused with `STALE_TASK`. Two tasks never see each
other's results.
