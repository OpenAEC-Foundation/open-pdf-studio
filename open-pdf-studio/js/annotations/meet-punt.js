// Schaal op de gemeten punten, niet op de verschoven maatlijn (#1046).
// Zonder hulplijnen blijft het midden van de lijn of de punten gelden.
export function meetPunt(ann) {
  if ([ann?.leaderStartX, ann?.leaderStartY, ann?.leaderEndX, ann?.leaderEndY].every(Number.isFinite)) {
    return { x: (ann.leaderStartX + ann.leaderEndX) / 2, y: (ann.leaderStartY + ann.leaderEndY) / 2 };
  }
  const punten = Array.isArray(ann?.points) ? ann.points : null;
  if (punten && punten.length > 0 && ann.startX === undefined) {
    let x = 0, y = 0;
    for (const p of punten) { x += p.x; y += p.y; }
    return { x: x / punten.length, y: y / punten.length };
  }
  return { x: (ann.startX + ann.endX) / 2, y: (ann.startY + ann.endY) / 2 };
}

