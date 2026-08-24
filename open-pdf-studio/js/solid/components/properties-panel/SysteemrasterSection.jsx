// Eigenschappen-sectie voor systemen (systeemraster / systeemplafond).
//
// TYPE ≠ INSTANCE: de dropdown kiest het SYSTEEMTYPE (herbruikbare
// definitie uit de registry, zie annotations/systeem-typen.js); de velden
// "— type" schrijven op die definitie — alle instanties met dat type
// veranderen mee. Instance-velden (rasterhoek, equalize, randconditie,
// paneeltype) raken alleen deze annotatie. Schrijft via updateAnnotProp,
// zodat undo/redo en redraw als elke andere eigenschap lopen. NL-labels
// hardgecodeerd, zoals bij de wand en de betonbalk.
import { Show, For, createMemo } from 'solid-js';
import { annotProps, updateAnnotProp } from '../../stores/propertiesStore.js';
import { openDialog } from '../../stores/dialogStore.js';
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
  const heeftType = () => !!annotProps.sgTypeId;
  const isStrook = () => annotProps.sgLayout === 'strook';

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
      rasterHoek: annotProps.sgRasterHoek,
    };
    const geom = buildSysteemraster(pseudo, systeemrasterBuildOpts(pseudo));
    return geom ? geom.randMm : null;
  });

  const fmt = (v) => (v > 0 ? `${Math.round(v)} mm` : '— (volle plaat)');

  return (
    <Show when={annotProps.annotationType === 'systeemraster'}>
      <CollapsibleSection title="Systeem" name="systeemraster" id="prop-sg-section">
        <Show when={heeftType()}>
          <div class="property-group">
            <label>Systeemtype</label>
            <div style={{ display: 'flex', gap: '4px', 'align-items': 'center' }}>
              <select id="prop-sg-type" style={{ flex: '1' }}
                value={annotProps.sgTypeId || ''}
                disabled={locked()}
                onChange={(e) => updateAnnotProp('sgTypeId', e.target.value)}
              >
                <For each={annotProps.sgTypeList || []}>
                  {(t) => <option value={t.id}>{t.naam}</option>}
                </For>
              </select>
              <button type="button" id="prop-sg-typen-beheren" title="Typen beheren…"
                onClick={() => openDialog('systeemtypen')}
              >…</button>
            </div>
          </div>
        </Show>

        <div class="property-group">
          <label>{isStrook() ? 'Strookbreedte (mm) — type'
            : heeftType() ? 'Celmaat X (mm) — type' : 'Plaatbreedte (mm)'}</label>
          <input type="number" id="prop-sg-breedte"
            min={SYSTEEMRASTER_PLAAT_RANGE.min} max={SYSTEEMRASTER_PLAAT_RANGE.max} step="50"
            value={breedte()}
            disabled={locked()}
            onChange={(e) => updateAnnotProp('sgTypeCelX', e.target.value)}
          />
        </div>

        <Show when={!isStrook()}>
          <div class="property-group">
            <label>{heeftType() ? 'Celmaat Y (mm) — type' : 'Plaathoogte (mm)'}</label>
            <input type="number" id="prop-sg-hoogte"
              min={SYSTEEMRASTER_PLAAT_RANGE.min} max={SYSTEEMRASTER_PLAAT_RANGE.max} step="50"
              value={hoogte()}
              disabled={locked()}
              onChange={(e) => updateAnnotProp('sgTypeCelY', e.target.value)}
            />
          </div>
        </Show>

        <div class="property-group">
          <button type="button" id="prop-sg-sparing-toevoegen"
            disabled={locked()}
            onClick={() => updateAnnotProp('sgSparingToevoegen', true)}
          >Sparing toevoegen</button>
        </div>

        <div class="property-group">
          <label>{heeftType() ? 'Randprofiel — type' : 'Randprofiel'}</label>
          <select id="prop-sg-randprofiel"
            value={annotProps.sgEdgeProfiel || 'geen'}
            disabled={locked()}
            onChange={(e) => updateAnnotProp('sgTypeEdge', e.target.value)}
          >
            <option value="geen">Geen</option>
            <option value="hoeklijn">Hoeklijn</option>
            <option value="schaduwvoeg">Schaduwvoeg</option>
          </select>
        </div>

        <div class="property-group">
          <label>Rasterhoek (°)</label>
          <input type="number" id="prop-sg-hoek"
            min="0" max="360" step="5"
            value={annotProps.sgRasterHoek ?? 0}
            disabled={locked()}
            onChange={(e) => updateAnnotProp('rasterHoek', e.target.value)}
          />
        </div>

        <div class="property-group">
          <button type="button" id="prop-sg-centreer"
            disabled={locked()}
            onClick={() => updateAnnotProp('sgCentreer', true)}
          >Centreer raster</button>
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

        {/* ONDERDEEL — het via de tweede klik geselecteerde sub-element:
            paneel, randsegment of rasterlijn. Delete = terug naar default;
            Escape = terug naar het hele component. */}
        <Show when={annotProps.sgSelectedSub}>
          <div class="property-group" style={{ 'border-top': '1px solid #d4d4d4', 'padding-top': '6px' }}>
            <label style={{ 'font-weight': 'bold' }}>
              {annotProps.sgSelectedSub.kind === 'paneel'
                ? `Onderdeel: paneel (${annotProps.sgSelectedSub.ix},${annotProps.sgSelectedSub.iy})`
                : annotProps.sgSelectedSub.kind === 'rand'
                  ? `Onderdeel: randsegment ${annotProps.sgSelectedSub.seg}`
                  : annotProps.sgSelectedSub.kind === 'strook'
                    ? `Onderdeel: strook #${annotProps.sgSelectedSub.index}`
                    : annotProps.sgSelectedSub.kind === 'sparing'
                      ? 'Onderdeel: sparing'
                      : `Onderdeel: rasterlijn ${annotProps.sgSelectedSub.as === 'v' ? 'verticaal' : 'horizontaal'} #${annotProps.sgSelectedSub.index}`}
            </label>
            <div style={{ 'font-size': '11px', opacity: '0.75' }}>
              {annotProps.sgIfcPad} → {annotProps.sgSelectedSub.kind}
            </div>
          </div>

          <Show when={annotProps.sgSelectedSub.kind === 'paneel'}>
            <div class="property-group">
              <label>Paneeltype</label>
              <select id="prop-sg-paneeltype"
                value={annotProps.sgPaneelType || 'tegel'}
                disabled={locked()}
                onChange={(e) => updateAnnotProp('sgPaneelType', e.target.value)}
              >
                <For each={annotProps.sgPaneelTypen || []}>
                  {(pt) => <option value={pt.id}>{pt.naam}</option>}
                </For>
                <Show when={annotProps.sgPaneelType === 'component'}>
                  <option value="component">
                    Component: {annotProps.sgPaneelComponent?.naam
                      || annotProps.sgPaneelComponent?.symbolId}
                  </option>
                </Show>
              </select>
            </div>
            <div class="property-group">
              <button type="button" id="prop-sg-paneel-component"
                disabled={locked()}
                onClick={() => openDialog('systeem-paneel-component')}
              >Ander component…</button>
            </div>
            <div class="property-group">
              <label>Afmeting</label>
              <div style={{ 'font-size': '11px' }}>
                {Math.round(breedte())} × {Math.round(hoogte())} mm
                (Delete = terug naar tegel)
              </div>
            </div>
          </Show>

          <Show when={annotProps.sgSelectedSub.kind === 'rand'}>
            <div class="property-group">
              <label>Randprofiel (dit segment)</label>
              <select id="prop-sg-randseg"
                value={annotProps.sgRandOverride || ''}
                disabled={locked()}
                onChange={(e) => updateAnnotProp('sgRandSegProfiel', e.target.value)}
              >
                <option value="">(van type: {annotProps.sgEdgeProfiel || 'geen'})</option>
                <option value="geen">Geen</option>
                <option value="hoeklijn">Hoeklijn</option>
                <option value="schaduwvoeg">Schaduwvoeg</option>
              </select>
            </div>
            <div class="property-group">
              <label>Lengte</label>
              <div style={{ 'font-size': '11px' }}>
                {Math.round(annotProps.sgSelectedSub.lengthMm || 0)} mm
              </div>
            </div>
          </Show>

          <Show when={annotProps.sgSelectedSub.kind === 'strook'}>
            <div class="property-group">
              <label>Strook</label>
              <div style={{ 'font-size': '11px', 'line-height': '1.5' }}>
                <div>Breedte: {Math.round(annotProps.sgSelectedSub.breedteMm || 0)} mm
                  {annotProps.sgSelectedSub.pas ? ' (passtrook)' : ''}</div>
                <div>Lengte: {Math.round(annotProps.sgSelectedSub.lengteMm || 0)} mm</div>
                <div>Positie: {Math.round(annotProps.sgSelectedSub.posMm || 0)} mm vanaf de rand</div>
              </div>
            </div>
          </Show>

          <Show when={annotProps.sgSelectedSub.kind === 'sparing'}>
            <div class="property-group">
              <label>Afmeting sparing (mm)</label>
              <div style={{ display: 'flex', gap: '6px', 'align-items': 'center' }}>
                <span>B</span>
                <input type="number" id="prop-sg-sparing-b" style={{ width: '70px' }}
                  min="10" step="50" value={Math.round(annotProps.sgSelectedSub.bMm || 0)}
                  disabled={locked()}
                  onChange={(e) => updateAnnotProp('sgSparingB', e.target.value)} />
                <span>H</span>
                <input type="number" id="prop-sg-sparing-h" style={{ width: '70px' }}
                  min="10" step="50" value={Math.round(annotProps.sgSelectedSub.hMm || 0)}
                  disabled={locked()}
                  onChange={(e) => updateAnnotProp('sgSparingH', e.target.value)} />
              </div>
            </div>
            <div class="property-group">
              <label>Positie (mm, t.o.v. linksboven)</label>
              <div style={{ display: 'flex', gap: '6px', 'align-items': 'center' }}>
                <span>X</span>
                <input type="number" id="prop-sg-sparing-x" style={{ width: '70px' }}
                  step="50" value={Math.round(annotProps.sgSelectedSub.xMm || 0)}
                  disabled={locked()}
                  onChange={(e) => updateAnnotProp('sgSparingX', e.target.value)} />
                <span>Y</span>
                <input type="number" id="prop-sg-sparing-y" style={{ width: '70px' }}
                  step="50" value={Math.round(annotProps.sgSelectedSub.yMm || 0)}
                  disabled={locked()}
                  onChange={(e) => updateAnnotProp('sgSparingY', e.target.value)} />
              </div>
            </div>
            <div class="property-group">
              <label>Regime</label>
              <div style={{ 'font-size': '11px' }}>
                {annotProps.sgSelectedSub.regime === 'klein' ? 'Klein (gewoon gat)'
                  : annotProps.sgSelectedSub.regime === 'raveel' ? 'Raveelijzer'
                    : 'Verzwaarde randlijn'} — Delete verwijdert de sparing
              </div>
            </div>
          </Show>

          <Show when={annotProps.sgSelectedSub.kind === 'lijn'}>
            <div class="property-group">
              <label>Rasterlijn</label>
              <div style={{ 'font-size': '11px', 'line-height': '1.5' }}>
                <div>Richting: {annotProps.sgSelectedSub.as === 'v' ? 'verticaal' : 'horizontaal'}</div>
                <div>Index: {annotProps.sgSelectedSub.index}</div>
                <div>Positie: {Math.round(annotProps.sgSelectedSub.posMm || 0)} mm vanaf de oorsprong</div>
              </div>
            </div>
          </Show>
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
