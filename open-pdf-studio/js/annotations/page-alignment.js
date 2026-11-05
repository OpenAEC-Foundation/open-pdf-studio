import { rectNaarWeergave, vectorNaarPagina, weergaveMaat } from '../pdf/weergave-rotatie.js';

// Bounds and page dimensions are in annotation page units (not physical points).
export function pageAlignmentMoves(entries, width, height, rotation, edge, individually = false) {
  if (!(width > 0 && height > 0) || !Number.isFinite(width + height)) return [];
  const items = entries.filter(e => e.bounds && ['x', 'y', 'width', 'height'].every(k => Number.isFinite(e.bounds[k])));
  const size = weergaveMaat(width, height, rotation);
  const groups = individually ? items.map(e => [e]) : [items];
  const moves = [];
  for (const group of groups) {
    if (!group.length) continue;
    const boxes = group.map(e => rectNaarWeergave(e.bounds, width, height, rotation));
    const left = Math.min(...boxes.map(b => b.x)), top = Math.min(...boxes.map(b => b.y));
    const right = Math.max(...boxes.map(b => b.x + b.width)), bottom = Math.max(...boxes.map(b => b.y + b.height));
    let dx = 0, dy = 0;
    switch (edge) {
      case 'left': dx = -left; break;
      case 'center': dx = size.breedte / 2 - (left + right) / 2; break;
      case 'right': dx = size.breedte - right; break;
      case 'top': dy = -top; break;
      case 'middle': dy = size.hoogte / 2 - (top + bottom) / 2; break;
      case 'bottom': dy = size.hoogte - bottom; break;
      default: return [];
    }
    const delta = vectorNaarPagina(dx, dy, rotation);
    if (Math.abs(delta.x) < 1e-9 && Math.abs(delta.y) < 1e-9) continue;
    for (const entry of group) moves.push({ ann: entry.ann, dx: delta.x, dy: delta.y });
  }
  return moves;
}
