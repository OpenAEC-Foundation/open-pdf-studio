import { Show } from 'solid-js';
import { annotProps, sectionVis, updateAnnotProp } from '../../stores/propertiesStore.js';
import CollapsibleSection from './CollapsibleSection.jsx';

export default function GeneralSection() {
  const isLocked = () => annotProps.locked;

  return (
    <Show when={sectionVis.general}>
      <CollapsibleSection title="General" name="general" id="prop-general-section">
        <div class="property-group">
          <label>Type</label>
          <input type="text" value={annotProps.typeDisplay} readonly />
        </div>

        <div class="property-group">
          <label>Subject</label>
          <input type="text" value={annotProps.subject} placeholder="Enter subject..."
            disabled={isLocked()}
            onInput={(e) => updateAnnotProp('subject', e.target.value)} />
        </div>

        <div class="property-group">
          <label>Author</label>
          <input type="text" value={annotProps.author}
            disabled={isLocked()}
            onInput={(e) => updateAnnotProp('author', e.target.value)} />
        </div>

        <div class="property-group">
          <label>Created</label>
          <input type="text" value={annotProps.created} readonly class="prop-date" />
        </div>

        <div class="property-group">
          <label>Modified</label>
          <input type="text" value={annotProps.modified} readonly class="prop-date" />
        </div>

        <div class="property-group">
          <label>Locked</label>
          <select value={annotProps.locked ? 'yes' : 'no'}
            onChange={(e) => updateAnnotProp('locked', e.target.value === 'yes')}>
            <option value="no">No</option>
            <option value="yes">Yes</option>
          </select>
        </div>

        <div class="property-group">
          <label>Printable</label>
          <select value={annotProps.printable ? 'yes' : 'no'}
            disabled={isLocked()}
            onChange={(e) => updateAnnotProp('printable', e.target.value === 'yes')}>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </div>

        <div class="property-group">
          <label>Read Only</label>
          <select value={annotProps.readOnly ? 'yes' : 'no'}
            disabled={isLocked()}
            onChange={(e) => updateAnnotProp('readOnly', e.target.value === 'yes')}>
            <option value="no">No</option>
            <option value="yes">Yes</option>
          </select>
        </div>

        <div class="property-group">
          <label>Marked</label>
          <select value={annotProps.marked ? 'yes' : 'no'}
            disabled={isLocked()}
            onChange={(e) => updateAnnotProp('marked', e.target.value === 'yes')}>
            <option value="no">No</option>
            <option value="yes">Yes</option>
          </select>
        </div>

        <div class="property-group">
          <label>Alt Text</label>
          <textarea rows="2" placeholder="Description for accessibility..."
            style="width: 100%; resize: vertical; font-size: 12px;"
            value={annotProps.altText}
            disabled={isLocked()}
            onInput={(e) => updateAnnotProp('altText', e.target.value)} />
        </div>

        <div class="property-group">
          <label>Status</label>
          <select value={annotProps.status}
            onChange={(e) => updateAnnotProp('status', e.target.value)}>
            <option value="none">None</option>
            <option value="accepted">Accepted</option>
            <option value="rejected">Rejected</option>
            <option value="cancelled">Cancelled</option>
            <option value="completed">Completed</option>
            <option value="reviewed">Reviewed</option>
          </select>
        </div>
      </CollapsibleSection>
    </Show>
  );
}
