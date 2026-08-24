// Systeemtypen-beheer — dialoog met LINKS een live preview van het
// geselecteerde systeemtype en RECHTS de instellingen + typenlijst.
//
// TYPE ≠ INSTANCE (zie annotations/systeem-typen.js): hier bewerk je de
// herbruikbare definities. De dialoog werkt op een KOPIE van de
// registry-data: OK/Toepassen schrijft naar de registry (en redrawt alle
// instanties); Annuleren of sluiten gooit niet-toegepaste wijzigingen weg.
// Verwijderen van een in-gebruik type waarschuwt en biedt omzetten aan.
//
// Vensterstijl: het gedeelde Dialog.jsx-patroon (Windows-stijl, rechte
// hoeken, titelbalkverloop, rode sluitknop-hover, versleepbaar, sluit
// niet bij buiten-klik) — zelfde als TekeninstellingenDialog.
// NL-labels hardgecodeerd (conventie van deze componentfamilie).
import { createSignal, createEffect, For, Show } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog } from '../../stores/dialogStore.js';
import { state, getActiveDocument } from '../../../core/state.js';
import {
  migrateSysteemTypen, findSysteemType, normalizeSysteemType,
  duplicateSysteemType, removeSysteemTypeFrom, typeUsageCount,
  reassignSysteemType, newSysteemTypeId, newPaneelTypeId,
} from '../../../annotations/systeem-typen.js';
import {
  getSysteemTypenData, saveSysteemTypen,
} from '../../../annotations/systeem-typen-registry.js';
import { buildSysteemraster } from '../../../annotations/systeemraster.js';
import { drawSysteemrasterGeom } from '../../../annotations/rendering/systeemraster-draw.js';
import { redrawAnnotations, redrawContinuous } from '../../../annotations/rendering.js';

function redraw() {
  const doc = getActiveDocument();
  if (doc?.viewMode === 'continuous') redrawContinuous();
  else redrawAnnotations();
}

// Alle annotaties van alle open documenten (voor in-gebruik-detectie).
function alleAnnotaties() {
  const out = [];
  for (const doc of state.documents || []) {
    for (const a of doc?.annotations || []) out.push(a);
  }
  return out;
}

const FIELD_STYLE = 'width:100%;box-sizing:border-box';
const NUM_STYLE = 'width:80px;box-sizing:border-box;text-align:right';

// Preview: voorbeeldcontour 3,6 × 2,4 m, passend in het canvas getekend via
// de ÉCHTE geometrie- en tekenroutines (buildSysteemraster +
// drawSysteemrasterGeom) — geen aparte nep-preview. Vaste paneel-mix zodat
// ventilatie- en lichtpanelen (en dus de celmaat) direct zichtbaar zijn.
const PREVIEW_W = 340;
const PREVIEW_H = 240;
const CONTOUR_MM = { b: 3600, h: 2400 };

function tekenPreview(canvas, typeDef) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const marge = 16;
  const k = Math.min(
    (canvas.width - 2 * marge) / CONTOUR_MM.b,
    (canvas.height - 2 * marge) / CONTOUR_MM.h,
  );
  const w = CONTOUR_MM.b * k, h = CONTOUR_MM.h * k;
  const x0 = (canvas.width - w) / 2, y0 = (canvas.height - h) / 2;
  const pseudo = {
    type: 'systeemraster',
    points: [
      { x: x0, y: y0 }, { x: x0 + w, y: y0 },
      { x: x0 + w, y: y0 + h }, { x: x0, y: y0 + h },
    ],
    equalizeX: true,
    equalizeY: true,
    tagTonen: false,
    system: { type: 'plafond', layers: [{
      // Vaste voorbeeld-mix: één ventilatiepaneel en één lichtpaneel.
      panels: { '1,1': 'ventilatie', '2,0': 'licht' },
      edge: { profiel: 'geen' },
    }] },
  };
  const geom = buildSysteemraster(pseudo, { pxPerMm: k, typeDef });
  if (geom) {
    drawSysteemrasterGeom(ctx, geom, { strokeColor: '#000000', lineWidth: 1 });
  }
}

export default function SysteemtypenDialog() {
  // KOPIE van de registry-data — pas bij OK/Toepassen naar de registry.
  const [werk, setWerk] = createSignal(
    migrateSysteemTypen(JSON.parse(JSON.stringify(getSysteemTypenData()))));
  const [rev, setRev] = createSignal(0);
  const [selectedId, setSelectedId] = createSignal(werk().typen[0]?.id || '');
  // Verwijder-flow: null of { id, count, doelId }.
  const [verwijderVraag, setVerwijderVraag] = createSignal(null);

  const typen = () => { rev(); return werk().typen; };
  const current = () => { rev(); return findSysteemType(werk(), selectedId()) || werk().typen[0]; };

  let canvasRef;
  createEffect(() => {
    rev();
    const t = current();
    // Buiten de reactieve read om tekenen (canvas is geen Solid-state).
    requestAnimationFrame(() => tekenPreview(canvasRef, t));
  });

  function muteer(patch) {
    const t = current();
    if (!t) return;
    const idx = werk().typen.findIndex(x => x.id === t.id);
    if (idx < 0) return;
    werk().typen[idx] = normalizeSysteemType({ ...t, ...patch, id: t.id });
    setRev(rev() + 1);
  }

  function toepassen() {
    saveSysteemTypen(migrateSysteemTypen(JSON.parse(JSON.stringify(werk()))));
    redraw(); // alle instanties met deze typen tekenen direct opnieuw
  }

  function handleNieuw() {
    const basis = current() || normalizeSysteemType({
      id: newSysteemTypeId(), naam: 'Systeemtype', celXMm: 600, celYMm: 600,
    });
    const copy = duplicateSysteemType(basis, 'Nieuw systeemtype');
    werk().typen.push(copy);
    setSelectedId(copy.id);
    setRev(rev() + 1);
  }

  function handleDupliceer() {
    const t = current();
    if (!t) return;
    const copy = duplicateSysteemType(t);
    werk().typen.push(copy);
    setSelectedId(copy.id);
    setRev(rev() + 1);
  }

  function handleVerwijder() {
    const t = current();
    if (!t || werk().typen.length <= 1) return;
    const count = typeUsageCount(alleAnnotaties(), t.id);
    if (count > 0) {
      // In gebruik: niet stilletjes weg — vraag om omzetten of annuleren.
      const doel = werk().typen.find(x => x.id !== t.id);
      setVerwijderVraag({ id: t.id, count, doelId: doel?.id || '' });
      return;
    }
    _verwijder(t.id);
  }

  function _verwijder(id) {
    setWerk(removeSysteemTypeFrom(werk(), id));
    setSelectedId(werk().typen[0]?.id || '');
    setVerwijderVraag(null);
    setRev(rev() + 1);
  }

  function handleOmzettenEnVerwijderen() {
    const v = verwijderVraag();
    const doel = v ? findSysteemType(werk(), v.doelId) : null;
    if (!v || !doel) return;
    // Instanties omzetten raakt de DOCUMENTEN direct (met redraw); de
    // type-verwijdering zelf blijft in de werkkopie tot OK/Toepassen.
    reassignSysteemType(alleAnnotaties(), v.id, doel);
    for (const doc of state.documents || []) { if (doc) doc.modified = true; }
    redraw();
    _verwijder(v.id);
  }

  return (
    <Dialog
      title="Systeemtypen beheren"
      dialogClass="systeemtypen-dialog"
      onClose={() => closeDialog('systeemtypen')}
      footer={
        <div style="display:flex;gap:6px;justify-content:flex-end;width:100%">
          <button class="ai-plan-btn" style="width:auto;padding:5px 16px" id="st-btn-ok"
            onClick={() => { toepassen(); closeDialog('systeemtypen'); }}>OK</button>
          <button class="ai-plan-btn" style="width:auto;padding:5px 16px" id="st-btn-toepassen"
            onClick={toepassen}>Toepassen</button>
          <button class="ai-plan-btn" style="width:auto;padding:5px 16px" id="st-btn-annuleren"
            onClick={() => closeDialog('systeemtypen')}>Annuleren</button>
        </div>
      }
    >
      <div style="display:flex;gap:12px;font-size:12px;max-height:70vh">
        {/* LINKS: live preview via de echte teken-pipeline */}
        <div style="display:flex;flex-direction:column;gap:4px">
          <label style="font-weight:bold">Voorbeeld (3,6 × 2,4 m)</label>
          <canvas ref={canvasRef} width={PREVIEW_W} height={PREVIEW_H}
            style="border:1px solid #d4d4d4;background:#fff" />
          <div style="opacity:.7">Met voorbeeldpanelen: ventilatie (kruis) en licht (arcering).</div>
        </div>

        {/* RECHTS: typenlijst + instellingen van het geselecteerde type */}
        <div style="min-width:300px;display:flex;flex-direction:column;gap:8px;overflow-y:auto">
          <div class="ai-login-field">
            <label>Typen in dit document</label>
            <select size="5" id="st-typen-lijst" style={FIELD_STYLE}
              value={current()?.id || ''}
              onChange={(e) => { setSelectedId(e.target.value); setVerwijderVraag(null); }}>
              <For each={typen()}>
                {(t) => <option value={t.id} selected={t.id === current()?.id}>{t.naam}</option>}
              </For>
            </select>
            <div style="display:flex;gap:4px;margin-top:4px">
              <button class="ai-plan-btn" style="width:auto;padding:4px 8px" id="st-btn-nieuw"
                onClick={handleNieuw}>Nieuw</button>
              <button class="ai-plan-btn" style="width:auto;padding:4px 8px" id="st-btn-dupliceer"
                onClick={handleDupliceer}>Dupliceren</button>
              <button class="ai-plan-btn" style="width:auto;padding:4px 8px" id="st-btn-verwijder"
                disabled={typen().length <= 1}
                onClick={handleVerwijder}>Verwijderen</button>
            </div>
          </div>

          <Show when={verwijderVraag()}>
            <div style="border:1px solid #d4a017;background:#fff8e1;padding:6px">
              <div style="margin-bottom:4px">
                Dit type wordt door {verwijderVraag().count} instantie(s) gebruikt.
                Zet ze om naar een ander type, of annuleer.
              </div>
              <div style="display:flex;gap:4px;align-items:center">
                <select style="flex:1" id="st-omzet-doel"
                  value={verwijderVraag().doelId}
                  onChange={(e) => setVerwijderVraag({ ...verwijderVraag(), doelId: e.target.value })}>
                  <For each={typen().filter(t => t.id !== verwijderVraag().id)}>
                    {(t) => <option value={t.id}>{t.naam}</option>}
                  </For>
                </select>
                <button class="ai-plan-btn" style="width:auto;padding:4px 8px" id="st-btn-omzetten"
                  onClick={handleOmzettenEnVerwijderen}>Omzetten en verwijderen</button>
                <button class="ai-plan-btn" style="width:auto;padding:4px 8px"
                  onClick={() => setVerwijderVraag(null)}>Annuleren</button>
              </div>
            </div>
          </Show>

          <Show when={current()}>
            <div class="ai-login-field">
              <label>Naam</label>
              <input type="text" class="ribbon-input" id="st-naam" style={FIELD_STYLE}
                value={current().naam}
                onChange={(e) => muteer({ naam: e.target.value })} />
            </div>

            <div class="ai-login-field">
              <label>Categorie</label>
              <select id="st-categorie" style={FIELD_STYLE}
                value={current().categorie}
                onChange={(e) => muteer({ categorie: e.target.value })}>
                <option value="plafond">Plafond</option>
                <option value="vloer">Vloer</option>
                <option value="wand">Wand</option>
                <option value="overig">Overig</option>
              </select>
            </div>

            <div class="ai-login-field">
              <label>IFC-categorie</label>
              <select id="st-ifc" style={FIELD_STYLE}
                value={current().ifcCategory}
                onChange={(e) => muteer({ ifcCategory: e.target.value })}>
                <option value="IfcCovering">IfcCovering</option>
                <option value="IfcWall">IfcWall</option>
                <option value="IfcSlab">IfcSlab</option>
                <option value="IfcPlate">IfcPlate</option>
              </select>
            </div>

            <div class="ai-login-field">
              <label>IFC PredefinedType</label>
              <select id="st-ifc-pre" style={FIELD_STYLE}
                value={current().ifcPredefinedType || ''}
                onChange={(e) => muteer({ ifcPredefinedType: e.target.value || undefined })}>
                <option value="">(geen)</option>
                <option value="CEILING">CEILING</option>
                <option value="FLOORING">FLOORING</option>
                <option value="FLOOR">FLOOR</option>
                <option value="CLADDING">CLADDING</option>
                <option value="ROOFING">ROOFING</option>
              </select>
            </div>

            <div class="ai-login-field">
              <label>Layout</label>
              <select id="st-layout" style={FIELD_STYLE}
                value={current().layout || 'raster'}
                onChange={(e) => muteer({ layout: e.target.value })}>
                <option value="raster">Raster (cellen in twee richtingen)</option>
                <option value="strook">Strook (kanaalplaat — één richting)</option>
              </select>
            </div>

            <Show when={(current().layout || 'raster') === 'strook'}
              fallback={
                <div class="ai-login-field">
                  <label>Celmaat (mm)</label>
                  <div style="display:flex;gap:8px;align-items:center">
                    <span>X</span>
                    <input type="number" class="ribbon-input" id="st-cel-x" style={NUM_STYLE}
                      min="50" max="20000" step="50" value={current().celXMm}
                      onChange={(e) => muteer({ celXMm: e.target.value })} />
                    <span>Y</span>
                    <input type="number" class="ribbon-input" id="st-cel-y" style={NUM_STYLE}
                      min="50" max="20000" step="50" value={current().celYMm}
                      onChange={(e) => muteer({ celYMm: e.target.value })} />
                  </div>
                </div>
              }>
              <div class="ai-login-field">
                <label>Strookbreedte (mm)</label>
                <input type="number" class="ribbon-input" id="st-strook-b" style={NUM_STYLE}
                  min="50" max="20000" step="50" value={current().strookBreedteMm}
                  onChange={(e) => muteer({ strookBreedteMm: e.target.value,
                    celXMm: e.target.value })} />
              </div>
            </Show>

            <div class="ai-login-field">
              <label>Sparingsregels (grootste zijde, mm)</label>
              <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
                <span>klein t/m</span>
                <input type="number" class="ribbon-input" id="st-sparing-klein" style={NUM_STYLE}
                  min="10" step="50"
                  value={current().sparingRegels?.kleineSparingMaxMm ?? 400}
                  onChange={(e) => muteer({ sparingRegels: {
                    ...current().sparingRegels,
                    kleineSparingMaxMm: parseFloat(e.target.value),
                  } })} />
                <span>raveel vanaf</span>
                <input type="number" class="ribbon-input" id="st-sparing-raveel" style={NUM_STYLE}
                  min="10" step="50"
                  value={current().sparingRegels?.raveelVanafMm ?? 800}
                  onChange={(e) => muteer({ sparingRegels: {
                    ...current().sparingRegels,
                    raveelVanafMm: parseFloat(e.target.value),
                  } })} />
              </div>
              <div style="opacity:.7;margin-top:2px">Tussenmaten krijgen een verzwaarde randlijn.</div>
            </div>

            <div class="ai-login-field">
              <label>Randprofiel</label>
              <select id="st-randprofiel" style={FIELD_STYLE}
                value={current().edgeProfiel}
                onChange={(e) => muteer({ edgeProfiel: e.target.value })}>
                <option value="geen">Geen</option>
                <option value="hoeklijn">Hoeklijn</option>
                <option value="schaduwvoeg">Schaduwvoeg</option>
              </select>
            </div>

            {/* Paneel-assortiment van dit type: elk paneeltype = naam +
                render-stijl. 'tegel' is de default/reset-waarde van elke
                cel en kan niet weg. */}
            <div class="ai-login-field">
              <label>Paneeltypes (assortiment)</label>
              <For each={current().paneelTypen || []}>
                {(pt, i) => (
                  <div style="display:flex;gap:4px;align-items:center;margin:2px 0">
                    <input type="text" class="ribbon-input" style="flex:1;box-sizing:border-box"
                      value={pt.naam}
                      onChange={(e) => {
                        const lijst = current().paneelTypen.slice();
                        lijst[i()] = { ...pt, naam: e.target.value };
                        muteer({ paneelTypen: lijst });
                      }} />
                    <select style="width:110px"
                      value={pt.renderStijl}
                      onChange={(e) => {
                        const lijst = current().paneelTypen.slice();
                        lijst[i()] = { ...pt, renderStijl: e.target.value };
                        muteer({ paneelTypen: lijst });
                      }}>
                      <option value="tegel">vlak (tegel)</option>
                      <option value="ventilatie">kruis (ventilatie)</option>
                      <option value="licht">arcering (licht)</option>
                    </select>
                    <button class="ai-plan-btn" style="width:auto;padding:2px 7px"
                      disabled={pt.id === 'tegel'}
                      title={pt.id === 'tegel' ? 'Default-paneeltype kan niet weg' : 'Verwijderen'}
                      onClick={() => {
                        muteer({ paneelTypen: current().paneelTypen.filter(q => q.id !== pt.id) });
                      }}>×</button>
                  </div>
                )}
              </For>
              <button class="ai-plan-btn" style="width:auto;padding:4px 8px;margin-top:4px"
                id="st-paneeltype-toevoegen"
                onClick={() => {
                  muteer({ paneelTypen: [...(current().paneelTypen || []),
                    { id: newPaneelTypeId(), naam: 'Nieuw paneeltype', renderStijl: 'tegel' }] });
                }}>Paneeltype toevoegen</button>
            </div>
          </Show>
        </div>
      </div>
    </Dialog>
  );
}
