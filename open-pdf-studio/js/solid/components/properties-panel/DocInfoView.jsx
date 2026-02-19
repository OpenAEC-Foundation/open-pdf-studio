import { Show } from 'solid-js';
import { panelMode, docInfo } from '../../stores/propertiesStore.js';
import CollapsibleSection from './CollapsibleSection.jsx';

export default function DocInfoView() {
  return (
    <Show when={panelMode() === 'none'}>
      <div id="prop-no-selection">
        <CollapsibleSection title="Document" name="docDocument">
          <div class="property-group"><label>File</label><span class="prop-info-value" style="word-break: break-all;">{docInfo.filename}</span></div>
          <div class="property-group"><label>Path</label><span class="prop-info-secondary" style="word-break: break-all;">{docInfo.filepath}</span></div>
          <div class="property-group"><label>Pages</label><span class="prop-info-value">{docInfo.pages}</span></div>
          <div class="property-group"><label>Page Size</label><span class="prop-info-value">{docInfo.pageSize}</span></div>
        </CollapsibleSection>

        <CollapsibleSection title="Metadata" name="docMetadata">
          <div class="property-group"><label>Title</label><span class="prop-info-value">{docInfo.title}</span></div>
          <div class="property-group"><label>Author</label><span class="prop-info-value">{docInfo.author}</span></div>
          <div class="property-group"><label>Subject</label><span class="prop-info-value">{docInfo.subject}</span></div>
          <div class="property-group"><label>Creator</label><span class="prop-info-value">{docInfo.creator}</span></div>
          <div class="property-group"><label>Producer</label><span class="prop-info-value">{docInfo.producer}</span></div>
          <div class="property-group"><label>PDF Version</label><span class="prop-info-value">{docInfo.version}</span></div>
        </CollapsibleSection>

        <CollapsibleSection title="Annotations" name="docAnnotations">
          <div class="property-group"><label>Total</label><span class="prop-info-value">{docInfo.annotCount}</span></div>
          <div class="property-group"><label>On Page</label><span class="prop-info-value">{docInfo.annotPage}</span></div>
        </CollapsibleSection>

        <div class="prop-hint-text">Select an annotation to edit its properties</div>
      </div>
    </Show>
  );
}
