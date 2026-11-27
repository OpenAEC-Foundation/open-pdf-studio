// Versleepbare breedte van het eigenschappenpaneel en het symbolenpalet
// (aangedokt links of rechts, of zwevend), net als het linkerpaneel.
//
// De breedte staat in de voorkeuren (propertiesPanelWidth,
// symbolPaletteWidth; null = de breedte uit het stijlblad) en hoort bij de
// werkruimte (core/werkruimte.js). Op het scherm is het een CSS-variabele op
// <html>, zodat het stijlblad hem gebruikt voor het paneel en zijn inhoud.
// Dubbelklik op de greep zet de breedte terug.

import { state } from '../../core/state.js';
import { bewaarLayoutVoorkeur } from '../../core/layout-voorkeur.js';
import { PANEEL_MIN } from '../../core/werkruimte.js';
import { maxPaneelBreedte } from './miniatuur-maat.js';

export const PANEEL_BREEDTES = Object.freeze({
  propertiesPanelWidth: Object.freeze({ cssVar: '--properties-panel-width' }),
  symbolPaletteWidth: Object.freeze({ cssVar: '--symbol-palette-width' }),
});

/** Breedte binnen de grenzen (smalst PANEEL_MIN, breedst 60 % van het venster), of null. */
export function begrensPaneelBreedte(breedte, vensterBreedte) {
  if (typeof breedte !== 'number' || !Number.isFinite(breedte)) return null;
  return Math.max(PANEEL_MIN, Math.min(maxPaneelBreedte(vensterBreedte), Math.round(breedte)));
}

/**
 * Nieuwe breedte tijdens het slepen. `kant` is de rand waar de greep zit:
 * 'links' (paneel rechts in beeld, naar links slepen = breder) of 'rechts'.
 */
export function gesleepteBreedte(startBreedte, startX, x, kant, vensterBreedte, rtl = false) {
  let delta = x - startX;
  if (kant === 'links') delta = -delta;
  if (rtl) delta = -delta;
  return begrensPaneelBreedte(startBreedte + delta, vensterBreedte);
}

function root() {
  return typeof document !== 'undefined' ? document.documentElement : null;
}

/** De breedte op het scherm zetten (null = terug naar het stijlblad). */
export function zetPaneelBreedte(sleutel, breedte) {
  const def = PANEEL_BREEDTES[sleutel];
  const el = root();
  if (!def || !el) return;
  if (breedte === null || breedte === undefined) el.style.removeProperty(def.cssVar);
  else el.style.setProperty(def.cssVar, `${breedte}px`);
}

/** Alle bewaarde breedtes toepassen (opstart, werkruimte gewisseld). */
export function herstelPaneelBreedtes() {
  const voorkeuren = state.preferences || {};
  const venster = globalThis.innerWidth || 0;
  for (const sleutel of Object.keys(PANEEL_BREEDTES)) {
    zetPaneelBreedte(sleutel, begrensPaneelBreedte(voorkeuren[sleutel], venster));
  }
}

/**
 * mousedown op een greep: slepen tot de muis loskomt, dan bewaren.
 * @param {MouseEvent} e
 * @param {{ sleutel: string, kant: 'links'|'rechts', paneel: HTMLElement }} opties
 */
export function startPaneelSlepen(e, { sleutel, kant, paneel }) {
  if (e.button !== 0 || !paneel || !PANEEL_BREEDTES[sleutel]) return;
  e.preventDefault();
  e.stopPropagation();
  const startX = e.clientX;
  const startBreedte = paneel.getBoundingClientRect().width;
  const rtl = document.documentElement.dir === 'rtl' && !paneel.classList.contains('sp-float');
  const greep = e.currentTarget;
  greep?.classList?.add('dragging');
  document.body.style.userSelect = 'none';
  let laatste = null;
  const verplaats = (ev) => {
    laatste = gesleepteBreedte(startBreedte, startX, ev.clientX, kant, window.innerWidth, rtl);
    zetPaneelBreedte(sleutel, laatste);
  };
  const los = () => {
    greep?.classList?.remove('dragging');
    document.body.style.userSelect = '';
    document.removeEventListener('mousemove', verplaats);
    document.removeEventListener('mouseup', los);
    if (laatste !== null) bewaarLayoutVoorkeur(sleutel, laatste);
  };
  document.addEventListener('mousemove', verplaats);
  document.addEventListener('mouseup', los);
}

/** Dubbelklik op een greep: terug naar de breedte uit het stijlblad. */
export function herstelStandaardBreedte(sleutel) {
  zetPaneelBreedte(sleutel, null);
  bewaarLayoutVoorkeur(sleutel, null);
}
