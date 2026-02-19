import { createSignal } from 'solid-js';

const [activeTab, setActiveTab] = createSignal('thumbnails');
const [collapsed, setCollapsed] = createSignal(false);

export function switchToLeftPanelTab(panelId) {
  setActiveTab(panelId);
  if (collapsed()) {
    setCollapsed(false);
  }
}

export function toggleLeftPanelCollapsed() {
  setCollapsed(prev => !prev);
}

export {
  activeTab, setActiveTab,
  collapsed, setCollapsed
};
