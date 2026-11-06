// Meldingstekst van de verliesloze monochroommodus (#902): het totaal en per
// beeld de grootte voor/na of de reden waarom het beeld gebleven is.
// Losgehouden van compress.js zodat de tekst zonder app-staat te testen is.

/** Hoeveel beelden de melding hooguit noemt; de rest wordt geteld. */
export const REPORT_MAX_IMAGES = 15;

/** De vertaalde reden voor een machineleesbare overslaancode. */
export function reasonText(t, reason) {
  return t(`compress.reason.${reason}`, { ns: 'dialogs', defaultValue: reason });
}

/**
 * @param {object} result  Uitkomst van optimizeMonochromeDocument().
 * @param {(key: string, opts?: object) => string} t  i18next-vertaler.
 * @param {(n: number) => string} formatBytes
 * @returns {string} Meerregelige melding.
 */
export function losslessReport(result, t, formatBytes) {
  const tt = (key, opts = {}) => t(key, { ns: 'dialogs', ...opts });
  const images = result.images || [];
  const lines = [];
  if (result.bytes) {
    const pct = Math.round(100 * (1 - result.newSize / result.origSize));
    lines.push(tt('compress.losslessDone', {
      before: formatBytes(result.origSize), after: formatBytes(result.newSize), pct,
      replaced: result.replaced, total: images.length,
    }));
  } else {
    lines.push(tt('compress.losslessNoGain', { reason: reasonText(t, result.reason) }));
  }
  for (const img of images.slice(0, REPORT_MAX_IMAGES)) {
    const base = { ref: img.ref.split(' ')[0], width: img.width ?? '?', height: img.height ?? '?' };
    lines.push(img.after != null
      ? tt('compress.losslessImage', { ...base, before: formatBytes(img.before), after: formatBytes(img.after) })
      : tt('compress.losslessImageKept', { ...base, reason: reasonText(t, img.reason) }));
  }
  if (images.length > REPORT_MAX_IMAGES) lines.push(tt('compress.losslessMore', { count: images.length - REPORT_MAX_IMAGES }));
  return lines.join('\n');
}
