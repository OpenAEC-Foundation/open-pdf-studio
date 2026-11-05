import { overspanningspijlVloerTemplate } from './overspanningspijl-vloer.js';

// Separate template so existing floor-span arrows keep their saved shape.
// U+294B: left barb down, right barb up. Draw vectors, not a font glyph.
export const overspanningsharpoenTemplate = {
  ...overspanningspijlVloerTemplate,
  id: 'overspanningsharpoen-vloer',
  name: 'Overspanningsrichting vloer (⥋)',
  nameEn: 'Floor span direction (harpoon)',
  render(params, bbox) {
    const cmds = overspanningspijlVloerTemplate.render(params, bbox);
    let left = true;
    return cmds.map(cmd => {
      if (cmd.role !== 'pijlpunt') return cmd;
      const points = left ? cmd.points.slice(1) : cmd.points.slice(0, 2);
      left = false;
      return { ...cmd, points };
    });
  },
};
