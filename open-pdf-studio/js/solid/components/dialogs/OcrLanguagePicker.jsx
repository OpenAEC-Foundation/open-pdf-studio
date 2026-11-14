import { createSignal, createMemo, onMount, Show, For } from 'solid-js';
import { state } from '../../../core/state.js';
import { isTauri, invoke } from '../../../core/platform.js';
import { revealInFileManager } from '../../../core/file-manager-reveal.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import {
  AUTO, ENGELS, taalNaam, sorteerOpNaam, bouwTaalSpec, ontleedTaalSpec, beginKeuze, teDownloaden, ontleedTaalFout,
} from '../../../pdf/ocr-talen.js';

// Without the desktop app (web build) or before the list arrives: the
// languages every build ships (scripts/ocr-runtime.mjs).
const MEEGELEVERD = ['chi_tra', 'eng'];

/** Remember the choice for every OCR window (preferences.ocrLanguage). */
async function onthoudTaal(spec) {
  if (!state.preferences || state.preferences.ocrLanguage === spec) return;
  state.preferences.ocrLanguage = spec;
  const { savePreferences } = await import('../../../core/preferences.js');
  savePreferences();
}

/** The language choice at the start of an OCR window: the saved one. */
export function opgeslagenOcrTaal() {
  return beginKeuze(state.preferences?.ocrLanguage, null);
}

/**
 * Language choice for the built-in OCR (#1083), shared by the OCR, batch OCR
 * and scan windows: "Automatic" or one of the languages in the language
 * folder, optionally together with English; in the desktop app also "Add
 * language…" (download from the fixed list) and "Open language folder".
 *
 * Props: value (spec, e.g. 'nld+eng'), onChange(spec), disabled,
 * rowClass / labelClass / selectClass (the host window's styles).
 */
export default function OcrLanguagePicker(props) {
  const { t, language } = useTranslation('dialogs');
  const { t: tCommon } = useTranslation('common');
  const o = (key, opts) => t(`ocrLanguage.${key}`, opts);
  const desktop = isTauri();

  const [info, setInfo] = createSignal(null); // answer of ocr_languages_list
  const [adding, setAdding] = createSignal(false);
  const [toAdd, setToAdd] = createSignal('');
  const [busy, setBusy] = createSignal('');
  const [error, setError] = createSignal('');
  const [notice, setNotice] = createSignal('');

  const varianten = () => ({
    vertical: o('variants.vertical'), historic: o('variants.historic'),
    fraktur: o('variants.fraktur'), equations: o('variants.equations'),
  });
  const naam = (code) => taalNaam(code, language(), { varianten: varianten() });

  const beschikbaar = createMemo(() => info()?.available ?? MEEGELEVERD);
  const keuze = createMemo(() => ontleedTaalSpec(props.value));
  const opties = createMemo(() => sorteerOpNaam(beschikbaar(), naam, language()));
  const downloadbaar = createMemo(() => sorteerOpNaam(teDownloaden(info()?.downloadable, beschikbaar()), naam, language()));

  const kies = (spec) => {
    props.onChange?.(spec);
    onthoudTaal(spec);
  };

  // After a refresh: a saved choice whose language is gone falls back to automatic.
  const pasKeuzeAan = () => {
    const spec = beginKeuze(props.value, beschikbaar());
    if (spec !== props.value) props.onChange?.(spec);
  };

  async function laad() {
    if (!desktop) return;
    try {
      setInfo(await invoke('ocr_languages_list'));
      pasKeuzeAan();
    } catch (e) {
      console.warn('[ocr] language list failed:', e);
    }
  }
  onMount(laad);

  function foutTekst(e) {
    const { code, detail } = ontleedTaalFout(e);
    if (code === 'OCR_LANGUAGE_FOLDER') return o('folderNotWritable');
    if (code === 'OCR_LANGUAGE_INVALID') return o('downloadFailed', { error: o('invalidFile') });
    return o('downloadFailed', { error: detail || String(e) });
  }

  function openAdd() {
    setError('');
    setNotice('');
    setToAdd(downloadbaar()[0] || '');
    setAdding(true);
  }

  async function download() {
    const code = toAdd();
    if (!code || busy()) return;
    setError('');
    setNotice('');
    setBusy(code);
    try {
      setInfo(await invoke('ocr_language_download', { code }));
      setAdding(false);
      setNotice(o('downloaded', { language: naam(code) }));
      kies(bouwTaalSpec(code, keuze().ookEngels));
    } catch (e) {
      setError(foutTekst(e));
    } finally {
      setBusy('');
    }
  }

  async function openFolder() {
    let pad = info()?.revealPath;
    if (!pad) {
      await laad();
      pad = info()?.revealPath;
    }
    if (pad) await revealInFileManager(pad);
  }

  const rowClass = () => props.rowClass || 'split-doc-row';
  const selectClass = () => props.selectClass || 'batch-ocr-select';

  return (
    <div class="ocr-talen">
      <div class={rowClass()}>
        <label class={props.labelClass || 'split-doc-label'}>{o('language')}</label>
        <select
          class={selectClass()}
          value={keuze().taal}
          disabled={props.disabled}
          onChange={(e) => kies(bouwTaalSpec(e.target.value, keuze().ookEngels))}
        >
          <option value={AUTO} selected={keuze().taal === AUTO}>{o('options.auto')}</option>
          <For each={opties()}>
            {(code) => <option value={code} selected={keuze().taal === code}>{naam(code)}</option>}
          </For>
        </select>
      </div>
      <label class="ocr-talen-check">
        <input
          type="checkbox"
          checked={keuze().ookEngels}
          disabled={props.disabled || keuze().taal === AUTO || keuze().taal === ENGELS || !beschikbaar().includes(ENGELS)}
          onChange={(e) => kies(bouwTaalSpec(keuze().taal, e.target.checked))}
        />
        <span>{o('alsoEnglish')}</span>
      </label>
      <Show when={desktop}>
        <div class="ocr-talen-actions">
          <button class="pref-btn pref-btn-secondary" disabled={props.disabled || !!busy() || !info()?.userFolder || downloadbaar().length === 0} onClick={openAdd}>
            {o('addLanguage')}
          </button>
          <button class="pref-btn pref-btn-secondary" disabled={!info()} onClick={openFolder}>{o('openFolder')}</button>
        </div>
        <Show when={adding()}>
          <div class={rowClass()}>
            <select class={selectClass()} value={toAdd()} disabled={!!busy()} onChange={(e) => setToAdd(e.target.value)}>
              <For each={downloadbaar()}>
                {(code) => <option value={code} selected={toAdd() === code}>{`${naam(code)} (${code})`}</option>}
              </For>
            </select>
            <button class="pref-btn pref-btn-primary" disabled={!toAdd() || !!busy()} onClick={download}>{o('download')}</button>
            <button class="pref-btn pref-btn-secondary" disabled={!!busy()} onClick={() => setAdding(false)}>{tCommon('cancel')}</button>
          </div>
        </Show>
        <Show when={busy()}>
          <div class="ocr-talen-status" role="status">{o('downloading', { language: naam(busy()) })}</div>
        </Show>
        <Show when={notice()}>
          <div class="ocr-talen-status" role="status">{notice()}</div>
        </Show>
        <Show when={error()}>
          <div class="ocr-talen-error" role="alert">{error()}</div>
        </Show>
        <div class="ocr-talen-hint">{o('hint')}</div>
      </Show>
    </div>
  );
}
