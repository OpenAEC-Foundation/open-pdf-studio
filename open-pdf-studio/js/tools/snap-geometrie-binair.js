// Snap-geometrie uit de PDFium-worker (pdfium-worker/src/snap_geometry.rs)
// terug naar de punten en randen die de snap-engine gebruikt.
//
// De worker levert de geometrie al ontdubbeld en in annotatieruimte, als
// compacte reeks getallen ('OSG1'):
//   0  "OSG1"
//   4  u32 aantal punten (P)
//   8  u32 aantal randen (E)
//   12 u32 vlaggen (bit 0: ruimtelijke index volgt)
//   16 P x (f32 x, f32 y), dan E x (f32 x1, y1, x2, y2),
//      dan P x u8 soort (0 = eindpunt, 1 = midden), aangevuld tot 4 bytes
//   met vlag 0 daarna de ruimtelijke index (zelfde cellen als
//   buildSpatialIndex in pdf-snap-extractor.js):
//      u32 Cp, u32 Ce, u32 O, u32 Re
//      Cp x (i32 cx, i32 cy, u32 begin, u32 aantal), P x u32 puntindex
//      Ce x (i32 cx, i32 cy, u32 begin, u32 aantal), Re x u32 randindex
//      O x u32 randindex (randen die te veel cellen beslaan)
//   De vakjes van de index zijn Uint32Array-blikken op het antwoord, geen
//   kopieen: de snap-engine leest alleen .length en [k].
//
// Puur en zonder app-imports, zodat het onder node te testen is.

const MAGIC = [0x4f, 0x53, 0x47, 0x31]; // "OSG1"
const KOP = 16;
const VLAG_INDEX = 1;

/** Bytes uit een invoke-antwoord: ArrayBuffer, typed array of getallenlijst. */
function alsBytes(data) {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (Array.isArray(data)) return Uint8Array.from(data);
  throw new TypeError('snap-geometrie: onbekend antwoordtype');
}

/**
 * @param {ArrayBuffer|Uint8Array|number[]} data
 * @returns {{ points: {x:number,y:number,type:string,annotation:null}[], edges: {x1:number,y1:number,x2:number,y2:number}[], index?: object }}
 */
export function decodeerSnapGeometrie(data) {
  let bytes = alsBytes(data);
  if (bytes.length < KOP || MAGIC.some((b, i) => bytes[i] !== b)) {
    throw new Error('snap-geometrie: geen OSG1-gegevens');
  }
  // Float32Array vraagt een veelvoud van 4 als begin; een antwoord met een
  // scheve byteOffset eerst kopiëren.
  if (bytes.byteOffset % 4 !== 0) bytes = bytes.slice();
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const P = dv.getUint32(4, true);
  const E = dv.getUint32(8, true);
  const vlaggen = dv.getUint32(12, true);
  const nodig = KOP + P * 8 + E * 16 + ((P + 3) & ~3);
  if (bytes.byteLength < nodig) throw new Error('snap-geometrie: afgekapt');

  // Little-endian op elk platform waar de app draait; DataView zou per
  // getal duurder zijn dan één Float32Array-blik.
  const f = new Float32Array(bytes.buffer, bytes.byteOffset + KOP, P * 2 + E * 4);
  const soorten = bytes.subarray(KOP + P * 8 + E * 16, KOP + P * 8 + E * 16 + P);

  const points = new Array(P);
  for (let i = 0; i < P; i++) {
    points[i] = { x: f[2 * i], y: f[2 * i + 1], type: soorten[i] ? 'midpoint' : 'endpoint', annotation: null };
  }
  const edges = new Array(E);
  const r = P * 2;
  for (let i = 0; i < E; i++) {
    const o = r + 4 * i;
    edges[i] = { x1: f[o], y1: f[o + 1], x2: f[o + 2], y2: f[o + 3] };
  }
  const resultaat = { points, edges };
  if (vlaggen & VLAG_INDEX) resultaat.index = leesIndex(bytes, nodig, P);
  return resultaat;
}

function leesIndex(bytes, begin, P) {
  const u32 = (woorden, at) => new Uint32Array(bytes.buffer, bytes.byteOffset + at, woorden);
  if (bytes.byteLength < begin + 16) throw new Error('snap-geometrie: index afgekapt');
  const [Cp, Ce, O, Re] = u32(4, begin);
  const lengte = 16 + Cp * 16 + P * 4 + Ce * 16 + Re * 4 + O * 4;
  if (bytes.byteLength < begin + lengte) throw new Error('snap-geometrie: index afgekapt');
  let at = begin + 16;
  const grid = (cellen, refs) => {
    const c = new Int32Array(bytes.buffer, bytes.byteOffset + at, cellen * 4);
    at += cellen * 16;
    const r = u32(refs, at);
    at += refs * 4;
    const map = new Map();
    for (let k = 0; k < cellen; k++) {
      const start = c[4 * k + 2] >>> 0;
      map.set(c[4 * k] + ',' + c[4 * k + 1], r.subarray(start, start + (c[4 * k + 3] >>> 0)));
    }
    return map;
  };
  const pointGrid = grid(Cp, P);
  const edgeGrid = grid(Ce, Re);
  const edgeOversized = Array.from(u32(O, at));
  return { pointGrid, edgeGrid, edgeOversized };
}

/**
 * Codering in JavaScript (zelfde formaat als de worker), voor tests en de
 * vergelijkingsscripts. `index` (optioneel): een index zoals
 * buildSpatialIndex hem maakt.
 */
export function codeerSnapGeometrie({ points, edges }, index = null) {
  const P = points.length;
  const E = edges.length;
  const basis = KOP + P * 8 + E * 16 + ((P + 3) & ~3);
  const cellen = (grid) => [...grid.entries()];
  const pc = index ? cellen(index.pointGrid) : [];
  const ec = index ? cellen(index.edgeGrid) : [];
  const Re = ec.reduce((n, [, v]) => n + v.length, 0);
  const O = index ? index.edgeOversized.length : 0;
  const extra = index ? 16 + pc.length * 16 + P * 4 + ec.length * 16 + Re * 4 + O * 4 : 0;
  const buf = new ArrayBuffer(basis + extra);
  const u8 = new Uint8Array(buf);
  u8.set(MAGIC, 0);
  const dv = new DataView(buf);
  dv.setUint32(4, P, true);
  dv.setUint32(8, E, true);
  dv.setUint32(12, index ? VLAG_INDEX : 0, true);
  const f = new Float32Array(buf, KOP, P * 2 + E * 4);
  points.forEach((p, i) => { f[2 * i] = p.x; f[2 * i + 1] = p.y; u8[KOP + P * 8 + E * 16 + i] = p.type === 'midpoint' ? 1 : 0; });
  edges.forEach((e, i) => { const o = P * 2 + 4 * i; f[o] = e.x1; f[o + 1] = e.y1; f[o + 2] = e.x2; f[o + 3] = e.y2; });
  if (index) {
    let at = basis;
    const zet = (v) => { dv.setUint32(at, v >>> 0, true); at += 4; };
    [pc.length, ec.length, O, Re].forEach(zet);
    for (const lijst of [pc, ec]) {
      let begin = 0;
      for (const [k, v] of lijst) {
        const [cx, cy] = k.split(',').map(Number);
        [cx, cy, begin, v.length].forEach(zet);
        begin += v.length;
      }
      for (const [, v] of lijst) for (const i of v) zet(i);
    }
    index.edgeOversized.forEach(zet);
  }
  return buf;
}
