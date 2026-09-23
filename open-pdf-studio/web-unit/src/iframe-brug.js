// De iframe-variant: dezelfde unit, aangestuurd met postMessage.
//
// De keuring van binnenkomende berichten zit in `api.js` en wordt daar met
// unit-tests gedekt; hier staat alleen de koppeling naar het element.

import { GEBEURTENISSEN, keurBericht, maakAntwoord, maakFoutAntwoord, maakBericht } from './api.js';
import { leesSchaal } from './meten.js';

export function koppelIframeBrug(element, venster = window) {
  const origins = () => element.instellingen.gastheerOrigins;
  const naarGastheer = (bericht) => {
    for (const o of origins()) venster.parent?.postMessage(bericht, o);
  };

  for (const [sleutel, naam] of Object.entries(GEBEURTENISSEN)) {
    element.addEventListener(naam, (e) => {
      const detail = { ...e.detail };
      // Bytes gaan als overdraagbare buffer; de gastheer krijgt een kopie.
      if (detail.bytes) detail.bytes = detail.bytes.slice().buffer;
      naarGastheer(maakBericht(sleutel, 'melding-' + Date.now(), detail));
    });
  }

  venster.addEventListener('message', async (e) => {
    const keuring = keurBericht(e.data, e.origin, origins());
    if (!keuring.geldig) return;
    const o = keuring.opdracht;
    try {
      if (o.type === 'laad') {
        const bytes = o.bytes ? new Uint8Array(o.bytes) : null;
        const info = bytes ? await element.laad(bytes) : await element._laadVanUrl(o.src);
        naarGastheer(maakAntwoord(o, { info: info || null }));
      } else if (o.type === 'opslaan') {
        const bytes = await element.opslaan();
        naarGastheer(maakAntwoord(o, { bytes: bytes.slice().buffer }));
      } else if (o.type === 'zetSchaal') {
        element.meetschaal = typeof o.schaal === 'string' ? leesSchaal(o.schaal, o.eenheid || 'mm') : o.schaal;
        naarGastheer(maakAntwoord(o, {}));
      } else if (o.type === 'gaNaarPagina') {
        element.pagina = o.pagina;
        naarGastheer(maakAntwoord(o, { pagina: element.pagina }));
      } else if (o.type === 'zetModus') {
        element.setAttribute('mode', o.modus === 'view' ? 'view' : 'edit');
        naarGastheer(maakAntwoord(o, {}));
      } else if (o.type === 'zetAnnotaties') {
        element.zetAnnotaties(o.annotaties || []);
        naarGastheer(maakAntwoord(o, { aantal: element.annotaties().length }));
      }
    } catch (fout) {
      naarGastheer(maakFoutAntwoord(o, 'opdracht', fout.message));
    }
  });
}
