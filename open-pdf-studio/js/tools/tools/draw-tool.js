import { applyToolTransform, resolvePointerCoords } from '../tool-context.js';
import {
  aanwijzerMetDruk, breedteUitDruk, inktEigenschappen, klemDruk, klemGladheid,
  maakPalmFilter, monstersVanEvent, INK_STANDAARD,
} from '../../annotations/pressure-ink.js';

/**
 * Freehand draw tool.
 *
 * Drukgevoelige inkt (#385): met een pen stuurt de druk de breedte per punt;
 * alle tussenliggende metingen komen binnen via getCoalescedEvents (de
 * dispatcher geeft elke ruwe pointermove door via onRawPointerMove, ook als
 * hij het hertekenen per beeldframe bundelt). Een muis tekent een vaste
 * breedte. Palmafwijzing: zolang een pen in de buurt is (of met "alleen pen"
 * altijd) begint een aanraking geen streek, en tijdens een streek telt alleen
 * de aanwijzer die hem begon.
 */

const palm = maakPalmFilter();
const nu = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

// De lopende streek, buiten de reactieve state: een pen levert honderden
// punten per seconde.
let _streek = null; // { pointerId, metDruk, punten, drukken, getekend, voorbeeld, viaRuw, canvasCtx }

function lijnBreedte(ctx, prefs) {
  return prefs.drawLineWidth || ctx.getLineWidthValue() || 2;
}

function andereAanwijzer(e) {
  return !!_streek && e?.pointerId !== undefined && _streek.pointerId !== undefined
    && e.pointerId !== _streek.pointerId;
}

/** Voor de dispatcher: elke pen-beweging (ook zweven) houdt de palmafwijzing actief. */
export function noteerAanwijzer(e) {
  palm.noteer(e, nu());
}

function voegMonstersToe(e) {
  for (const m of monstersVanEvent(e)) {
    const c = resolvePointerCoords({ clientX: m.clientX, clientY: m.clientY, target: e.target });
    if (!Number.isFinite(c.x) || !Number.isFinite(c.y)) continue;
    const laatste = _streek.punten[_streek.punten.length - 1];
    if (laatste && laatste.x === c.x && laatste.y === c.y) continue;
    _streek.punten.push({ x: c.x, y: c.y });
    _streek.drukken.push(klemDruk(m.pressure));
  }
}

function tekenNieuwStuk(ctx) {
  const s = _streek;
  // Het canvas van de pagina waar de streek begon (doorlopende weergave: een
  // palm op een andere pagina levert een ander canvas).
  const canvasCtx = s?.canvasCtx || ctx.canvasCtx;
  if (!s || !canvasCtx || s.punten.length < 2 || s.getekend >= s.punten.length - 1) return;
  const prefs = ctx.state.preferences;
  const max = lijnBreedte(ctx, prefs);
  const minPct = prefs.drawPressureMinWidth ?? INK_STANDAARD.minBreedtePct;
  // Voorbeeld: een eenzijdig (causaal) filter, zodat de lijn al tijdens het
  // tekenen rustig is; de uiteindelijke streek wordt fasevrij gladgemaakt.
  const k = (klemGladheid(prefs.drawSmoothing ?? INK_STANDAARD.gladheid) / 100) * 0.85;
  // Zelfde volgorde als annotation-creators: de voorkeur van het
  // gereedschap, dan pas de lintwaarde (#668).

  canvasCtx.save();
  applyToolTransform(canvasCtx);
  canvasCtx.globalAlpha = (prefs.drawOpacity || 100) / 100;
  canvasCtx.strokeStyle = prefs.drawStrokeColor || ctx.getColorPickerValue() || '#000000';
  canvasCtx.fillStyle = canvasCtx.strokeStyle;
  canvasCtx.lineCap = 'round';
  canvasCtx.lineJoin = 'round';
  canvasCtx.beginPath();
  let vorige = s.voorbeeld;
  for (let i = s.getekend + 1; i < s.punten.length; i++) {
    const p = s.punten[i];
    const q = { x: vorige.x + (p.x - vorige.x) * (1 - k), y: vorige.y + (p.y - vorige.y) * (1 - k), w: max };
    if (s.metDruk) {
      q.w = breedteUitDruk(s.drukken[i], max, minPct);
      // Een stuk met twee breedtes: het vlak tussen twee cirkels plus de cirkel.
      const dx = q.x - vorige.x, dy = q.y - vorige.y;
      const len = Math.hypot(dx, dy);
      if (len > 1e-6) {
        const nx = -dy / len, ny = dx / len;
        const r0 = vorige.w / 2, r1 = q.w / 2;
        canvasCtx.moveTo(vorige.x + nx * r0, vorige.y + ny * r0);
        canvasCtx.lineTo(q.x + nx * r1, q.y + ny * r1);
        canvasCtx.lineTo(q.x - nx * r1, q.y - ny * r1);
        canvasCtx.lineTo(vorige.x - nx * r0, vorige.y - ny * r0);
        canvasCtx.closePath();
      }
      canvasCtx.moveTo(q.x + q.w / 2, q.y);
      canvasCtx.arc(q.x, q.y, q.w / 2, 0, Math.PI * 2);
    } else {
      canvasCtx.moveTo(vorige.x, vorige.y);
      canvasCtx.lineTo(q.x, q.y);
    }
    vorige = q;
  }
  if (s.metDruk) canvasCtx.fill('nonzero');
  else { canvasCtx.lineWidth = max; canvasCtx.stroke(); }
  canvasCtx.globalAlpha = 1;
  canvasCtx.restore();
  s.voorbeeld = vorige;
  s.getekend = s.punten.length - 1;
}

export const drawTool = {
  name: 'draw',
  cursor: 'crosshair',

  /** Palmafwijzing: true = de dispatcher laat deze pointerdown helemaal liggen. */
  rejectPointer(e, state) {
    palm.noteer(e, nu());
    // Tijdens een streek begint een tweede aanwijzer (de hand) niets.
    if (state.isDrawing && andereAanwijzer(e)) return true;
    return palm.weiger(e, nu(), { alleenPen: state.preferences?.drawPenOnly === true });
  },

  onPointerDown(ctx, e) {
    const { x, y, state } = ctx;
    const prefs = state.preferences;
    const metDruk = prefs.drawPressure !== false && aanwijzerMetDruk(e?.pointerType);
    const max = lijnBreedte(ctx, prefs);
    state.isDrawing = true;
    _streek = {
      pointerId: e?.pointerId,
      metDruk,
      punten: [{ x, y }],
      drukken: [klemDruk(e?.pressure)],
      getekend: 0,
      voorbeeld: { x, y, w: metDruk ? breedteUitDruk(e?.pressure, max, prefs.drawPressureMinWidth) : max },
      viaRuw: false,
      canvasCtx: ctx.canvasCtx,
    };
    state.currentPath = [{ x, y }];
  },

  /** Elke ruwe pointermove, vóór de bundeling per beeldframe (alle coalesced monsters). */
  onRawPointerMove(e, state) {
    if (!state.isDrawing || !_streek || andereAanwijzer(e)) return;
    _streek.viaRuw = true;
    voegMonstersToe(e);
  },

  onPointerMove(ctx, e) {
    const { state } = ctx;
    if (!state.isDrawing || !_streek) return;
    // Zonder ruwe doorgifte (synthetisch event, autopan): dit event zelf.
    if (!_streek.viaRuw && !andereAanwijzer(e)) {
      const laatste = _streek.punten[_streek.punten.length - 1];
      if (laatste.x !== ctx.x || laatste.y !== ctx.y) {
        _streek.punten.push({ x: ctx.x, y: ctx.y });
        _streek.drukken.push(klemDruk(e?.pressure));
      }
    }
    tekenNieuwStuk(ctx);
  },

  onPointerUp(ctx, e) {
    const { state } = ctx;
    if (!state.isDrawing) return false;
    // Een andere aanwijzer (de palm) die loslaat, beëindigt de streek niet.
    if (andereAanwijzer(e)) return true;
    state.isDrawing = false;
    const streek = _streek;
    _streek = null;
    const prefs = state.preferences;
    if (streek) state.currentPath = streek.punten;

    const ann = ctx.createAnnotationFromTool('draw', state.startX, state.startY, ctx.x, ctx.y, e);
    if (ann) {
      Object.assign(ann, inktEigenschappen(prefs, streek, ann.path.length));
      const doc = state.documents[state.activeDocumentIndex];
      if (doc) doc.annotations.push(ann);
      ctx.recordAdd(ann);
    }
    ctx.redraw();

    // Auto-reset to select tool
    import("../../tools/manager.js").then(m => m.maybeRevertToSelect && m.maybeRevertToSelect());

    return true;
  },
};
