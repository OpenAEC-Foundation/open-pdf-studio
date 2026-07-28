// Eigenschappen-sectie voor het systeemraster: plaatmaat (b×h in mm),
// equalize x/y (randstukken per as gelijk), randconditie (gesneden platen
// tonen of een minimale randmaat afdwingen) en de berekende RANDSTUK-MATEN
// per zijde — de eerste stap richting randafval-inzicht. Schrijft terug via
// updateAnnotProp, zodat undo/redo en redraw exact als elke andere
// eigenschap-bewerking lopen. NL-labels hardgecodeerd, zoals bij de wand en
// de betonbalk.
import { Show, createMemo } from 'solid-js';
import { annotProps, updateAnnotProp } from '../../stores/propertiesStore.js';
import CollapsibleSection from './CollapsibleSection.jsx';
import {
  SYSTEEMRASTER_DEFAULTS,
  SYSTEEMRASTER_PLAAT_RANGE,
  buildSysteemraster,
} from '../../../annotations/systeemraster.js';
import { systeemrasterBuildOpts } from '../../../annotations/systeemraster-scale.js';

export default function SysteemrasterSection() {
  const locked = () => annotProps.locked === true || annotProps.locked === 'mixed';
  const breedte = () => annotProps.plaatBreedteMm ?? SYSTEEMRASTER_DEFAULTS.plaatBreedteMm;
  const hoogte = () => annotProps.plaatHoogteMm ?? SYSTEEMRASTER_DEFAULTS.plaatHoogteMm;

  // Randstuk-maten per zijde uit dezelfde geometrie als de rendering,
  // reactief herbouwd uit de paneel-kopie (annotProps.sgPoints + waarden) —
  // ververst dus bij elke paneel-bewerking en bij (her)selectie.
  const randMm = createMemo(() => {
    if (!Array.isArray(annotProps.sgPoints) || annotProps.sgPoints.length < 3) return null;
    const pseudo = {
      type: 'systeemraster',
      page: annotProps.sgPage,
      points: annotProps.sgPoints,
      plaatBreedteMm: breedte(),
      plaatHoogteMm: hoogte(),
      originXMm: annotProps.sgOriginXMm,
      originYMm: annotProps.sgOriginYMm,
      equalizeX: annotProps.equalizeX === true,
      equalizeY: annotProps.equalizeY === true,
      randConditie: annotProps.randConditie,
      minRandMm: annotProps.minRandMm,
    };
    const geom = buildSysteemraster(pseudo, systeemrasterBuildOpts(pseudo));
    return geom ? geom.randMm : null;
  });

  const fmt = (v) => (v > 0 ? `${Math.round(v)} mm` : '— (volle plaat)');

  return (
    <Show when={annotProps.annotationType === 'systeemraster'}>
      <CollapsibleSection title="Systeemraster" name="systeemraster" id="prop-sg-section">
        <div class="property-group">
          <label>Plaatbreedte (mm)</label>
          <input type="number" id="prop-sg-breedte"
            min={SYSTEEMRASTER_PLAAT_RANGE.min} max={SYSTEEMRASTER_PLAAT_RANGE.max} step="50"
            value={breedte()}
            disabled={locked()}
            onChange={(e) => updateAnnotProp('plaatBreedteMm', e.target.value)}
          />
        </div>

        <div class="property-group">
          <label>Plaathoogte (mm)</label>
          <input type="number" id="prop-sg-hoogte"
            min={SYSTEEMRASTER_PLAAT_RANGE.min} max={SYSTEEMRASTER_PLAAT_RANGE.max} step="50"
            value={hoogte()}
            disabled={locked()}
            onChange={(e) => updateAnnotProp('plaatHoogteMm', e.target.value)}
          />
        </div>

        <div class="property-group">
          <label>
            <input type="checkbox" id="prop-sg-eqx"
              checked={annotProps.equalizeX === true}
              disabled={locked()}
              onChange={(e) => updateAnnotProp('equalizeX', e.target.checked)}
            /> Equalize X (randstukken links = rechts)
          </label>
        </div>

        <div class="property-group">
          <label>
            <input type="checkbox" id="prop-sg-eqy"
              checked={annotProps.equalizeY === true}
              disabled={locked()}
              onChange={(e) => updateAnnotProp('equalizeY', e.target.checked)}
            /> Equalize Y (randstukken boven = onder)
          </label>
        </div>

        <div class="property-group">
          <label>Randconditie</label>
          <select id="prop-sg-rand"
            value={annotProps.randConditie || SYSTEEMRASTER_DEFAULTS.randConditie}
            disabled={locked()}
            onChange={(e) => updateAnnotProp('randConditie', e.target.value)}
          >
            <option value="tonen">Gesneden platen tonen</option>
            <option value="minmaat">Minimale randmaat afdwingen</option>
          </select>
        </div>

        <Show when={(annotProps.randConditie || SYSTEEMRASTER_DEFAULTS.randConditie) === 'minmaat'}>
          <div class="property-group">
            <label>Minimale randmaat (mm)</label>
            <input type="number" id="prop-sg-minrand"
              min="0" step="50"
              value={annotProps.minRandMm ?? SYSTEEMRASTER_DEFAULTS.minRandMm}
              disabled={locked()}
              onChange={(e) => updateAnnotProp('minRandMm', e.target.value)}
            />
          </div>
        </Show>

        <Show when={randMm()}>
          <div class="property-group">
            <label>Randstukken</label>
            <div id="prop-sg-randmaten" style={{ 'font-size': '11px', 'line-height': '1.5' }}>
              <div>Links: {fmt(randMm().links)}</div>
              <div>Rechts: {fmt(randMm().rechts)}</div>
              <div>Boven: {fmt(randMm().boven)}</div>
              <div>Onder: {fmt(randMm().onder)}</div>
            </div>
          </div>
        </Show>
      </CollapsibleSection>
    </Show>
  );
}
