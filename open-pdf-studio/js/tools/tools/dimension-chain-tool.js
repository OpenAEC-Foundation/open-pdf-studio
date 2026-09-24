// Maatketting bewerken (#477): een bestaande maat of ketting verlengen met
// extra meetpunten, of er een hulplijn uit halen - zonder een nieuwe maatlijn
// te tekenen.
//
// Start via het rechtsklikmenu van een maat ("Punten toevoegen aan
// maatketting" / "Hulplijn uit maatketting halen"); het menu zet
// `state.dimChainTargetId` en kiest het gereedschap.
//   - dimChainAdd: elke klik (met objectsnap, ook op het wandvlak) voegt een
//     hulplijn toe: ertussen splitst het segment, erbuiten wordt de ketting
//     langer. Blijf klikken voor meer punten.
//   - dimChainRemove: klik op een hulplijn (het gemeten punt of ergens langs
//     de hulplijn) en de twee segmenten worden er een.
// Esc of rechtsklik stopt; daarna de selectietool.
//
// Ongedaan maken: ELKE KLIK is een eigen stap. Zo haalt Ctrl+Z alleen het
// laatst gezette punt weg terwijl je doorgaat - net als "vorig punt terug" in
// een tekenprogramma - en blijft een lange reeks niet in een keer hangen.
//
// Het rekenwerk (maatketting-bewerken.js) en het uitvoeren gaan via dezelfde
// weg als `app_floorplan {action:"dimensions", chainOf, addPoints|removePoints}`:
// verankerde maten blijven verankerd en een punt op een wandvlak wordt aan die
// wand verankerd.

import { state, getActiveDocument } from '../../core/state.js';

function _doel() {
  const doc = getActiveDocument();
  const id = state.dimChainTargetId;
  return id ? (doc?.annotations || []).find((a) => a.id === id) || null : null;
}

function _stop(ctx) {
  state.dimChainTargetId = null;
  ctx.redraw();
  import('../manager.js').then((m) => m.setTool && m.setTool('select'));
}

let _bezig = false;

async function _voerUit(ctx, doel, veld, punt) {
  if (_bezig) return;
  _bezig = true;
  try {
    const { plattegrondInApp } = await import('../../mcp-bridge.js');
    const r = await plattegrondInApp({
      action: 'dimensions', page: doel.page ?? 1, chainOf: doel.id, [veld]: [punt],
      tolerance: 8 / (ctx.scale || 1),
    });
    // Is de aangewezen maat zelf weggevallen (een buitenste hulplijn eraf),
    // dan gaat het gereedschap verder met een overgebleven lid.
    if (!_doel() && r?.dimensions?.length) state.dimChainTargetId = r.dimensions[0].id;
  } catch (err) {
    console.error('[maatketting] bewerken mislukt', err);
  } finally {
    _bezig = false;
    ctx.redraw();
  }
}

function _gesnapt(ctx, doel) {
  const snap = ctx.snap(ctx.x, ctx.y, doel.id);
  return { snap, punt: snap.snapped ? { x: snap.x, y: snap.y } : { x: ctx.x, y: ctx.y } };
}

function _maakGereedschap(naam, veld) {
  return {
    name: naam,
    cursor: 'crosshair',

    onPointerDown(ctx, e) {
      if (e.button === 2) { _stop(ctx); return; }
      if (e.button !== 0) return;
      const doel = _doel();
      if (!doel) { _stop(ctx); return; }
      const { punt } = veld === 'addPoints' ? _gesnapt(ctx, doel) : { punt: { x: ctx.x, y: ctx.y } };
      _voerUit(ctx, doel, veld, punt);
    },

    onPointerMove(ctx) {
      if (veld !== 'addPoints') return;
      const doel = _doel();
      if (!doel) return;
      const { snap } = _gesnapt(ctx, doel);
      ctx.redraw();
      if (snap.snapped) ctx.drawSnapIndicator(snap);
    },

    onEscape(ctx) {
      if (!state.dimChainTargetId) return false;
      _stop(ctx);
      return true;
    },

    onDeactivate() {
      state.dimChainTargetId = null;
    },
  };
}

export const dimChainAddTool = _maakGereedschap('dimChainAdd', 'addPoints');
export const dimChainRemoveTool = _maakGereedschap('dimChainRemove', 'removePoints');
