// Cache van de snap-geometrie (punten, randen, ruimtelijke index) per
// document en pagina (#705).
//
// De cache stond eerst alleen op paginanummer. Daardoor:
// - bleef de geometrie van een gesloten tekening staan zolang er nog een
//   ander tabblad open was, en diende ze daar als snap-geometrie van
//   pagina 1 van dat andere document;
// - legde een extractie die bij het sluiten nog liep haar resultaat neer ná
//   het legen van de cache (clearPdfVectorCache): bij MV-03 bleef zo na het
//   sluiten ruim 80 MB aan punten en randen voor altijd staan, en sloeg de
//   volgende opening de extractie over met die verouderde geometrie.
//
// De sleutel is nu `<bestandspad>:<pagina>` (zoals de andere caches per
// document, zodat geefDocumentVrij ze per pad kan vrijgeven), en een
// resultaat wordt alleen bewaard als de cache intussen niet geleegd is en
// het document nog open staat.
//
// Puur en zonder app-imports, zodat het onder node te testen is.

/** Sleutel van een document: het pad, of het id voor een document zonder pad. */
export function documentSleutel(doc) {
  if (!doc) return null;
  if (doc.filePath) return doc.filePath;
  return doc.id != null ? `__memory__${doc.id}` : null;
}

/**
 * @param {object} [opties]
 * @param {(doc: object) => boolean} [opties.isOpen]  staat dit document nog open?
 */
export function maakSnapGeometrieCache({ isOpen = () => true } = {}) {
  const klaar = new Map();  // "<documentsleutel>:<pagina>" -> { points, edges, index }
  const bezig = new Map();  // dezelfde sleutel -> lopende belofte

  const sleutel = (doc, pagina) => {
    const d = documentSleutel(doc);
    return d ? `${d}:${pagina}` : null;
  };

  // De punten liggen in geroteerde paginacoordinaten. Bewaar per pagina
  // alleen de laatste stand, ook als een oudere extractie nog loopt.
  const rotatie = (doc, pagina) => doc?.pageRotations?.[pagina] || 0;
  const passend = (map, doc, pagina) => {
    const item = map.get(sleutel(doc, pagina));
    return item?.rotatie === rotatie(doc, pagina) ? item : null;
  };

  return {
    sleutel,

    /** Het resultaat voor deze pagina van dit document, of null. */
    get(doc, pagina) {
      return passend(klaar, doc, pagina)?.resultaat ?? null;
    },

    heeft(doc, pagina) {
      return !!passend(klaar, doc, pagina);
    },

    /** De lopende extractie voor deze pagina van dit document, of null. */
    lopend(doc, pagina) {
      return passend(bezig, doc, pagina)?.belofte ?? null;
    },

    /**
     * Start de extractie (eenmaal per pagina tegelijk) en bewaart het
     * resultaat, tenzij de cache (of dit pad) intussen geleegd is of het
     * document dicht is: dan staat de belofte niet meer in `bezig`.
     * @param {() => Promise<object>} extraheer
     * @returns {Promise<void>|null}
     */
    laad(doc, pagina, extraheer) {
      const k = sleutel(doc, pagina);
      if (!k) return null;
      if (passend(klaar, doc, pagina)) return Promise.resolve();
      const lopend = passend(bezig, doc, pagina);
      if (lopend) return lopend.belofte;
      klaar.delete(k);
      const stand = rotatie(doc, pagina);
      const belofte = Promise.resolve()
        .then(extraheer)
        .then((resultaat) => {
          if (bezig.get(k)?.belofte === belofte && rotatie(doc, pagina) === stand && isOpen(doc)) {
            klaar.set(k, { rotatie: stand, resultaat });
          }
        })
        .catch(() => { /* afgebroken of mislukt: niets bewaren */ })
        .finally(() => {
          if (bezig.get(k)?.belofte === belofte) bezig.delete(k);
        });
      bezig.set(k, { rotatie: stand, belofte });
      return belofte;
    },

    /** Alles van dit bestandspad (of documentsleutel) weg, ook wat nog loopt. */
    vergeetPad(pad) {
      if (!pad) return;
      const prefix = `${pad}:`;
      for (const k of Array.from(klaar.keys())) if (k.startsWith(prefix)) klaar.delete(k);
      for (const k of Array.from(bezig.keys())) if (k.startsWith(prefix)) bezig.delete(k);
    },

    /** Alles weg; wat nog loopt, wordt daarna niet meer bewaard. */
    wis() {
      klaar.clear();
      bezig.clear();
    },

    get grootte() { return klaar.size; },
  };
}
