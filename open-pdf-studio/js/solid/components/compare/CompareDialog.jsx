import { createSignal, For, Show } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog } from '../../stores/dialogStore.js';
import { state } from '../../../core/state.js';
import { startCompare } from '../../../compare/compare-store.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { registerCompareSource } from '../../../compare/compare-sources.js';
import { getDocPageCount } from '../../../compare/compare-viewport.js';
import { getPreviousPdfBytes } from '../../../pdf/loader.js';
import { openFileDialog, readBinaryFile } from '../../../core/platform.js';

export default function CompareDialog() {
  const { t } = useTranslation('ribbon');
  const { t: tCommon } = useTranslation('common');

  const docs = () => (state.documents || []).filter(d => d && d.filePath);
  const docName = (d) => {
    if (!d) return '';
    return d.fileName || (d.filePath || '').split(/[\\/]/).pop() || d.filePath;
  };

  // Sides to choose from (#465): the open tabs, the version of an open tab
  // from before its last save, and files picked from disk.
  const initialSources = () => {
    const list = docs().map((d) => ({ key: d.filePath, name: docName(d), pages: d?.pdfDoc?.numPages || 1 }));
    for (const d of docs()) {
      const prev = getPreviousPdfBytes(d.filePath);
      if (!prev) continue;
      const key = registerCompareSource({ kind: 'previous', path: d.filePath, name: docName(d), bytes: prev });
      list.push({ key, name: `${docName(d)} (${t('compare.previousVersion') || 'before last save'})`, pages: d?.pdfDoc?.numPages || 1 });
    }
    return list;
  };
  const [sources, setSources] = createSignal(initialSources());
  const keyAt = (i) => sources()[i]?.key || null;

  const [oldKey, setOldKey] = createSignal(keyAt(0));
  const [newKey, setNewKey] = createSignal(keyAt(Math.min(1, Math.max(0, sources().length - 1))));
  const [mode, setMode] = createSignal('side');
  const [oldPage, setOldPage] = createSignal(1);
  const [newPage, setNewPage] = createSignal(1);
  const [loadError, setLoadError] = createSignal('');

  const close = () => closeDialog('compare');
  const sourceFor = (key) => sources().find((s) => s.key === key) || null;

  // Pick a PDF from disk for one side.
  const browse = async (side) => {
    setLoadError('');
    try {
      const picked = await openFileDialog(['pdf']);
      const path = Array.isArray(picked) ? picked[0] : picked;
      if (!path) return;
      const bytes = await readBinaryFile(path);
      if (!bytes || !bytes.length) throw new Error('empty');
      const name = String(path).split(/[\\/]/).pop();
      const key = registerCompareSource({ kind: 'file', path, name, bytes: new Uint8Array(bytes) });
      const pages = await getDocPageCount(key);
      if (!pages) throw new Error('unreadable');
      setSources([...sources().filter((s) => s.key !== key), { key, name: `${name} (${t('compare.fromDisk') || 'file'})`, pages }]);
      if (side === 'old') { setOldKey(key); setOldPage(1); } else { setNewKey(key); setNewPage(1); }
    } catch (_) {
      setLoadError(t('compare.fileLoadError') || 'The file could not be opened as a PDF.');
    }
  };

  const handleOk = () => {
    const o = sourceFor(oldKey());
    const n = sourceFor(newKey());
    if (!o || !n) {
      close();
      return;
    }
    startCompare({
      oldFilePath: o.key,
      newFilePath: n.key,
      mode: mode(),
      oldPage: oldPage(),
      newPage: newPage(),
      oldPageCount: o.pages,
      newPageCount: n.pages,
    });
    close();
  };

  const canStart = () => !!sourceFor(oldKey()) && !!sourceFor(newKey()) && oldKey() !== newKey();

  // Get max pages for selected doc, fallback to 1
  const oldMaxPages = () => sourceFor(oldKey())?.pages || 1;
  const newMaxPages = () => sourceFor(newKey())?.pages || 1;

  const footer = (
    <div class="cmp-dialog-footer">
      <button class="pref-btn pref-btn-secondary" onClick={close}>{tCommon('cancel') || 'Annuleren'}</button>
      <button class="pref-btn pref-btn-primary" disabled={!canStart()} onClick={handleOk}>
        {t('compare.start') || 'Start vergelijken'}
      </button>
    </div>
  );

  const SourceSelect = (p) => (
    <div style="display:flex; gap:4px;">
      <select
        class="cmp-doc-select"
        style="flex:1; min-width:0;"
        value={p.value()}
        onChange={(e) => p.onChange(e.target.value)}
      >
        <For each={sources()}>
          {(s) => <option value={s.key} selected={s.key === p.value()}>{s.name}</option>}
        </For>
      </select>
      <button type="button" class="pref-btn pref-btn-secondary" title={t('compare.browseHint') || 'Pick a PDF file from disk'} onClick={() => browse(p.side)}>
        {t('compare.browse') || 'Browse…'}
      </button>
    </div>
  );

  return (
    <Dialog
      title={t('compare.title') || "PDF's vergelijken"}
      onClose={close}
      footer={footer}
    >
        <div class="cmp-dialog">
          <Show when={sources().length < 2}>
            <div class="cmp-dialog-empty-msg" style="margin-bottom:6px;">
              {t('compare.pickSecondSide') || 'Pick the other side from a file on disk, or open a second PDF in a tab.'}
            </div>
          </Show>
          <Show when={loadError()}>
            <div style="color:#b91c1c; font-size:12px; margin-bottom:6px;">{loadError()}</div>
          </Show>

          {/* Document selectors — side by side */}
          <div class="cmp-doc-row">
            <div class="cmp-doc-col">
              <div class="cmp-doc-label cmp-old">
                <span class="cmp-color-dot" style="background:#dc2626"></span>
                {t('compare.oldDoc') || 'Oud'}
              </div>
              <SourceSelect side="old" value={oldKey} onChange={(k) => { setOldKey(k); setOldPage(1); }} />
              <div class="cmp-page-row">
                <span class="cmp-page-label">{t('compare.page') || 'Pagina'}</span>
                <input
                  type="text" inputmode="decimal" data-getal
                  min="1"
                  max={oldMaxPages()}
                  class="cmp-page-input"
                  value={oldPage()}
                  onInput={(e) => setOldPage(Math.max(1, Math.min(oldMaxPages(), parseInt(e.target.value) || 1)))}
                />
                <span class="cmp-page-of">/ {oldMaxPages()}</span>
              </div>
            </div>

            <button
              type="button"
              class="cmp-vs cmp-swap-btn"
              title={t('compare.swap') || 'Wissel oud en nieuw'}
              onClick={() => {
                const a = oldKey(), b = newKey();
                const ap = oldPage(), bp = newPage();
                setOldKey(b); setNewKey(a);
                setOldPage(bp); setNewPage(ap);
              }}
            >
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M7 7h12M19 7l-3-3M19 7l-3 3"/>
                <path d="M17 17H5M5 17l3-3M5 17l3 3"/>
              </svg>
            </button>

            <div class="cmp-doc-col">
              <div class="cmp-doc-label cmp-new">
                <span class="cmp-color-dot" style="background:#16a34a"></span>
                {t('compare.newDoc') || 'Nieuw'}
              </div>
              <SourceSelect side="new" value={newKey} onChange={(k) => { setNewKey(k); setNewPage(1); }} />
              <div class="cmp-page-row">
                <span class="cmp-page-label">{t('compare.page') || 'Pagina'}</span>
                <input
                  type="text" inputmode="decimal" data-getal
                  min="1"
                  max={newMaxPages()}
                  class="cmp-page-input"
                  value={newPage()}
                  onInput={(e) => setNewPage(Math.max(1, Math.min(newMaxPages(), parseInt(e.target.value) || 1)))}
                />
                <span class="cmp-page-of">/ {newMaxPages()}</span>
              </div>
            </div>
          </div>

          {/* Mode selector — large radio cards */}
          <div class="cmp-mode-row">
            <label class={`cmp-mode-card ${mode() === 'overlay' ? 'active' : ''}`}>
              <input
                type="radio"
                name="cmp-mode"
                value="overlay"
                checked={mode() === 'overlay'}
                onChange={() => setMode('overlay')}
              />
              <div class="cmp-mode-icon">
                <svg viewBox="0 0 32 32" width="32" height="32" fill="none" stroke-width="2">
                  <rect x="4" y="4" width="20" height="22" stroke="#dc2626"/>
                  <rect x="8" y="6" width="20" height="22" stroke="#16a34a"/>
                </svg>
              </div>
              <div class="cmp-mode-title">{t('compare.overlay') || 'Overlay'}</div>
              <div class="cmp-mode-desc">{t('compare.overlayDesc') || 'Beide PDFs over elkaar heen'}</div>
            </label>

            <label class={`cmp-mode-card ${mode() === 'side' ? 'active' : ''}`}>
              <input
                type="radio"
                name="cmp-mode"
                value="side"
                checked={mode() === 'side'}
                onChange={() => setMode('side')}
              />
              <div class="cmp-mode-icon">
                <svg viewBox="0 0 32 32" width="32" height="32" fill="none" stroke="#555" stroke-width="2">
                  <rect x="3" y="6" width="12" height="20"/>
                  <rect x="17" y="6" width="12" height="20"/>
                </svg>
              </div>
              <div class="cmp-mode-title">{t('compare.sideBySide') || 'Naast elkaar'}</div>
              <div class="cmp-mode-desc">{t('compare.sideDesc') || "Twee PDFs naast elkaar, gesynchroniseerd"}</div>
            </label>

            <label class={`cmp-mode-card ${mode() === 'split' ? 'active' : ''}`}>
              <input
                type="radio"
                name="cmp-mode"
                value="split"
                checked={mode() === 'split'}
                onChange={() => setMode('split')}
              />
              <div class="cmp-mode-icon">
                <svg viewBox="0 0 32 32" width="32" height="32" fill="none" stroke-width="2">
                  <rect x="4" y="5" width="24" height="22" stroke="#555"/>
                  <line x1="16" y1="2" x2="16" y2="30" stroke="#0078d4"/>
                  <circle cx="16" cy="16" r="3.5" fill="#0078d4" stroke="#0078d4"/>
                </svg>
              </div>
              <div class="cmp-mode-title">{t('compare.split') || 'Scheidingslijn'}</div>
              <div class="cmp-mode-desc">{t('compare.splitDesc') || 'Sleep een lijn om oud en nieuw te tonen'}</div>
            </label>
          </div>

          {/* Legend */}
          <Show when={mode() === 'overlay'}>
            <div class="cmp-legend">
              <span class="cmp-legend-item"><span class="cmp-color-dot" style="background:#dc2626"></span>{t('compare.legendOld') || 'Alleen in oud'}</span>
              <span class="cmp-legend-item"><span class="cmp-color-dot" style="background:#16a34a"></span>{t('compare.legendNew') || 'Alleen in nieuw'}</span>
              <span class="cmp-legend-item"><span class="cmp-color-dot" style="background:#222"></span>{t('compare.legendBoth') || 'Ongewijzigd'}</span>
            </div>
          </Show>
        </div>
    </Dialog>
  );
}
