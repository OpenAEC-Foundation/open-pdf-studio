// De opties van het wandgereedschap in het lint (#1230): diktelijst en
// locatielijn. De diktelijst hangt af van het blad onder de cursor (imperiaal
// of metrisch); het gereedschap meldt dat punt bij elke muisbeweging en het
// signaal verandert alleen als de conventie verandert.

import { createSignal } from 'solid-js';
import { isImperiaalBladOpPunt, isImperiaalBladOpPagina } from '../../plattegrond/blad-conventie-op-punt.js';

const [imperiaal, setImperiaal] = createSignal(false);

/** Is het blad waar het wandgereedschap nu boven hangt imperiaal? */
export const wandBladImperiaal = imperiaal;

/** Het wandgereedschap meldt het punt onder de cursor. */
export function meldWandPunt(page, x, y) {
  setImperiaal(isImperiaalBladOpPunt(page, x, y));
}

/** Zonder cursor op het blad (het gereedschap is net gekozen): de pagina. */
export function meldWandPagina(page) {
  setImperiaal(isImperiaalBladOpPagina(page));
}
