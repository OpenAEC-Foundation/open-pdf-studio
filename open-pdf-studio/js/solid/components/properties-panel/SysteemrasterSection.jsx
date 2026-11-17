// Eigenschappen-sectie voor systemen (systeemraster / systeemplafond).
//
// TYPE ≠ INSTANCE: de dropdown kiest het SYSTEEMTYPE (herbruikbare
// definitie uit de registry, zie annotations/systeem-typen.js); de velden
// "— type" schrijven op die definitie — alle instanties met dat type
// veranderen mee. Instance-velden (rasterhoek, equalize, randconditie,
// paneeltype) raken alleen deze annotatie. Schrijft via updateAnnotProp,
// zodat undo/redo en redraw als elke andere eigenschap lopen. Teksten lopen
// via i18n (properties:systeemraster).
import { Show, For, createMemo } from 'solid-js';
import { annotProps, updateAnnotProp } from '../../stores/propertiesStore.js';
import { openDialog } from '../../stores/dialogStore.js';
import CollapsibleSection from './CollapsibleSection.jsx';
import { useTranslation } from '../../../i18n/useTranslation.js';
import {
  SYSTEEMRASTER_DEFAULTS,
  SYSTEEMRASTER_PLAAT_RANGE,
  buildSysteemraster,
  randstukkenVoorPaneel,
} from '../../../annotations/systeemraster.js';
import { systeemrasterBuildOpts } from '../../../annotations/systeemraster-scale.js';

export default function SysteemrasterSection() {
  const { t } = useTranslation('properties');
  const locked = () => annotProps.locked === true || annotProps.locked === 'mixed';
  const breedte = () => annotProps.plaatBreedteMm ?? SYSTEEMRASTER_DEFAULTS.plaatBreedteMm;
  const hoogte = () => annotProps.plaatHoogteMm ?? SYSTEEMRASTER_DEFAULTS.plaatHoogteMm;
  const heeftType = () => !!annotProps.sgTypeId;
  // Weergave: bij een type is een onbevestigde maat (null) een leeg veld met
  // de placeholder "onbevestigd" — nooit een verzonnen standaardmaat (#567).
  const breedteVeld = () => (heeftType() ? (annotProps.plaatBreedteMm ?? '') : breedte());
  const hoogteVeld = () => (heeftType() ? (annotProps.plaatHoogteMm ?? '') : hoogte());
  const isStrook = () => annotProps.sgLayout === 'strook';

  // Randstuk-maten per zijde uit dezelfde geometrie als de rendering,
  // reactief herbouwd uit de paneel-kopie (annotProps.sgPoints + waarden) —
  // ververst dus bij elke paneel-bewerking en bij (her)selectie. Mist het
  // type een vereiste maat, dan is er geen indeling: "onbevestigd", nooit
  // "volle plaat" (randstukkenVoorPaneel, #567).
  const randstukken = createMemo(() => {
    if (!Array.isArray(annotProps.sgPoints) || annotProps.sgPoints.length < 3) return null;
    const pseudo = {
      type: 'systeemraster',
      page: annotProps.sgPage,
      points: annotProps.sgPoints,
      // Met type rekent de geometrie met de typematen (en bij een
      // onbevestigde maat zonder indeling: randstukken 0).
      systeemTypeId: annotProps.sgTypeId || undefined,
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
    return randstukkenVoorPaneel(buildSysteemraster(pseudo, systeemrasterBuildOpts(pseudo)));
  });
  const randMm = () => randstukken()?.randMm || null;

  const richting = () => (annotProps.sgSelectedSub?.as === 'v' ? t('systeemraster.vertical') : t('systeemraster.horizontal'));
  const fmt = (v) => (v > 0 ? `${Math.round(v)} mm` : t('systeemraster.fullTile'));

  return (
    <Show when={annotProps.annotationType === 'systeemraster'}>
      <CollapsibleSection title={t('systeemraster.title')} name="systeemraster" id="prop-sg-section">
        <Show when={heeftType()}>
          <div class="property-group">
            <label>{t('systeemraster.systemType')}</label>
            <div style={{ display: 'flex', gap: '4px', 'align-items': 'center' }}>
              <select id="prop-sg-type" style={{ flex: '1' }}
                value={annotProps.sgTypeId || ''}
                disabled={locked()}
                onChange={(e) => updateAnnotProp('sgTypeId', e.target.value)}
              >
                <For each={annotProps.sgTypeList || []}>
                  {(st) => <option value={st.id}>{st.naam}</option>}
                </For>
              </select>
              <button type="button" id="prop-sg-typen-beheren" title={t('systeemraster.manageTypes')}
                onClick={() => openDialog('systeemtypen', { typeId: annotProps.sgTypeId })}
              >…</button>
            </div>
          </div>
        </Show>

        <div class="property-group">
          <label>{isStrook() ? t('systeemraster.stripWidthType')
            : heeftType() ? t('systeemraster.cellXType') : t('systeemraster.tileWidth')}</label>
          <input type="text" inputmode="decimal" data-getal id="prop-sg-breedte"
            min={SYSTEEMRASTER_PLAAT_RANGE.min} max={SYSTEEMRASTER_PLAAT_RANGE.max} step="50"
            value={breedteVeld()} placeholder={t('systeemraster.unconfirmed')}
            disabled={locked()}
            onChange={(e) => updateAnnotProp('sgTypeCelX', e.target.value)}
          />
        </div>

        <Show when={!isStrook()}>
          <div class="property-group">
            <label>{heeftType() ? t('systeemraster.cellYType') : t('systeemraster.tileHeight')}</label>
            <input type="text" inputmode="decimal" data-getal id="prop-sg-hoogte"
              min={SYSTEEMRASTER_PLAAT_RANGE.min} max={SYSTEEMRASTER_PLAAT_RANGE.max} step="50"
              value={hoogteVeld()} placeholder={t('systeemraster.unconfirmed')}
              disabled={locked()}
              onChange={(e) => updateAnnotProp('sgTypeCelY', e.target.value)}
            />
          </div>
        </Show>

        <div class="property-group">
          <button type="button" id="prop-sg-sparing-toevoegen"
            disabled={locked()}
            onClick={() => updateAnnotProp('sgSparingToevoegen', true)}
          >{t('systeemraster.addOpening')}</button>
        </div>

        <div class="property-group">
          <label>{heeftType() ? t('systeemraster.edgeProfileType') : t('systeemraster.edgeProfile')}</label>
          <select id="prop-sg-randprofiel"
            value={annotProps.sgEdgeProfiel || 'geen'}
            disabled={locked()}
            onChange={(e) => updateAnnotProp('sgTypeEdge', e.target.value)}
          >
            <option value="geen">{t('systeemraster.edge.geen')}</option>
            <option value="hoeklijn">{t('systeemraster.edge.hoeklijn')}</option>
            <option value="schaduwvoeg">{t('systeemraster.edge.schaduwvoeg')}</option>
          </select>
        </div>

        <div class="property-group">
          <label>{t('systeemraster.gridAngle')}</label>
          <input type="text" inputmode="decimal" data-getal id="prop-sg-hoek"
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
          >{t('systeemraster.centreGrid')}</button>
        </div>

        <div class="property-group">
          <label>
            <input type="checkbox" id="prop-sg-eqx"
              checked={annotProps.equalizeX === true}
              disabled={locked()}
              onChange={(e) => updateAnnotProp('equalizeX', e.target.checked)}
            /> {t('systeemraster.equalizeX')}
          </label>
        </div>

        <div class="property-group">
          <label>
            <input type="checkbox" id="prop-sg-eqy"
              checked={annotProps.equalizeY === true}
              disabled={locked()}
              onChange={(e) => updateAnnotProp('equalizeY', e.target.checked)}
            /> {t('systeemraster.equalizeY')}
          </label>
        </div>

        <div class="property-group">
          <label>{t('systeemraster.edgeCondition')}</label>
          <select id="prop-sg-rand"
            value={annotProps.randConditie || SYSTEEMRASTER_DEFAULTS.randConditie}
            disabled={locked()}
            onChange={(e) => updateAnnotProp('randConditie', e.target.value)}
          >
            <option value="tonen">{t('systeemraster.edgeShowCut')}</option>
            <option value="minmaat">{t('systeemraster.edgeEnforceMin')}</option>
          </select>
        </div>

        <Show when={(annotProps.randConditie || SYSTEEMRASTER_DEFAULTS.randConditie) === 'minmaat'}>
          <div class="property-group">
            <label>{t('systeemraster.minEdge')}</label>
            <input type="text" inputmode="decimal" data-getal id="prop-sg-minrand"
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
                ? t('systeemraster.partPanel', { ix: annotProps.sgSelectedSub.ix, iy: annotProps.sgSelectedSub.iy })
                : annotProps.sgSelectedSub.kind === 'rand'
                  ? t('systeemraster.partEdge', { n: annotProps.sgSelectedSub.seg })
                  : annotProps.sgSelectedSub.kind === 'strook'
                    ? t('systeemraster.partStrip', { n: annotProps.sgSelectedSub.index })
                    : annotProps.sgSelectedSub.kind === 'sparing'
                      ? t('systeemraster.partOpening')
                      : t('systeemraster.partLine', { direction: richting(), n: annotProps.sgSelectedSub.index })}
            </label>
            <div style={{ 'font-size': '11px', opacity: '0.75' }}>
              {annotProps.sgIfcPad} → {annotProps.sgSelectedSub.kind}
            </div>
          </div>

          <Show when={annotProps.sgSelectedSub.kind === 'paneel'}>
            <div class="property-group">
              <label>{t('systeemraster.panelType')}</label>
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
                    {t('systeemraster.componentOption', {
                      name: annotProps.sgPaneelComponent?.naam || annotProps.sgPaneelComponent?.symbolId,
                    })}
                  </option>
                </Show>
              </select>
            </div>
            <div class="property-group">
              <button type="button" id="prop-sg-paneel-component"
                disabled={locked()}
                onClick={() => openDialog('systeem-paneel-component')}
              >{t('systeemraster.otherComponent')}</button>
            </div>
            <div class="property-group">
              <label>{t('systeemraster.size')}</label>
              <div style={{ 'font-size': '11px' }}>
                {Math.round(breedte())} × {Math.round(hoogte())} mm
                {' '}{t('systeemraster.deleteToTile')}
              </div>
            </div>
          </Show>

          <Show when={annotProps.sgSelectedSub.kind === 'rand'}>
            <div class="property-group">
              <label>{t('systeemraster.edgeProfileSegment')}</label>
              <select id="prop-sg-randseg"
                value={annotProps.sgRandOverride || ''}
                disabled={locked()}
                onChange={(e) => updateAnnotProp('sgRandSegProfiel', e.target.value)}
              >
                <option value="">{t('systeemraster.edgeFromType', { value: t(`systeemraster.edge.${annotProps.sgEdgeProfiel || 'geen'}`, annotProps.sgEdgeProfiel || '') })}</option>
                <option value="geen">{t('systeemraster.edge.geen')}</option>
                <option value="hoeklijn">{t('systeemraster.edge.hoeklijn')}</option>
                <option value="schaduwvoeg">{t('systeemraster.edge.schaduwvoeg')}</option>
              </select>
            </div>
            <div class="property-group">
              <label>{t('systeemraster.length')}</label>
              <div style={{ 'font-size': '11px' }}>
                {Math.round(annotProps.sgSelectedSub.lengthMm || 0)} mm
              </div>
            </div>
          </Show>

          <Show when={annotProps.sgSelectedSub.kind === 'strook'}>
            <div class="property-group">
              <label>{t('systeemraster.strip')}</label>
              <div style={{ 'font-size': '11px', 'line-height': '1.5' }}>
                <div>{t('systeemraster.stripWidth', { mm: Math.round(annotProps.sgSelectedSub.breedteMm || 0) })}
                  {annotProps.sgSelectedSub.pas ? ` ${t('systeemraster.stripFitting')}` : ''}</div>
                <div>{t('systeemraster.stripLength', { mm: Math.round(annotProps.sgSelectedSub.lengteMm || 0) })}</div>
                <div>{t('systeemraster.stripPosition', { mm: Math.round(annotProps.sgSelectedSub.posMm || 0) })}</div>
              </div>
            </div>
          </Show>

          <Show when={annotProps.sgSelectedSub.kind === 'sparing'}>
            <div class="property-group">
              <label>{t('systeemraster.openingSize')}</label>
              <div style={{ display: 'flex', gap: '6px', 'align-items': 'center' }}>
                <span>{t('systeemraster.widthLetter')}</span>
                <input type="text" inputmode="decimal" data-getal id="prop-sg-sparing-b" style={{ width: '70px' }}
                  min="10" step="50" value={Math.round(annotProps.sgSelectedSub.bMm || 0)}
                  disabled={locked()}
                  onChange={(e) => updateAnnotProp('sgSparingB', e.target.value)} />
                <span>{t('systeemraster.heightLetter')}</span>
                <input type="text" inputmode="decimal" data-getal id="prop-sg-sparing-h" style={{ width: '70px' }}
                  min="10" step="50" value={Math.round(annotProps.sgSelectedSub.hMm || 0)}
                  disabled={locked()}
                  onChange={(e) => updateAnnotProp('sgSparingH', e.target.value)} />
              </div>
            </div>
            <div class="property-group">
              <label>{t('systeemraster.openingPosition')}</label>
              <div style={{ display: 'flex', gap: '6px', 'align-items': 'center' }}>
                <span>X</span>
                <input type="text" inputmode="decimal" data-getal id="prop-sg-sparing-x" style={{ width: '70px' }}
                  step="50" value={Math.round(annotProps.sgSelectedSub.xMm || 0)}
                  disabled={locked()}
                  onChange={(e) => updateAnnotProp('sgSparingX', e.target.value)} />
                <span>Y</span>
                <input type="text" inputmode="decimal" data-getal id="prop-sg-sparing-y" style={{ width: '70px' }}
                  step="50" value={Math.round(annotProps.sgSelectedSub.yMm || 0)}
                  disabled={locked()}
                  onChange={(e) => updateAnnotProp('sgSparingY', e.target.value)} />
              </div>
            </div>
            <div class="property-group">
              <label>{t('systeemraster.regime')}</label>
              <div style={{ 'font-size': '11px' }}>
                {annotProps.sgSelectedSub.regime === 'klein' ? t('systeemraster.regimeSmall')
                  : annotProps.sgSelectedSub.regime === 'raveel' ? t('systeemraster.regimeTrimmer')
                    : t('systeemraster.regimeHeavy')} — {t('systeemraster.deleteRemovesOpening')}
              </div>
            </div>
          </Show>

          <Show when={annotProps.sgSelectedSub.kind === 'lijn'}>
            <div class="property-group">
              <label>{t('systeemraster.gridLine')}</label>
              <div style={{ 'font-size': '11px', 'line-height': '1.5' }}>
                <div>{t('systeemraster.lineDirection', { value: richting() })}</div>
                <div>{t('systeemraster.lineIndex', { n: annotProps.sgSelectedSub.index })}</div>
                <div>{t('systeemraster.linePosition', { mm: Math.round(annotProps.sgSelectedSub.posMm || 0) })}</div>
              </div>
            </div>
          </Show>
        </Show>

        <Show when={randstukken()}>
          <div class="property-group">
            <label>{t('systeemraster.edgePieces')}</label>
            <Show when={randMm()}
              fallback={
                <div id="prop-sg-randmaten" style={{ 'font-size': '11px', 'line-height': '1.5' }}>
                  {t('systeemraster.edgeUnconfirmed')}
                </div>
              }>
              <div id="prop-sg-randmaten" style={{ 'font-size': '11px', 'line-height': '1.5' }}>
                <div>{t('systeemraster.edgeLeft', { value: fmt(randMm().links) })}</div>
                <div>{t('systeemraster.edgeRight', { value: fmt(randMm().rechts) })}</div>
                <div>{t('systeemraster.edgeTop', { value: fmt(randMm().boven) })}</div>
                <div>{t('systeemraster.edgeBottom', { value: fmt(randMm().onder) })}</div>
              </div>
            </Show>
          </div>
        </Show>
      </CollapsibleSection>
    </Show>
  );
}
