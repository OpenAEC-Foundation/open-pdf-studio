// Hoeveelheden — CSV-export van een engine-resultaat (puur, geen UI/IO-deps).
// Kolommen → koppen, groepen → subtotaal-regels, eindtotaal. Beeldkolommen
// exporteren geen (enorme) data-URL maar een korte placeholder.
import { formatCell, fmtTotal, isImageCell } from './schedule-templates.js';
import { qLabel } from './categories.js';

function csvCell(s) {
  s = String(s ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Cel-tekst voor CSV: beeld-data-URL's worden vervangen door een placeholder
// zodat het bestand leesbaar/klein blijft.
function textCell(row, col) {
  if (col.kind === 'image') {
    const v = row.vals[col.key];
    return isImageCell(v) ? qLabel('quantities.imageCell', '[image]') : '';
  }
  return formatCell(row.vals[col.key], col);
}

/**
 * Bouw een CSV-string uit een buildSchedule-resultaat.
 * @param {object} r  resultaat van buildSchedule (columns/groups/grandTotals/itemize)
 * @returns {string}  CSV-inhoud (LF-gescheiden)
 */
export function scheduleResultToCsv(r) {
  if (!r || !r.columns || !r.columns.length) return '';
  const cols = r.columns;
  const lines = [cols.map(c => csvCell(c.label + (c.unit ? ` (${c.unit})` : ''))).join(',')];
  for (const g of r.groups) {
    if (g.key !== null) lines.push(csvCell(`${g.key} (${g.rows.length})`));
    if (r.itemize) {
      for (const row of g.rows) {
        lines.push(cols.map(c => csvCell(textCell(row, c))).join(','));
      }
    }
    lines.push(cols.map((c, i) => i === 0 ? csvCell(qLabel('quantities.subtotal', 'Subtotal')) : csvCell(fmtTotal(g.subtotals[c.key], c))).join(','));
  }
  lines.push(cols.map((c, i) => i === 0 ? csvCell(qLabel('quantities.grandTotal', 'Grand total')) : csvCell(fmtTotal(r.grandTotals[c.key], c))).join(','));
  return lines.join('\n');
}
