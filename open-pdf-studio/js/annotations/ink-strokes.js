// Keep one point array for moving, resizing and rotating an entire annotation.
// Only compound ink needs the offsets where the pen lifted.
export function inkPathFromStrokes(strokes) {
  const path = [];
  const strokeStarts = [];
  for (const stroke of strokes) {
    if (!stroke.length) continue;
    if (path.length) strokeStarts.push(path.length);
    for (const point of stroke) path.push(point);
  }
  return strokeStarts.length ? { path, strokeStarts } : { path };
}

export function inkStrokes(annotation) {
  if (!annotation.strokeStarts?.length) return [annotation];
  const ends = [...annotation.strokeStarts, annotation.path.length];
  let start = 0;
  return ends.map(end => {
    const path = annotation.path.slice(start, end);
    const pressures = start === 0 ? annotation.pressures : undefined;
    start = end;
    return { ...annotation, path, pressures, strokeStarts: undefined };
  });
}
