// Tijdelijk draaipunt in de editorsessie. Geen annotatieveld: opslaan,
// kopiëren en PDF/XFDF-export krijgen nooit UI-coördinaten mee.
const anchors = new WeakMap();
export const ANCHOR_HANDLE = 'transform_anchor';
const TYPES = new Set(['image', 'stamp', 'signature', 'box', 'mask', 'circle',
  'highlight', 'polygon', 'cloud']);
const RESIZE = new Set(['tl', 'tr', 'bl', 'br', 't', 'b', 'l', 'r']);

function frame(a) {
  if (!a || !TYPES.has(a.type)) return null;
  const { x, y, width, height } = a;
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
  return { x, y, width, height, rotation: a.rotation || 0,
    crop: [a.cropLeft || 0, a.cropTop || 0, a.cropRight || 0, a.cropBottom || 0].join(',') };
}

function vector(x, y, degrees) {
  const r = degrees * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
  return { x: x * c - y * s, y: x * s + y * c };
}

function world(f, uv) {
  const d = vector((uv.u - 0.5) * f.width, (uv.v - 0.5) * f.height, f.rotation);
  return { x: f.x + f.width / 2 + d.x, y: f.y + f.height / 2 + d.y };
}

function local(f, p) {
  const d = vector(p.x - f.x - f.width / 2, p.y - f.y - f.height / 2, -f.rotation);
  return { u: 0.5 + d.x / f.width, v: 0.5 + d.y / f.height };
}

function entry(a) {
  const f = frame(a), stored = anchors.get(a);
  if (!f || !stored) return null;
  // Bijsnijden verplaatst de pixels niet. Houd het oude paginapunt vast,
  // ook als het nieuwe venster het draaipunt buiten het zichtbare vak legt.
  if (stored.frame.crop !== f.crop) Object.assign(stored, local(f, world(stored.frame, stored)));
  stored.frame = f;
  return stored;
}

export function getTransformAnchor(a, geometry = a) {
  const f = frame(geometry);
  if (!f) return null;
  const stored = entry(a);
  return { ...world(f, stored || { u: 0.5, v: 0.5 }), custom: !!stored };
}

export function setTransformAnchor(a, point) {
  const f = frame(a);
  if (!f || a.locked || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
  anchors.set(a, { ...local(f, point), frame: f });
}

export function resetTransformAnchor(a) { anchors.delete(a); }

export function snapshotTransformAnchor(a) {
  const value = entry(a);
  return value ? { ...value, frame: { ...value.frame } } : null;
}

export function restoreTransformAnchor(a, value) {
  if (value) anchors.set(a, { ...value, frame: { ...value.frame } });
  else anchors.delete(a);
}

// Vervang de verplaatsgreep in het midden; het lijf blijft versleepbaar.
// De nieuwe greep staat in paginaruimte, dus pas NA de handle-rotatie.
export function addTransformAnchorHandle(handles, a, scale, handleSize) {
  const p = getTransformAnchor(a);
  if (!p || a.locked || !handles.some(h => h.type === 'rotate')) return;
  for (let i = handles.length - 1; i >= 0; i--) {
    if (handles[i].type === 'rect_center' || handles[i].type === 'circle_center') handles.splice(i, 1);
  }
  const size = handleSize / scale;
  handles.unshift({ type: ANCHOR_HANDLE, x: p.x - size / 2, y: p.y - size / 2 });
}

// Reken de muis-delta om naar de bestaande opposite-corner resize. Daarna
// wordt het resultaat als geheel verschoven zodat het draaipunt vastblijft.
// Zo blijven bestaande minimumafmetingen, verhouding en vormgeometrie gelden.
export function resizeAboutTransformAnchor(a, original, handle, dx, dy, shift, ctrl, options, resize, move) {
  const p = getTransformAnchor(a, original), f = frame(original);
  if (!p?.custom || !RESIZE.has(handle) || a.locked) return false;
  const uv = entry(a);
  const d = vector(dx, dy, -f.rotation);
  const sx = handle.includes('l') ? -1 : handle.includes('r') ? 1 : 0;
  const sy = handle.includes('t') ? -1 : handle.includes('b') ? 1 : 0;
  const spanX = ((sx + 1) / 2 - uv.u) * f.width;
  const spanY = ((sy + 1) / 2 - uv.v) * f.height;
  // Een greep precies op het draaipunt kan langs die as geen schaal bepalen.
  const dw = sx && Math.abs(spanX) > 1e-9 ? d.x / spanX * f.width : 0;
  const dh = sy && Math.abs(spanY) > 1e-9 ? d.y / spanY * f.height : 0;
  const delta = vector(sx * dw, sy * dh, f.rotation);
  resize(a, handle, delta.x, delta.y, original, shift, ctrl, options);
  const after = world(frame(a), uv);
  move(a, p.x - after.x, p.y - after.y);
  return true;
}

export function rotateAboutTransformAnchor(a, original, start, point, snapStep, rotate) {
  const p = getTransformAnchor(a, original);
  if (!p?.custom || a.locked) return false;
  if (Math.hypot(start.x - p.x, start.y - p.y) < 1e-9 ||
      Math.hypot(point.x - p.x, point.y - p.y) < 1e-9) return true;
  const delta = (Math.atan2(point.y - p.y, point.x - p.x) -
    Math.atan2(start.y - p.y, start.x - p.x)) * 180 / Math.PI;
  let angle = (original.rotation || 0) + delta;
  if (snapStep > 0) angle = Math.round(angle / snapStep) * snapStep;
  rotate(a, original, p.x, p.y, angle - (original.rotation || 0));
  return true;
}
