import { autoShrinkLabel } from './autoShrinkLabel.js';
import { isTauri } from '../../../core/platform.js';
import { knopUitInBrowser, meldingTekst } from '../../../core/webfuncties.js';
import { useTranslation } from '../../../i18n/useTranslation.js';

export default function RibbonButton(props) {
  const { t } = useTranslation('common');
  // Knoppen achter een Rust-opdracht (OCR, CAD, handtekeningen, comprimeren,
  // IFC, plug-ins, de bijwerker) hebben in de webversie geen equivalent. Ze
  // stonden daar aan en deden niets; nu staan ze uit en draagt de tooltip
  // dezelfde melding als overal. Eén tabel: js/core/webfuncties.js (#456).
  const geenWebvariant = () => knopUitInBrowser(props.id, isTauri());
  const titel = () => (geenWebvariant()
    ? meldingTekst(t, props.label || props.title || props.id)
    : props.title);

  return (
    <button
      class={`ribbon-btn${props.size === 'small' ? ' small' : ''}${props.size === 'medium' ? ' medium' : ''}${props.active ? ' active' : ''}${props.iconOnly ? ' icon-only' : ''}${props.extraClass ? ' ' + props.extraClass : ''}`}
      id={props.id}
      title={titel()}
      disabled={props.disabled || geenWebvariant()}
      onClick={props.onClick}
      style={props.style}
    >
      <div class="ribbon-btn-icon" style={props.iconStyle} ref={el => { if (props.icon) el.innerHTML = props.icon; }}>
      </div>
      {!props.iconOnly && (
        <span class="ribbon-btn-label" ref={el => autoShrinkLabel(el)}>{props.label}</span>
      )}
    </button>
  );
}
