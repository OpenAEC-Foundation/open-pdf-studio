import { createSignal } from 'solid-js';
import { bewaarLayoutVoorkeur } from '../../core/layout-voorkeur.js';

const [activeTab, setActiveTabRaw] = createSignal('thumbnails');
const [collapsed, setCollapsedRaw] = createSignal(false);

// Tab en ingeklapt-stand blijven over een herstart bewaard (#932).
function setActiveTab(panelId) {
  setActiveTabRaw(panelId);
  bewaarLayoutVoorkeur('leftPanelTab', panelId);
}

function setCollapsed(value) {
  setCollapsedRaw(!!value);
  bewaarLayoutVoorkeur('leftPanelCollapsed', !!value);
}

export function switchToLeftPanelTab(panelId) {
  setActiveTab(panelId);
  if (collapsed()) {
    zetIngeklapt(false);
  }
}

export function toggleLeftPanelCollapsed() {
  zetIngeklapt(!collapsed());
}

// Inklappen/uitklappen inclusief de breedte die de sleepgreep inline zette:
// die moet weg bij inklappen (anders wint hij van .collapsed) en terug bij
// uitklappen.
function zetIngeklapt(willCollapse) {
  setCollapsed(willCollapse);
  const panel = typeof document !== 'undefined' ? document.getElementById('left-panel') : null;
  if (panel) {
    if (willCollapse) {
      if (panel.style.width) panel.dataset.prevWidth = panel.style.width;
      panel.style.width = '';
    } else if (panel.dataset.prevWidth) {
      panel.style.width = panel.dataset.prevWidth;
    }
  }
}

/**
 * Indeling uit de voorkeuren op het paneel zetten (opstart, werkruimte
 * wisselen). `breedte` null = de breedte uit het stijlblad.
 */
export function herstelLeftPanel({ collapsed: ingeklapt, tab, breedte }) {
  if (typeof tab === 'string' && tab) setActiveTabRaw(tab);
  setCollapsedRaw(!!ingeklapt);
  const panel = typeof document !== 'undefined' ? document.getElementById('left-panel') : null;
  if (!panel) return;
  const px = typeof breedte === 'number' && breedte > 0 ? `${Math.round(breedte)}px` : '';
  if (ingeklapt) {
    panel.style.width = '';
    if (px) panel.dataset.prevWidth = px; else delete panel.dataset.prevWidth;
  } else {
    panel.style.width = px;
    delete panel.dataset.prevWidth;
  }
}

export {
  activeTab, setActiveTab,
  collapsed, setCollapsed
};
