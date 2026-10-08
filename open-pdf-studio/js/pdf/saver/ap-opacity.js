// How an annotation's opacity ends up inside its /AP stream. Viewers that
// display the stored appearance (instead of regenerating it from /CA) show a
// 40% annotation at 100% unless the appearance applies the alpha itself.
//
// annotOpacity: the annotation's /CA (0..1). fillAlpha: a separate fill-only
// alpha (the /GSf state, drawn inside q...Q) that sits on top of it.
// Returns the content prefix to put first in the stream, the alpha for the
// overall /GSo state (undefined = none) and the effective fill alpha for /GSf.
export function apOpacityPlan(annotOpacity, fillAlpha) {
  const o = typeof annotOpacity === 'number' && annotOpacity > 0 && annotOpacity < 1
    ? annotOpacity : undefined;
  const f = typeof fillAlpha === 'number' && fillAlpha >= 0 && fillAlpha < 1
    ? fillAlpha : undefined;
  return {
    prefix: o !== undefined ? '/GSo gs\n' : '',
    overall: o,
    fill: f === undefined ? undefined : f * (o ?? 1),
  };
}
