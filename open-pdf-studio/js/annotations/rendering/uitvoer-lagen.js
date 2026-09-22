// Welke lagen een rendering tekent.
//
// Het scherm toont ook bewerkingstoestand: het selectiekader met grepen, de
// blauwe klik-affordance van bewerkbare getallen, de 2D-cursor, het
// sleepkader, uitlijnhulplijnen en de bijsnij-overlay. Daarnaast rekent het
// scherm lijndiktes om naar schermpixels (minstens één pixel bij uitzoomen,
// een plafond tijdens slepen, en de voorkeur "lijndikte niet tonen").
//
// Een afdruk, export of printvoorbeeld is geen scherm: daar hoort alleen wat
// op papier komt, met de echte lijndiktes. `uitvoer: true` zet die
// bewerkingslagen uit; `markeringen: false` laat ook de annotatielaag weg
// ("Afdrukken: Document"), maar houdt watermerken en tekstbewerkingen — dat
// is inhoud van het document, geen markering.

/**
 * @param {{ uitvoer?: boolean, markeringen?: boolean }} [opties]
 * @returns {{ watermerken: boolean, tekstbewerkingen: boolean, markeringen: boolean,
 *             selectie: boolean, bewerkhulp: boolean, schermlijndikte: boolean }}
 */
export function weergaveLagen({ uitvoer = false, markeringen = true } = {}) {
  const scherm = !uitvoer;
  return {
    watermerken: true,
    tekstbewerkingen: true,
    markeringen: markeringen !== false,
    selectie: scherm,
    bewerkhulp: scherm,
    schermlijndikte: scherm,
  };
}
