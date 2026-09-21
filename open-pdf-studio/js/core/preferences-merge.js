// Opgeslagen voorkeuren samenvoegen met de standaarden: elke sleutel die is
// opgeslagen wint, ontbrekende sleutels krijgen de standaard. Een opgeslagen
// `false` is dus een keuze en blijft staan, ook als de standaard later `true`
// wordt.
export function voegSamenMetStandaarden(standaarden, opgeslagen) {
  return { ...standaarden, ...(opgeslagen || {}) };
}
