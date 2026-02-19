import { Show } from 'solid-js';
import { collapsedSections, toggleSection } from '../../stores/propertiesStore.js';

export default function CollapsibleSection(props) {
  const isCollapsed = () => collapsedSections()[props.name] || false;

  return (
    <div class={`property-section${isCollapsed() ? ' collapsed' : ''}`}
      id={props.id || undefined}
      style={props.style || undefined}>
      <div class="property-section-header" onClick={() => toggleSection(props.name)}>
        {props.title} <span class="collapse-arrow">&#9660;</span>
      </div>
      <div class="property-section-content">
        {props.children}
      </div>
    </div>
  );
}
