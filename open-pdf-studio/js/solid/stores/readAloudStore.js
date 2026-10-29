import { createSignal } from 'solid-js';

// Read aloud (#384): the bar under the ribbon while reading.
const [visible, setVisible] = createSignal(false);
// 'idle' | 'loading' | 'playing' | 'paused'
const [status, setStatus] = createSignal('idle');
const [voices, setVoices] = createSignal([]);
const [voice, setVoice] = createSignal('');
const [rate, setRate] = createSignal(1);
const [engineKind, setEngineKind] = createSignal('');
// i18n key under readAloud.* for a message in the bar, or ''.
const [messageKey, setMessageKey] = createSignal('');
const [readingPage, setReadingPage] = createSignal(0);
// Online voices (text goes to an online speech service): only after opting
// in. onlineVoices is how many the browser offers, so the opt-in is only shown
// when there is something to opt in to.
const [allowOnline, setAllowOnline] = createSignal(false);
const [onlineVoices, setOnlineVoices] = createSignal(0);

export {
  allowOnline, setAllowOnline,
  onlineVoices, setOnlineVoices,
  visible, setVisible,
  status, setStatus,
  voices, setVoices,
  voice, setVoice,
  rate, setRate,
  engineKind, setEngineKind,
  messageKey, setMessageKey,
  readingPage, setReadingPage,
};
