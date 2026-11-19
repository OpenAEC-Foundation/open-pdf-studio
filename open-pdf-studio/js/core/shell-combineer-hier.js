import { PDFDocument, PDFName } from 'pdf-lib';
import i18next from '../i18n/config.js';
import { invoke, readBinaryFile, writeBinaryFileNew } from './platform.js';
import { naamVan, schrijfNaastBron } from './shell-acties-logica.js';
import { telHandtekeningen, voegPdfsSamen } from '../pdf/samenvoegen.js';
import { isVoorbeeldPdf } from '../pdf/cad-import-logica.js';

export async function combineerNaastBron(paden) {
  if (paden.length < 2) throw new Error(i18next.t('dialogs:shellCombineMinimum'));
  const bronnen = [];
  for (const pad of paden) {
    try {
      await invoke('allow_fs_scope', { path: pad });
      const doc = await PDFDocument.load(new Uint8Array(await readBinaryFile(pad)));
      if (telHandtekeningen(doc) || isVoorbeeldPdf(doc, { PDFName })) {
        throw new Error(i18next.t('dialogs:shellCombineInteractive'));
      }
      if (!doc.getPageCount()) throw new Error(i18next.t('dialogs:shellCombineEmpty'));
      bronnen.push({ doc, naam: naamVan(pad) });
    } catch (error) {
      throw new Error(i18next.t('failedToMergeFile', { file: naamVan(pad), error: error.message || String(error) }));
    }
  }
  const [eerste, ...rest] = bronnen;
  await voegPdfsSamen(eerste.doc, rest, { positie: 'end' });
  const bytes = await eerste.doc.save();
  const naam = paden[0].replace(/\.pdf$/i, ' - ' + i18next.t('dialogs:shellCombinedName') + '.pdf');
  return schrijfNaastBron(naam, bytes, async (pad, inhoud) => {
    await invoke('allow_fs_scope', { path: pad });
    await writeBinaryFileNew(pad, inhoud);
  });
}
