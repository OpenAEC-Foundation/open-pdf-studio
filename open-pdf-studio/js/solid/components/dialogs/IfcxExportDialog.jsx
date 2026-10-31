import { createSignal, Show, For } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog } from '../../stores/dialogStore.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { getActiveDocument } from '../../../core/state.js';
import { parsePageRange } from '../../../pdf/exporter.js';

// Export to IFCX (Beta, #876): pages, what to include, then the save dialog.
export default function IfcxExportDialog() {
  const { t } = useTranslation('dialogs');
  const { t: tCommon } = useTranslation('common');
  const doc = getActiveDocument();
  const totalPages = doc?.pdfDoc?.numPages || 1;
  const currentPage = doc?.currentPage || 1;

  const [range, setRange] = createSignal('all');
  const [customPages, setCustomPages] = createSignal('');
  const [raster, setRaster] = createSignal(true);
  const [text, setText] = createSignal(true);
  const [annotations, setAnnotations] = createSignal(true);
  const [busy, setBusy] = createSignal(false);
  const [status, setStatus] = createSignal('');
  const [warnings, setWarnings] = createSignal([]);
  let cancelled = false;

  const close = () => {
    cancelled = true;
    closeDialog('ifcx-export');
  };

  const pages = () => {
    if (range() === 'current') return [currentPage];
    if (range() === 'custom') return parsePageRange(customPages(), totalPages);
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  };

  const handleExport = async () => {
    const list = pages();
    if (!list.length) {
      setStatus(t('ifcxExport.noPages'));
      return;
    }
    const mod = await import('../../../pdf/ifcx-export.js');
    const target = await mod.kiesIfcxDoel(doc);
    if (!target) return;
    setBusy(true);
    setWarnings([]);
    cancelled = false;
    try {
      const result = await mod.exporteerIfcx(doc, {
        pad: target,
        paginas: list,
        opties: { raster: raster(), tekst: text(), annotaties: annotations() },
        voortgang: (done, total) => setStatus(t('ifcxExport.progress', { done, total })),
        afgebroken: () => cancelled,
      });
      if (result.ok) {
        const c = result.verslag.counts;
        const file = String(result.pad).split(/[\\/]/).pop();
        setStatus(t('ifcxExport.done', {
          file, sheets: c.sheets, paths: c.paths, texts: c.texts, images: c.images, annotations: c.annotations,
        }));
        setWarnings(mod.waarschuwingTeksten(t, result.verslag));
      } else if (result.code === 'noBytes') {
        setStatus(t('ifcxExport.noBytes'));
      } else if (result.code === 'protected') {
        setStatus(tCommon('protectedPdfReadOnly'));
      } else if (result.code !== 'cancelled') {
        setStatus(t('ifcxExport.failed', { error: result.error || '' }));
      }
    } catch (e) {
      setStatus(t('ifcxExport.failed', { error: String(e?.message ?? e) }));
    } finally {
      setBusy(false);
    }
  };

  const footer = (
    <>
      <div></div>
      <div class="extract-pages-footer-right">
        <button class="pref-btn pref-btn-primary" disabled={busy()} onClick={handleExport}>{t('ifcxExport.export')}</button>
        <button class="pref-btn pref-btn-secondary" onClick={close}>{tCommon('close')}</button>
      </div>
    </>
  );

  return (
    <Dialog
      title={t('ifcxExport.title')}
      overlayClass="extract-pages-overlay"
      dialogClass="extract-pages-dialog ifcx-export-dialog"
      headerClass="extract-pages-header"
      bodyClass="extract-pages-content"
      footerClass="extract-pages-footer"
      onClose={close}
      footer={footer}
    >
      <div class="extract-pages-form">
        <div class="ifcx-export-beta">{t('ifcxExport.betaNote')}</div>
        <div class="extract-pages-row">
          <label class="extract-pages-label">{t('ifcxExport.pages')}</label>
          <select class="crop-margins-select" value={range()} disabled={busy()} onChange={(e) => setRange(e.target.value)}>
            <option value="all">{t('ifcxExport.allPages')}</option>
            <option value="current">{t('ifcxExport.currentPage')}</option>
            <option value="custom">{t('ifcxExport.customPages')}</option>
          </select>
        </div>
        <Show when={range() === 'custom'}>
          <div class="extract-pages-row">
            <label class="extract-pages-label"></label>
            <input type="text" class="extract-pages-input-wide" placeholder={t('ifcxExport.rangePlaceholder')}
              value={customPages()} disabled={busy()} onInput={(e) => setCustomPages(e.target.value)} />
          </div>
        </Show>
        <div class="extract-pages-row extract-pages-checkbox-row">
          <label class="extract-pages-checkbox-label">
            <input type="checkbox" checked={raster()} disabled={busy()} onChange={(e) => setRaster(e.target.checked)} /> {t('ifcxExport.includeRaster')}
          </label>
        </div>
        <div class="extract-pages-row">
          <label class="extract-pages-checkbox-label">
            <input type="checkbox" checked={text()} disabled={busy()} onChange={(e) => setText(e.target.checked)} /> {t('ifcxExport.includeText')}
          </label>
        </div>
        <div class="extract-pages-row">
          <label class="extract-pages-checkbox-label">
            <input type="checkbox" checked={annotations()} disabled={busy()} onChange={(e) => setAnnotations(e.target.checked)} /> {t('ifcxExport.includeAnnotations')}
          </label>
        </div>
        <Show when={doc?.modified}>
          <div class="ifcx-export-note">{t('ifcxExport.unsavedNote')}</div>
        </Show>
        <Show when={status()}>
          <div class="ifcx-export-status">{status()}</div>
        </Show>
        <For each={warnings()}>{(w) => <div class="ifcx-export-warning">{w}</div>}</For>
      </div>
    </Dialog>
  );
}
