// Escape bij een niet-modale dialoog (bv. het watermerkvenster, #848): het
// document eronder blijft bruikbaar, en een Escape die daar bedoeld is (een
// selectie of gereedschap annuleren) mag de dialoog niet stil sluiten. Een
// modale dialoog sluit zoals altijd.
export function createEscapeScope({ modal = true } = {}) {
  let laatsteKlikBinnen = true;
  const binnen = (root, target) => !!(root && target != null && root.contains(target));
  return {
    pointerDown(event, root) {
      laatsteKlikBinnen = binnen(root, event.target);
    },
    sluitBijEscape(root, actief) {
      if (modal !== false) return true;
      return binnen(root, actief) || laatsteKlikBinnen;
    },
  };
}
