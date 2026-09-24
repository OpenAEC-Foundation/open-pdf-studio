// De CMYK-omzetting van de PDF/X-export (#422), aan de kant van de webview.
//
// Het omzetten zelf gebeurt in Rust (crate open-pdf-cmyk, commando
// `pdfx_convert_to_cmyk`). Hier: de aanroep met rauwe bytes, het uitpakken
// van het antwoord, het verslag voor de gebruiker en de onthouden keuze.
//
// Geen imports uit de app: `invoke` en `t` komen van de aanroeper, zodat de
// unit-tests onder node draaien.

import { buildPdfxBytes } from './pdfx-enrich.js';

/** Soorten in het verslag, in de volgorde waarin ze gemeld worden. */
export const REPORT_KINDS = Object.freeze([
  'colourOperators',
  'colourSpaces',
  'images',
  'inlineImages',
  'shadings',
  'transparencyGroups',
  'contentStreams',
]);

/** Redenen die de Rust-kant kan geven voor "niet omgezet". */
export const SKIP_REASONS = Object.freeze([
  'malformed',
  'decodeFailed',
  'unsupportedFilter',
  'jpeg2000',
  'colourKeyMask',
  'bitsPerComponent',
  'tooLarge',
  'encodeFailed',
  'shadingType',
  'functionType',
  'separationRgbAlternate',
  'unreadable',
]);

/** Rendering intents; de eerste is de standaard. */
export const INTENTS = Object.freeze(['relative', 'perceptual']);

/**
 * Boven deze groeifactor, én meer dan GROWTH_MIN_BYTES erbij, meldt het
 * verslag dat het bestand veel groter werd. Het ondergrens voorkomt een
 * melding bij een klein bestand dat alleen groeit door het ingesloten profiel.
 */
export const GROWTH_WARNING = 2;
export const GROWTH_MIN_BYTES = 1e6;

/** Standaard: sRGB zonder omzetting (het gedrag van vóór #422). */
export const PDFX_STANDAARD = Object.freeze({ profilePath: null, profileName: '', intent: 'relative' });

/**
 * Opgeslagen keuze (`state.preferences.pdfxSettings`) terug naar een geldige set.
 * @param {unknown} opgeslagen
 */
export function herstelPdfxInstellingen(opgeslagen) {
  const o = opgeslagen && typeof opgeslagen === 'object' ? opgeslagen : {};
  const s = { ...PDFX_STANDAARD };
  if (typeof o.profilePath === 'string' && o.profilePath.trim()) {
    s.profilePath = o.profilePath;
    s.profileName = typeof o.profileName === 'string' ? o.profileName.slice(0, 200) : '';
  }
  if (INTENTS.includes(o.intent)) s.intent = o.intent;
  return s;
}

/**
 * Pakt het antwoord van `pdfx_convert_to_cmyk` uit:
 * `[u32 LE n][n bytes JSON {report, profileName}][u32 LE m][m bytes profiel][pdf]`.
 * Profiel en PDF zijn blikken op dezelfde buffer, geen kopieën.
 * @param {ArrayBuffer|Uint8Array} response
 */
export function unpackCmykResponse(response) {
  const bytes = response instanceof Uint8Array ? response : new Uint8Array(response);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const bad = () => new Error('invalid CMYK conversion response');
  if (bytes.byteLength < 8) throw bad();
  const metaLen = dv.getUint32(0, true);
  if (4 + metaLen + 4 > bytes.byteLength) throw bad();
  const meta = JSON.parse(new TextDecoder().decode(bytes.subarray(4, 4 + metaLen)));
  const profileLen = dv.getUint32(4 + metaLen, true);
  const profileAt = 8 + metaLen;
  if (profileAt + profileLen > bytes.byteLength) throw bad();
  return {
    report: meta.report || {},
    profileName: String(meta.profileName || ''),
    profile: bytes.subarray(profileAt, profileAt + profileLen),
    pdf: bytes.subarray(profileAt + profileLen),
  };
}

/**
 * Zet PDF-bytes om. De bytes gaan als rauwe body over de grens (geen
 * JSON-array van getallen, zie #463); pad en intent als koppen.
 * @param {(cmd: string, args?: any, options?: any) => Promise<any>} invoke
 * @param {Uint8Array} pdfBytes
 * @param {{profilePath: string, intent?: string}} keuze
 */
export async function convertToCmyk(invoke, pdfBytes, { profilePath, intent = 'relative' }) {
  const response = await invoke('pdfx_convert_to_cmyk', pdfBytes, {
    headers: {
      'x-profile-path': encodeURIComponent(profilePath),
      'x-rendering-intent': INTENTS.includes(intent) ? intent : INTENTS[0],
    },
  });
  return unpackCmykResponse(response);
}

/**
 * Van bronbytes naar PDF/X. Zonder `profilePath` (sRGB, geen omzetting)
 * komt er niets bij Rust: exact de export van vóór #422. Met een drukprofiel
 * eerst omzetten, dan dat profiel als output-intent.
 * @param {Uint8Array} bytes
 * @param {{conformance: string, title: string, profilePath: string|null, intent?: string}} keuze
 * @param {{invoke: Function, onPhase?: (phase: 'converting'|'writing') => void}} deps
 * @returns {Promise<{pdfBytes: Uint8Array, conversion: null | {report: object, profileName: string}}>}
 */
export async function buildPdfx(bytes, { conformance, title, profilePath, intent }, { invoke, onPhase = () => {} }) {
  if (!profilePath) {
    return { pdfBytes: await buildPdfxBytes(bytes, { conformance, title }), conversion: null };
  }
  onPhase('converting');
  const converted = await convertToCmyk(invoke, bytes, { profilePath, intent });
  onPhase('writing');
  const pdfBytes = await buildPdfxBytes(converted.pdf, {
    conformance,
    title,
    outputProfile: { bytes: converted.profile, name: converted.profileName },
  });
  return { pdfBytes, conversion: { report: converted.report, profileName: converted.profileName } };
}

/** CMYK-drukprofielen in de systeemmappen: `[{ path, name }]`. */
export async function listCmykProfiles(invoke) {
  return (await invoke('pdfx_list_cmyk_profiles')) || [];
}

/** Controleert een gekozen bestand; wijst af met een code (`notCmyk`, …). */
export async function inspectCmykProfile(invoke, path) {
  return invoke('pdfx_inspect_profile', { path });
}

const K = 'appMenu:pdfxCmyk.';

function reasonText(t, reason) {
  const key = `${K}skipReasons.${reason}`;
  const text = t(key);
  return text === key ? reason : text;
}

function size(bytes) {
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(bytes >= 1e8 ? 0 : 1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}

/**
 * Het verslag na de export, als tekst met regeleinden.
 * @param {(key: string, vars?: object) => string} t
 * @param {{report: object, profileName: string, sizeBefore: number, sizeAfter: number}} o
 */
export function formatCmykReport(t, { report, profileName, sizeBefore, sizeAfter }) {
  const lines = [t(`${K}reportTitle`, { profile: profileName })];
  let anyConverted = false;
  let anySkipped = false;
  for (const kind of REPORT_KINDS) {
    const tally = report?.[kind];
    if (!tally) continue;
    const skipped = Object.entries(tally.skipped || {});
    const skippedTotal = skipped.reduce((sum, [, n]) => sum + n, 0);
    if (!tally.converted && !skippedTotal) continue;
    anyConverted ||= tally.converted > 0;
    anySkipped ||= skippedTotal > 0;
    const name = t(`${K}kinds.${kind}`);
    if (skippedTotal) {
      const reasons = skipped.map(([r, n]) => `${reasonText(t, r)}: ${n}`).join(', ');
      lines.push(t(`${K}reportLineSkipped`, { kind: name, converted: tally.converted, skipped: skippedTotal, reasons }));
    } else {
      lines.push(t(`${K}reportLine`, { kind: name, converted: tally.converted }));
    }
  }
  if (!anyConverted && !anySkipped) lines.push(t(`${K}nothing`));
  if (anySkipped) lines.push(t(`${K}stillRgb`));
  if (sizeBefore > 0 && sizeAfter / sizeBefore > GROWTH_WARNING && sizeAfter - sizeBefore > GROWTH_MIN_BYTES) {
    lines.push(t(`${K}growth`, { before: size(sizeBefore), after: size(sizeAfter), factor: (sizeAfter / sizeBefore).toFixed(1) }));
  }
  return lines.join('\n');
}

/** Melding voor een gekozen bestand dat geen CMYK-drukprofiel is. */
export function profileErrorMessage(t, code, file) {
  return t(`${K}invalidProfile`, { file, reason: reasonOrCode(t, `${K}profileReasons.${code}`, code) });
}

/** Melding als de omzetting zelf mislukt (code van de Rust-kant). */
export function conversionErrorMessage(t, code) {
  const text = String(code || '');
  const reason = text.startsWith('profile:')
    ? reasonOrCode(t, `${K}profileReasons.${text.slice(8)}`, text)
    : reasonOrCode(t, `${K}failReasons.${text}`, text);
  return t(`${K}failed`, { reason });
}

function reasonOrCode(t, key, code) {
  const text = t(key);
  return text === key ? code : text;
}
