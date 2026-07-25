// Eigenschappen-sectie voor de betonbalk: breedte in mm (schaalgebied-bewust
// omgerekend bij het renderen) en de lijnstijl. Schrijft terug via
// updateAnnotProp, zodat undo/redo en redraw exact als elke andere
// eigenschap-bewerking lopen. NL-labels hardgecodeerd, zoals bij de wand.
import { Show } from 'solid-js';
import { annotProps, updateAnnotProp } from '../../stores/propertiesStore.js';
import CollapsibleSection from './CollapsibleSection.jsx';
import { BETONBALK_BREEDTE_RANGE, BETONBALK_DEFAULTS } from '../../../annotations/betonbalk.js';

export default function BetonbalkSection() {
  const locked = () => annotProps.locked === true || annotProps.locked === 'mixed';
  return (
    <Show when={annotProps.annotationType === 'betonbalk'}>
      <CollapsibleSection title="Betonbalk" name="betonbalk" id="prop-betonbalk-section">
        <div class="property-group">
          <label>Breedte (mm)</label>
          <input type="number" id="prop-bb-breedte"
            min={BETONBALK_BREEDTE_RANGE.min} max={BETONBALK_BREEDTE_RANGE.max} step="10"
            value={annotProps.breedteMm ?? BETONBALK_DEFAULTS.breedteMm}
            disabled={locked()}
            onChange={(e) => updateAnnotProp('breedteMm', e.target.value)}
          />
        </div>
        <div class="property-group">
          <label>Lijnstijl</label>
          <select id="prop-bb-lijnstijl"
            value={annotProps.lijnstijl || BETONBALK_DEFAULTS.lijnstijl}
            disabled={locked()}
            onChange={(e) => updateAnnotProp('lijnstijl', e.target.value)}
          >
            <option value="doorgetrokken">Doorgetrokken</option>
            <option value="gestippeld">Gestippeld (boven aanzichtvlak)</option>
          </select>
        </div>
      </CollapsibleSection>
    </Show>
  );
}
