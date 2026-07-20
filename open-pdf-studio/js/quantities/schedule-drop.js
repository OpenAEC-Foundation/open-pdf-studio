// Drag & drop van een schedule (staat) uit het linkerpaneel naar de PDF.
// De SchedulesPanel-rij zet bij dragstart de schedule-id op de dataTransfer;
// hier vangen we de drop op de viewer, resolven het drop-punt naar app-space
// pagina-coördinaten en plaatsen een scheduleTable-annotatie op die positie.
import { getActiveDocument } from '../core/state.js';
import { createAnnotation } from '../annotations/factory.js';
import { resolvePointerCoords } from '../tools/tool-context.js';
import { redrawAnnotations, redrawContinuous } from '../annotations/rendering.js';
import { scheduleResultToTable } from './schedule-templates.js';
import { getScheduleById, buildResultForSchedule } from '../solid/stores/schedulesStore.js';
import { recordAdd } from '../core/undo-manager.js';

export const SCHEDULE_DND_MIME = 'application/x-opds-schedule';

let installed = false;

function redraw() {
  const doc = getActiveDocument();
  if (doc?.viewMode === 'continuous') redrawContinuous();
  else redrawAnnotations();
}

// Plaats een schedule als tabel-annotatie op app-space punt (x, y) op `pageNum`.
export function placeScheduleAt(scheduleId, x, y, pageNum) {
  const doc = getActiveDocument();
  if (!doc) return null;
  const schedule = getScheduleById(scheduleId);
  if (!schedule) return null;
  const result = buildResultForSchedule(schedule);
  if (!result || !result.columns.length) return null;

  const table = scheduleResultToTable(result, schedule.name);
  const ann = createAnnotation({
    type: 'scheduleTable',
    page: pageNum || doc.currentPage || 1,
    x: Math.max(0, Math.round(x)),
    y: Math.max(0, Math.round(y)),
    width: table.width,
    height: table.height,
    title: table.title,
    columns: table.columns,
    rows: table.rows,
    color: '#000000',
    lineWidth: 0.5,
    opacity: 1,
  });
  doc.annotations.push(ann);
  recordAdd(ann);
  redraw();
  return ann;
}

function onDragOver(e) {
  if (!e.dataTransfer) return;
  const types = e.dataTransfer.types;
  if (types && Array.prototype.indexOf.call(types, SCHEDULE_DND_MIME) === -1) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
}

function onDrop(e) {
  if (!e.dataTransfer) return;
  const id = e.dataTransfer.getData(SCHEDULE_DND_MIME);
  if (!id) return;
  e.preventDefault();
  e.stopPropagation();
  const coords = resolvePointerCoords(e);
  placeScheduleAt(id, coords.x, coords.y, coords.pageNum);
}

/** Idempotent: hang drop-handlers op de PDF-viewer. Retryt kort als de
 *  viewer-container nog niet in de DOM staat bij eerste aanroep. */
export function initScheduleDrop(_attempt = 0) {
  if (installed) return;
  const container = document.getElementById('pdf-container');
  if (!container) {
    if (_attempt < 30) requestAnimationFrame(() => initScheduleDrop(_attempt + 1));
    return;
  }
  container.addEventListener('dragover', onDragOver);
  container.addEventListener('drop', onDrop);
  installed = true;
}
