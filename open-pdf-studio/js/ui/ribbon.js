import { ribbonTabs, ribbonContents } from './dom-elements.js';

// Initialize ribbon tab switching
export function initRibbon() {
  ribbonTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const tabName = tab.dataset.tab;

      // Update active tab
      ribbonTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      // Update active content
      ribbonContents.forEach(content => {
        content.classList.remove('active');
        if (content.id === `tab-${tabName}`) {
          content.classList.add('active');
        }
      });
    });
  });
}

// Switch to a specific ribbon tab
export function switchToTab(tabName) {
  const tab = document.querySelector(`.ribbon-tab[data-tab="${tabName}"]`);
  if (tab) {
    tab.click();
  }
}
