// Speech engines and the read-aloud player (#384).
//
// Engine choice, in this order:
//   1. Web Speech (speechSynthesis in the WebView), when it has voices. On
//      Windows (WebView2) and macOS (WKWebView) this is the OS engine. On
//      Linux, WebKitGTK may expose speechSynthesis without any voice, or not
//      at all; an engine without voices does not count.
//   2. The native engine through Tauri (src-tauri/src/spraak/mod.rs): SAPI via
//      PowerShell on Windows, `say` on macOS, spd-say or espeak-ng on Linux.
//   3. None: the caller shows a message (on Linux: install speech-dispatcher
//      or espeak-ng).
//
// The player reads a list of items (segments) one by one; each item's text is
// fetched when it is its turn (so page text loads lazily) and split into
// pieces short enough for every engine. Pause uses the engine's own pause
// where it has one; otherwise it stops and resumes at the start of the piece.
//
// No app imports: the environment is passed in, so it is testable under node.

import { splitForSpeech } from './reading-order.js';

/** Clamp a rate multiplier (1 = normal). */
export function clampRate(rate) {
  const r = Number(rate);
  if (!Number.isFinite(r) || r <= 0) return 1;
  return Math.min(2, Math.max(0.5, r));
}

function waitForVoices(synth, timeoutMs) {
  return new Promise((resolve) => {
    let done = false;
    let timer = null;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { synth.removeEventListener?.('voiceschanged', finish); } catch { /* ignore */ }
      resolve(synth.getVoices?.() || []);
    };
    try { synth.addEventListener?.('voiceschanged', finish); } catch { /* ignore */ }
    timer = setTimeout(finish, timeoutMs);
  });
}

// Privacy: a Web Speech voice with localService !== true is synthesised by an
// online service (some browsers list such voices next to the local ones), so the text being read
// leaves the machine. Such voices are only used after the user opted in
// (preference readAloudAllowOnline); without that they are not listed, not
// chosen as default and never handed to the utterance.

/** True for a voice that speaks on this machine. */
export function isLocalVoice(v) {
  return v?.localService === true;
}

/** The voices the user may use: the local ones, plus the online ones after opting in. */
export function usableVoices(voices, allowOnline = false) {
  return (voices || []).filter((v) => allowOnline || isLocalVoice(v));
}

const voiceId = (v) => v.voiceURI || v.name;

/**
 * The voice an utterance gets when no (valid) voice is chosen: never left to
 * the browser, whose default may be an online voice. Local voices first.
 */
function fallbackVoice(list) {
  const local = list.filter(isLocalVoice);
  return local.find((v) => v.default) || local[0] || list.find((v) => v.default) || list[0] || null;
}

/**
 * Web Speech engine over a speechSynthesis object.
 * @param {{ allowOnline?: boolean }} [opts] online voices only with allowOnline
 */
export function webSpeechEngine(synth, Utterance, voices, { allowOnline = false } = {}) {
  let list = usableVoices(voices, allowOnline);
  return {
    kind: 'web',
    canPause: true,
    allowOnline,
    onlineVoiceCount: (voices || []).filter((v) => !isLocalVoice(v)).length,
    voices: () => list.map((v) => ({ id: voiceId(v), name: v.name, lang: v.lang || '', isDefault: !!v.default, online: !isLocalVoice(v) })),
    speak(text, { voice = null, rate = 1 } = {}) {
      return new Promise((resolve, reject) => {
        const u = new Utterance(text);
        u.rate = clampRate(rate);
        const chosen = (voice ? list.find((v) => voiceId(v) === voice) : null) || fallbackVoice(list);
        if (!chosen) { reject(new Error('no usable voice')); return; }
        u.voice = chosen;
        if (chosen.lang) u.lang = chosen.lang;
        u.onend = () => resolve();
        u.onerror = (e) => {
          const code = e?.error;
          if (code === 'interrupted' || code === 'canceled') resolve();
          else reject(new Error(code || 'speech error'));
        };
        synth.speak(u);
      });
    },
    pause() { synth.pause(); },
    resume() { synth.resume(); },
    stop() { synth.cancel(); },
    refreshVoices() {
      const fresh = synth.getVoices?.();
      if (fresh?.length) list = usableVoices(fresh, allowOnline);
    },
  };
}

/** Native engine through Tauri commands. */
export function nativeEngine(invoke, info) {
  return {
    kind: 'native',
    engine: info.engine,
    canPause: false,
    voices: () => (info.voices || []).map((name) => ({ id: name, name, lang: '', isDefault: false })),
    async speak(text, { voice = null, rate = 1 } = {}) {
      await invoke('tts_speak', { text, voice: voice || null, rate: clampRate(rate) });
    },
    pause() {},
    resume() {},
    stop() { return invoke('tts_stop').catch(() => {}); },
  };
}

/**
 * Pick the speech engine.
 * Web Speech counts only with a usable voice: a local one, or an online one
 * after the user opted in (allowOnline). With only online voices and no opt-in
 * the native engine is tried, else the reason is 'onlyOnlineVoices', so the
 * bar can offer the opt-in instead of sending text out unasked.
 * @param {{ synth?: object, Utterance?: Function, invoke?: Function,
 *   inTauri?: boolean, platform?: string, voiceWaitMs?: number,
 *   allowOnline?: boolean }} env
 * @returns {Promise<object>} an engine, or { kind: 'none', reason }; both carry
 *   onlineVoiceCount when Web Speech has online voices
 */
export async function chooseSpeechEngine({
  synth = globalThis.speechSynthesis,
  Utterance = globalThis.SpeechSynthesisUtterance,
  invoke = null,
  inTauri = false,
  platform = '',
  voiceWaitMs = 1000,
  allowOnline = false,
} = {}) {
  let online = 0;
  if (synth && typeof synth.speak === 'function' && typeof Utterance === 'function') {
    let voices = [];
    try { voices = synth.getVoices?.() || []; } catch { voices = []; }
    if (!voices.length) voices = await waitForVoices(synth, voiceWaitMs);
    online = voices.filter((v) => !isLocalVoice(v)).length;
    if (usableVoices(voices, allowOnline).length) return webSpeechEngine(synth, Utterance, voices, { allowOnline });
  }
  const withOnline = (engine) => (online ? Object.assign(engine, { onlineVoiceCount: online }) : engine);
  if (inTauri && typeof invoke === 'function') {
    try {
      const info = await invoke('tts_info');
      if (info?.available) return withOnline(nativeEngine(invoke, info));
    } catch { /* fall through */ }
  }
  if (online) return withOnline({ kind: 'none', reason: 'onlyOnlineVoices' });
  return { kind: 'none', reason: /linux/i.test(platform) ? 'noEngineLinux' : 'noEngine' };
}

/**
 * The voice to start with, from the engine's voice list (already limited to
 * the usable voices). A saved choice wins; otherwise a local voice for the
 * language (the engine default first). Without a local voice for the
 * language an online one is only taken when the user opted in; otherwise the
 * result is '' (the local default voice) with warning 'noLocalVoice', so the
 * bar says so instead of silently picking another voice.
 * @param {{id:string, lang:string, isDefault:boolean, online?:boolean}[]} list
 * @param {{ saved?: string, lang?: string, allowOnline?: boolean }} opts
 * @returns {{ id: string, warning: string }}
 */
export function pickVoice(list, { saved = '', lang = 'en', allowOnline = false } = {}) {
  const voices = (list || []).filter((v) => allowOnline || !v.online);
  if (saved && voices.some((v) => v.id === saved)) return { id: saved, warning: '' };
  const code = String(lang || 'en').toLowerCase().slice(0, 2);
  const forLang = voices.filter((v) => v.lang?.toLowerCase().startsWith(code));
  const local = forLang.filter((v) => !v.online);
  const pick = local.find((v) => v.isDefault) || local[0]
    || (allowOnline ? (forLang.find((v) => v.isDefault) || forLang[0]) : null);
  if (pick) return { id: pick.id, warning: '' };
  // A list without languages (the native engines) cannot tell; no warning then.
  return { id: '', warning: voices.some((v) => v.lang) ? 'noLocalVoice' : '' };
}

/**
 * Player over a list of items.
 * @param {{ engine: object, resolveText: (item) => Promise<string>|string,
 *   onItem?: (item, index) => void, onState?: (state) => void, onError?: (err) => void }} opts
 */
export class ReadAloudPlayer {
  constructor({ engine, resolveText, onItem = null, onState = null, onError = null }) {
    this.engine = engine;
    this.resolveText = resolveText;
    this.onItem = onItem;
    this.onState = onState;
    this.onError = onError;
    this.items = [];
    this.index = 0;
    this.pieces = null;
    this.piece = 0;
    this.state = 'idle';
    this.gen = 0;
    this.voice = null;
    this.rate = 1;
    this._engineUsedPause = false;
  }

  _set(state) {
    this.state = state;
    this.onState?.(state);
  }

  /** Start reading `items` from `start`. Stops anything that was playing. */
  play(items, start = 0) {
    this.stop();
    this.items = items || [];
    this.index = Math.max(0, start);
    this.pieces = null;
    this.piece = 0;
    if (!this.items.length || this.index >= this.items.length) return this._finish();
    this._set('playing');
    return this._loop(++this.gen);
  }

  async _loop(gen) {
    try {
      while (this.index < this.items.length) {
        if (gen !== this.gen) return;
        const item = this.items[this.index];
        if (!this.pieces) {
          const text = await this.resolveText(item);
          if (gen !== this.gen) return;
          this.pieces = splitForSpeech(text);
          this.piece = 0;
          if (this.pieces.length) this.onItem?.(item, this.index);
        }
        while (this.piece < this.pieces.length) {
          await this.engine.speak(this.pieces[this.piece], { voice: this.voice, rate: this.rate });
          if (gen !== this.gen) return;
          this.piece++;
        }
        this.pieces = null;
        this.index++;
      }
      if (gen === this.gen) this._finish();
    } catch (err) {
      if (gen !== this.gen) return;
      this.gen++;
      this._set('idle');
      this.onError?.(err);
    }
  }

  _finish() {
    this.gen++;
    this._set('idle');
  }

  pause() {
    if (this.state !== 'playing') return;
    if (this.engine.canPause) {
      this.engine.pause();
      this._engineUsedPause = true;
    } else {
      this.gen++;
      this._engineUsedPause = false;
      this.engine.stop();
    }
    this._set('paused');
  }

  resume() {
    if (this.state !== 'paused') return;
    this._set('playing');
    if (this._engineUsedPause) {
      this.engine.resume();
      return;
    }
    return this._loop(++this.gen);
  }

  stop() {
    const wasActive = this.state !== 'idle';
    this.gen++;
    this.pieces = null;
    if (wasActive) {
      try { this.engine.stop(); } catch { /* ignore */ }
      this._set('idle');
    }
  }

  setVoice(voice) { this.voice = voice || null; }
  setRate(rate) { this.rate = clampRate(rate); }
}
