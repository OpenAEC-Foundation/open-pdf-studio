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
  setReadAloudAllowOnline, setReadAloudOnlineVoices,
} from '../bridge.js';
import { chooseSpeechEngine, ReadAloudPlayer, clampRate, pickVoice } from './speech.js';
import { readingItems } from './accessibility-service.js';

let enginePromise = null;
let player = null;
let readingDoc = null;
// 'noLocalVoice' when no local voice speaks the language: shown in the bar
// instead of the reading order, so the user knows another voice is used.
let voiceWarning = '';

/** Online voices only after the user opted in (preference readAloudAllowOnline). */
function allowOnlineVoices() {
  return state.preferences?.readAloudAllowOnline === true;
}

function engine() {
  if (!enginePromise) {
    enginePromise = chooseSpeechEngine({
      invoke: (cmd, args) => invoke(cmd, args),
      inTauri: isTauri(),
      platform: globalThis.navigator?.userAgent || '',
      allowOnline: allowOnlineVoices(),
    });
  }
  return enginePromise;
}

function preferredVoice(list) {
  // Default: a local voice for the interface language, else the local default
  // voice with a warning; an online voice only after opting in.
  const { id, warning } = pickVoice(list, {
    saved: state.preferences?.readAloudVoice || '',
    lang: document.documentElement.lang || 'en',
    allowOnline: allowOnlineVoices(),
  });
  voiceWarning = warning;
  return id;
}

async function ensurePlayer() {
  const eng = await engine();
  setReadAloudEngineKind(eng.kind);
  setReadAloudAllowOnline(allowOnlineVoices());
  setReadAloudOnlineVoices(eng.onlineVoiceCount || 0);
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
    if (voiceWarning) setReadAloudMessageKey(voiceWarning);
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
  setReadAloudMessageKey(voiceWarning || (reading.tagged ? 'tagOrder' : 'contentOrder'));
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
  voiceWarning = '';
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

/**
 * Opt in to (or out of) online voices. With an online voice the text being
 * read is sent to an online speech service, so this is never on by default.
 * Stops reading and chooses the engine and voices again.
 */
export async function setAllowOnlineVoices(allow) {
  stopReadAloud();
  state.preferences.readAloudAllowOnline = !!allow;
  savePreferences();
  enginePromise = null;
  player = null;
  voiceWarning = '';
  setReadAloudMessageKey('');
  await ensurePlayer();
}
