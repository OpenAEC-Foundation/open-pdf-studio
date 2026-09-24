// Gevelelement als parametrisch symbool: één soort object met twee
// voorinstellingen, de vliesgevel en het kozijn (zie js/gevelelement/).
//
// Getekend langs een lijn (placement 'two-point'), op werkelijke maat via de
// meetschaal. De indeling (stijlen, panelen) staat in annotation.params en
// gaat mee in het bestand zoals bij elk parametrisch symbool (OPS_Params).
//
// Naast render() biedt het sjabloon haken die de selectietool, de grepen en
// het oplichten gebruiken:
//   gevelelement        id van de voorinstelling (herkenning)
//   extraGrepen(ann)    de greep op de geselecteerde tussenstijl
//   greepOorsprong(ann, greep)          waar die greep zat (voor objectsnap)
//   sleepGreep(ann, orig, greep, dx, dy) stijl verschuiven tijdens slepen
//   naRek(ann, orig, vasteKant)          eindgreep verslept: stijlen blijven staan
//   onderdeelVlakken(ann)               vlakken van geselecteerd / aangewezen onderdeel

import { preset } from '../../gevelelement/catalogus.js';
import { elementMaat, tekenOpdrachten } from '../../gevelelement/weergave.js';
import {
  STIJL_GREEP, stijlGreep, sleepStijl, rekElement, onderdeelPaginaVlak,
} from '../../gevelelement/element.js';
import { indeling } from '../../gevelelement/indeling.js';
import { geldigOnderdeel, zelfdeOnderdeel } from '../../gevelelement/onderdelen.js';

function maakTemplate(presetId) {
  const pr = preset(presetId);
  return {
    id: presetId,
    name: pr.naam,
    nameEn: pr.nameEn,
    category: 'Bouwkundig',
    defaultSize: { width: 360, height: 15 },
    placement: 'two-point',
    fixedSize: true,
    gevelelement: presetId,
    // Geen losse invoervelden in het algemene paneel: de indeling heeft een
    // eigen sectie (GevelelementSection.jsx).
    params: [],
    realSizeMm(params) {
      const m = elementMaat(params, presetId);
      return { width: m.lengteMm, height: m.bandMm };
    },
    render(params, bbox) {
      return tekenOpdrachten(params, presetId, bbox);
    },
    extraGrepen(ann) {
      const g = stijlGreep(ann, presetId);
      return g ? [g] : [];
    },
    greepOorsprong(ann, greep) {
      if (greep !== STIJL_GREEP) return null;
      const g = stijlGreep(ann, presetId);
      return g ? { x: g.x, y: g.y } : null;
    },
    sleepGreep(ann, orig, greep, dx, dy) {
      if (greep !== STIJL_GREEP) return false;
      return sleepStijl(ann, orig, presetId, dx, dy);
    },
    naRek(ann, orig, vasteKant) {
      return rekElement(ann, orig, presetId, vasteKant);
    },
    onderdeelVlakken(ann) {
      const lay = indeling(ann.params, presetId);
      const uit = [];
      const sel = geldigOnderdeel(lay, ann.selectedSub);
      const hover = geldigOnderdeel(lay, ann._hoverSub);
      if (hover && !zelfdeOnderdeel(hover, sel)) {
        const punten = onderdeelPaginaVlak(ann, presetId, hover);
        if (punten) uit.push({ soort: 'aanwijzer', punten });
      }
      if (sel) {
        const punten = onderdeelPaginaVlak(ann, presetId, sel);
        if (punten) uit.push({ soort: 'selectie', punten });
      }
      return uit;
    },
  };
}

export const vliesgevelTemplate = maakTemplate('vliesgevel');
export const kozijnTemplate = maakTemplate('kozijn');
