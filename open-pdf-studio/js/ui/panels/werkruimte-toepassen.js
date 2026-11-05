// Werkruimten in de app (#932): de indeling uit de voorkeuren op de panelen
// zetten, de huidige indeling onder een naam bewaren, wisselen en terug naar
// de standaard. De regels zelf (welke sleutels, opschonen, samenvoegen) staan
// in core/werkruimte.js.

import { state } from '../../core/state.js';
import { DEFAULT_PREFERENCES } from '../../core/constants.js';
import { savePreferences } from '../../core/preferences.js';
import {
  leesLayout, layoutWijzigingen, normaliseerWerkruimten, vindWerkruimte,
  bewaarWerkruimte, verwijderWerkruimte, begrensdeBreedte,
} from '../../core/werkruimte.js';
import { herstelLeftPanel } from '../../solid/stores/leftPanelStore.js';
import { setPanelVisible, herstelPanelCollapsed } from '../../solid/stores/propertiesStore.js';
import { initPaletteOrder } from '../../solid/stores/paletteOrder.js';
import { initToolPalette } from '../../solid/components/ToolPalette.jsx';
import { initSymbolPalette } from '../../solid/stores/symbolStore.js';
import { herlaadExtPalettes } from '../../solid/components/ExtensionToolPalette.jsx';

/** Alleen het linkerpaneel (bij de opstart; de rest heeft een eigen init). */
export function herstelLinkerPaneel() {
  const p = state.preferences || {};
  herstelLeftPanel({
    collapsed: p.leftPanelCollapsed === true,
    tab: p.leftPanelTab,
    breedte: begrensdeBreedte(p.leftPanelWidth, globalThis.innerWidth || 0),
  });
}

/** Alle panelen en paletten volgen de indeling die nu in de voorkeuren staat. */
export function pasHuidigeLayoutToe() {
  const p = state.preferences;
  herstelLinkerPaneel();
  // Een ander tabblad in het linkerpaneel: zijn inhoud bijwerken. Laat
  // geladen, want left-panel.js trekt de renderer mee.
  import('./left-panel.js').then(m => m.refreshActiveTab()).catch(() => {});
  setPanelVisible(p.propertiesPanelVisible !== false);
  herstelPanelCollapsed(p.propertiesPanelCollapsed === true);
  initPaletteOrder();
  initToolPalette();
  initSymbolPalette();
  herlaadExtPalettes();
}

function zetIndeling(layout) {
  const wijzig = layoutWijzigingen(state.preferences, layout, DEFAULT_PREFERENCES);
  for (const [sleutel, waarde] of Object.entries(wijzig)) state.preferences[sleutel] = waarde;
  pasHuidigeLayoutToe();
}

export function werkruimten() {
  return normaliseerWerkruimten(state.preferences?.workspaces);
}

/** Naar een opgeslagen werkruimte wisselen. @returns {boolean} gevonden */
export function kiesWerkruimte(naam) {
  const w = vindWerkruimte(state.preferences?.workspaces, naam);
  if (!w) return false;
  zetIndeling(w.layout);
  state.preferences.activeWorkspace = w.naam;
  savePreferences();
  return true;
}

/** De huidige indeling onder `naam` bewaren. @returns {string|null} de naam zoals bewaard */
export function bewaarHuidigeWerkruimte(naam) {
  const uit = bewaarWerkruimte(state.preferences?.workspaces, naam, leesLayout(state.preferences));
  if (!uit) return null;
  state.preferences.workspaces = uit.lijst;
  state.preferences.activeWorkspace = uit.naam;
  savePreferences();
  return uit.naam;
}

export function verwijderOpgeslagenWerkruimte(naam) {
  state.preferences.workspaces = verwijderWerkruimte(state.preferences?.workspaces, naam);
  const actief = state.preferences.activeWorkspace;
  if (actief && !vindWerkruimte(state.preferences.workspaces, actief)) state.preferences.activeWorkspace = '';
  savePreferences();
}

/** Terug naar de standaardindeling; de opgeslagen werkruimten blijven staan. */
export function herstelStandaardIndeling() {
  zetIndeling(leesLayout(DEFAULT_PREFERENCES));
  state.preferences.activeWorkspace = '';
  savePreferences();
}
