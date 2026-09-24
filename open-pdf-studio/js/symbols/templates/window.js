// Parametric window symbol — a window frame in plan.
//
// The bbox is the frame width along the wall and the wall thickness across
// it (for a hosted window: the whole wall build-up). Inside it the symbol
// draws the frame at real size: timber stiles with a rebate, glazing in the
// rebate (two lines at 1:50, one at 1:100), a sash for opening windows and
// the sill in view below the cut (see js/plattegrond/kozijn.js). The INSIDE
// of the wall is at the top of the bbox.
import { kozijnTekenopdrachten } from '../../plattegrond/kozijn.js';

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
    return kozijnTekenopdrachten('raam', params, bbox);
  }
};
