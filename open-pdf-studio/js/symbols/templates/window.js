// Parametric window symbol — a window frame in plan.
//
// The bbox is the frame width along the wall and the wall thickness across
// it (for a hosted window: the whole wall build-up). Inside it the symbol
// draws the frame at real size: timber stiles with a rebate, glazing in the
// rebate (two lines at 1:50, one at 1:100), a sash for opening windows and
// the sill in view below the cut (see js/plattegrond/kozijn.js). The INSIDE
// of the wall is at the top of the bbox.
//
// Windows from older documents have no frame timber (`stijlBreedteMm`) in
// their params: they keep their old drawing (legacyRender below), on screen
// and in a saved PDF.
import { heeftKozijnOpbouw, kozijnTekenopdrachten } from '../../plattegrond/kozijn.js';

function legacyRender(params, bbox) {
  const cmds = [];
  const x = bbox.x, y = bbox.y, w = bbox.width, h = bbox.height;
  // Two parallel "frame" lines along the bbox top/bottom
  cmds.push({ kind: 'line', x1: x, y1: y, x2: x + w, y2: y });
  cmds.push({ kind: 'line', x1: x, y1: y + h, x2: x + w, y2: y + h });
  // Two glass lines in the middle (the parallel pair representing glazing)
  const cy = y + h / 2;
  const inset = h * 0.18;
  cmds.push({ kind: 'line', x1: x, y1: cy - inset, x2: x + w, y2: cy - inset });
  cmds.push({ kind: 'line', x1: x, y1: cy + inset, x2: x + w, y2: cy + inset });
  // End caps
  cmds.push({ kind: 'line', x1: x, y1: y, x2: x, y2: y + h });
  cmds.push({ kind: 'line', x1: x + w, y1: y, x2: x + w, y2: y + h });
  // Type indicator: small symbol in the centre
  if (params.type === 'pivot') {
    // Diagonal X across centre band
    cmds.push({ kind: 'line', x1: x + w / 2 - 6, y1: cy - inset, x2: x + w / 2 + 6, y2: cy + inset });
    cmds.push({ kind: 'line', x1: x + w / 2 - 6, y1: cy + inset, x2: x + w / 2 + 6, y2: cy - inset });
  } else if (params.type === 'tilt') {
    // Single diagonal indicating tilt
    cmds.push({ kind: 'line', x1: x, y1: cy + inset, x2: x + w, y2: cy - inset, dash: [3, 2] });
  }
  return cmds;
}

export const windowTemplate = {
  id: 'window',
  name: 'Raam',
  nameEn: 'Window',
  category: 'NEN1414',
  defaultSize: { width: 120, height: 24 },
  params: [
    { key: 'width', label: 'Kozijnmaat', labelEn: 'Frame size', type: 'number', default: 1200, min: 200, max: 6000, step: 10, unit: 'mm' },
    { key: 'wallThickness', label: 'Muurdikte', labelEn: 'Wall thickness', type: 'number', default: 240, min: 50, max: 1000, step: 10, unit: 'mm' },
    { key: 'type', label: 'Type', labelEn: 'Type', type: 'enum', options: [
        { value: 'fixed', label: 'Vast' },
        { value: 'turn', label: 'Draai' },
        { value: 'pivot', label: 'Tuimel' },
        { value: 'tilt', label: 'Klap' }
      ], default: 'fixed' },
    { key: 'draairichtingTonen', label: 'Draairichting tonen', labelEn: 'Show opening direction', type: 'boolean', default: false },
    { key: 'swing', label: 'Scharnierzijde', labelEn: 'Hinge side', type: 'enum', options: [
        { value: 'left', label: 'Links' },
        { value: 'right', label: 'Rechts' }
      ], default: 'left' },
    { key: 'borstweringMm', label: 'Borstwering', labelEn: 'Sill height', type: 'number', default: 850, min: 0, max: 3000, step: 10, unit: 'mm' },
    { key: 'stijlBreedteMm', label: 'Kozijnhout breedte', labelEn: 'Frame timber width', type: 'number', default: 67, min: 20, max: 300, step: 1, unit: 'mm' },
    { key: 'stijlDiepteMm', label: 'Kozijnhout diepte', labelEn: 'Frame timber depth', type: 'number', default: 114, min: 20, max: 400, step: 1, unit: 'mm' },
    { key: 'kozijnPositieMm', label: 'Positie vanaf buitenkant (-1 = midden)', labelEn: 'Position from outside face (-1 = centred)', type: 'number', default: -1, min: -1, max: 1000, step: 5, unit: 'mm' },
    { key: 'aanslagMm', label: 'Aanslag buitenblad', labelEn: 'Outer leaf overlap', type: 'number', default: 0, min: 0, max: 100, step: 1, unit: 'mm' },
    { key: 'binnenSpelingMm', label: 'Speling binnenblad', labelEn: 'Inner leaf clearance', type: 'number', default: 0, min: 0, max: 100, step: 1, unit: 'mm' },
  ],
  render(params, bbox) {
    if (!heeftKozijnOpbouw(params, 'raam')) return legacyRender(params, bbox);
    return kozijnTekenopdrachten('raam', params, bbox);
  }
};
