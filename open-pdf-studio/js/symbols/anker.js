// Ankerpunten van een (gedraaid) symboolvak.
//
// Een parametrisch symbool is een vak {x, y, width, height} dat om zijn
// midden gedraaid wordt (annotation.rotation, graden, met de klok mee op
// het scherm). Voor inrichting — een closet, een fontein, een aanrecht —
// is het midden zelden het punt dat je kent: je kent het WANDVLAK. Daarom
// benoemen we een paar punten van het ongedraaide vak, met de achterkant
// (de wandzijde) aan de bovenrand:
//
//   center      het midden
//   back        het midden van de achterkant
//   back-left   de linkerhoek van de achterkant
//   back-right  de rechterhoek van de achterkant
//
// Twee toepassingen, één rekenregel:
//   * plaatsen: "zet dit punt van het symbool HIER" (MCP `anchor`);
//   * maat wijzigen: "houd dit punt vast terwijl het vak groeit" (een
//     aanrecht wordt langer vanuit zijn begin, niet vanuit zijn midden).
//
// De namen zijn Engels: ze zijn ook de buitenkant van de MCP-opdracht.

export const ANKERS = Object.freeze({
  center: Object.freeze([0.5, 0.5]),
  back: Object.freeze([0.5, 0]),
  'back-left': Object.freeze([0, 0]),
  'back-right': Object.freeze([1, 0]),
});

function fracties(anker) {
  return ANKERS[anker] || ANKERS.center;
}

/** Verschuiving van het midden naar het anker, gedraaid. */
function gedraaideAfstand(breedte, hoogte, rotatieGraden, anker) {
  const [fx, fy] = fracties(anker);
  const dx = (fx - 0.5) * breedte;
  const dy = (fy - 0.5) * hoogte;
  const a = (Number(rotatieGraden) || 0) * Math.PI / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return { x: dx * cos - dy * sin, y: dx * sin + dy * cos };
}

/** Paginapositie van een ankerpunt van een (gedraaid) vak. */
export function ankerPunt(vak, rotatieGraden, anker) {
  const cx = vak.x + vak.width / 2;
  const cy = vak.y + vak.height / 2;
  const d = gedraaideAfstand(vak.width, vak.height, rotatieGraden, anker);
  return { x: cx + d.x, y: cy + d.y };
}

/** Het vak met deze maat waarvan het ankerpunt precies op `punt` ligt. */
export function vakUitAnker(punt, breedte, hoogte, rotatieGraden, anker) {
  const d = gedraaideAfstand(breedte, hoogte, rotatieGraden, anker);
  const cx = punt.x - d.x;
  const cy = punt.y - d.y;
  return { x: cx - breedte / 2, y: cy - hoogte / 2, width: breedte, height: hoogte };
}

/** Nieuwe maat voor een vak, met het ankerpunt op dezelfde paginaplek. */
export function vakMetVastAnker(vak, rotatieGraden, breedte, hoogte, anker) {
  return vakUitAnker(ankerPunt(vak, rotatieGraden, anker), breedte, hoogte, rotatieGraden, anker);
}

// ── Maatwijziging en MCP-invoer ──────────────────────────────────────────

/**
 * Welk punt blijft staan als een symbool van maat verandert? De aanroeper
 * vraagt 'center' (de gewone regel) of 'topleft'; een template met
 * `maatAnker(params)` mag 'center' vervangen door zijn eigen punt — een
 * closet groeit vanaf de wand, een aanrecht vanaf zijn begin.
 */
export function maatAnkerVoor(template, params, gevraagd = 'center') {
  if (gevraagd === 'center' && typeof template?.maatAnker === 'function') {
    const eigen = template.maatAnker(params || {});
    if (ANKERS[eigen]) return eigen;
  }
  return gevraagd;
}

/**
 * Het vak na een maatwijziging. Een anker uit ANKERS blijft op zijn
 * paginaplek (ook gedraaid); elk ander anker ('topleft') houdt x/y.
 */
export function vakNaMaatwijziging(vak, rotatieGraden, breedte, hoogte, anker) {
  if (ANKERS[anker]) return vakMetVastAnker(vak, rotatieGraden, breedte, hoogte, anker);
  return { x: vak.x, y: vak.y, width: breedte, height: hoogte };
}

/**
 * Het `anchor`-argument van app_create_annotation: leeg = midden, anders
 * een van de vaste namen.
 */
export function ankerArgument(waarde) {
  if (waarde === undefined || waarde === null || waarde === '') return { ok: true, anker: 'center' };
  if (typeof waarde === 'string' && ANKERS[waarde]) return { ok: true, anker: waarde };
  return { ok: false, error: `props.anchor must be one of: ${Object.keys(ANKERS).join(', ')}` };
}

/**
 * Parameters bijwerken via MCP: SAMENVOEGEN, niet vervangen. Wie alleen
 * {lengte: 3600} stuurt, verliest de onderdelen van het aanrecht niet.
 */
export function voegParamsSamen(oud, patch) {
  const basis = oud && typeof oud === 'object' && !Array.isArray(oud) ? oud : {};
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return { ...basis };
  return { ...basis, ...patch };
}
