export default function RibbonGroup(props) {
  return (
    <div class={`ribbon-group${props.wide ? ' ribbon-group-wide' : ''}`}>
      <div class="ribbon-group-content">
        {props.children}
      </div>
      <div class="ribbon-group-label">{props.label || ''}</div>
    </div>
  );
}
