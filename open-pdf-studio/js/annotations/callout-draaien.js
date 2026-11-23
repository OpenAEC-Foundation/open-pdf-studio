// The leader of a callout on a rotated box (#1240).
//
// A callout is a text box (x, y, width, height, rotation about its centre)
// with a leader: from the box edge (armOrigin) through a knee to the arrow
// tip. The leader was worked out for the unrotated box and drawn unrotated, so
// after rotating the box its start hung in the air, and the arrow stayed
// where it was.
//
// Here the leader is worked out in the frame of the box: the arrow tip is
// taken into that frame, the edge and the knee are chosen there the way they
// always were, and both are turned back onto the page. So the leader starts on
// the edge of the box at every angle. Rotating the callout turns the arrow tip
// with it; the tip stays a point of its own that can be dragged afterwards.
//
// Pure: no DOM, no app state.

const RAD = Math.PI / 180;

/** Point (x, y) turned about (cx, cy), in the direction the canvas turns a box. */
export function draaiPunt(x, y, cx, cy, graden) {
  const h = graden * RAD;
  const cos = Math.cos(h);
  const sin = Math.sin(h);
  const dx = x - cx;
  const dy = y - cy;
  return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
}

const maat = (ann) => ({ w: ann.width || 150, h: ann.height || 50 });
const draaiing = (ann) => (Number.isFinite(Number(ann?.rotation)) ? Number(ann.rotation) : 0);

/** The arrow tip of a callout, with the place it has when none is stored. */
export function calloutPunt(ann) {
  const { h } = maat(ann);
  return {
    x: ann.arrowX !== undefined ? ann.arrowX : ann.x - 60,
    y: ann.arrowY !== undefined ? ann.arrowY : ann.y + h,
  };
}

/**
 * Where the leader leaves the box and where its knee is, for the box as it
 * lies on the page (rotated or not) and the arrow tip where it is.
 * `wasVertical` keeps the side from flipping while the tip is dragged past a
 * corner (the same hysteresis as before).
 * @returns {{armOriginX:number, armOriginY:number, kneeX:number, kneeY:number, vertical:boolean}}
 */
export function calloutLeider(ann, wasVertical = false) {
  const { w, h } = maat(ann);
  const cx = ann.x + w / 2;
  const cy = ann.y + h / 2;
  const hoek = draaiing(ann);
  const tip = calloutPunt(ann);
  // The tip in the frame of the box.
  const t = hoek ? draaiPunt(tip.x, tip.y, cx, cy, -hoek) : tip;

  const hDist = t.x < ann.x ? ann.x - t.x : t.x > ann.x + w ? t.x - (ann.x + w) : 0;
  const vDist = t.y < ann.y ? ann.y - t.y : t.y > ann.y + h ? t.y - (ann.y + h) : 0;
  const drempel = 20;
  const vertical = wasVertical ? !(hDist > vDist + drempel) : vDist > hDist + drempel;

  let arm;
  let knie;
  if (!vertical) {
    const links = t.x < cx;
    arm = { x: links ? ann.x : ann.x + w, y: cy };
    const lengte = Math.min(30, Math.abs(t.x - arm.x) * 0.4);
    knie = { x: links ? arm.x - lengte : arm.x + lengte, y: arm.y };
  } else {
    const boven = t.y < cy;
    arm = { x: cx, y: boven ? ann.y : ann.y + h };
    const lengte = Math.min(30, Math.abs(t.y - arm.y) * 0.4);
    knie = { x: arm.x, y: boven ? arm.y - lengte : arm.y + lengte };
  }
  // Back onto the page.
  if (hoek) {
    arm = draaiPunt(arm.x, arm.y, cx, cy, hoek);
    knie = draaiPunt(knie.x, knie.y, cx, cy, hoek);
  }
  return { armOriginX: arm.x, armOriginY: arm.y, kneeX: knie.x, kneeY: knie.y, vertical };
}

/** Put the leader of the callout on its box (after a move, a resize or a turn). */
export function zetCalloutLeider(ann) {
  const l = calloutLeider(ann, ann._leaderVertical);
  ann._leaderVertical = l.vertical;
  ann.armOriginX = l.armOriginX;
  ann.armOriginY = l.armOriginY;
  ann.kneeX = l.kneeX;
  ann.kneeY = l.kneeY;
  return ann;
}

/**
 * Give the callout a new rotation: the box turns about its centre and the
 * arrow tip turns with it over the same angle, so box, knee and arrow stay
 * one figure.
 * @param {object} ann  the callout
 * @param {number} nieuw  the new rotation in degrees
 */
export function zetCalloutRotatie(ann, nieuw) {
  const oud = draaiing(ann);
  const doel = Number.isFinite(Number(nieuw)) ? Number(nieuw) : 0;
  const delta = doel - oud;
  if (delta) {
    const { w, h } = maat(ann);
    const tip = calloutPunt(ann);
    const gedraaid = draaiPunt(tip.x, tip.y, ann.x + w / 2, ann.y + h / 2, delta);
    ann.arrowX = gedraaid.x;
    ann.arrowY = gedraaid.y;
  }
  ann.rotation = doel;
  return zetCalloutLeider(ann);
}
