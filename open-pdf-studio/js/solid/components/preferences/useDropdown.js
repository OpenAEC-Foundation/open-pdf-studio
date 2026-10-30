import { createSignal, onCleanup } from 'solid-js';

export default function useDropdown(optionCount) {
  const [open, setOpen] = createSignal(false);
  const [dropdownStyle, setDropdownStyle] = createSignal({});
  let wrapperRef;
  let dropdownRef;

  function handleDocClick(e) {
    if (wrapperRef && !wrapperRef.contains(e.target) &&
        dropdownRef && !dropdownRef.contains(e.target)) {
      setOpen(false);
    }
  }

  document.addEventListener('mousedown', handleDocClick);
  onCleanup(() => document.removeEventListener('mousedown', handleDocClick));

  function positionDropdown() {
    if (!wrapperRef) return;
    const rect = wrapperRef.getBoundingClientRect();
    const count = typeof optionCount === 'function' ? optionCount() : optionCount;
    const scale = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-scale')) || 1;
    const dropdownHeight = (count * 24 + 4) * scale;
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUpward = spaceBelow < dropdownHeight && rect.top > spaceBelow;
    const width = Math.min(rect.width + 2, window.innerWidth - 8);
    const style = {
      position: 'fixed',
      left: Math.max(4, Math.min(rect.left - 1, window.innerWidth - width - 4)) + 'px',
      width: width + 'px',
    };
    if (openUpward) {
      style.bottom = (window.innerHeight - rect.top) + 'px';
      style['max-height'] = Math.max(0, rect.top - 4) + 'px';
    } else {
      style.top = rect.bottom + 'px';
      style['max-height'] = Math.max(0, spaceBelow - 4) + 'px';
    }
    setDropdownStyle(style);
  }

  function toggleDropdown(e, disabled) {
    e.preventDefault();
    if (disabled) return;
    const willOpen = !open();
    if (willOpen) positionDropdown();
    setOpen(willOpen);
    if (willOpen && dropdownRef) {
      requestAnimationFrame(() => {
        const sel = dropdownRef.querySelector('.selected');
        if (sel) sel.scrollIntoView({ block: 'nearest' });
      });
    }
  }

  return {
    open, setOpen, dropdownStyle,
    setWrapperRef: (el) => { wrapperRef = el; },
    setDropdownRef: (el) => { dropdownRef = el; },
    toggleDropdown,
  };
}
