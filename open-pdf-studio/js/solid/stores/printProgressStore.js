// Non-modal print progress. The print dialog closes the moment the user
// clicks "Afdrukken"; the actual render + spool runs in the background
// (pdf/print-job.js) and drives the floating progress bar through these
// signals, so the user keeps working meanwhile.

import { createSignal } from 'solid-js';
import i18next from '../../i18n/config.js';

const [active, setActive] = createSignal(false);
const [label, setLabel] = createSignal('');
const [value, setValue] = createSignal(0);     // 0..1
const [isError, setIsError] = createSignal(false);
// Optional button on the finished toast: { label, uitvoeren } ("Open" after
// "Save as PDF"); null = none.
const [actie, setActie] = createSignal(null);
// Only the last finish/fail may hide the toast: a new job that starts while
// the previous toast is still fading must not be closed by that old timer.
let sluitBeurt = 0;

export {
  active as printProgressActive,
  label as printProgressLabel,
  value as printProgressValue,
  isError as printProgressError,
  actie as printProgressActie,
};

export function startPrintProgress(l) {
  sluitBeurt += 1;
  setIsError(false);
  setActie(null);
  setLabel(l || '');
  setValue(0);
  setActive(true);
}

/** Close the toast now (the button on the toast does this after its action). */
export function sluitPrintProgress() {
  sluitBeurt += 1;
  setActive(false);
  setActie(null);
  setIsError(false);
}

export function updatePrintProgress(l, v) {
  if (l != null) setLabel(l);
  if (v != null) setValue(Math.max(0, Math.min(1, v)));
}

/**
 * @param {string} l
 * @param {{ actie?: {label:string, uitvoeren:() => void}|null, duur?: number }} [opties]
 *   actie: a button on the finished toast; duur: how long the toast stays (ms).
 */
export function finishPrintProgress(l, { actie: knop = null, duur = 1800 } = {}) {
  const beurt = ++sluitBeurt;
  setLabel(l || '');
  setValue(1);
  setActie(knop);
  setTimeout(() => { if (beurt === sluitBeurt) sluitPrintProgress(); }, duur);
}

export function failPrintProgress(msg) {
  const beurt = ++sluitBeurt;
  setIsError(true);
  setActie(null);
  setLabel(msg || i18next.t('print.progress.failedGeneric', { ns: 'dialogs' }));
  setValue(1);
  setTimeout(() => { if (beurt === sluitBeurt) sluitPrintProgress(); }, 6000);
}
