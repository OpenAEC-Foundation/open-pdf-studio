import { createRenderEffect } from 'solid-js';
import { autoShrinkLabel } from './autoShrinkLabel.js';
import { isTauri } from '../../../core/platform.js';
import { knopUit, meldingTekst } from '../../../core/webfuncties.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { knopTitel } from '../../stores/keybindingStore.js';

export default function RibbonButton(props) {
  const { t } = useTranslation('common');
  // Knoppen achter een Rust-opdracht (OCR, CAD, handtekeningen, comprimeren,
  // IFC, plug-ins, de bijwerker) hebben in de webversie geen equivalent. Ze
  // stonden daar aan en deden niets; nu staan ze uit en draagt de tooltip
  // dezelfde melding als overal. Eén tabel: js/core/webfuncties.js (#456).
  // Als gast geldt hetzelfde voor diensten op een andere host (#548).
  const geenWebvariant = () => knopUit(props.id, { inTauri: isTauri() });
  // De tooltip toont de huidige sneltoets van de knop (#714), niet een
  // toets die in de vertaling staat.
  const titel = () => (geenWebvariant()
    ? meldingTekst(t, props.label || props.title || props.id)
    : knopTitel({ id: props.id, extCommand: props.extCommand, title: props.title, label: props.label }));

  return (
    <button
      class={`ribbon-btn${props.size === 'small' ? ' small' : ''}${props.size === 'medium' ? ' medium' : ''}${props.active ? ' active' : ''}${props.iconOnly ? ' icon-only' : ''}${props.extraClass ? ' ' + props.extraClass : ''}`}
      id={props.id}
      data-ext-command={props.extCommand}
      aria-pressed={props.pressed}
      title={titel()}
      disabled={props.disabled || geenWebvariant()}
      onClick={props.onClick}
      style={props.style}
    >
      {/* Het pictogram volgt de prop: een extensie kan het via update() wisselen (#551). */}
      <div class="ribbon-btn-icon" style={props.iconStyle} ref={el => createRenderEffect(() => { if (props.icon || el.innerHTML) el.innerHTML = props.icon || ''; })}>
      </div>
      {!props.iconOnly && (
        <span class="ribbon-btn-label" ref={el => autoShrinkLabel(el)}>{props.label}</span>
      )}
    </button>
  );
}
