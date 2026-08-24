// Systeemraster / systeemplafond — gedeelde canvas-tekenroutine.
//
// Gebruikt door annotations/rendering.js (definitieve weergave) én door de
// systeemraster-tool (live voorbeeld), zodat voorbeeld en eindresultaat per
// definitie identiek ogen. De geometrie komt ALTIJD uit buildSysteemraster()
// (annotations/systeemraster.js) — hier wordt alleen gestreept.
import {
  arcControl,
  SYSTEEM_RAVEEL_OFFSET_MM,
  SYSTEEM_RAVEEL_STREEP_MM,
} from '../systeemraster.js';

const SELECT_KLEUR = '#0078d7';

// Contourpad uit de NODES (met echte bogen als kwadratische Béziers) — de
// vlakke contour is voor rekenwerk, dit pad is voor het oog.
function _contourPath(ctx, nodes) {
  const n = nodes.length;
  ctx.moveTo(nodes[0].x, nodes[0].y);
  for (let s = 0; s < n; s++) {
    const a = nodes[s], b = nodes[(s + 1) % n];
    if (b.arc === true) {
      const cp = arcControl(a, b);
      ctx.quadraticCurveTo(cp.x, cp.y, b.x, b.y);
    } else {
      ctx.lineTo(b.x, b.y);
    }
  }
  ctx.closePath();
}

function _polyline(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke();
}

// Paneel-decoratie binnen (reeds geclipte, evt. geroteerde) context, op
// basis van de RENDER-STIJL van het paneeltype (assortiment = data op het
// systeemtype): ventilatie = diagonaal kruis, licht = 45°-arcering.
function _drawPaneelStijl(ctx, p) {
  if (p.stijl === 'ventilatie') {
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x + p.w, p.y + p.h);
    ctx.moveTo(p.x + p.w, p.y);
    ctx.lineTo(p.x, p.y + p.h);
    ctx.stroke();
  } else if (p.stijl === 'licht') {
    const pitch = Math.max(2, Math.min(p.w, p.h) / 5);
    ctx.save();
    ctx.beginPath();
    ctx.rect(p.x, p.y, p.w, p.h);
    ctx.clip();
    ctx.beginPath();
    for (let c = p.x - p.h; c <= p.x + p.w; c += pitch) {
      ctx.moveTo(c, p.y + p.h);
      ctx.lineTo(c + p.h, p.y);
    }
    ctx.stroke();
    ctx.restore();
  }
}

// Component-in-cel: symbool uit de bibliotheek, gecentreerd en passend
// geschaald (80% van de kleinste celmaat). `getSymbolImage` (via de style,
// geleverd door rendering.js) mag null geven zolang het beeld laadt of het
// symbool onbekend is — dan tekenen we een herkenbare placeholder met
// naamlabel (zelfde beeld als de PDF-appearance-terugval).
function _drawPaneelComponent(ctx, p, style) {
  const maat = Math.min(p.w, p.h) * 0.8;
  const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
  const img = typeof style?.getSymbolImage === 'function'
    ? style.getSymbolImage(p.component.symbolId) : null;
  if (img) {
    ctx.drawImage(img, cx - maat / 2, cy - maat / 2, maat, maat);
    return;
  }
  // Placeholder: vierkant + diagonalen + naamlabel (documenteerd beeld
  // voor symbolen zonder laadbaar beeld).
  ctx.strokeRect(cx - maat / 2, cy - maat / 2, maat, maat);
  ctx.beginPath();
  ctx.moveTo(cx - maat / 2, cy - maat / 2);
  ctx.lineTo(cx + maat / 2, cy + maat / 2);
  ctx.moveTo(cx + maat / 2, cy - maat / 2);
  ctx.lineTo(cx - maat / 2, cy + maat / 2);
  ctx.stroke();
  const label = p.component.naam || p.component.symbolId;
  ctx.save();
  ctx.font = `${Math.max(6, maat * 0.18)}px Arial`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = ctx.strokeStyle;
  ctx.fillText(label, cx, cy + maat * 0.62);
  ctx.restore();
}

// Highlight van één sub-element in RASTERRUIMTE (paneel/lijn). `sterk` =
// geselecteerd (vol), anders hover (licht). Rand-highlights (wereldruimte)
// gaan apart, buiten de clip.
function _drawSubHighlight(ctx, geom, sub, sterk, lw) {
  ctx.save();
  ctx.globalAlpha = sterk ? 1 : 0.35;
  ctx.strokeStyle = SELECT_KLEUR;
  if (sub.kind === 'paneel') {
    const p = (geom.panels || []).find(q => q.ix === sub.ix && q.iy === sub.iy);
    if (p) {
      ctx.fillStyle = sterk ? 'rgba(0, 120, 215, 0.18)' : 'rgba(0, 120, 215, 0.08)';
      ctx.fillRect(p.x, p.y, p.w, p.h);
      ctx.lineWidth = Math.max(lw, 1);
      ctx.strokeRect(p.x, p.y, p.w, p.h);
    }
  } else if (sub.kind === 'lijn') {
    const lijst = sub.as === 'v' ? geom.linesV : geom.linesH;
    for (const l of lijst || []) {
      const idx = sub.as === 'v'
        ? Math.round((l.x - geom.origin.x) / geom.cellW)
        : Math.round((l.y - geom.origin.y) / geom.cellH);
      if (idx !== sub.index) continue;
      ctx.lineWidth = Math.max(lw * 2, 2);
      ctx.beginPath();
      for (const s of l.segs) {
        if (sub.as === 'v') { ctx.moveTo(l.x, s.a); ctx.lineTo(l.x, s.b); }
        else { ctx.moveTo(s.a, l.y); ctx.lineTo(s.b, l.y); }
      }
      ctx.stroke();
    }
  } else if (sub.kind === 'strook') {
    const st = (geom.stroken || []).find(q => q.index === sub.index);
    const bb = geom.rasterAabb;
    if (st && bb) {
      ctx.fillStyle = sterk ? 'rgba(0, 120, 215, 0.16)' : 'rgba(0, 120, 215, 0.07)';
      ctx.fillRect(st.x0, bb.y, st.x1 - st.x0, bb.height);
      ctx.lineWidth = Math.max(lw, 1);
      ctx.strokeRect(st.x0, bb.y, st.x1 - st.x0, bb.height);
    }
  } else if (sub.kind === 'sparing') {
    const sp = (geom.sparingen || []).find(q => q.id === sub.id);
    if (sp) {
      ctx.fillStyle = sterk ? 'rgba(0, 120, 215, 0.16)' : 'rgba(0, 120, 215, 0.07)';
      ctx.fillRect(sp.x, sp.y, sp.w, sp.h);
      ctx.lineWidth = Math.max(lw, 1);
      ctx.strokeRect(sp.x, sp.y, sp.w, sp.h);
    }
  }
  ctx.restore();
}

// Sparingsrand + raveelsymbool, in RASTERRUIMTE. Randlijn per regime:
// klein = dun, verzwaard = dik; raveel = dun + raveelijzers (dubbele dikke
// lijn met korte dwarsstreepjes) uit geom.raveels.
function _drawSparingen(ctx, geom, lw) {
  const k = geom.pxPerMm || 1;
  for (const sp of geom.sparingen || []) {
    ctx.lineWidth = sp.regime === 'verzwaard' ? lw * 2.2 : Math.max(lw * 0.6, 0.4);
    ctx.strokeRect(sp.x, sp.y, sp.w, sp.h);
  }
  const off = SYSTEEM_RAVEEL_OFFSET_MM * k;
  const steek = SYSTEEM_RAVEEL_STREEP_MM * k;
  for (const r of geom.raveels || []) {
    ctx.lineWidth = lw * 1.8;
    ctx.beginPath();
    ctx.moveTo(r.x1, r.y - off);
    ctx.lineTo(r.x2, r.y - off);
    ctx.moveTo(r.x1, r.y + off);
    ctx.lineTo(r.x2, r.y + off);
    ctx.stroke();
    // Korte dwarsstreepjes tussen de dubbele lijnen.
    ctx.lineWidth = Math.max(lw * 0.8, 0.5);
    ctx.beginPath();
    for (let x = r.x1 + steek / 2; x < r.x2; x += steek) {
      ctx.moveTo(x, r.y - off);
      ctx.lineTo(x, r.y + off);
    }
    ctx.stroke();
  }
}

/**
 * Teken een systeemraster-geometrie op een 2D-context.
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} geom  Resultaat van buildSysteemraster().
 * @param {{strokeColor:string, lineWidth:number, tagColor?:string|null,
 *          selectedSub?:object|null, hoverSub?:object|null,
 *          getSymbolImage?:(symbolId:string)=>CanvasImageSource|null}} style
 */
export function drawSysteemrasterGeom(ctx, geom, style) {
  if (!geom || !geom.contour || geom.contour.length < 3) return;
  const stroke = style?.strokeColor || '#000000';
  const lw = Number(style?.lineWidth) > 0 ? Number(style.lineWidth) : 1;
  const nodes = geom.nodes || geom.contour;

  ctx.save();
  ctx.strokeStyle = stroke;
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';
  ctx.setLineDash([]);

  // Contour (gesloten) — de veldbegrenzing, met echte bogen.
  ctx.lineWidth = lw;
  ctx.beginPath();
  _contourPath(ctx, nodes);
  ctx.stroke();

  // Rasterlijnen en panelen zijn RASTERRUIMTE-coördinaten; bij een
  // rasterhoek brengt de canvas-transform (rotatie om de pivot) ze terug
  // naar de wereld. De clip op de contour blijft in wereldruimte staan.
  const rot = geom.rot || null;
  const applyRot = () => {
    if (!rot) return;
    ctx.translate(rot.pivot.x, rot.pivot.y);
    ctx.rotate(rot.rad);
    ctx.translate(-rot.pivot.x, -rot.pivot.y);
  };

  ctx.save();
  applyRot();
  ctx.beginPath();
  for (const l of geom.linesV) {
    for (const s of l.segs) {
      ctx.moveTo(l.x, s.a);
      ctx.lineTo(l.x, s.b);
    }
  }
  for (const l of geom.linesH) {
    for (const s of l.segs) {
      ctx.moveTo(s.a, l.y);
      ctx.lineTo(s.b, l.y);
    }
  }
  ctx.stroke();
  ctx.restore();

  // Rasterruimte-overlay: paneel-overrides (stijl-decoraties + componenten-
  // in-cel), pas-markeringen (strook-layout), sparingen + raveels en de
  // sub-element-highlights — alles geclipt op de contour.
  const sel = style?.selectedSub || null;
  const hover = style?.hoverSub || null;
  const decorated = (geom.panels || []).filter(p => p.stijl !== 'tegel' || p.component);
  const heeftSparingen = (geom.sparingen || []).length > 0;
  const heeftPas = (geom.pasLijnen || []).length > 0;
  if (decorated.length > 0 || sel || hover || heeftSparingen || heeftPas) {
    ctx.save();
    ctx.beginPath();
    _contourPath(ctx, nodes);
    ctx.clip();
    applyRot();

    // Pas-markeringen: dunne extra lijn aan de paszijde van passtroken
    // (samen met de naad een "dunne dubbele lijn").
    if (heeftPas) {
      ctx.lineWidth = Math.max(lw * 0.5, 0.35);
      ctx.beginPath();
      for (const pl of geom.pasLijnen) {
        for (const s of pl.segs) {
          ctx.moveTo(pl.x, s.a);
          ctx.lineTo(pl.x, s.b);
        }
      }
      ctx.stroke();
    }

    // Paneel-decoraties, met de SPARINGEN eruit geknipt (even-odd-clip:
    // grote rechthoek + sparingsrechthoeken → alles behalve de gaten).
    if (decorated.length > 0) {
      ctx.save();
      if (heeftSparingen && geom.rasterAabb) {
        const bb = geom.rasterAabb;
        ctx.beginPath();
        ctx.rect(bb.x - bb.width, bb.y - bb.height, bb.width * 3, bb.height * 3);
        for (const sp of geom.sparingen) ctx.rect(sp.x, sp.y, sp.w, sp.h);
        ctx.clip('evenodd');
      }
      ctx.lineWidth = Math.max(lw * 0.6, 0.4);
      for (const p of decorated) {
        if (p.component) _drawPaneelComponent(ctx, p, style);
        else _drawPaneelStijl(ctx, p);
      }
      ctx.restore();
    }

    // Sparingsranden + raveelijzers.
    if (heeftSparingen) _drawSparingen(ctx, geom, lw);

    // Hover eerst (licht), selectie erover (vol) — rasterruimte-kinds.
    if (hover && hover.kind !== 'rand') _drawSubHighlight(ctx, geom, hover, false, lw);
    if (sel && sel.kind !== 'rand') _drawSubHighlight(ctx, geom, sel, true, lw);
    ctx.restore();
  }

  // Randprofiel per CONTOURSEGMENT (type-basis + instantie-overrides per
  // segment): hoeklijn = zwaardere lijn óp het segment; schaduwvoeg =
  // dunne gestreepte binnenlijn (miter-inzet); 'geen' = niets.
  for (const es of geom.edgeSegs || []) {
    if (es.profiel === 'hoeklijn' && es.pts.length >= 2) {
      ctx.lineWidth = lw * 2.5;
      _polyline(ctx, es.pts);
      ctx.lineWidth = lw;
    } else if (es.profiel === 'schaduwvoeg' && es.insetPts && es.insetPts.length >= 2) {
      ctx.setLineDash([4, 3]);
      ctx.lineWidth = Math.max(lw * 0.6, 0.4);
      _polyline(ctx, es.insetPts);
      ctx.setLineDash([]);
      ctx.lineWidth = lw;
    }
  }

  // Rand-highlights (wereldruimte, niet geclipt — de rand IS de contour).
  const randHighlight = (sub, sterk) => {
    const es = (geom.edgeSegs || []).find(e => e.seg === sub.seg);
    if (!es || es.pts.length < 2) return;
    ctx.save();
    ctx.globalAlpha = sterk ? 1 : 0.35;
    ctx.strokeStyle = SELECT_KLEUR;
    ctx.lineWidth = Math.max(lw * 2, 2.5);
    _polyline(ctx, es.pts);
    ctx.restore();
  };
  if (hover && hover.kind === 'rand') randHighlight(hover, false);
  if (sel && sel.kind === 'rand') randHighlight(sel, true);

  // Tag (plaatmaat "B×H"): blauwe klik-affordance bij selectie
  // (inline getalbewerking); anders de gewone lijnkleur.
  if (geom.tag) {
    const t = geom.tag;
    ctx.fillStyle = style?.tagColor || stroke;
    ctx.font = `${t.fontSize}px Arial`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(t.text, t.x, t.y);
  }

  ctx.restore();
}
