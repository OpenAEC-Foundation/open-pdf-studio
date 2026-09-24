// De laag van een geladen annotatie (#468). createAnnotation zet op een nieuwe
// annotatie de huidige laag van het ACTIEVE document; bij het laden is dat
// fout (het bestand zegt waar een annotatie hoort, en het document dat laadt
// kan een achtergrondtab zijn). Dus na de omzetting: de laag uit het bestand,
// of geen veld (= standaardlaag). Geldt ook voor de extra annotaties die de
// omzetting naast de hoofdannotatie maakt.

export function zetLaagUitBestand(ann, laagId) {
  if (!ann || typeof ann !== 'object') return ann;
  const extra = Array.isArray(ann.__extraAnnotations) ? ann.__extraAnnotations : [];
  for (const a of [ann, ...extra]) {
    if (!a || typeof a !== 'object') continue;
    if (typeof laagId === 'string' && laagId) a.layer = laagId;
    else delete a.layer;
  }
  return ann;
}
