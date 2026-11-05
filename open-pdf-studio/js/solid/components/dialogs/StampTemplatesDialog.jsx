// Editor for dynamic stamp templates (#629): built-in, personal and shared
// templates; text lines with fields, font size, colour, border, date format,
// optional image; import/export of a template-set file; the shared folder.
import { For, Show, createSignal, createMemo, onMount, onCleanup } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import Dialog from '../Dialog.jsx';
import { closeDialog, showMessage } from '../../stores/dialogStore.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { stampTemplates } from '../../../annotations/stamp-template-backend.js';
import {
  BUILTIN_FIELDS, DATE_FORMATS, BORDER_STYLES, ALIGNS, LIMITS, TEMPLATE_SET_EXTENSION,
  customFields, formatStampDate, normalizeTemplate, newTemplateId,
} from '../../../annotations/dynamic-stamp.js';
import { showConfirm } from '../../../ui/chrome/confirm-dialog.js';
import { leesGetal } from '../../../core/getal-invoer.js';
import i18next from '../../../i18n/config.js';
import StampTemplatePreview from './StampTemplatePreview.jsx';
import { fieldLabel } from './DynamicStampFieldsDialog.jsx';

const SCOPES = ['builtin', 'personal', 'shared'];

function emptyTemplate(name) {
  return {
    id: null, name, scope: 'personal', readOnly: false,
    lines: [
      { text: 'APPROVED', fontSize: 16, bold: true, align: 'center' },
      { text: '{user} · {date}', fontSize: 9, bold: false, align: 'center' },
    ],
    color: '#c00000', fillColor: null, border: 'rounded', borderWidth: 2,
    dateFormat: 'short', customDateFormat: 'dd-MM-yyyy', image: null, lockOnPlace: false, fields: {},
  };
}

function bytesToBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export default function StampTemplatesDialog() {
  const { t } = useTranslation('dialogs');
  const { t: tc } = useTranslation('common');
  const { t: tp } = useTranslation('properties');
  const tx = (k, o) => t(`stampTemplates.${k}`, o);

  let store = null;
  let unsubscribe = null;
  let closed = false;
  const [list, setList] = createSignal([]);
  const [selected, setSelected] = createSignal(null);
  const [draft, setDraft] = createStore(emptyTemplate(''));
  const [dirty, setDirty] = createSignal(false);
  const [folder, setFolder] = createSignal('');
  const [sharedError, setSharedError] = createSignal(null);
  const [activeLine, setActiveLine] = createSignal(0);

  const refresh = () => {
    setList(store.list());
    setFolder(store.sharedFolder());
    setSharedError(store.sharedError());
  };

  function select(tpl) {
    setSelected(tpl.id);
    setDraft(reconcile(JSON.parse(JSON.stringify({ ...emptyTemplate(''), ...tpl }))));
    setDirty(false);
    setActiveLine(0);
  }

  onCleanup(() => { closed = true; unsubscribe?.(); });
  onMount(async () => {
    store = await stampTemplates();
    if (closed) return;
    unsubscribe = store.onChange(refresh);
    refresh();
    const first = store.list()[0];
    if (first) select(first);
  });

  const close = () => closeDialog('stamp-templates');
  const readOnly = () => !!draft.readOnly;
  const change = (...args) => { if (readOnly()) return; setDraft(...args); setDirty(true); };
  // Deep read: also tracks every property for the memo and the preview.
  const plain = () => JSON.parse(JSON.stringify(draft));
  const fields = createMemo(() => customFields(plain()));
  const fail = (e) => showMessage(tx('saveFailed', { error: e?.code || e?.message || String(e) }), tx('title'));

  async function save() {
    const tpl = plain();
    const { template, errors } = normalizeTemplate({ ...tpl, id: tpl.id || undefined });
    if (!template) { showMessage(tx('invalid', { error: errors.join(', ') }), tx('title')); return; }
    try {
      const saved = draft.scope === 'shared' ? await store.saveShared(template) : await store.savePersonal(template);
      select(saved);
    } catch (e) { fail(e); }
  }

  async function remove() {
    if (!selected() || draft.scope === 'builtin' || readOnly()) return;
    const ok = await showConfirm({ title: tx('title'), message: tx('deleteConfirm', { name: draft.name }) });
    if (!ok) return;
    try {
      if (draft.scope === 'shared') await store.removeShared(selected());
      else await store.deletePersonal(selected());
      const first = store.list()[0];
      if (first) select(first);
    } catch (e) { fail(e); }
  }

  async function duplicate() {
    try {
      if (selected()) {
        const copy = await store.copyToPersonal(selected(), `${draft.name} (2)`.slice(0, LIMITS.name));
        if (copy) select(copy);
      }
    } catch (e) { fail(e); }
  }

  async function share() {
    try {
      const saved = await store.saveShared({ ...plain(), id: newTemplateId() });
      select(saved);
    } catch (e) { fail(e); }
  }

  async function importSet() {
    try {
      const { openFileDialog, readBinaryFile } = await import('../../../core/platform.js');
      const path = await openFileDialog([TEMPLATE_SET_EXTENSION, 'json']);
      if (!path || typeof path !== 'string') return;
      const bytes = await readBinaryFile(path);
      const res = await store.importSet(new TextDecoder('utf-8').decode(bytes));
      if (!res.added.length) showMessage(tx('importFailed', { error: res.errors.join('; ') }), tx('title'));
      else {
        showMessage(tx('importDone', { count: res.added.length }), tx('title'));
        select(res.added[0]);
      }
    } catch (e) { showMessage(tx('importFailed', { error: e?.message || String(e) }), tx('title')); }
  }

  async function exportSet() {
    try {
      const ids = list().filter((x) => x.scope === 'personal').map((x) => x.id);
      if (selected() && !ids.includes(selected())) ids.push(selected());
      const { saveFileDialog, writeBinaryFile } = await import('../../../core/platform.js');
      const path = await saveFileDialog(`stamps.${TEMPLATE_SET_EXTENSION}`, [{ name: tx('title'), extensions: [TEMPLATE_SET_EXTENSION] }]);
      if (!path) return;
      await writeBinaryFile(path, new TextEncoder().encode(store.exportSet(ids)));
    } catch (e) { fail(e); }
  }

  async function chooseImage() {
    try {
      const { openFileDialog, readBinaryFile } = await import('../../../core/platform.js');
      const path = await openFileDialog(['png', 'jpg', 'jpeg']);
      if (!path || typeof path !== 'string') return;
      const bytes = await readBinaryFile(path);
      if (!bytes || bytes.length > LIMITS.imageBytes) { showMessage(tx('imageTooLarge'), tx('title')); return; }
      const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
      const dataUrl = `data:image/${jpeg ? 'jpeg' : 'png'};base64,${bytesToBase64(bytes)}`;
      const img = new Image();
      img.src = dataUrl;
      await img.decode();
      change('image', { dataUrl, width: img.naturalWidth, height: img.naturalHeight });
    } catch (e) { fail(e); }
  }

  async function browseFolder() {
    const { openFolderDialog } = await import('../../../core/platform.js');
    const path = await openFolderDialog(tx('sharedFolder'));
    if (path && typeof path === 'string') await store.setSharedFolder(path);
  }

  function insertField(key) {
    if (!key || readOnly()) return;
    const i = Math.min(activeLine(), draft.lines.length - 1);
    if (i < 0) return;
    change('lines', i, 'text', (s) => `${s}${s && !s.endsWith(' ') ? ' ' : ''}{${key}}`.slice(0, LIMITS.lineText));
  }

  function moveLine(i, d) {
    const j = i + d;
    if (j < 0 || j >= draft.lines.length) return;
    const lines = plain().lines;
    [lines[i], lines[j]] = [lines[j], lines[i]];
    change('lines', lines);
    setActiveLine(j);
  }

  const dateExample = () => formatStampDate(new Date(), {
    locale: i18next.language || 'en', format: draft.dateFormat, custom: draft.customDateFormat,
  });

  const footer = (
    <>
      <button class="pref-btn pref-btn-primary" disabled={readOnly() || !dirty()} onClick={save}>{tx('save')}</button>
      <button class="pref-btn pref-btn-secondary" onClick={close}>{tc('close')}</button>
    </>
  );

  return (
    <Dialog title={tx('title')} overlayClass="stamp-picker-overlay" dialogClass="stamp-templates-dialog" onClose={close} footer={footer}>
      <div class="stamp-templates-body">
        <div class="stamp-templates-side">
          <div class="stamp-templates-list" role="listbox">
            <For each={SCOPES}>
              {(scope) => (
                <Show when={list().some((x) => x.scope === scope)}>
                  <div class="stamp-templates-group">{tx(scope)}</div>
                  <For each={list().filter((x) => x.scope === scope)}>
                    {(tpl) => (
                      <div
                        role="option"
                        aria-selected={selected() === tpl.id}
                        classList={{ 'stamp-templates-item': true, selected: selected() === tpl.id }}
                        onClick={() => select(tpl)}
                      >
                        {tpl.name}
                      </div>
                    )}
                  </For>
                </Show>
              )}
            </For>
          </div>
          <div class="stamp-templates-side-buttons">
            <button class="pref-btn" onClick={() => { setSelected(null); setDraft(reconcile(emptyTemplate(tx('newName')))); setDirty(true); }}>{tx('new')}</button>
            <button class="pref-btn" disabled={!selected()} onClick={duplicate}>{tx('duplicate')}</button>
            <button class="pref-btn" disabled={!selected() || draft.scope === 'builtin' || readOnly()} onClick={remove}>{tx('delete')}</button>
            <button class="pref-btn" onClick={importSet}>{tx('import')}</button>
            <button class="pref-btn" onClick={exportSet}>{tx('export')}</button>
          </div>
        </div>

        <div class="stamp-templates-editor">
          <Show when={readOnly()}>
            <div class="stamp-templates-note">
              {draft.scope === 'shared' ? tx('readOnlyShared', { owner: draft.owner || '?' }) : tx('readOnlyBuiltin')}
              <button class="pref-btn" onClick={duplicate}>{tx('copyToPersonal')}</button>
            </div>
          </Show>
          <div class="stamp-templates-row">
            <label for="stpl-name">{tx('name')}</label>
            <input id="stpl-name" type="text" maxLength={LIMITS.name} value={draft.name} disabled={readOnly()}
              onInput={(e) => change('name', e.currentTarget.value)} />
          </div>

          <div class="stamp-templates-caption">{tx('lines')}</div>
          <table class="stamp-templates-lines">
            <thead>
              <tr><th>{tx('text')}</th><th>{tx('fontSize')}</th><th>{tx('bold')}</th><th>{tx('align')}</th><th /></tr>
            </thead>
            <tbody>
              <For each={draft.lines}>
                {(line, i) => (
                  <tr classList={{ active: activeLine() === i() }}>
                    <td><input type="text" class="stpl-line-text" value={line.text} maxLength={LIMITS.lineText} disabled={readOnly()}
                      onFocus={() => setActiveLine(i())}
                      onInput={(e) => change('lines', i(), 'text', e.currentTarget.value)} /></td>
                    <td><input type="text" inputmode="decimal" data-getal class="stpl-line-size" min={LIMITS.fontMin} max={LIMITS.fontMax} value={line.fontSize} disabled={readOnly()}
                      onChange={(e) => change('lines', i(), 'fontSize', Math.min(LIMITS.fontMax, Math.max(LIMITS.fontMin, leesGetal(e.currentTarget.value) || 12)))} /></td>
                    <td class="stpl-center"><input type="checkbox" checked={line.bold} disabled={readOnly()}
                      onChange={(e) => change('lines', i(), 'bold', e.currentTarget.checked)} /></td>
                    <td><select value={line.align} disabled={readOnly()} onChange={(e) => change('lines', i(), 'align', e.currentTarget.value)}>
                      <For each={ALIGNS}>{(a) => <option value={a}>{tx(`align_${a}`)}</option>}</For>
                    </select></td>
                    <td class="stpl-line-buttons">
                      <button class="stpl-mini" title={tx('moveUp')} disabled={readOnly() || i() === 0} onClick={() => moveLine(i(), -1)}>▲</button>
                      <button class="stpl-mini" title={tx('moveDown')} disabled={readOnly() || i() === draft.lines.length - 1} onClick={() => moveLine(i(), 1)}>▼</button>
                      <button class="stpl-mini stpl-remove" title={tx('removeLine')} disabled={readOnly() || draft.lines.length <= 1}
                        onClick={() => change('lines', (ls) => ls.filter((_, k) => k !== i()))}>✕</button>
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
          <div class="stamp-templates-row">
            <button class="pref-btn" disabled={readOnly() || draft.lines.length >= LIMITS.lines}
              onClick={() => change('lines', (ls) => [...ls, { text: '', fontSize: 10, bold: false, align: 'center' }])}>{tx('addLine')}</button>
            <select disabled={readOnly()} value="" onChange={(e) => { insertField(e.currentTarget.value); e.currentTarget.value = ''; }}>
              <option value="">{tx('insertField')}</option>
              <For each={BUILTIN_FIELDS}>{(k) => <option value={k}>{tp(`dynamicStamp.field.${k}`)}</option>}</For>
            </select>
          </div>
          <div class="stamp-templates-help">{tx('syntaxHelp')}</div>

          <div class="stamp-templates-grid">
            <label>{tx('color')}</label>
            <input type="color" value={draft.color} disabled={readOnly()} onInput={(e) => change('color', e.currentTarget.value)} />
            <label>{tx('fill')}</label>
            <span class="stamp-templates-inline">
              <input type="checkbox" checked={!!draft.fillColor} disabled={readOnly()}
                onChange={(e) => change('fillColor', e.currentTarget.checked ? '#ffffff' : null)} />
              <Show when={draft.fillColor}>
                <input type="color" value={draft.fillColor} disabled={readOnly()} onInput={(e) => change('fillColor', e.currentTarget.value)} />
              </Show>
            </span>
            <label>{tx('border')}</label>
            <span class="stamp-templates-inline">
              <select value={draft.border} disabled={readOnly()} onChange={(e) => change('border', e.currentTarget.value)}>
                <For each={BORDER_STYLES}>{(b) => <option value={b}>{tx(`border_${b}`)}</option>}</For>
              </select>
              <input type="text" inputmode="decimal" data-getal class="stpl-line-size" min="0" max={LIMITS.borderMax} step="0.5" value={draft.borderWidth}
                title={tx('borderWidth')} disabled={readOnly() || draft.border === 'none'}
                onChange={(e) => change('borderWidth', Math.min(LIMITS.borderMax, Math.max(0, leesGetal(e.currentTarget.value) || 0)))} />
            </span>
            <label>{tx('dateFormat')}</label>
            <span class="stamp-templates-inline">
              <select value={draft.dateFormat} disabled={readOnly()} onChange={(e) => change('dateFormat', e.currentTarget.value)}>
                <For each={DATE_FORMATS}>{(d) => <option value={d}>{tx(`date_${d}`)}</option>}</For>
              </select>
              <Show when={draft.dateFormat === 'custom'}>
                <input type="text" class="stpl-format" maxLength={LIMITS.customFormat} value={draft.customDateFormat} disabled={readOnly()}
                  title={tx('customFormatHelp')} onInput={(e) => change('customDateFormat', e.currentTarget.value)} />
              </Show>
              <span class="stamp-templates-example">{dateExample()}</span>
            </span>
            <label>{tx('image')}</label>
            <span class="stamp-templates-inline">
              <button class="pref-btn" disabled={readOnly()} onClick={chooseImage}>{tx('chooseImage')}</button>
              <button class="pref-btn" disabled={readOnly() || !draft.image} onClick={() => change('image', null)}>{tx('removeImage')}</button>
            </span>
            <label />
            <label class="stamp-templates-check">
              <input type="checkbox" checked={draft.lockOnPlace} disabled={readOnly()} onChange={(e) => change('lockOnPlace', e.currentTarget.checked)} />
              {tx('lockOnPlace')}
            </label>
          </div>

          <Show when={fields().length}>
            <div class="stamp-templates-caption">{tx('fields')}</div>
            <div class="stamp-templates-grid">
              <For each={fields()}>
                {(f) => (
                  <>
                    <label>{fieldLabel(f, tp)}</label>
                    <input type="text" placeholder={tx('fieldDefault')} value={draft.fields?.[f.key]?.default ?? f.default}
                      disabled={readOnly()}
                      onInput={(e) => change('fields', { ...plain().fields, [f.key]: { default: e.currentTarget.value } })} />
                  </>
                )}
              </For>
            </div>
          </Show>

          <div class="stamp-templates-caption">{tx('preview')}</div>
          <div class="stamp-templates-preview">
            <StampTemplatePreview template={plain()} width={320} height={100} maxScale={2.5} />
          </div>

          <Show when={draft.scope === 'personal' && selected() && folder()}>
            <div class="stamp-templates-row">
              <button class="pref-btn" onClick={share}>{tx('publish')}</button>
            </div>
          </Show>
        </div>
      </div>

      <div class="stamp-templates-folder">
        <label>{tx('sharedFolder')}</label>
        <input type="text" readOnly value={folder()} placeholder={tx('noSharedFolder')} />
        <button class="pref-btn" onClick={browseFolder}>{tx('browse')}</button>
        <button class="pref-btn" disabled={!folder()} onClick={() => store.setSharedFolder('')}>{tx('clear')}</button>
      </div>
      <Show when={sharedError()}>
        <div class="stamp-templates-error">{tx('sharedUnavailable')}</div>
      </Show>
    </Dialog>
  );
}
