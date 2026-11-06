// Een link van de app (#953) volgen: een webadres in de standaardbrowser
// (core/extern-openen.js), een pagina binnen het document (dezelfde weg als
// een link uit het bestand, pdf/link-layer.js), een bestand alleen op het
// bureaublad en pas na een waarschuwing: een PDF is onvertrouwde invoer.

import i18next from '../../i18n/config.js';
import { isSafeLinkUrl } from '../../pdf/link-destination.js';
import { isTauri } from '../../core/platform.js';
import { slaOverInHeadless } from '../../core/headless.js';
import { getActiveDocument } from '../../core/state.js';

const t = (sleutel, opties) => i18next.t(sleutel, { ns: 'dialogs', ...opties });

/** Een relatief pad naast het geopende document; een absoluut pad blijft. */
export function bestandNaastDocument(pad, documentPad) {
  const p = String(pad || '');
  if (!p || /^([a-z]:[\\/]|[\\/]{1,2}|[a-z][a-z0-9+.-]*:\/\/)/i.test(p)) return p;
  const doc = String(documentPad || '');
  const i = Math.max(doc.lastIndexOf('/'), doc.lastIndexOf('\\'));
  if (i < 0) return p;
  return doc.slice(0, i + 1) + p.replace(/^\.[\\/]/, '');
}

async function openBestand(pad) {
  const { showMessage } = await import('../../solid/stores/dialogStore.js');
  if (!isTauri() || !window.__TAURI__?.shell?.open) {
    showMessage(t('link.fileDesktopOnly'), t('link.title'));
    return false;
  }
  const volledig = bestandNaastDocument(pad, getActiveDocument()?.filePath);
  const { showConfirm } = await import('../../ui/chrome/confirm-dialog.js');
  const ja = await showConfirm({
    title: t('link.openFileTitle'),
    message: t('link.openFileMessage', { file: volledig }),
  });
  if (!ja) return false;
  if (slaOverInHeadless(`open link file ${volledig}`)) return false;
  try {
    await window.__TAURI__.shell.open(volledig);
    return true;
  } catch (e) {
    console.warn('[link] bestand openen mislukt:', e);
    showMessage(t('link.openFileFailed', { file: volledig }), t('link.title'));
    return false;
  }
}

/**
 * Volg de link. Geeft true als er iets geopend of aangesprongen is.
 * @param {object} ann  een annotatie van de soort 'link'
 */
export async function volgLink(ann) {
  const doel = ann?.linkTarget;
  if (!doel) return false;
  if (doel.kind === 'uri') {
    if (!isSafeLinkUrl(doel.uri)) return false;
    const { openExtern } = await import('../../core/extern-openen.js');
    await openExtern(doel.uri);
    return true;
  }
  if (doel.kind === 'page') {
    const { handleInternalLink } = await import('../../pdf/link-layer.js');
    const naam = doel.fit === 'fit' ? 'Fit' : 'XYZ';
    await handleInternalLink([Math.max(0, (doel.page || 1) - 1), { name: naam },
      doel.left ?? null, doel.top ?? null, doel.zoom ?? null]);
    return true;
  }
  if (doel.kind === 'file') return openBestand(doel.file);
  return false;
}
