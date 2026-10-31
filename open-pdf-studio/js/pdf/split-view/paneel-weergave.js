// Gesplitste weergave (#715): de zoom en weergaverotatie van het tweede
// paneel tijdens het tekenen van zijn annotaties.
//
// De annotatietekenaar haalt lijndiktes, grepen, arceringen en rechtop
// staande tekst op schermmaat uit doc.scale en de rotatie uit
// doc.viewRotation, de stand van de echte viewer. Het tweede paneel heeft een
// eigen zoom en rotatie. Die tijdelijk op het document zetten (een Solid-
// store) liet bij elke hertekening van het paneel alles opnieuw rekenen wat
// van doc.scale of doc.viewRotation afhangt (effecten draaien na de batch,
// ook als de waarde dan weer de oude is). Daarom leest de tekenaar die twee
// waarden via deze functies, en zet het paneel ze hier, alleen tijdens zijn
// eigen (synchrone) tekenbeurt.
//
// Zonder afhankelijkheden, zodat elke tekenmodule hem kan laden.

let _stand = null;

/**
 * Voer fn uit met `schaal` en `rotatie` als schermschaal en weergaverotatie
 * van `doc`. Geneste aanroepen herstellen de vorige stand.
 */
export function metPaneelStand(doc, { schaal, rotatie }, fn) {
  const vorige = _stand;
  _stand = { doc, schaal, rotatie };
  try {
    return fn();
  } finally {
    _stand = vorige;
  }
}

/** De schermschaal van een document: doc.scale, of die van het paneel dat nu tekent. */
export function schermSchaal(doc) {
  if (_stand && doc && doc === _stand.doc && _stand.schaal > 0) return _stand.schaal;
  return doc ? doc.scale : undefined;
}

/** De weergaverotatie van een document: doc.viewRotation, of die van het paneel dat nu tekent. */
export function weergaveRotatieVan(doc) {
  if (_stand && doc && doc === _stand.doc && _stand.rotatie != null) return _stand.rotatie;
  return doc ? doc.viewRotation : undefined;
}

/** Alleen tijdens de synchrone tekenbeurt; verandert het actieve tabblad niet. */
export function paneelDocument() { return _stand?.doc || null; }
