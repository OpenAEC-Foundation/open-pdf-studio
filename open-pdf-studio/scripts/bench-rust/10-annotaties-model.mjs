// Het model van een geladen set vastleggen, reproduceerbaar: dezelfde bytes
// geven dezelfde modellen, ook de id's en tijdstempels die de lader zelf
// maakt (createAnnotation: Date.now + Math.random, 'nu' als het bestand geen
// datum heeft). Voor de pariteit tussen twee laadroutes of twee versies van
// de lader: twee keer draaien en de uitvoer met `cmp` vergelijken.
//
// Run vanuit open-pdf-studio/:
//   node --max-old-space-size=8192 scripts/bench-rust/10-annotaties-model.mjs [bladen] [perBlad] uit.json

const ECHTE_DATE = globalThis.Date;
const ECHTE_RANDOM = Math.random;

/** `fn` draaien met een vaste klok en een vaste reeks toevalsgetallen. */
export async function deterministisch(fn) {
  let s = 12345;
  Math.random = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  const VAST = Date.UTC(2026, 0, 1, 12, 0, 0);
  class VasteDate extends ECHTE_DATE {
    constructor(...a) { if (a.length === 0) super(VAST); else super(...a); }
    static now() { return VAST; }
  }
  globalThis.Date = VasteDate;
  try { return await fn(); } finally { globalThis.Date = ECHTE_DATE; Math.random = ECHTE_RANDOM; }
}

/** Modellen naar vergelijkbare JSON (Set/Map/typed arrays als gewone waarden). */
export function modelJson(modellen) {
  return JSON.stringify(modellen, (_k, v) => {
    if (v instanceof Map) return { __map: [...v] };
    if (v instanceof Set) return { __set: [...v] };
    if (ArrayBuffer.isView(v)) return { __bytes: Array.from(v) };
    if (v === undefined) return { __undef: true };
    return v;
  });
}

// ── als script ──────────────────────────────────────────────────────────────
const [bladen = '100', perBlad = '500', uit] = process.argv.slice(2);
if (!uit) {
  console.error('gebruik: 10-annotaties-model.mjs [bladen] [perBlad] uit.json');
  process.exit(2);
}
const { writeFileSync } = await import('node:fs');
const hulp = await import('../../js/pdf/rondgang.testhulp.mjs');
const { maakSet } = await import('./annotaties-set.mjs');
const { bytes } = await maakSet(hulp, { bladen: Number(bladen), perBlad: Number(perBlad) });
const modellen = await deterministisch(() => hulp.laadAlles(bytes));
writeFileSync(uit, modelJson(modellen));
console.log(`${modellen.length} modellen -> ${uit}`);
