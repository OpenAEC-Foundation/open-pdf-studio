export default function RibbonTab(props) {
  return (
    <button
      class={`ribbon-tab${props.isActive ? ' active' : ''}${props.isFileTab ? ' file-tab' : ''}${props.isContextual ? ' contextual-tab contextual-tabs' : ''}`}
      data-tab={props.dataTab}
      id={props.id}
      onClick={props.onClick}
    >
      {props.label}
    </button>
  );
}
