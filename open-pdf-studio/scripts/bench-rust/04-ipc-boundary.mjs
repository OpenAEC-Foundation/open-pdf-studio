// What a trip across the JS<->Rust boundary costs, measured with the exact
// serialiser Tauri uses.
//
// Tauri 2.10's injected `processIpcMessage` (tauri-2.10.x/scripts/
// process-ipc-message-fn.js) is reproduced verbatim below. The rule that
// matters: a top-level ArrayBuffer / typed array / Array is handed over as
// application/octet-stream, everything else goes through JSON.stringify with a
// replacer that turns a *nested* Uint8Array into `Array.from(val)` — one JSON
// integer per byte.
//
// Coming back, `tauri::ipc::Response::new(Vec<u8>)` arrives as an ArrayBuffer,
// while a plain `Result<Vec<u8>, String>` arrives as a JSON array of numbers.
// Both shapes exist in this app, so both are measured.
//
// Run: node scripts/bench-rust/04-ipc-boundary.mjs

import { bench, report, rng } from './lib.mjs';

// --- verbatim copy of tauri-2.10.3/scripts/process-ipc-message-fn.js --------
function processIpcMessage(message) {
  if (message instanceof ArrayBuffer || ArrayBuffer.isView(message) || Array.isArray(message)) {
    return { contentType: 'application/octet-stream', data: message };
  }
  const data = JSON.stringify(message, (_k, val) => {
    const SERIALIZE_TO_IPC_FN = '__TAURI_TO_IPC_KEY__';
    if (val instanceof Map) return Object.fromEntries(val.entries());
    if (val instanceof Uint8Array) return Array.from(val);
    if (val instanceof ArrayBuffer) return Array.from(new Uint8Array(val));
    if (typeof val === 'object' && val !== null && SERIALIZE_TO_IPC_FN in val) return val[SERIALIZE_TO_IPC_FN]();
    return val;
  });
  return { contentType: 'application/json', data };
}
// ---------------------------------------------------------------------------

const rows = [];
const r = rng(11);

function randomBytes(n) {
  const a = new Uint8Array(n);
  for (let i = 0; i < n; i++) a[i] = (r() * 256) | 0;
  return a;
}

console.log('payload sizes after serialisation');
for (const mb of [1, 8]) {
  const n = mb * 1024 * 1024;
  const bytes = randomBytes(n);
  const asJson = processIpcMessage({ data: bytes, name: 'job' });
  const asRaw = processIpcMessage(bytes);
  console.log(`  ${mb} MB Uint8Array nested in an object -> ${(asJson.data.length / 1024 / 1024).toFixed(1)} MB of JSON text (${asJson.contentType})`);
  console.log(`  ${mb} MB Uint8Array passed at top level -> ${(asRaw.data.byteLength / 1024 / 1024).toFixed(1)} MB raw (${asRaw.contentType})`);
}
console.log('');

// -------------------------------------------- JS -> Rust: bytes in an object
for (const mb of [1, 8]) {
  const bytes = randomBytes(mb * 1024 * 1024);
  rows.push(bench(`JS->Rust ${mb} MB as { data: Uint8Array } (JSON)`, () => {
    processIpcMessage({ data: bytes, name: 'job' });
  }, { iters: 1, warm: 1, repeat: 3 }));

  // What print-job.js actually does today: Array.from() first, then the same
  // JSON path. The conversion is an extra full pass over the buffer.
  rows.push(bench(`JS->Rust ${mb} MB as { data: Array.from(bytes) }`, () => {
    processIpcMessage({ data: Array.from(bytes), name: 'job' });
  }, { iters: 1, warm: 1, repeat: 3 }));

  rows.push(bench(`JS->Rust ${mb} MB as a top-level Uint8Array (raw)`, () => {
    processIpcMessage(bytes);
  }, { iters: 20, warm: 2, repeat: 5 }));
}

// -------------------------------------------- Rust -> JS: the two return shapes
for (const mb of [1, 8]) {
  const bytes = randomBytes(mb * 1024 * 1024);
  // `Result<Vec<u8>, String>`: serde_json emits "[12,240,3,...]" and the
  // webview parses it into a JS Array of numbers.
  const jsonArray = JSON.stringify(Array.from(bytes));
  rows.push(bench(`Rust->JS ${mb} MB as Vec<u8> (JSON.parse of ${(jsonArray.length / 1024 / 1024).toFixed(1)} MB text)`, () => {
    const arr = JSON.parse(jsonArray);
    return new Uint8Array(arr); // the `new Uint8Array(cmdData)` the call sites do
  }, { iters: 1, warm: 1, repeat: 3 }));

  // `tauri::ipc::Response::new(Vec<u8>)`: arrives as an ArrayBuffer, and the
  // render path only reads a header and wraps the rest.
  const ab = bytes.buffer.slice(0);
  rows.push(bench(`Rust->JS ${mb} MB as ipc::Response (ArrayBuffer view)`, () => {
    const u8 = new Uint8Array(ab);
    const header = new DataView(u8.buffer, u8.byteOffset, 8);
    header.getUint32(0, true); header.getUint32(4, true);
    return new Uint8ClampedArray(u8.buffer, u8.byteOffset + 8, u8.length - 8);
  }, { iters: 200, warm: 5, repeat: 5 }));
}

// -------------------------------- a structured payload: annotations both ways
function fakeAnnotations(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const pts = [];
    for (let k = 0; k < 24; k++) pts.push({ x: r() * 2000, y: r() * 1400 });
    out.push({
      id: `a${i}`, type: 'filledArea', page: 1 + (i % 12),
      x: r() * 2000, y: r() * 1400, width: r() * 400, height: r() * 300,
      rotation: r() * 360, color: '#123456', fillColor: '#abcdef',
      lineWidth: 1.5, borderStyle: 'solid', opacity: 1,
      points: pts, subject: `item ${i}`, contents: `remark ${i}`,
    });
  }
  return out;
}
for (const n of [500, 5000]) {
  const anns = fakeAnnotations(n);
  const wire = processIpcMessage({ annotations: anns }).data;
  console.log(`  ${n} annotations (24 points each) -> ${(wire.length / 1024 / 1024).toFixed(2)} MB of JSON`);
  rows.push(bench(`JS->Rust ${n} annotations (JSON.stringify)`, () => {
    processIpcMessage({ annotations: anns });
  }, { iters: n > 1000 ? 5 : 20, warm: 1, repeat: 3 }));
  rows.push(bench(`Rust->JS ${n} annotations (JSON.parse)`, () => {
    JSON.parse(wire);
  }, { iters: n > 1000 ? 5 : 20, warm: 1, repeat: 3 }));
}

// ------------------------------------------- a bare call with a tiny payload
rows.push(bench('serialise a tiny arg object { path, pageIndex, scale }', () => {
  processIpcMessage({ path: 'C:/x/y.pdf', pageIndex: 3, scale: 1.5, rotation: 0 });
}, { iters: 100000 }));

report(rows);
