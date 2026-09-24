// Parametric stramien (structural grid line) — chain-dashed line with a
// numbered bubble at one or both ends, per Dutch drafting convention.
export const stramienTemplate = {
  id: 'stramien',
  name: 'Stramien',
  nameEn: 'Grid line',
  category: 'NL',
  defaultSize: { width: 36, height: 280 },
  params: [
    { key: 'label', label: 'Nummer', labelEn: 'Label', type: 'string', default: '1' },
    { key: 'orientation', label: 'Richting', labelEn: 'Orientation', type: 'enum', default: 'verticaal',
      options: [
        { value: 'verticaal', label: 'Verticaal' },
        { value: 'horizontaal', label: 'Horizontaal' },
      ] },
    { key: 'bollen', label: 'Bollen', labelEn: 'Bubbles', type: 'enum', default: 'begin',
      options: [
        { value: 'begin', label: 'Eén bol (begin)' },
        { value: 'einde', label: 'Eén bol (einde)' },
        { value: 'beide', label: 'Twee bollen' },
      ] },
    { key: 'dashed', label: 'Streep-punt lijn', labelEn: 'Chain-dashed', type: 'boolean', default: true },
    // Koppeling van de uiteinden met die van andere stramienlijnen (zie
    // annotations/stramien-koppeling.js). Verborgen: het paneel toont er een
    // eigen schakelaar voor, en een groeps-id hoort nooit gereedschapsstandaard
    // te worden. Staat in params zodat hij met OPS_Params mee opgeslagen wordt.
    { key: 'koppelBegin', label: 'Koppelgroep begin', labelEn: 'Start alignment group', type: 'string', default: '', hidden: true },
    { key: 'koppelEinde', label: 'Koppelgroep einde', labelEn: 'End alignment group', type: 'string', default: '', hidden: true },
    { key: 'losBegin', label: 'Begin losgezet', labelEn: 'Start unlocked', type: 'boolean', default: false, hidden: true },
    { key: 'losEinde', label: 'Einde losgezet', labelEn: 'End unlocked', type: 'boolean', default: false, hidden: true },
  ],
  // Geometry shared by render() and snapPoints().
  _layout(params, bbox) {
    const { x, y, width: w, height: h } = bbox;
    const vertical = (params.orientation || 'verticaal') === 'verticaal';
    const r = Math.max(8, Math.min(vertical ? w / 2 : h / 2, (vertical ? h : w) * 0.12));
    const mode = params.bollen || (params.bubbleEnd ? 'einde' : 'begin'); // bubbleEnd = legacy
    const atStart = mode === 'begin' || mode === 'beide';
    const atEnd = mode === 'einde' || mode === 'beide';
    if (vertical) {
      const cx = x + w / 2;
      return {
        vertical, r, atStart, atEnd,
        startBubble: { x: cx, y: y + r },
        endBubble: { x: cx, y: y + h - r },
        lineA: { x: cx, y: atStart ? y + 2 * r : y },
        lineB: { x: cx, y: atEnd ? y + h - 2 * r : y + h },
      };
    }
    const cy = y + h / 2;
    return {
      vertical, r, atStart, atEnd,
      startBubble: { x: x + r, y: cy },
      endBubble: { x: x + w - r, y: cy },
      lineA: { x: atStart ? x + 2 * r : x, y: cy },
      lineB: { x: atEnd ? x + w - 2 * r : x + w, y: cy },
    };
  },
  render(params, bbox) {
    const cmds = [];
    const L = this._layout(params, bbox);
    const label = String(params.label ?? '1');
    const dash = params.dashed ? [12, 4, 2, 4] : undefined; // streep-punt

    cmds.push({ kind: 'line', x1: L.lineA.x, y1: L.lineA.y, x2: L.lineB.x, y2: L.lineB.y, dash });
    if (L.atStart) {
      cmds.push({ kind: 'circle', cx: L.startBubble.x, cy: L.startBubble.y, r: L.r });
      cmds.push({ kind: 'text', x: L.startBubble.x, y: L.startBubble.y, text: label, size: L.r * 1.1, bold: true });
    }
    if (L.atEnd) {
      cmds.push({ kind: 'circle', cx: L.endBubble.x, cy: L.endBubble.y, r: L.r });
      cmds.push({ kind: 'text', x: L.endBubble.x, y: L.endBubble.y, text: label, size: L.r * 1.1, bold: true });
    }
    return cmds;
  },
  // Object-snap candidates: the grid line's endpoints + midpoint, and bubble
  // centres — so dimensions and lines snap onto the stramien.
  snapPoints(params, bbox) {
    const L = this._layout(params, bbox);
    const pts = [
      { x: L.lineA.x, y: L.lineA.y, kind: 'endpoint' },
      { x: L.lineB.x, y: L.lineB.y, kind: 'endpoint' },
      { x: (L.lineA.x + L.lineB.x) / 2, y: (L.lineA.y + L.lineB.y) / 2, kind: 'midpoint' },
    ];
    if (L.atStart) pts.push({ x: L.startBubble.x, y: L.startBubble.y, kind: 'center' });
    if (L.atEnd) pts.push({ x: L.endBubble.x, y: L.endBubble.y, kind: 'center' });
    return pts;
  }
};
