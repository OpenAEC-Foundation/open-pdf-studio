// Hoeveelheden — CSV-export van een engine-resultaat (puur, geen UI/IO-deps).
// Kolommen → koppen, groepen → subtotaal-regels, eindtotaal. Beeldkolommen
// exporteren geen (enorme) data-URL maar een korte placeholder.
import { formatRowCell, fmtTotal, isImageCell } from './schedule-templates.js';
import { qLabel } from './categories.js';
import { TAG_ID_HEADER, rowAnnotationId } from './takeoff-tags.js';

// A number, optionally negative and with a unit ("-1.50 m"), is data.
// Grouped with a (narrow) no-break space in some languages (#629).
const NUMBER = /^-?\d+(?:[.,\u00a0\u202f]\d+)*(?: [\p{L}\p{N}²³/%.·]+)?$/u;

// Like bindingCsv: a cell that a spreadsheet application would evaluate as a
// formula (=, +, -, @, tab, carriage return first) gets a leading quote.
function csvCell(s) {
  s = String(s ?? '');
  if (/^[=+\-@\t\r]/.test(s) && !NUMBER.test(s)) s = `'${s}`;
  return /^'|[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Cel-tekst voor CSV: beeld-data-URL's worden vervangen door een placeholder
// zodat het bestand leesbaar/klein blijft.
function textCell(row, col) {
  if (col.kind === 'image') {
    const v = row.vals[col.key];
    return isImageCell(v) ? qLabel('quantities.imageCell', '[image]') : '';
  }
  return formatRowCell(row, col);
}

/**
 * Bouw een CSV-string uit een buildSchedule-resultaat.
 * @param {object} r  resultaat van buildSchedule (columns/groups/grandTotals/itemize)
 * @param {{ids?: boolean}} [opties]  ids: een laatste kolom "ID" met het id
 *   van de annotatie achter elke regel, zodat bewerkte kenmerken weer
 *   ingelezen kunnen worden (takeoff-tags.js)
 * @returns {string}  CSV-inhoud (LF-gescheiden)
 */
export function scheduleResultToCsv(r, { ids = false } = {}) {
  if (!r || !r.columns || !r.columns.length) return '';
  const cols = r.columns;
  const metIds = ids && r.itemize;
  const kop = cols.map(c => csvCell(c.label + (c.unit ? ` (${c.unit})` : '')));
  if (metIds) kop.push(TAG_ID_HEADER);
  const lines = [kop.join(',')];
  for (const g of r.groups) {
    if (g.key !== null) lines.push(csvCell(`${g.key} (${g.rows.length})`));
    if (r.itemize) {
      for (const row of g.rows) {
        const cellen = cols.map(c => csvCell(textCell(row, c)));
        if (metIds) cellen.push(csvCell(rowAnnotationId(row)));
        lines.push(cellen.join(','));
      }
    }
    lines.push(cols.map((c, i) => i === 0 ? csvCell(qLabel('quantities.subtotal', 'Subtotal')) : csvCell(fmtTotal(g.subtotals[c.key], c))).join(','));
  }
  lines.push(cols.map((c, i) => i === 0 ? csvCell(qLabel('quantities.grandTotal', 'Grand total')) : csvCell(fmtTotal(r.grandTotals[c.key], c))).join(','));
  return lines.join('\n');
}
