// Key sequences: two or three letters typed one after the other, like the
// command aliases of CAD programs ("D L" = Line). They live in the same
// registry as the other shortcuts (binding.js: canonical form "D L"), can be
// changed under Preferences > Keyboard Shortcuts, and are recognised here
// letter by letter, together with the built-in command-line chords of
// keyboard-handlers.js ("TR" trim, "CO" copy, ...).
//
// How a letter is handled (createSequenceMatcher):
//   - it completes a sequence and no longer sequence starts with these
//     letters: that command runs at once;
//   - it starts or continues a longer sequence: the app waits for the next
//     letter (at most `timeoutMs`, about a second);
//   - the wait runs out: the letters typed so far run their own command, if
//     they have one (a single letter that also has a shortcut of its own);
//   - another key breaks the sequence: the letters typed so far run their own
//     command, if any, and the new letter is handled on its own.
//
// Choice for a letter that is both a single-key shortcut and the start of a
// sequence (D bound to a command while "D L" exists): the single key waits for
// the timeout (or the next letter) before it runs, so both stay reachable.
// No default single-letter key starts a default sequence (D is free), so out
// of the box nothing waits that did not wait before.
//
// The keyboard handling only calls the matcher outside text fields, without
// Ctrl/Alt/Meta and not during a move or type-in-a-length session.
//
// Pure module: no DOM, no app state. Timers are passed in for the tests.

import { isSequence, sequenceKeys } from './binding.js';

export const SEQUENCE_TIMEOUT_MS = 1200;

/**
 * The sequences in the registry, as a table for the matcher:
 * Map<lower-case letters, command id>, e.g. 'dl' -> 'tool.line'. A single
 * letter that starts a sequence and has a shortcut of its own is in it too
 * ('d' -> its command), so it runs when no second letter follows.
 */
export function sequenceCommandTable(registry) {
  const tabel = new Map();
  if (!registry) return tabel;
  for (const command of registry.commands()) {
    for (const combo of registry.bindingsOf(command.id)) {
      if (isSequence(combo)) tabel.set(sequenceKeys(combo).join('').toLowerCase(), command.id);
    }
  }
  for (const reeks of [...tabel.keys()]) {
    const letter = reeks[0];
    if (tabel.has(letter)) continue;
    const eigenaar = registry.ownerOf(letter.toUpperCase());
    if (eigenaar) tabel.set(letter, eigenaar);
  }
  return tabel;
}

/** Does a letter (or letters) start a longer entry of the table? */
export function startsLonger(tabel, letters) {
  for (const k of tabel.keys()) if (k.length > letters.length && k.startsWith(letters)) return true;
  return false;
}

/**
 * The matcher. `key(letter, table)` handles one letter with the table of the
 * moment (Map<letters, action function>) and returns true when the letter was
 * used for a sequence (the caller then does nothing else with it).
 */
export function createSequenceMatcher({
  timeoutMs = SEQUENCE_TIMEOUT_MS,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
} = {}) {
  let buffer = '';
  let tabel = null;
  let timer = null;

  const stopTimer = () => { if (timer !== null) { clearTimer(timer); timer = null; } };
  const reset = () => { buffer = ''; tabel = null; stopTimer(); };
  const voer = (fn) => { if (typeof fn === 'function') { try { fn(); } catch { /* a command must not break the keys */ } } };

  function key(letter, nieuweTabel) {
    if (typeof letter !== 'string' || !/^[a-z]$/i.test(letter) || !(nieuweTabel instanceof Map)) return false;
    const volgende = buffer + letter.toLowerCase();
    const langer = startsLonger(nieuweTabel, volgende);
    const precies = nieuweTabel.get(volgende);

    if (precies && !langer) {
      reset();
      voer(precies);
      return true;
    }
    if (langer) {
      buffer = volgende;
      tabel = nieuweTabel;
      stopTimer();
      timer = setTimer(() => {
        timer = null;
        const fn = tabel?.get(buffer);
        buffer = '';
        tabel = null;
        voer(fn);
      }, timeoutMs);
      return true;
    }
    if (buffer) {
      // The letter breaks the sequence: what was typed runs (if it is a
      // command), then the letter counts on its own.
      const wachtend = (tabel || nieuweTabel).get(buffer);
      reset();
      voer(wachtend);
      return key(letter, nieuweTabel);
    }
    return false;
  }

  return {
    key,
    /** Forget the letters typed so far without running anything (Escape). */
    cancel: reset,
    /** The letters typed so far ('' when nothing waits). */
    pending: () => buffer,
  };
}
