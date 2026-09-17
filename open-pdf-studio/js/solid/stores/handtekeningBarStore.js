import { createSignal } from 'solid-js';

// Handtekeningbalk van het actieve document. Toestand: 'verborgen' | 'bezig' | 'klaar' | 'fout'.
const [toestand, setToestand] = createSignal('verborgen');
const [items, setItems] = createSignal([]);
const [foutDetail, setFoutDetail] = createSignal('');

export function toonHandtekeningBalk({ toestand: nieuw, items: lijst = [], fout = '' }) {
  setItems(Array.isArray(lijst) ? lijst : []);
  setFoutDetail(fout || '');
  setToestand(nieuw);
}

export function verbergHandtekeningBalk() {
  setToestand('verborgen');
  setItems([]);
  setFoutDetail('');
}

export { toestand, items, foutDetail };
