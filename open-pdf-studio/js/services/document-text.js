// Documenttekst voor de AI-assistent.
//
// Hergebruikt de bestaande Tauri-command `extract_page_text` (path + pageIndex,
// 0-based), precies zoals js/solid/stores/quantitiesStore.js (loadBuiltInText)
// en js/text/text-layer.js (createTextLayerFromRust) dat doen: het resultaat is
// een JSON-string met tekst-spans { text, fontSize, x, y, width }.

import { invoke, isTauri } from '../core/platform.js';
import { getActiveDocument } from '../core/state.js';

/**
 * Harde bovengrens op wat we naar de AI-server sturen. LANGE DOCUMENTEN WORDEN
 * AFGEKAPT: we lezen pagina voor pagina vanaf pagina 1 en stoppen zodra deze
 * limiet bereikt is — de rest van het document gaat NIET mee. Een samenvatting
 * van een dik bestek beschrijft dus alleen het begin ervan.
 */
export const MAX_DOC_CHARS = 40000;

const TRUNCATION_NOTE = '\n\n[…] Document afgekapt — alleen het eerste deel is meegestuurd.';

/** Spans van één pagina → leesbare tekst (regeleinde bij een nieuwe regel). */
function spansToText(spans) {
  let out = '';
  let prevY = null;
  for (const s of spans || []) {
    const raw = String(s?.text ?? '');
    if (!raw.trim()) continue;
    const y = Number(s?.y);
    const lineGap = Math.max(1, Number(s?.fontSize) || 8) * 0.5;
    if (prevY !== null && Number.isFinite(y) && Math.abs(y - prevY) > lineGap) out += '\n';
    else if (out) out += ' ';
    out += raw.trim();
    if (Number.isFinite(y)) prevY = y;
  }
  return out;
}

/**
 * Verzamelt de tekst van het actieve document, pagina voor pagina, tot
 * `maxChars`. Geeft '' terug als er niets te lezen valt (geen document, geen
 * bestandspad, of een pure scan zonder tekstlaag).
 *
 * @param {object} [opts]
 * @param {number} [opts.maxChars=MAX_DOC_CHARS]
 * @returns {Promise<string>}
 */
export async function collectActiveDocumentText({ maxChars = MAX_DOC_CHARS } = {}) {
  const doc = getActiveDocument();
  if (!doc?.filePath || !isTauri()) return '';
  const pageCount = doc.pdfDoc?.numPages || 1;

  const parts = [];
  let total = 0;
  let truncated = false;

  for (let page = 1; page <= pageCount; page++) {
    let spans;
    try {
      const json = await invoke('extract_page_text', { path: doc.filePath, pageIndex: page - 1 });
      spans = typeof json === 'string' ? JSON.parse(json) : json;
    } catch (e) {
      console.warn(`[ai] extract_page_text faalde op pagina ${page}`, e);
      continue;
    }
    const text = spansToText(spans);
    if (!text) continue;

    const header = pageCount > 1 ? `--- Pagina ${page} ---\n` : '';
    let chunk = header + text;
    if (total + chunk.length > maxChars) {
      chunk = chunk.slice(0, Math.max(0, maxChars - total));
      truncated = true;
    }
    if (chunk) { parts.push(chunk); total += chunk.length; }
    if (truncated || total >= maxChars) { truncated = true; break; }
  }

  const out = parts.join('\n\n').trim();
  if (!out) return '';
  return truncated ? out + TRUNCATION_NOTE : out;
}

const DUTCH_MARKERS = /\b(de|het|een|van|en|niet|met|voor|zijn|wordt|worden|tekening|bestek|gebouw|verdieping|afmeting)\b/gi;
const ENGLISH_MARKERS = /\b(the|and|of|with|for|are|is|not|drawing|building|floor|section|detail|scale)\b/gi;

/**
 * Doeltaal voor de 'Vertaal'-skill: Nederlandse tekst → Engels, anders →
 * Nederlands (exact wat de skill-omschrijving belooft). De server vereist een
 * `language` bij action 'translate', dus die keuze moet hier vallen.
 */
export function guessTranslationTarget(text) {
  const sample = String(text || '').slice(0, 4000);
  const nl = (sample.match(DUTCH_MARKERS) || []).length;
  const en = (sample.match(ENGLISH_MARKERS) || []).length;
  return nl >= en ? 'Engels' : 'Nederlands';
}
