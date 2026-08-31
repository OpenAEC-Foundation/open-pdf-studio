// Pure generatie-/schaalpoort voor de debounced re-render van de doorlopende
// weergave. De re-renderlus (reRenderVisibleContinuousPages) heeft awaits;
// zoomt de gebruiker tijdens zo'n await door, dan zou de lus daarna
// wrappermaten op de inmiddels verouderde schaal schrijven en de scroll
// meeslepen (verspringen bij snel zoomen). Elke run haalt bij de start een
// token; ná elke await controleert hij of het token nog het nieuwste is én of
// de schaal ongewijzigd bleef — anders breekt hij af (de nieuwe debounce-
// aanroep neemt het over).
export function createRerenderGate() {
  let gen = 0;
  return {
    begin(scale) {
      return { gen: ++gen, scale };
    },
    isCurrent(token, currentScale) {
      return token.gen === gen && token.scale === currentScale;
    },
  };
}
