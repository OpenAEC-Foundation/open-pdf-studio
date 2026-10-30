// Preview geometry comes from the print layout, never a second tile-count rule.
function intersection(a, b) {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  const width = Math.min(a.x + a.width, b.x + b.width) - x;
  const height = Math.min(a.y + a.height, b.y + b.height) - y;
  return width > 0 && height > 0 ? { x, y, width, height } : null;
}

function rect(r) {
  return { x: r.x, y: r.y, width: r.breedte, height: r.hoogte };
}

export function posterGrid(layout) {
  if (!layout?.vellen?.length) return null;
  const first = layout.vellen[0];
  const page = layout.getegeld
    ? { x: 0, y: 0, width: layout.paginaMm.breedte, height: layout.paginaMm.hoogte }
    : rect(first.plaatsing.pagina);
  const tiles = layout.vellen.map(v => ({
    ...rect(v.tegel || { x: 0, y: 0, breedte: v.vel.breedteMm, hoogte: v.vel.hoogteMm }),
    number: v.nummer, row: v.rij, col: v.kol,
  }));
  let x = page.x, y = page.y, right = page.x + page.width, bottom = page.y + page.height;
  const overlaps = [];
  tiles.forEach((tile, i) => {
    x = Math.min(x, tile.x); y = Math.min(y, tile.y);
    right = Math.max(right, tile.x + tile.width); bottom = Math.max(bottom, tile.y + tile.height);
    for (const j of [tile.col < layout.kolommen ? i + 1 : -1, i + layout.kolommen]) {
      if (j < 0 || j >= tiles.length) continue;
      const overlap = intersection(tile, tiles[j]);
      if (overlap) overlaps.push(overlap);
    }
  });
  return { page, tiles, overlaps, bounds: { x, y, width: right - x, height: bottom - y } };
}

// The same repeated strips, translated to the selected physical sheet.
export function posterSheetOverlaps(layout, sheet) {
  if (!layout?.getegeld || !sheet?.tegel) return [];
  const i = sheet.nummer - 1;
  const tile = rect(sheet.tegel);
  const neighbours = [
    sheet.kol > 1 ? i - 1 : -1,
    sheet.kol < layout.kolommen ? i + 1 : -1,
    sheet.rij > 1 ? i - layout.kolommen : -1,
    sheet.rij < layout.rijen ? i + layout.kolommen : -1,
  ];
  return neighbours.flatMap(j => {
    if (j < 0) return [];
    const overlap = intersection(tile, rect(layout.vellen[j].tegel));
    return overlap ? [{ ...overlap,
      x: overlap.x - tile.x + sheet.venster.x,
      y: overlap.y - tile.y + sheet.venster.y,
    }] : [];
  });
}
