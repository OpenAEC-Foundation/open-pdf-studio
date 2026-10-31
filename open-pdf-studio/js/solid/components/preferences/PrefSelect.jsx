import { Portal } from 'solid-js/web';
import useDropdown from './useDropdown.js';

export default function PrefSelect(props) {
  const { open, setOpen, dropdownStyle, setWrapperRef, setDropdownRef, toggleDropdown } =
    useDropdown(() => props.options.length);

  const isDisabled = () => typeof props.disabled === 'function' ? props.disabled() : !!props.disabled;

  const displayLabel = () => {
    const val = props.value();
    const opt = props.options.find(o => o.value === val);
    return opt ? opt.label : String(val);
  };

  function selectOption(val) {
    if (isDisabled()) return;
    props.setValue(val);
    setOpen(false);
  }

  return (
    <div id={props.id} class="pref-combo" classList={{ disabled: isDisabled() }} style={props.style} ref={setWrapperRef}>
      <span class="pref-select-display" onMouseDown={(e) => toggleDropdown(e, isDisabled())}>{displayLabel()}</span>
      <button type="button" class="pref-combo-arrow" tabIndex={-1} disabled={isDisabled()} onMouseDown={(e) => toggleDropdown(e, isDisabled())}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M6 9l6 6 6-6"/>
        </svg>
      </button>
      <Portal>
        <div class="pref-combo-dropdown" classList={{ show: open() }}
          style={dropdownStyle()} ref={setDropdownRef}>
          {props.options.map(opt => (
            <div
              class="pref-combo-option"
              classList={{ selected: props.value() === opt.value }}
              onMouseDown={() => selectOption(opt.value)}
            >
              {opt.label}
            </div>
          ))}
        </div>
      </Portal>
    </div>
  );
}
