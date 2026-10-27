// Speech engines and the read-aloud player (#384).
//
// Engine choice, in this order:
//   1. Web Speech (speechSynthesis in the WebView), when it has voices. On
//      Windows (WebView2) and macOS (WKWebView) this is the OS engine. On
//      Linux, WebKitGTK may expose speechSynthesis without any voice, or not
//      at all; an engine without voices does not count.
//   2. The native engine through Tauri (src-tauri/src/spraak.rs): SAPI via
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

/** Web Speech engine over a speechSynthesis object. */
export function webSpeechEngine(synth, Utterance, voices) {
  let list = voices;
  return {
    kind: 'web',
    canPause: true,
    voices: () => list.map((v) => ({ id: v.voiceURI || v.name, name: v.name, lang: v.lang || '', isDefault: !!v.default })),
    speak(text, { voice = null, rate = 1 } = {}) {
      return new Promise((resolve, reject) => {
        const u = new Utterance(text);
        u.rate = clampRate(rate);
        const chosen = voice ? list.find((v) => (v.voiceURI || v.name) === voice) : null;
        if (chosen) { u.voice = chosen; if (chosen.lang) u.lang = chosen.lang; }
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
    refreshVoices() { list = synth.getVoices?.() || list; },
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
 * @param {{ synth?: object, Utterance?: Function, invoke?: Function,
 *   inTauri?: boolean, platform?: string, voiceWaitMs?: number }} env
 * @returns {Promise<object>} an engine, or { kind: 'none', reason }
 */
export async function chooseSpeechEngine({
  synth = globalThis.speechSynthesis,
  Utterance = globalThis.SpeechSynthesisUtterance,
  invoke = null,
  inTauri = false,
  platform = '',
  voiceWaitMs = 1000,
} = {}) {
  if (synth && typeof synth.speak === 'function' && typeof Utterance === 'function') {
    let voices = [];
    try { voices = synth.getVoices?.() || []; } catch { voices = []; }
    if (!voices.length) voices = await waitForVoices(synth, voiceWaitMs);
    if (voices.length) return webSpeechEngine(synth, Utterance, voices);
  }
  if (inTauri && typeof invoke === 'function') {
    try {
      const info = await invoke('tts_info');
      if (info?.available) return nativeEngine(invoke, info);
    } catch { /* fall through */ }
  }
  return { kind: 'none', reason: /linux/i.test(platform) ? 'noEngineLinux' : 'noEngine' };
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
