// Drag & drop van een schedule (staat) uit het linkerpaneel naar de PDF.
// Het slepen zelf staat in schedule-pointer-drag.js; hier resolven we het
// drop-punt naar app-space pagina-coördinaten en plaatsen we een
// scheduleTable-annotatie op die positie.
import { getActiveDocument } from '../core/state.js';
import { createAnnotation } from '../annotations/factory.js';
import { resolvePointerCoords } from '../tools/tool-context.js';
import { redrawAnnotations, redrawContinuous } from '../annotations/rendering.js';
import { scheduleResultToTable } from './schedule-templates.js';
import { getScheduleById, buildResultForSchedule } from '../solid/stores/schedulesStore.js';
import { recordAdd } from '../core/undo-manager.js';
import { isPaginaDoel } from './schedule-pointer-drag.js';

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
    // Van welke staat deze tabel een momentopname is: zo kan een staat samen
    // met zijn geplaatste tabellen worden verwijderd (#1130).
    scheduleId: schedule.id,
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

/** Plaats een staat op een schermpunt; buiten de PDF gebeurt er niets. */
export function placeScheduleAtPoint(scheduleId, clientX, clientY) {
  const target = document.elementFromPoint(clientX, clientY);
  if (!isPaginaDoel(target, getActiveDocument()?.viewMode)) return null;
  const coords = resolvePointerCoords({ clientX, clientY, target });
  return placeScheduleAt(scheduleId, coords.x, coords.y, coords.pageNum);
}
