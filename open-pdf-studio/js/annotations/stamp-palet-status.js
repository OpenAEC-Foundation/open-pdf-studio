// Is the stamp palette (left panel tab) open? The Stamp tool then does not
// open the picker dialog: the palette is where the stamp is chosen.
// Kept apart from the Solid store so the vanilla tool code can read it.

let zichtbaar = false;

export function zetPaletZichtbaar(waarde) {
  zichtbaar = !!waarde;
}

export function paletZichtbaar() {
  return zichtbaar;
}
