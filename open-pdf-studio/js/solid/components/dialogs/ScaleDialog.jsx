import { createSignal, onMount } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog } from '../../stores/dialogStore.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { setScaleFromLine } from '../../../annotations/measurement.js';
import { leesGetalMetEenheid } from '../../../core/getal-invoer.js';
import { leesVoetInchMaat, lijktOpVoetInch, isImperialeLengte } from '../../../core/voet-inch.js';

const UNIT_ALIASES = {
  mm: 'mm', millimeter: 'mm', millimeters: 'mm', millimetre: 'mm', millimetres: 'mm',
  cm: 'cm', centimeter: 'cm', centimeters: 'cm', centimetre: 'cm', centimetres: 'cm',
  m: 'm', meter: 'm', meters: 'm', metre: 'm', metres: 'm',
  km: 'km', kilometer: 'km', kilometers: 'km', kilometre: 'km', kilometres: 'km',
  in: 'in', inch: 'in', inches: 'in', '"': 'in',
  ft: 'ft', foot: 'ft', feet: 'ft', "'": 'ft',
  yd: 'yd', yard: 'yd', yards: 'yd',
  mi: 'mi', mile: 'mi', miles: 'mi',
  px: 'px', pixel: 'px', pixels: 'px',
};

function parseValueAndUnit(input, fallbackUnit) {
  const trimmed = (input || '').trim();
  if (!trimmed) return null;

  // Voet en inch samen: 12'-6 3/8", 6 3/8", 12' 6" (#1145). De maat draagt
  // haar eigen eenheid: voet als er een voetdeel staat, anders inch. Wat op
  // voet-inch lijkt maar het niet is, wordt geweigerd in plaats van geraden.
  if (lijktOpVoetInch(trimmed)) {
    const maat = leesVoetInchMaat(trimmed);
    return maat && maat.waarde > 0 ? { value: maat.waarde, unit: maat.eenheid } : null;
  }

  // Komma en punt zijn allebei een decimaalteken: "2,5 m" = "2.5 m".
  const match = leesGetalMetEenheid(trimmed);
  if (!match) {
    // "12 ft 6 in" is ook een voet-inchmaat.
    const maat = leesVoetInchMaat(trimmed);
    return maat && maat.waarde > 0 ? { value: maat.waarde, unit: maat.eenheid } : null;
  }

  const value = match.waarde;
  if (!value || value <= 0 || !isFinite(value)) return null;

  const rawUnit = match.eenheid.toLowerCase();
  const unit = rawUnit ? (UNIT_ALIASES[rawUnit] || rawUnit) : fallbackUnit;

  return { value, unit };
}

export default function ScaleDialog(props) {
  const { t } = useTranslation('dialogs');
  const [input, setInput] = createSignal('');
  const [error, setError] = createSignal('');

  let inputRef;

  const pixelLength = () => props.data?.pixelLength || 0;
  const currentText = () => props.data?.currentText || '';
  const currentUnit = () => props.data?.currentUnit || 'mm';
  const annotation = () => props.data?.annotation || null;

  onMount(() => {
    setTimeout(() => inputRef?.focus(), 50);
  });

  const close = () => closeDialog('scale');

  function handleOk() {
    const parsed = parseValueAndUnit(input(), currentUnit());
    if (!parsed) {
      setError(t('scale.invalidInput'));
      return;
    }

    const px = pixelLength();
    if (px <= 0) {
      setError(t('scale.invalidLine'));
      return;
    }

    setScaleFromLine(px, parsed.value, parsed.unit, annotation());
    close();
  }

  function onKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleOk();
    }
  }

  const footer = (
    <div class="scale-dialog-footer">
      <button class="scale-btn scale-btn-ok" disabled={!input().trim()} onClick={handleOk}>
        {t('scale.ok')}
      </button>
      <button class="scale-btn" onClick={close}>
        {t('scale.cancel')}
      </button>
    </div>
  );

  return (
    <Dialog
      title={t('scale.title')}
      dialogClass="scale-dialog"
      onClose={close}
      footer={footer}
    >
      <div class="scale-dialog-body">
        <div class="scale-current-value">
          {t('scale.currentValue')}: <strong>{currentText()}</strong>
        </div>

        <label class="scale-input-label">{t('scale.enterValue')}</label>
        <input
          ref={inputRef}
          type="text"
          class="scale-input"
          placeholder={t('scale.placeholder')}
          title={isImperialeLengte(currentUnit()) ? t('calibration.feetInchHint') : undefined}
          value={input()}
          onInput={(e) => { setInput(e.target.value); setError(''); }}
          onKeyDown={onKeyDown}
        />
        <div class="scale-hint">{t('scale.hint')}</div>

        {error() && <div class="scale-error">{error()}</div>}
      </div>
    </Dialog>
  );
}
