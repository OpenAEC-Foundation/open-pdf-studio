import { draaiPunt, zetCalloutLeider } from './callout-draaien.js';

// The vertex index is local to the cloud. /IRT resolves its annotation ID
// again after a save, paste or reload.
function vertices(cloud) {
  if (cloud.type === 'cloudPolyline') return cloud.points || [];
  if (cloud.type !== 'cloud') return [];
  const { x, y, width, height } = cloud;
  return [[0, 0], [1, 0], [1, 1], [0, 1]].map(([u, v]) =>
    draaiPunt(x + width * (cloud.flipX ? 1 - u : u), y + height * (cloud.flipY ? 1 - v : v),
      x + width / 2, y + height / 2, cloud.rotation || 0));
}

export function closestCloudVertex(cloud, x, y) {
  let best = null;
  let distance = Infinity;
  vertices(cloud).forEach((point, index) => {
    const d = Math.hypot(point.x - x, point.y - y);
    if (d < distance) { best = { ...point, index }; distance = d; }
  });
  return best;
}

export function syncCloudNote(note, annotations) {
  if (note.type !== 'callout' || !Number.isInteger(note.cloudVertex) || note.inReplyTo == null) return;
  const cloud = annotations.find(a => a.id === note.inReplyTo && a.page === note.page);
  if (!cloud) return;
  const point = vertices(cloud)[note.cloudVertex];
  if (!point || (note.arrowX === point.x && note.arrowY === point.y)) return;
  note.arrowX = point.x;
  note.arrowY = point.y;
  zetCalloutLeider(note);
}
