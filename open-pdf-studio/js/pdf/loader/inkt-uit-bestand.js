// Drukgevoelige inkt (#385) uit het bestand: de eigen sleutels die
// color-extraction.js las (saver/inkt-sleutels.js) naar het model. De druk
// hoort bij de punten van de eerste /InkList; past het aantal niet (een ander
// programma bewerkte de streek), dan valt de druk weg en blijft de streek
// een gewone inktlijn met vaste breedte.

export function inktUitBestand(extra, aantalPunten) {
  const uit = {};
  if (!extra) return uit;
  if (Array.isArray(extra.inkPressures) && extra.inkPressures.length === aantalPunten && aantalPunten > 0) {
    uit.pressures = extra.inkPressures.slice();
    if (extra.inkMinWidth !== undefined) uit.inkMinWidth = extra.inkMinWidth;
    if (extra.inkPressureOff) uit.inkPressure = false;
  }
  if (extra.inkSmoothing !== undefined) uit.inkSmoothing = extra.inkSmoothing;
  return uit;
}
