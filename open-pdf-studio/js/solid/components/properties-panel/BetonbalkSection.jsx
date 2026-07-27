// Eigenschappen-sectie voor de betonbalk: profielkeuze (gangbare b×h-
// doorsneden + "Aangepast…"), breedte/hoogte in mm, lijnstijl, hartlijn-
// schakelaar en optionele tag. Schrijft terug via updateAnnotProp, zodat
// undo/redo en redraw exact als elke andere eigenschap-bewerking lopen.
// NL-labels hardgecodeerd, zoals bij de wand. De gekozen doorsnede wordt als
// voorinstelling onthouden (betonbalkStore) voor de volgende geplaatste balk.
import { Show, For, createMemo } from 'solid-js';
import { annotProps, updateAnnotProp } from '../../stores/propertiesStore.js';
import CollapsibleSection from './CollapsibleSection.jsx';
import {
  BETONBALK_PROFIELEN,
  BETONBALK_BREEDTE_RANGE,
  BETONBALK_HOOGTE_RANGE,
  BETONBALK_DEFAULTS,
  betonbalkProfielNaam,
} from '../../../annotations/betonbalk.js';

export default function BetonbalkSection() {
  const locked = () => annotProps.locked === true || annotProps.locked === 'mixed';
  const breedte = () => annotProps.breedteMm ?? BETONBALK_DEFAULTS.breedteMm;
  const hoogte = () => annotProps.hoogteMm ?? BETONBALK_DEFAULTS.hoogteMm;

  // Huidige doorsnede → keuzelijstwaarde ('bxh' of 'aangepast').
  const profielWaarde = createMemo(() => {
    const naam = betonbalkProfielNaam(breedte(), hoogte());
    return BETONBALK_PROFIELEN.some(p => betonbalkProfielNaam(p.breedteMm, p.hoogteMm) === naam)
      ? naam : 'aangepast';
  });

  const kiesProfiel = (value) => {
    if (value === 'aangepast') return; // vrije invoer via de velden eronder
    const p = BETONBALK_PROFIELEN.find(
      pr => betonbalkProfielNaam(pr.breedteMm, pr.hoogteMm) === value);
    if (!p) return;
    updateAnnotProp('breedteMm', p.breedteMm);
    updateAnnotProp('hoogteMm', p.hoogteMm);
  };

  return (
    <Show when={annotProps.annotationType === 'betonbalk'}>
      <CollapsibleSection title="Betonbalk" name="betonbalk" id="prop-betonbalk-section">
        <div class="property-group">
          <label>Profiel (b×h)</label>
          <select id="prop-bb-profiel"
            value={profielWaarde()}
            disabled={locked()}
            onChange={(e) => kiesProfiel(e.target.value)}
          >
            <For each={BETONBALK_PROFIELEN}>{(p) => (
              <option value={betonbalkProfielNaam(p.breedteMm, p.hoogteMm)}>
                {betonbalkProfielNaam(p.breedteMm, p.hoogteMm)}
              </option>
            )}</For>
            <option value="aangepast">Aangepast…</option>
          </select>
        </div>

        <div class="property-group">
          <label>Breedte (mm)</label>
          <input type="number" id="prop-bb-breedte"
            min={BETONBALK_BREEDTE_RANGE.min} max={BETONBALK_BREEDTE_RANGE.max} step="10"
            value={breedte()}
            disabled={locked()}
            onChange={(e) => updateAnnotProp('breedteMm', e.target.value)}
          />
        </div>

        <div class="property-group">
          <label>Hoogte (mm)</label>
          <input type="number" id="prop-bb-hoogte"
            min={BETONBALK_HOOGTE_RANGE.min} max={BETONBALK_HOOGTE_RANGE.max} step="10"
            value={hoogte()}
            disabled={locked()}
            onChange={(e) => updateAnnotProp('hoogteMm', e.target.value)}
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

        <div class="property-group">
          <label>
            <input type="checkbox" id="prop-bb-hartlijn"
              checked={annotProps.toonHartlijn !== false}
              disabled={locked()}
              onChange={(e) => updateAnnotProp('toonHartlijn', e.target.checked)}
            /> Hartlijn tonen
          </label>
        </div>

        <div class="property-group">
          <label>
            <input type="checkbox" id="prop-bb-tag"
              checked={annotProps.tagTonen === true}
              disabled={locked()}
              onChange={(e) => updateAnnotProp('tagTonen', e.target.checked)}
            /> Tag tonen
          </label>
        </div>
        <Show when={annotProps.tagTonen === true}>
          <div class="property-group">
            <label>Tagtekst</label>
            <input type="text" id="prop-bb-tagtekst"
              placeholder={betonbalkProfielNaam(breedte(), hoogte())}
              value={annotProps.tagTekst || ''}
              disabled={locked()}
              onChange={(e) => updateAnnotProp('tagTekst', e.target.value)}
            />
          </div>
        </Show>
      </CollapsibleSection>
    </Show>
  );
}
