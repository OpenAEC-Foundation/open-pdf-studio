// The bare minimum browser surface the app's modules touch while they are being
// imported. Nothing here does real work; it only stops module-scope listener
// registration and feature probes from throwing under node.

const noop = () => {};
function fakeCtx() {
  const c = {};
  for (const k of ['beginPath', 'closePath', 'moveTo', 'lineTo', 'arc', 'arcTo', 'bezierCurveTo',
    'quadraticCurveTo', 'rect', 'ellipse', 'stroke', 'fill', 'clip', 'save', 'restore',
    'translate', 'rotate', 'scale', 'transform', 'setTransform', 'resetTransform',
    'setLineDash', 'getLineDash', 'fillText', 'strokeText', 'drawImage', 'clearRect',
    'fillRect', 'strokeRect', 'putImageData', 'createPattern', 'createLinearGradient']) c[k] = noop;
  c.measureText = () => ({ width: 10, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 });
  c.getImageData = (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
  c.canvas = { width: 300, height: 150 };
  return c;
}
function fakeEl(tag = 'div') {
  const el = {
    tagName: String(tag).toUpperCase(), style: {}, dataset: {}, classList: { add: noop, remove: noop, contains: () => false, toggle: noop },
    children: [], childNodes: [], width: 300, height: 150,
    addEventListener: noop, removeEventListener: noop, appendChild: (c) => c, removeChild: noop,
    setAttribute: noop, getAttribute: () => null, remove: noop, focus: noop, blur: noop, click: noop,
    querySelector: () => null, querySelectorAll: () => [], closest: () => null, contains: () => false,
    getBoundingClientRect: () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }),
    getContext: () => fakeCtx(), toDataURL: () => 'data:,', insertBefore: (c) => c,
  };
  return el;
}

const doc = {
  createElement: (t) => fakeEl(t),
  createElementNS: (_ns, t) => fakeEl(t),
  createTextNode: () => fakeEl('#text'),
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener: noop, removeEventListener: noop,
  body: fakeEl('body'), documentElement: fakeEl('html'), head: fakeEl('head'),
  fonts: { check: () => true, ready: Promise.resolve(), add: noop },
  readyState: 'complete', activeElement: null,
};

const store = new Map();
const storage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k),
  clear: () => store.clear(), key: () => null, get length() { return store.size; },
};

globalThis.window = globalThis;
globalThis.document = doc;
try { if (!globalThis.navigator) globalThis.navigator = { userAgent: 'node', language: 'en', platform: 'win32', clipboard: {} }; } catch {}
globalThis.localStorage = storage;
globalThis.sessionStorage = storage;
globalThis.devicePixelRatio = 1;
globalThis.addEventListener = noop;
globalThis.removeEventListener = noop;
globalThis.matchMedia = () => ({ matches: false, addEventListener: noop, removeEventListener: noop, addListener: noop, removeListener: noop });
globalThis.requestAnimationFrame = (fn) => setTimeout(() => fn(Date.now()), 0);
globalThis.cancelAnimationFrame = clearTimeout;
globalThis.requestIdleCallback = (fn) => setTimeout(() => fn({ timeRemaining: () => 0, didTimeout: true }), 0);
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
globalThis.MutationObserver = class { observe() {} disconnect() {} takeRecords() { return []; } };
globalThis.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
globalThis.DOMMatrix = class { constructor() { this.a = 1; this.b = 0; this.c = 0; this.d = 1; this.e = 0; this.f = 0; } };
globalThis.Path2D = class { addPath() {} };
globalThis.OffscreenCanvas = class { constructor(w, h) { this.width = w; this.height = h; } getContext() { return fakeCtx(); } };
globalThis.Image = class { set src(_v) {} addEventListener() {} };
globalThis.CSS = { supports: () => false };
globalThis.getComputedStyle = () => ({ getPropertyValue: () => '' });
globalThis.__pdfViewport = null;
