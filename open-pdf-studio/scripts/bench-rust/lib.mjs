// Shared timing helpers for the JS-vs-Rust measurement scripts.
// Deliberately tiny: no dependencies, no warm-up magic beyond a fixed number
// of discarded iterations, and a median over repeats so one GC pause does not
// decide the answer.

export function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Run `fn` `iters` times and report ms for the whole batch.
 * `warm` batches are run first and discarded, then `repeat` batches are timed
 * and the median batch is reported.
 */
export function bench(name, fn, { iters = 1, warm = 2, repeat = 5 } = {}) {
  for (let w = 0; w < warm; w++) for (let i = 0; i < iters; i++) fn(i);
  const runs = [];
  for (let r = 0; r < repeat; r++) {
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < iters; i++) fn(i);
    const t1 = process.hrtime.bigint();
    runs.push(Number(t1 - t0) / 1e6);
  }
  const ms = median(runs);
  return { name, iters, ms, perIterUs: (ms * 1000) / iters, runs };
}

export async function benchAsync(name, fn, { iters = 1, warm = 1, repeat = 3 } = {}) {
  for (let w = 0; w < warm; w++) for (let i = 0; i < iters; i++) await fn(i);
  const runs = [];
  for (let r = 0; r < repeat; r++) {
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < iters; i++) await fn(i);
    const t1 = process.hrtime.bigint();
    runs.push(Number(t1 - t0) / 1e6);
  }
  const ms = median(runs);
  return { name, iters, ms, perIterUs: (ms * 1000) / iters, runs };
}

export function report(rows) {
  const w = Math.max(...rows.map((r) => r.name.length), 8);
  console.log('');
  console.log(`${'case'.padEnd(w)} | ${'iters'.padStart(8)} | ${'batch ms'.padStart(10)} | ${'per call'.padStart(12)}`);
  console.log(`${'-'.repeat(w)}-+-${'-'.repeat(8)}-+-${'-'.repeat(10)}-+-${'-'.repeat(12)}`);
  for (const r of rows) {
    const per = r.perIterUs >= 1000
      ? `${(r.perIterUs / 1000).toFixed(2)} ms`
      : `${r.perIterUs.toFixed(2)} us`;
    console.log(`${r.name.padEnd(w)} | ${String(r.iters).padStart(8)} | ${r.ms.toFixed(2).padStart(10)} | ${per.padStart(12)}`);
  }
  console.log('');
}

/** Deterministic pseudo-random generator so runs are comparable. */
export function rng(seed = 42) {
  let s = seed >>> 0;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

/** A recording stand-in for a CanvasRenderingContext2D path builder. */
export function pathRecorder() {
  let ops = 0;
  const noop = () => { ops++; };
  return {
    get ops() { return ops; },
    reset() { ops = 0; },
    beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop,
    arc: noop, arcTo: noop, bezierCurveTo: noop, quadraticCurveTo: noop,
    rect: noop, ellipse: noop, stroke: noop, fill: noop,
    save: noop, restore: noop, translate: noop, rotate: noop, scale: noop,
    setLineDash: noop, measureText: () => { ops++; return { width: 10 }; },
    fillText: noop, strokeText: noop,
  };
}

export function env() {
  console.log(`node ${process.version} | ${process.platform} ${process.arch}`);
  console.log(`cpu  ${require0('os').cpus()[0]?.model ?? 'unknown'}`);
}

function require0(m) {
  // eslint-disable-next-line no-undef
  return globalThis.process.getBuiltinModule(m);
}
