export default function RibbonButton(props) {
  return (
    <button
      class={`ribbon-btn${props.size === 'small' ? ' small' : ''}${props.size === 'medium' ? ' medium' : ''}${props.active ? ' active' : ''}${props.extraClass ? ' ' + props.extraClass : ''}`}
      id={props.id}
      title={props.title}
      disabled={props.disabled}
      onClick={props.onClick}
      style={props.style}
    >
      <div class="ribbon-btn-icon" style={props.iconStyle} ref={el => { if (props.icon) el.innerHTML = props.icon; }}>
      </div>
      <span class="ribbon-btn-label">{props.label}</span>
    </button>
  );
}
