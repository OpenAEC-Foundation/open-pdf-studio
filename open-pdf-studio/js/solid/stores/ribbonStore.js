import { createSignal, createEffect } from 'solid-js';

const [activeTab, setActiveTab] = createSignal('home');
const [contextualTabsVisible, setContextualTabsVisible] = createSignal(false);
const [colorPickerValue, setColorPickerValue] = createSignal('#ffff00');
const [lineWidthValue, setLineWidthValue] = createSignal(3);
const [currentTheme, setCurrentTheme] = createSignal('dark');

// Fall back to 'home' when contextual tabs hide while a contextual tab is active
createEffect(() => {
  if (!contextualTabsVisible()) {
    const current = activeTab();
    if (current === 'format' || current === 'arrange') {
      setActiveTab('home');
    }
  }
});

export function switchToTab(name) {
  setActiveTab(name);
}

export function getColorPickerValue() {
  return colorPickerValue();
}

export function getLineWidthValue() {
  return lineWidthValue();
}

export {
  activeTab, setActiveTab,
  contextualTabsVisible, setContextualTabsVisible,
  colorPickerValue, setColorPickerValue,
  lineWidthValue, setLineWidthValue,
  currentTheme, setCurrentTheme,
};
