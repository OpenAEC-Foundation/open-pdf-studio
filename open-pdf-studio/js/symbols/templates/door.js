// Parametric door symbol — a door frame in plan.
//
// With a wall thickness (`wallThickness`) the symbol draws a real frame:
// timber stiles with a rebate, a door leaf of real thickness hinged in the
// rebate on the side it opens to, and the swing arc (see
// js/plattegrond/kozijn.js). The bbox holds the wall zone plus the swing;
// the INSIDE of the wall is at the top of the bbox.
//
// Doors from older documents have no wall thickness: their bbox is the
// square swing with the hinge line at the bottom edge, and they keep that
// drawing (legacyRender below).
//
// Coords: app coords (top-left origin, y-down).
import { heeftKozijnOpbouw, kozijnTekenopdrachten } from '../../plattegrond/kozijn.js';

function legacyRender(params, bbox) {
  const cmds = [];
  const x = bbox.x, y = bbox.y, w = bbox.width, h = bbox.height;
  const swing = params.swing || 'left';
  const angleDeg = Math.max(1, Math.min(180, Number(params.angle) || 90));
  // Hinge at bottom-left for 'left' swing, bottom-right for 'right'
  const hingeX = swing === 'left' ? x : x + w;
  const hingeY = y + h;
  const r = Math.min(w, h);
  // Door leaf line: from hinge at angle (0 = along bottom, 90 = vertical up)
  const rad = angleDeg * Math.PI / 180;
  let leafEndX, leafEndY;
  if (swing === 'left') {
    leafEndX = hingeX + r * Math.cos(rad);
    leafEndY = hingeY - r * Math.sin(rad);
  } else {
    leafEndX = hingeX - r * Math.cos(rad);
    leafEndY = hingeY - r * Math.sin(rad);
  }
  cmds.push({ kind: 'line', x1: hingeX, y1: hingeY, x2: leafEndX, y2: leafEndY });
  // Swing arc from the open leaf back to the closed position along the wall.
  let a0, a1, ccw;
  if (swing === 'left') {
    a0 = -rad; a1 = 0; ccw = false;
  } else {
    a0 = Math.PI + rad; a1 = Math.PI; ccw = true;
  }
  cmds.push({ kind: 'arc', cx: hingeX, cy: hingeY, r, a0, a1, ccw });
  if (params.showWall) {
    cmds.push({ kind: 'line', x1: x, y1: hingeY, x2: x + w, y2: hingeY, dash: [6, 3] });
  }
  return cmds;
}

export const doorTemplate = {
  id: 'door',
  name: 'Deur',
  nameEn: 'Door',
  category: 'NEN1414',
  defaultSize: { width: 90, height: 90 },
  params: [
    { key: 'width', label: 'Kozijnmaat', labelEn: 'Frame size', type: 'number', default: 900, min: 100, max: 4000, step: 10, unit: 'mm' },
    { key: 'wallThickness', label: 'Wanddikte', labelEn: 'Wall thickness', type: 'number', default: 100, min: 20, max: 1000, step: 10, unit: 'mm' },
    { key: 'swing', label: 'Draairichting', labelEn: 'Swing', type: 'enum', options: [
        { value: 'left', label: 'Links' },
        { value: 'right', label: 'Rechts' }
      ], default: 'left' },
    { key: 'draaiNaar', label: 'Draait naar', labelEn: 'Opens to', type: 'enum', options: [
        { value: 'binnen', label: 'Binnen' },
        { value: 'buiten', label: 'Buiten' }
      ], default: 'binnen' },
    { key: 'angle', label: 'Openingshoek', labelEn: 'Opening angle', type: 'number', default: 90, min: 5, max: 180, step: 5, unit: '°' },
    { key: 'stijlBreedteMm', label: 'Kozijnhout breedte', labelEn: 'Frame timber width', type: 'number', default: 67, min: 20, max: 300, step: 1, unit: 'mm' },
    { key: 'stijlDiepteMm', label: 'Kozijnhout diepte', labelEn: 'Frame timber depth', type: 'number', default: 114, min: 20, max: 400, step: 1, unit: 'mm' },
    { key: 'kozijnPositieMm', label: 'Positie vanaf buitenkant (-1 = midden)', labelEn: 'Position from outside face (-1 = centred)', type: 'number', default: -1, min: -1, max: 1000, step: 5, unit: 'mm' },
    { key: 'aanslagMm', label: 'Aanslag buitenblad', labelEn: 'Outer leaf overlap', type: 'number', default: 0, min: 0, max: 100, step: 1, unit: 'mm' },
    { key: 'binnenSpelingMm', label: 'Speling binnenblad', labelEn: 'Inner leaf clearance', type: 'number', default: 0, min: 0, max: 100, step: 1, unit: 'mm' },
    { key: 'deurbladDikteMm', label: 'Deurblad dikte', labelEn: 'Door leaf thickness', type: 'number', default: 40, min: 10, max: 120, step: 1, unit: 'mm' },
    { key: 'showWall', label: 'Toon muur', labelEn: 'Show wall', type: 'boolean', default: false },
  ],
  // Returns array of draw commands. bbox: {x,y,width,height}
  render(params, bbox) {
    if (!heeftKozijnOpbouw(params)) return legacyRender(params, bbox);
    return kozijnTekenopdrachten('deur', params, bbox);
  }
};
