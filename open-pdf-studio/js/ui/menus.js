import { state } from '../core/state.js';
import { menuItems, menuDropdowns } from './dom-elements.js';

// Toggle menu visibility
export function toggleMenu(menuName) {
  const menuItem = document.querySelector(`[data-menu="${menuName}"]`);
  const dropdown = document.getElementById(`menu-${menuName}`);

  if (state.activeMenu === menuName) {
    closeAllMenus();
    return;
  }

  closeAllMenus();
  state.activeMenu = menuName;
  if (menuItem) menuItem.classList.add('active');
  if (dropdown) dropdown.classList.add('visible');
}

// Close all menus
export function closeAllMenus() {
  menuItems.forEach(item => item.classList.remove('active'));
  menuDropdowns.forEach(dropdown => dropdown.classList.remove('visible'));
  state.activeMenu = null;
}

// Initialize menu system
export function initMenus() {
  // Menu item click handlers
  menuItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      const menuName = item.dataset.menu;
      toggleMenu(menuName);
    });

    // Close menu when mouse leaves the menu item
    item.addEventListener('mouseleave', (e) => {
      // Small delay to allow moving to dropdown
      setTimeout(() => {
        const menuName = item.dataset.menu;
        const dropdown = document.getElementById(`menu-${menuName}`);
        // Check if mouse is not over the dropdown
        if (dropdown && !dropdown.matches(':hover') && !item.matches(':hover')) {
          closeAllMenus();
        }
      }, 100);
    });
  });

  // Close menus when mouse leaves the dropdown
  menuDropdowns.forEach(dropdown => {
    dropdown.addEventListener('mouseleave', (e) => {
      // Small delay to allow moving back to menu item
      setTimeout(() => {
        const menuItem = dropdown.closest('.menu-item') ||
                         document.querySelector(`[data-menu="${dropdown.id.replace('menu-', '')}"]`);
        if (!dropdown.matches(':hover') && (!menuItem || !menuItem.matches(':hover'))) {
          closeAllMenus();
        }
      }, 100);
    });
  });

  // Close menus when clicking outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.menu-item') && !e.target.closest('.menu-dropdown')) {
      closeAllMenus();
    }
  });
}
