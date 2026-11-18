import { Portal } from 'solid-js/web';
import useDropdown from './useDropdown.js';
import { language } from '../../../i18n/useTranslation.js';
import { toonGetal } from '../../../core/getal-invoer.js';

export default function PrefComboBox(props) {
  const options = props.options || [100, 80, 60, 40, 20];
  const min = props.min ?? 0;
  const max = props.max ?? 100;
  const suffix = props.suffix !== undefined ? props.suffix : '%';

  // Voor het slepen op het veld (ui/getal-slepen.js): de grenzen, de stap
  // (dragStep) en of het veld alleen hele getallen kent. De keuzevelden van
  // het eigenschappenpaneel slaan hele getallen op (punten, procenten,
  // graden), behalve waar een fijnere sleepstap is opgegeven.
  const geheel = props.integer ?? !(props.dragStep < 1);

  const { open, setOpen, dropdownStyle, setWrapperRef, setDropdownRef, toggleDropdown } =
    useDropdown(options.length);

  const isDisabled = () => typeof props.disabled === 'function' ? props.disabled() : !!props.disabled;

  // Het veld is een getalveld (zie ui/getal-veld.js): komma en
  // punt zijn allebei een decimaalteken en e.target.value is de canonieke
  // tekst ("0.5"), of '' zolang er geen getal staat.
  function handleInput(e) {
    if (isDisabled()) return;
    const val = parseFloat(e.target.value);
    if (!isNaN(val)) {
      const clamped = Math.max(min, Math.min(max, val));
      props.setValue(clamped);
      if (clamped !== val) {
        e.target.value = clamped;
      }
    }
  }

  function handleBlur(e) {
    if (isDisabled()) return;
    let val = parseFloat(e.target.value);
    if (isNaN(val)) val = props.fallback ?? 100;
    val = Math.max(min, Math.min(max, val));
    props.setValue(val);
    e.target.value = val;
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      let val = parseFloat(e.target.value);
      if (!isNaN(val)) {
        val = Math.max(min, Math.min(max, val));
        props.setValue(val);
        e.target.value = val;
      }
      setOpen(false);
      e.target.blur();
    }
  }

  function selectOption(val) {
    if (isDisabled()) return;
    props.setValue(val);
    setOpen(false);
  }

  return (
    <div class="pref-combo" classList={{ disabled: isDisabled() }} ref={setWrapperRef}>
      <input
        type="text"
        inputmode="decimal"
        data-getal
        class="pref-combo-input"
        data-min={min}
        data-max={max}
        data-step={props.dragStep}
        data-geheel={geheel ? '' : undefined}
        value={props.value() === 'mixed' ? 'Mixed' : props.value()}
        placeholder={props.value() === 'mixed' ? 'Mixed' : undefined}
        disabled={isDisabled()}
        onInput={handleInput}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        onFocus={(e) => { if (props.value() === 'mixed') e.target.value = ''; }}
      />
      <span class="pref-combo-suffix">{props.value() === 'mixed' ? '' : suffix}</span>
      <button type="button" class="pref-combo-arrow" tabIndex={-1} disabled={isDisabled()} onMouseDown={(e) => toggleDropdown(e, isDisabled())}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M6 9l6 6 6-6"/>
        </svg>
      </button>
      <Portal>
        <div class="pref-combo-dropdown" classList={{ show: open() }}
          style={dropdownStyle()} ref={setDropdownRef}>
          {options.map(opt => (
            <div
              class="pref-combo-option"
              classList={{ selected: props.value() === opt }}
              onMouseDown={() => selectOption(opt)}
            >
              {toonGetal(opt, language())} {suffix}
            </div>
          ))}
        </div>
      </Portal>
    </div>
  );
}
