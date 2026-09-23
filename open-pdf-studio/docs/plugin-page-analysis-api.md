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
