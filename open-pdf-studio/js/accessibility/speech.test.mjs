// Read aloud (#384): choosing the speech engine (Web Speech, the native
// fallback through Tauri, or none) and the player (order, pause, resume,
// stop) with a mocked speechSynthesis.

import assert from 'node:assert/strict';
import test from 'node:test';
import { chooseSpeechEngine, ReadAloudPlayer, clampRate } from './speech.js';

class FakeUtterance {
  constructor(text) { this.text = text; }
}

/** A speechSynthesis mock: utterances end when `finish()` is called. */
function fakeSynth({ voices = [{ name: 'Anna', voiceURI: 'anna', lang: 'de-DE', default: true }], lateVoices = null } = {}) {
  const listeners = {};
  const synth = {
    spoken: [],
    current: null,
    paused: false,
    getVoices: () => synth._voices,
    _voices: voices,
    addEventListener: (n, fn) => { listeners[n] = fn; },
    removeEventListener: (n) => { delete listeners[n]; },
    speak(u) { synth.spoken.push(u); synth.current = u; },
    pause() { synth.paused = true; },
    resume() { synth.paused = false; },
    cancel() { const u = synth.current; synth.current = null; u?.onerror?.({ error: 'interrupted' }); },
    finish() { const u = synth.current; synth.current = null; u?.onend?.(); },
    fail(error) { const u = synth.current; synth.current = null; u?.onerror?.({ error }); },
  };
  if (lateVoices) setTimeout(() => { synth._voices = lateVoices; listeners.voiceschanged?.(); }, 5);
  return synth;
}

const tick = () => new Promise((r) => setTimeout(r, 0));
async function until(cond, n = 2000) { for (let i = 0; i < n && !cond(); i++) await tick(); assert.ok(cond(), 'condition reached'); }

test('Web Speech with voices is chosen first', async () => {
  const invoked = [];
  const eng = await chooseSpeechEngine({ synth: fakeSynth(), Utterance: FakeUtterance, invoke: async (c) => { invoked.push(c); }, inTauri: true });
  assert.equal(eng.kind, 'web');
  assert.deepEqual(eng.voices(), [{ id: 'anna', name: 'Anna', lang: 'de-DE', isDefault: true }]);
  assert.deepEqual(invoked, [], 'no native call when the WebView can speak');
});

test('voices that arrive late (voiceschanged) still count', async () => {
  const synth = fakeSynth({ voices: [], lateVoices: [{ name: 'Late', voiceURI: 'late', lang: 'en' }] });
  // The wait is an upper bound: voiceschanged ends it as soon as voices arrive.
  const eng = await chooseSpeechEngine({ synth, Utterance: FakeUtterance, voiceWaitMs: 60000 });
  assert.equal(eng.kind, 'web');
  assert.equal(eng.voices()[0].id, 'late');
});

test('speechSynthesis without voices (WebKitGTK) falls back to the native engine', async () => {
  const calls = [];
  const invoke = async (cmd, args) => {
    calls.push([cmd, args]);
    if (cmd === 'tts_info') return { available: true, engine: 'espeak-ng', voices: ['en', 'nl'] };
    return undefined;
  };
  const eng = await chooseSpeechEngine({ synth: fakeSynth({ voices: [] }), Utterance: FakeUtterance, invoke, inTauri: true, voiceWaitMs: 10 });
  assert.equal(eng.kind, 'native');
  assert.equal(eng.engine, 'espeak-ng');
  assert.equal(eng.canPause, false);
  assert.deepEqual(eng.voices().map((v) => v.id), ['en', 'nl']);
  await eng.speak('Hallo', { voice: 'nl', rate: 5 });
  assert.deepEqual(calls.at(-1), ['tts_speak', { text: 'Hallo', voice: 'nl', rate: 2 }], 'rate is clamped');
});

test('no speechSynthesis at all also falls back to native', async () => {
  const eng = await chooseSpeechEngine({ synth: undefined, Utterance: undefined, inTauri: true,
    invoke: async () => ({ available: true, engine: 'sapi', voices: [] }) });
  assert.equal(eng.kind, 'native');
});

test('no engine anywhere: a reason, with the Linux hint on Linux', async () => {
  const none = await chooseSpeechEngine({ synth: fakeSynth({ voices: [] }), Utterance: FakeUtterance, inTauri: true, voiceWaitMs: 5,
    invoke: async () => ({ available: false, engine: null, voices: [] }), platform: 'Mozilla/5.0 (X11; Linux x86_64)' });
  assert.deepEqual(none, { kind: 'none', reason: 'noEngineLinux' });
  const web = await chooseSpeechEngine({ synth: undefined, Utterance: undefined, inTauri: false, platform: 'Windows' });
  assert.deepEqual(web, { kind: 'none', reason: 'noEngine' });
  const broken = await chooseSpeechEngine({ synth: undefined, inTauri: true, invoke: async () => { throw new Error('x'); } });
  assert.equal(broken.kind, 'none');
});

test('clampRate keeps the rate between 0.5 and 2', () => {
  assert.equal(clampRate(1.25), 1.25);
  assert.equal(clampRate(0.1), 0.5);
  assert.equal(clampRate(9), 2);
  assert.equal(clampRate('x'), 1);
});

test('the player reads items in order with voice and rate; empty items are skipped', async () => {
  const synth = fakeSynth();
  const eng = await chooseSpeechEngine({ synth, Utterance: FakeUtterance });
  const seen = [];
  const states = [];
  const p = new ReadAloudPlayer({ engine: eng, resolveText: async (it) => it.text, onItem: (it) => seen.push(it.id), onState: (s) => states.push(s) });
  p.setVoice('anna');
  p.setRate(1.5);
  const done = p.play([{ id: 1, text: 'One.' }, { id: 2, text: '' }, { id: 3, text: 'Three.' }]);
  await until(() => synth.current);
  assert.equal(synth.current.text, 'One.');
  assert.equal(synth.current.rate, 1.5);
  assert.equal(synth.current.voice.name, 'Anna');
  synth.finish();
  await until(() => synth.current);
  assert.equal(synth.current.text, 'Three.');
  synth.finish();
  await done;
  assert.deepEqual(seen, [1, 3]);
  assert.equal(p.state, 'idle');
  assert.deepEqual(states, ['playing', 'idle']);
});

test('web pause and resume use the engine; stop cancels', async () => {
  const synth = fakeSynth();
  const eng = await chooseSpeechEngine({ synth, Utterance: FakeUtterance });
  const p = new ReadAloudPlayer({ engine: eng, resolveText: (it) => it });
  p.play(['First.', 'Second.']);
  await until(() => synth.current);
  p.pause();
  assert.equal(synth.paused, true);
  assert.equal(p.state, 'paused');
  p.resume();
  assert.equal(synth.paused, false);
  assert.equal(p.state, 'playing');
  p.stop();
  assert.equal(p.state, 'idle');
  await tick();
  assert.equal(synth.spoken.length, 1, 'nothing more after stop');
});

test('native pause stops the process and resume restarts the same piece', async () => {
  const spoken = [];
  let release = null;
  const eng = {
    kind: 'native', canPause: false,
    speak: (text) => new Promise((resolve) => { spoken.push(text); release = resolve; }),
    stop: () => { release?.(); },
    pause() {}, resume() {},
  };
  const p = new ReadAloudPlayer({ engine: eng, resolveText: (it) => it });
  p.play(['Alpha.', 'Beta.']);
  await until(() => spoken.length === 1);
  p.pause();
  await tick();
  assert.equal(p.state, 'paused');
  assert.deepEqual(spoken, ['Alpha.'], 'stopping the engine does not advance');
  p.resume();
  await until(() => spoken.length === 2);
  assert.deepEqual(spoken, ['Alpha.', 'Alpha.'], 'resume starts the interrupted piece again');
  release();
  await until(() => spoken.length === 3);
  assert.equal(spoken[2], 'Beta.');
  release();
  await until(() => p.state === 'idle');
});

test('an engine error stops the player and is reported', async () => {
  const synth = fakeSynth();
  const eng = await chooseSpeechEngine({ synth, Utterance: FakeUtterance });
  let error = null;
  const p = new ReadAloudPlayer({ engine: eng, resolveText: (it) => it, onError: (e) => { error = e; } });
  const done = p.play(['A.', 'B.']);
  await until(() => synth.current);
  synth.fail('synthesis-failed');
  await done;
  assert.equal(p.state, 'idle');
  assert.match(error.message, /synthesis-failed/);
  assert.equal(synth.spoken.length, 1);
});
