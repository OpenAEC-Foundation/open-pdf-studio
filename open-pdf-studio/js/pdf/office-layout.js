// Geometry-only text and table recovery shared by ODT and XLSX export.
// Coordinates are displayed page points (x right, y down), independent of zoom.
export function textItemsToBoxes(items, viewport) {
  const text = items.filter(item => typeof item.str === 'string' && item.str.trim());
  const [a, b, c, d, e, f] = viewport.transform;
  // Read in the dominant text direction, even when the PDF or viewer turns
  // the sheet sideways. Otherwise a rotated table becomes one row per column.
  const directions = [0, 0, 0, 0];
  for (const item of text) {
    const [ta, tb] = item.transform;
    const angle = Math.atan2(b * ta + d * tb, a * ta + c * tb);
    const quadrant = ((Math.round(angle / (Math.PI / 2)) % 4) + 4) % 4;
    directions[quadrant] += item.str.length;
  }
  const direction = directions.indexOf(Math.max(...directions));
  const cos = [1, 0, -1, 0][direction], sin = [0, 1, 0, -1][direction];
  return text.map(item => {
    const [ta, tb, , , tx, ty] = item.transform;
    const height = Math.max(1, Math.hypot(a * ta + c * tb, b * ta + d * tb));
    const x = a * tx + c * ty + e;
    const y = b * tx + d * ty + f;
    return { text: item.str, x: cos * x + sin * y, y: -sin * x + cos * y - height,
      width: Math.max(1, item.width * viewport.scale), height };
  });
}

export function recoverLayout(boxes, { joinParagraphs = false } = {}) {
  const sorted = boxes.filter(b => b.text?.trim() && [b.x, b.y, b.width, b.height].every(Number.isFinite))
    .map(b => ({ ...b, text: b.text.trim() })).sort((a, b) => a.y - b.y || a.x - b.x);
  const rows = [];
  for (const box of sorted) {
    let row = rows.at(-1);
    // Wrapped descriptions can straddle the baseline of their quantity and
    // amount. Their boxes still overlap vertically and belong to one row.
    if (!row || box.y > row.bottom - Math.max(1, Math.min(row.height, box.height) * 0.1)) {
      row = { y: box.y, bottom: box.y + box.height, height: box.height, boxes: [] };
      rows.push(row);
    }
    row.boxes.push(box);
    row.bottom = Math.max(row.bottom, box.y + box.height);
    row.height = Math.max(row.height, box.height);
  }
  for (const row of rows) {
    row.cells = [];
    for (const box of row.boxes.sort((a, b) => a.x - b.x)) {
      const previous = row.cells.at(-1);
      const gap = previous ? box.x - previous.right : Infinity;
      if (previous && gap < Math.max(6, row.height * 0.7)) {
        const wrapped = Math.abs(box.y - previous.lastY) > row.height * 0.45;
        previous.text += (wrapped || gap > row.height * 0.12 ? ' ' : '') + box.text;
        previous.right = Math.max(previous.right, box.x + box.width);
        previous.lastY = box.y;
      } else row.cells.push({ text: box.text, x: box.x, right: box.x + box.width, lastY: box.y });
    }
    row.text = row.cells.map(c => c.text).join('  ');
  }
  const blocks = [];
  const paragraph = (row, text = row.text, continuationX = row.cells[0]?.x) => ({
    type: 'paragraph', text, _row: row, _continuationX: continuationX,
  });
  let pending = [];
  const flush = () => {
    if (!pending.length) return;
    if (pending.filter(row => row.cells.length >= 2).length < 2) {
      blocks.push(...pending.map(row => paragraph(row)));
    }
    else {
      // The fullest row supplies column anchors. Matching by nearest interval
      // preserves empty middle cells and right-aligned quantities.
      const template = pending.reduce((a, b) => b.cells.length > a.cells.length
        || (b.cells.length === a.cells.length && b.cells.at(-1).right > a.cells.at(-1).right) ? b : a);
      const boundaries = template.cells.slice(1).map((cell, i) => (template.cells[i].right + cell.x) / 2);
      const cells = pending.map(row => {
        const values = Array(template.cells.length).fill('');
        for (const cell of row.cells) {
          const center = (cell.x + cell.right) / 2;
          let column = boundaries.findIndex(edge => center < edge);
          if (column < 0) column = values.length - 1;
          values[column] += (values[column] ? ' ' : '') + cell.text;
        }
        return values;
      });
      blocks.push({ type: 'table', rows: cells });
    }
    pending = [];
  };
  for (const [index, row] of rows.entries()) {
    const previous = pending.at(-1);
    if (previous && row.y - previous.bottom > Math.max(previous.height, row.height) * 5) flush();
    const bullet = row.cells.length === 2 && /^[-•–]$/.test(row.cells[0].text);
    if (bullet) {
      flush();
      blocks.push(paragraph(row, `${row.cells[0].text} ${row.cells[1].text}`, row.cells[1].x));
    } else if (row.cells.length >= 2) pending.push(row);
    else {
      const next = rows[index + 1];
      const aligned = pending.length && next?.cells.length >= 2
        && Math.abs(row.cells[0].x - pending[0].cells[0].x) < 20
        && Math.abs(next.cells[0].x - row.cells[0].x) < 20
        && next.y - row.bottom <= Math.max(row.height, next.height) * 5;
      if (aligned) pending.push(row);
      else { flush(); blocks.push(paragraph(row)); }
    }
  }
  flush();
  if (!joinParagraphs) return blocks.map(({ _row, _continuationX, ...block }) => block);
  const joined = [];
  for (const block of blocks) {
    const previous = joined.at(-1);
    const row = block._row, before = previous?._row;
    const gap = before && row ? row.y - before.bottom : Infinity;
    const wrapped = previous?.type === 'paragraph' && block.type === 'paragraph'
      && gap >= -1 && gap <= Math.max(before.height, row.height) * 0.65
      && Math.abs(row.cells[0].x - previous._continuationX) <= Math.max(3, row.height * 0.25)
      && !/[.!?:;]$/.test(previous.text.trim())
      && !/^[-•–]\s/.test(block.text);
    if (wrapped) {
      previous.text += `${/-$/.test(previous.text) ? '' : ' '}${block.text}`;
      previous._row = row;
    } else joined.push(block);
  }
  return joined.map(({ _row, _continuationX, ...block }) => block);
}

// On drawings, labels elsewhere on the sheet often share the same y values
// as a schedule. A page-wide row pass then folds those labels into the table.
// Find isolated text islands inside overlapping horizontal bands first. The
// ordinary layout pass still handles everything outside a confident island.
export function recoverDrawingLayout(boxes, pageWidth, pageHeight) {
  if (pageWidth < 1000 || boxes.length < 20) return recoverLayout(boxes);
  const bandHeight = Math.min(400, Math.max(200, pageHeight / 3));
  const step = bandHeight / 2;
  const candidates = [];
  for (let start = 0; start < pageHeight; start += step) {
    const band = boxes.filter(box => box.y + box.height / 2 >= start && box.y + box.height / 2 < start + bandHeight);
    if (band.length < 15) continue;
    const intervals = band.map(box => [box.x, box.x + box.width]).sort((a, b) => a[0] - b[0]);
    let right = intervals[0][1];
    const gaps = [];
    for (const [left, end] of intervals.slice(1)) {
      if (left - right >= Math.max(90, pageWidth * 0.08)) gaps.push([right, left]);
      right = Math.max(right, end);
    }
    for (const [left, right] of gaps) {
      for (const region of [band.filter(box => box.x + box.width <= left), band.filter(box => box.x >= right)]) {
        if (region.length < 12) continue;
        const blocks = recoverLayout(region);
        const tables = blocks.filter(block => block.type === 'table' && block.rows.length >= 4
          && block.rows[0].length >= 3 && block.rows[0].length <= 12
          && block.rows.flat().filter(Boolean).length / (block.rows.length * block.rows[0].length) >= 0.65);
        if (!tables.length) continue;
        candidates.push({ region, blocks, score: tables.reduce((n, table) => n + table.rows.length * table.rows[0].length, 0) });
      }
    }
  }
  candidates.sort((a, b) => b.score - a.score || b.region.length - a.region.length);
  const used = new Set();
  const isolated = [];
  for (const candidate of candidates) {
    const overlap = candidate.region.filter(box => used.has(box)).length;
    if (overlap > candidate.region.length / 2) continue;
    candidate.region.forEach(box => used.add(box));
    isolated.push(candidate);
  }
  isolated.sort((a, b) => Math.min(...a.region.map(box => box.y)) - Math.min(...b.region.map(box => box.y)));
  return [...isolated.flatMap(candidate => candidate.blocks), recoverLayout(boxes.filter(box => !used.has(box)))];
}

// Keep identifiers (leading zeroes, >15 significant digits) and ambiguous
// values as text. No value from a PDF is ever treated as an Excel formula.
export function spreadsheetNumber(value, decimal = '.') {
  const text = String(value).trim();
  const thousands = decimal === ',' ? '.' : ',';
  const escaped = thousands === '.' ? '\\.' : ',';
  const mark = decimal === '.' ? '\\.' : ',';
  const pattern = new RegExp(`^[+-]?(?:0|[1-9]\\d*|[1-9]\\d{0,2}(?:${escaped}\\d{3})+)(?:${mark}\\d+)?$`);
  if (!pattern.test(text)) return null;
  const normalized = text.split(thousands).join('').replace(decimal, '.');
  if (normalized.replace(/[^0-9]/g, '').length > 15) return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

export function spreadsheetCurrency(value, decimal = '.') {
  const match = /^(-?)€\s*(.+)$/.exec(String(value).trim());
  if (!match) return null;
  const number = spreadsheetNumber(match[2], decimal);
  return number === null ? null : match[1] ? -number : number;
}
