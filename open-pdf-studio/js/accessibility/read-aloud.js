// Read aloud (#384): the selection, or the document from the current page on.
//
// A tagged document is read in the order of its structure tree (with the
// unsaved reading-order edits of the tags panel), an untagged one page by
// page in content order. The view follows to the page being read.

import { getActiveDocument, state } from '../core/state.js';
import { invoke, isTauri } from '../core/platform.js';
import { savePreferences } from '../core/preferences.js';
import {
  setReadAloudVisible, setReadAloudStatus, setReadAloudVoices, setReadAloudVoice,
  setReadAloudRate, setReadAloudEngineKind, setReadAloudMessageKey, setReadAloudPage,
} from '../bridge.js';
import { chooseSpeechEngine, ReadAloudPlayer, clampRate } from './speech.js';
import { readingItems } from './accessibility-service.js';

let enginePromise = null;
let player = null;
let readingDoc = null;

function engine() {
  if (!enginePromise) {
    enginePromise = chooseSpeechEngine({
      invoke: (cmd, args) => invoke(cmd, args),
      inTauri: isTauri(),
      platform: globalThis.navigator?.userAgent || '',
    });
  }
  return enginePromise;
}

function preferredVoice(list) {
  const saved = state.preferences?.readAloudVoice || '';
  if (saved && list.some((v) => v.id === saved)) return saved;
  // Default: a voice for the document or interface language, else the engine default.
  const lang = (document.documentElement.lang || 'en').toLowerCase().slice(0, 2);
  return list.find((v) => v.lang?.toLowerCase().startsWith(lang) && v.isDefault)?.id
    || list.find((v) => v.lang?.toLowerCase().startsWith(lang))?.id
    || '';
}

async function ensurePlayer() {
  const eng = await engine();
  setReadAloudEngineKind(eng.kind);
  if (eng.kind === 'none') {
    setReadAloudMessageKey(eng.reason);
    return null;
  }
  if (!player) {
    const list = eng.voices();
    setReadAloudVoices(list);
    const v = preferredVoice(list);
    setReadAloudVoice(v);
    const r = clampRate(state.preferences?.readAloudRate ?? 1);
    setReadAloudRate(r);
    player = new ReadAloudPlayer({
      engine: eng,
      resolveText: (item) => item.resolve(),
      onItem: (item) => followItem(item),
      onState: (s) => setReadAloudStatus(s),
      onError: (err) => {
        console.warn('[read aloud]', err);
        setReadAloudMessageKey('speechFailed');
      },
    });
    player.setVoice(v);
    player.setRate(r);
  }
  return player;
}

function followItem(item) {
  const doc = getActiveDocument();
  if (!doc || doc !== readingDoc) { stopReadAloud(); return; }
  if (item.pageIndex == null) return;
  setReadAloudPage(item.pageIndex + 1);
  if (doc.currentPage !== item.pageIndex + 1) {
    import('../pdf/renderer.js').then((m) => m.goToPage(item.pageIndex + 1)).catch(() => {});
  }
}

/** The selected document text, if the selection is in the page text layer. */
function selectedText() {
  const t = state.textSelection?.hasSelection ? state.textSelection.selectedText : '';
  return typeof t === 'string' ? t.trim() : '';
}

/**
 * Start reading. With a text selection: the selection. Otherwise the
 * document from the current page to the end.
 */
export async function startReadAloud() {
  const doc = getActiveDocument();
  if (!doc?.pdfDoc) return;
  setReadAloudVisible(true);
  setReadAloudMessageKey('');
  setReadAloudStatus('loading');
  const p = await ensurePlayer();
  if (!p) { setReadAloudStatus('idle'); return; }
  readingDoc = doc;
  const selection = selectedText();
  if (selection) {
    const page = state.textSelection?.pageNum ?? null;
    setReadAloudPage(page || 0);
    p.play([{ pageIndex: null, resolve: () => selection }]);
    return;
  }
  let reading;
  try {
    reading = await readingItems(doc, Math.max(0, (doc.currentPage || 1) - 1));
  } catch (err) {
    console.warn('[read aloud] reading order failed:', err);
    setReadAloudStatus('idle');
    setReadAloudMessageKey('speechFailed');
    return;
  }
  if (getActiveDocument() !== doc) { setReadAloudStatus('idle'); return; }
  const items = reading.items.map((it) => ({ pageIndex: it.pageIndex ?? null, resolve: () => reading.resolveText(it) }));
  if (!items.length) {
    setReadAloudStatus('idle');
    setReadAloudMessageKey('nothingToRead');
    return;
  }
  setReadAloudMessageKey(reading.tagged ? 'tagOrder' : 'contentOrder');
  p.play(items);
}

export function pauseReadAloud() { player?.pause(); }
export function resumeReadAloud() { player?.resume(); }

export function togglePauseReadAloud() {
  if (!player) return;
  if (player.state === 'playing') player.pause();
  else if (player.state === 'paused') player.resume();
}

export function stopReadAloud() {
  player?.stop();
  readingDoc = null;
  setReadAloudStatus('idle');
}

export function closeReadAloud() {
  stopReadAloud();
  setReadAloudVisible(false);
  setReadAloudMessageKey('');
}

export function isReading() {
  return !!player && player.state !== 'idle';
}

export function chooseVoice(id) {
  setReadAloudVoice(id || '');
  player?.setVoice(id || '');
  state.preferences.readAloudVoice = id || '';
  savePreferences();
}

export function chooseRate(rate) {
  const r = clampRate(rate);
  setReadAloudRate(r);
  player?.setRate(r);
  state.preferences.readAloudRate = r;
  savePreferences();
}
