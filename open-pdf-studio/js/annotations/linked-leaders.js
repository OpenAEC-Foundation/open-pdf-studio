import { HANDLE_TYPES as H } from '../core/constants.js';
import { calloutPunt, draaiPunt } from './callout-draaien.js';

// Pick the textbox edge whose midpoint is closest to (kx, ky).
// Returns { x, y, side } where side is 'top'|'right'|'bottom'|'left'.
export function pickAnchorSide(box, kx, ky) {
  const bx = box.x, by = box.y;
  const bw = box.width || 150, bh = box.height || 50;
  const candidates = [
    { side: 'top',    x: bx + bw / 2, y: by },
    { side: 'right',  x: bx + bw,     y: by + bh / 2 },
    { side: 'bottom', x: bx + bw / 2, y: by + bh },
    { side: 'left',   x: bx,          y: by + bh / 2 },
  ];
  if (box.type === 'callout' && box.rotation) {
    for (const c of candidates) Object.assign(c, draaiPunt(c.x, c.y, bx + bw / 2, by + bh / 2, box.rotation));
  }
  let best = candidates[0];
  let bestD = Infinity;
  for (const c of candidates) {
    const d = (c.x - kx) * (c.x - kx) + (c.y - ky) * (c.y - ky);
    if (d < bestD) { bestD = d; best = c; }
  }
  return best;
}

const cornerOffsets = new Map([
  [H.TOP_LEFT, [0, 0]], [H.TOP_RIGHT, [1, 0]],
  [H.BOTTOM_LEFT, [0, 1]], [H.BOTTOM_RIGHT, [1, 1]],
]);

export function leaderNode(box, handle) {
  if (!handle) return null;
  if (box.type === 'callout') {
    const corner = cornerOffsets.get(handle);
    if (corner) {
      const w = box.width || 150, h = box.height || 50;
      return draaiPunt(box.x + corner[0] * w, box.y + corner[1] * h,
        box.x + w / 2, box.y + h / 2, box.rotation || 0);
    }
    if (handle === H.CALLOUT_ARROW) return calloutPunt(box);
    if (handle === H.CALLOUT_KNEE) return {
      x: box.kneeX ?? box.x - 30, y: box.kneeY ?? box.y + (box.height || 50) / 2,
    };
  }
  for (const l of box.leaders || []) {
    if (handle === H.LEADER_TIP + '_' + l.id) return { x: l.tipX, y: l.tipY };
    if (handle === H.LEADER_KNEE + '_' + l.id) return { x: l.kneeX, y: l.kneeY };
  }
  return null;
}

export function leaderAnchor(box, leader) {
  return leaderNode(box, leader.anchorNode) || pickAnchorSide(box, leader.kneeX, leader.kneeY);
}

export function newLinkedLeader(box, id, anchorNode) {
  const node = leaderNode(box, anchorNode);
  const x = node?.x ?? box.x + (box.width || 150);
  const y = node?.y ?? box.y + (box.height || 50) / 2;
  const direction = node && x < box.x + (box.width || 150) / 2 ? -1 : 1;
  const count = (box.leaders || []).filter(l => l.anchorNode === anchorNode).length;
  const offset = (node ? 35 : 0) + 20 * count;
  return { id, ...(node && { anchorNode }), kneeX: x + 35 * direction, kneeY: y + offset / 2,
    tipX: x + 80 * direction, tipY: y + offset, endStyle: 'arrow' };
}
