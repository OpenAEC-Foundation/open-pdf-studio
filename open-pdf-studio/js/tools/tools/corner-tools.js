/**
 * Fillet (afronden) en Chamfer (afkanten) — AutoCAD-achtige hoekbewerkingen
 * op twee lijnen.
 *
 * Werking (beide):
 *   1. De ribbon-knop start het gereedschap met een CAD-invoer voor de
 *      straal (fillet) / afstand (chamfer): typen + Enter, of gewoon met de
 *      onthouden standaard doorklikken.
 *   2. Klik lijn 1, klik lijn 2 → de hoek wordt bijgewerkt (één eindpunt per
 *      lijn, zie corner-geometry.js) en de kant/boog toegevoegd.
 *   3. De sessie blijft actief voor de volgende hoek; Escape of rechtsklik
 *      zegt de eerste klik, de ribbon-stand verlaat het gereedschap.
 *
 * De geometrie zit in annotations/corner-geometry.js (puur, getest).
 */
import { state, getActiveDocument } from '../../core/state.js';
import { cloneAnnotation } from '../../annotations/factory.js';
import {
  recordModify,
  beginUndoTransaction,
  endUndoTransaction,
} from '../../core/undo-manager.js';
import { redrawAnnotations } from '../../annotations/rendering.js';
import { updateStatusMessage } from '../../ui/chrome/status-bar.js';
import i18next from '../../i18n/config.js';
import { filletGeometry, chamferGeometry } from '../../annotations/corner-geometry.js';
import {
  enterTypeLengthMode,
  exitTypeLengthMode,
  typeLengthActive,
  typeLengthBuffer,
  clearTypeLengthBuffer,
} from '../type-length-input.js';
import { parseCoordBuffer } from '../coord-invoer.js';

function _t(key, def) {
  return i18next.t(key, { ns: 'ribbon', defaultValue: def });
}

/** Alleen lijnachtige objecten (zelfde regel als Trim/Extend). */
function _isLijn(ann) {
  return !!ann && ann.startX !== undefined && ann.endX !== undefined
    && ann.startY !== undefined && ann.endY !== undefined;
}

const _seg = (a) => ({ x1: a.startX, y1: a.startY, x2: a.endX, y2: a.endY });

/**
 * Factory voor beide gereedschappen. `soort` = 'fillet' | 'chamfer';
 * `vraagBericht`/`invalidKey` sturen de invoerhulptekst.
 */
function makeCornerTool(soort) {
  // Onthouden waarde (straal / afstand) — blijft over sessies heen staan,
  // net als AutoCAD's onthouden fillet-radius.
  let _waarde = 10;
  let _tweede = null;   // chamfer: d2 (null = gelijk aan d1)
  const _s = { first: null, ownsCommit: false };

  function _bericht(def, key) {
    updateStatusMessage(key ? _t(key, def) : def, 5000);
  }

  function _hint() {
    // Dynamische tekst (bevat de actuele waarde) → geen vertaalsleutel,
    // de default-string is de bron.
    if (soort === 'fillet') {
      _bericht(
        `Fillet: radius ${_waarde} — type a new radius + Enter, or click the first line`,
      );
    } else {
      const twee = _tweede != null ? ` or two distances ${_waarde},${_tweede}` : '';
      _bericht(
        `Chamfer: distance ${_waarde}${twee} — type + Enter, or click the first line`,
      );
    }
  }

  /**
   * Zet de invoer om in waarde(n). Retourneert true als geldig.
   * fillet: alleen lengte (R > 0).
   * chamfer: lengte (d1 = d2) óf cartesian "d1,d2" (beide ≥ 0, niet beide 0).
   */
  function _vulUitBuffer() {
    const r = parseCoordBuffer(typeLengthBuffer());
    if (soort === 'fillet') {
      if (r.kind === 'length' && r.a > 0) {
        _waarde = r.a;
        _tweede = null;
        clearTypeLengthBuffer();
        _hint();
        return true;
      }
      clearTypeLengthBuffer();
      _bericht('Fillet: type a radius above 0, e.g. 10', 'drawing.filletRadiusInvalid');
      return false;
    }
    if (r.kind === 'length' && r.a > 0) {
      // Eén afstand → beide zijden gelijk.
      _waarde = r.a;
      _tweede = null;
      clearTypeLengthBuffer();
      _hint();
      return true;
    }
    if (r.kind === 'cartesian' && r.a >= 0 && r.b >= 0 && (r.a > 0 || r.b > 0)) {
      _waarde = r.a; _tweede = r.b;
      clearTypeLengthBuffer();
      _hint();
      return true;
    }
    clearTypeLengthBuffer();
    _bericht(
      'Chamfer: type a distance above 0, e.g. 10 (or two: 25,10)',
      'drawing.chamferDistanceInvalid',
    );
    return false;
  }

  // Enter in de CAD-invoer zet de waarde vast.
  function _commitWaarde() {
    _vulUitBuffer();
  }

  function _startInvoer() {
    const anchorX = Number.isFinite(state._lastMouseAppX) ? state._lastMouseAppX : 0;
    const anchorY = Number.isFinite(state._lastMouseAppY) ? state._lastMouseAppY : 0;
    enterTypeLengthMode(anchorX, anchorY);
    state._typeLengthCommit = _commitWaarde;
    _s.ownsCommit = true;
  }

  function _reset() {
    _s.first = null;
    if (_s.ownsCommit) {
      if (typeLengthActive()) exitTypeLengthMode();
      if (state._typeLengthCommit) state._typeLengthCommit = null;
      _s.ownsCommit = false;
    }
  }

  /** Eerste lijn vastleggen; een al getypte buffer geldt meteen als waarde. */
  function _pakEerste(ctx, clicked) {
    if (typeLengthBuffer().length > 0 && !_vulUitBuffer()) return;
    _s.first = clicked;
    _bericht(
      soort === 'fillet'
        ? 'Fillet: now click the second line'
        : 'Chamfer: now click the second line',
      soort === 'fillet' ? 'drawing.filletPick2' : 'drawing.chamferPick2',
    );
  }

  /** Tweede klik: geometrie toepassen + boog/kant toevoegen (één undo-stap). */
  function _voltooien(ctx, tweede) {
    const eerste = _s.first;
    _s.first = null;
    const resultaat = soort === 'fillet'
      ? filletGeometry(_seg(eerste), _seg(tweede), _waarde)
      : chamferGeometry(_seg(eerste), _seg(tweede), _waarde, _tweede ?? _waarde);

    if (resultaat.error === 'parallel') {
      _bericht(
        soort === 'fillet'
          ? 'Fillet: those lines never meet'
          : 'Chamfer: those lines never meet',
        soort === 'fillet' ? 'drawing.filletParallel' : 'drawing.chamferParallel',
      );
      return;
    }
    if (resultaat.error) {
      _bericht(
        soort === 'fillet'
          ? 'Fillet: no room for that radius here'
          : 'Chamfer: no room for that distance here',
        soort === 'fillet' ? 'drawing.filletDegenerate' : 'drawing.chamferDegenerate',
      );
      return;
    }

    const doc = getActiveDocument();
    const orig1 = cloneAnnotation(eerste);
    const orig2 = cloneAnnotation(tweede);
    Object.assign(eerste, {
      startX: resultaat.lijn1.x1, startY: resultaat.lijn1.y1,
      endX: resultaat.lijn1.x2, endY: resultaat.lijn1.y2,
    });
    Object.assign(tweede, {
      startX: resultaat.lijn2.x1, startY: resultaat.lijn2.y1,
      endX: resultaat.lijn2.x2, endY: resultaat.lijn2.y2,
    });
    const nu = new Date().toISOString();
    eerste.modifiedAt = nu;
    tweede.modifiedAt = nu;

    beginUndoTransaction();
    recordModify(eerste.id, orig1, eerste);
    recordModify(tweede.id, orig2, tweede);

    let extra = null;
    if (soort === 'fillet' && resultaat.arc) {
      const prefs = ctx.prefs || {};
      extra = ctx.createAnnotation({
        type: 'arc',
        page: eerste.page ?? doc?.currentPage ?? 1,
        centerX: resultaat.arc.centerX,
        centerY: resultaat.arc.centerY,
        radius: resultaat.arc.radius,
        startAngle: resultaat.arc.startAngle,
        endAngle: resultaat.arc.endAngle,
        color: eerste.strokeColor || eerste.color || prefs.lineStrokeColor || '#000000',
        lineWidth: eerste.lineWidth || prefs.lineLineWidth || 1,
        opacity: eerste.opacity ?? ((prefs.lineOpacity ?? 100) / 100),
      });
    } else if (soort === 'chamfer' && resultaat.chamfer) {
      const prefs = ctx.prefs || {};
      extra = ctx.createAnnotation({
        type: 'line',
        page: eerste.page ?? doc?.currentPage ?? 1,
        startX: resultaat.chamfer.x1, startY: resultaat.chamfer.y1,
        endX: resultaat.chamfer.x2, endY: resultaat.chamfer.y2,
        color: eerste.strokeColor || eerste.color || prefs.lineStrokeColor || '#000000',
        lineWidth: eerste.lineWidth || prefs.lineLineWidth || 1,
        opacity: eerste.opacity ?? ((prefs.lineOpacity ?? 100) / 100),
      });
    }
    if (extra && doc) {
      doc.annotations.push(extra);
      ctx.recordAdd(extra);
    }
    endUndoTransaction();

    ctx.redraw();
    _bericht(
      soort === 'fillet'
        ? 'Fillet created — click the next two lines'
        : 'Chamfer created — click the next two lines',
      soort === 'fillet' ? 'drawing.filletDone' : 'drawing.chamferDone',
    );
    import('../../tools/manager.js')
      .then((m) => m.maybeRevertToSelect && m.maybeRevertToSelect());
  }

  return {
    name: soort,
    cursor: 'crosshair',

    /** Toon de huidige waarde + instructie (ribbon-entry-point). */
    toonHint: _hint,

    /** Ribbon-entry-point: actieve CAD-invoer (typen + Enter) én hint. */
    activeeer() {
      if (!_s.ownsCommit || !typeLengthActive()) _startInvoer();
      _hint();
    },

    onPointerDown(ctx, e) {
      if (e.button === 2) {
        // Rechtsklik: eerste keuze annuleren (sessie blijft actief).
        if (_s.first) {
          _s.first = null;
          _bericht(
            soort === 'fillet' ? 'Fillet: click the first line' : 'Chamfer: click the first line',
            soort === 'fillet' ? 'drawing.filletPick1' : 'drawing.chamferPick1',
          );
          ctx.redraw();
        }
        return;
      }
      if (e.button !== 0) return;
      const clicked = ctx.findAnnotationAt(ctx.x, ctx.y);
      if (!clicked) {
        if (_s.first) {
          _s.first = null;
          _bericht(
            soort === 'fillet' ? 'Fillet: click the first line' : 'Chamfer: click the first line',
            soort === 'fillet' ? 'drawing.filletPick1' : 'drawing.chamferPick1',
          );
        }
        return;
      }
      if (!_isLijn(clicked)) {
        _bericht(
          soort === 'fillet'
            ? 'Fillet: click a line, arrow or wall'
            : 'Chamfer: click a line, arrow or wall',
          soort === 'fillet' ? 'drawing.filletNotLine' : 'drawing.chamferNotLine',
        );
        return;
      }
      if (!_s.first) { _pakEerste(ctx, clicked); return; }
      if (clicked === _s.first) {
        // Zelfde lijn twee keer: opnieuw beginnen.
        _s.first = null;
        _pakEerste(ctx, clicked);
        return;
      }
      _voltooien(ctx, clicked);
    },

    onEscape() { _reset(); },
    onDeactivate() { _reset(); },
  };
}

export const filletTool = makeCornerTool('fillet');
export const chamferTool = makeCornerTool('chamfer');

/** Ribbon-entry-points: gereedschap activeren + CAD-invoer + instructie. */
export async function startFilletTool() {
  const m = await import('../manager.js');
  m.setTool('fillet');
  filletTool.activeeer();
}

export async function startChamferTool() {
  const m = await import('../manager.js');
  m.setTool('chamfer');
  chamferTool.activeeer();
}
