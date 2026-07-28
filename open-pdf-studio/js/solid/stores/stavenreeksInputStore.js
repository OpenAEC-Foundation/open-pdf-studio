// Store voor de INLINE invoer van aantal + diameter op een stavenreeks.
//
// Zelfde opzet als textEditOverlayStore.js: een klein signaal-paar dat de
// vanilla-laag (tools/stavenreeks-editing.js) aanstuurt en dat de SolidJS-
// component StavenreeksInlineEditor.jsx rendert. De store houdt GEEN
// annotatie-logica vast — bevestigen en annuleren lopen via de callbacks die
// de vanilla-laag meegeeft.
import { createSignal } from 'solid-js';

const [active, setActive] = createSignal(false);
const [anchor, setAnchor] = createSignal({ left: 0, top: 0 });
const [countValue, setCountValue] = createSignal('');
const [diameterValue, setDiameterValue] = createSignal('');
const [fontSizeValue, setFontSizeValue] = createSignal('');
const [onCommit, setOnCommit] = createSignal(null);
const [onCancel, setOnCancel] = createSignal(null);
// Functie die de schermpositie van het label opnieuw uitrekent. De editor
// roept hem elke frame aan zodat hij meebeweegt met zoom en pan; levert hij
// null, dan is de annotatie weg (verwijderd of ander document) en sluit de
// editor zichzelf.
const [locator, setLocator] = createSignal(null);
// Veld dat bij openen focus krijgt: 'count' (default), 'diameter' of
// 'fontSize' — gezet door de inline getalbewerking (klik op een getal).
const [focusField, setFocusField] = createSignal('count');

export function showStavenreeksInput(opts) {
  const o = opts || {};
  setFocusField(o.focusField === 'diameter' || o.focusField === 'fontSize'
    ? o.focusField : 'count');
  setCountValue(String(o.count ?? ''));
  setDiameterValue(String(o.diameter ?? ''));
  setFontSizeValue(String(o.fontSize ?? ''));
  setAnchor(o.anchor || { left: 0, top: 0 });
  setLocator(() => (typeof o.locate === 'function' ? o.locate : null));
  setOnCommit(() => (typeof o.commit === 'function' ? o.commit : null));
  setOnCancel(() => (typeof o.cancel === 'function' ? o.cancel : null));
  setActive(true);
}

export function hideStavenreeksInput() {
  setActive(false);
  setLocator(() => null);
  setOnCommit(() => null);
  setOnCancel(() => null);
}

/** Is er op dit moment een inline invoer open? */
export function stavenreeksInputActive() {
  return active();
}

export {
  active, anchor, setAnchor,
  countValue, setCountValue,
  diameterValue, setDiameterValue,
  fontSizeValue, setFontSizeValue,
  onCommit, onCancel, locator, focusField,
};
