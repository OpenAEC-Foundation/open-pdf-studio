// Constructieplan — PURE module (geen UI-, DOM- of app-state-imports; los
// testbaar onder node --test).
//
// Zet een compacte opgave ("3x5400 bij 2x6000 op 1:100, HE200B-kolommen,
// 300x500-balken, vloeren overspannend in x") om in een PLATTE LIJST
// annotatie-opgaven die één-op-één door app_create_annotation gemaakt kunnen
// worden, plus de staat-configuratie die erbij hoort.
//
// De module TEKENT niets en raakt geen app-state aan: hij rekent. Daardoor is
// alle maatvoering — paginapunten, positienummers, overspanningen,
// peilteksten — toetsbaar zonder draaiende applicatie.

import { MM_TO_PX, maakRaster, meetschaalVoor, RasterFout } from './raster.js';
import { balken, kolommen, ontleedProfiel, peilTekst, vloervelden } from './draagstructuur.js';

/** Teksthoogte van labels in PAPIER-mm (tekeningtype 'Constructieplattegrond'). */
export const STANDAARD_TEKST_MM = 2.5;

/** Straal van de stramienbol in PAPIER-mm (bol van circa 8 mm doorsnede). */
export const STANDAARD_BOL_MM = 4;

/** Standaard-sjabloon voor de tekst bij een overspanningspijl. */
export const STANDAARD_VLOERTEKST = '{id} - {overspanning} mm';

const ZWART = '#000000';

function vulIn(sjabloon, waarden) {
  return String(sjabloon).replace(/\{(\w+)\}/g, (heel, sleutel) =>
    (waarden[sleutel] == null ? heel : String(waarden[sleutel])));
}

/** Ruwe breedte van een tekstregel in punten (zelfde benadering als de
 *  betonbalk-tag: 0,58 × korpsgrootte per teken). */
function tekstBreedte(regels, fontSize) {
  const langste = regels.reduce((n, r) => Math.max(n, String(r).length), 0);
  return Math.max(24, langste * fontSize * 0.58 + 6);
}

function tekstvak(regels, x, y, fontSize, extra = {}) {
  const breedte = tekstBreedte(regels, fontSize);
  const hoogte = regels.length * fontSize * 1.35 + 4;
  return {
    type: 'textbox',
    props: {
      x, y, width: breedte, height: hoogte,
      text: regels.join('\n'),
      fontSize,
      color: ZWART, strokeColor: ZWART,
      borderWidth: 0, lineWidth: 0,
      fillColor: 'transparent',
      ...extra,
    },
  };
}

// --- Engelse opgave-sleutels ------------------------------------------------
// De MCP-kant spreekt Engels (zoals elke andere opdracht van de app), de
// rekenmodules spreken Nederlands. Deze vertaallaag zit ertussen en is het
// enige wat van die twee talen af weet.

const SLEUTELS = {
  page: 'pagina', origin: 'oorsprong', scale: 'schaal',
  baysX: 'veldenX', baysY: 'veldenY',
  labelStyleX: 'labelStijlX', labelStyleY: 'labelStijlY',
  labelsYFromBottom: 'labelsYVanOnder',
  gridExtensionMm: 'uitloopMm',
  textHeightMm: 'tekstMm', gridBubbleMm: 'bolMm',
  columns: 'kolommen', beams: 'balken', floors: 'vloeren',
  levelMarkers: 'peilmaten', schedule: 'staat',
};

const DEELSLEUTELS = {
  profile: 'profiel', prefix: 'voorvoegsel', levelMm: 'peilMm', skip: 'overslaan',
  direction: 'richting', edgeOnly: 'alleenRand',
  thicknessMm: 'dikteMm', text: 'tekst', name: 'naam',
};

/** Sleutels die het plan zelf leest (na vertaling naar de interne vorm). */
export const OPGAVE_SLEUTELS = [
  'pagina', 'oorsprong', 'veldenX', 'veldenY', 'schaal',
  'labelStijlX', 'labelStijlY', 'labelsYVanOnder', 'uitloopMm',
  'tekstMm', 'bolMm',
  'kolommen', 'balken', 'vloeren', 'peilmaten', 'tags', 'staat',
];

/** Sleutels die de MCP-brug zelf afhandelt en niet aan het plan doorgeeft. */
export const BRUG_SLEUTELS = ['setMeasureScale', 'dryRun'];

const WAARDEN = {
  both: 'beide', shortest: 'kortste', numbers: 'cijfers',
};

function vertaalWaarde(waarde) {
  return (typeof waarde === 'string' && WAARDEN[waarde]) ? WAARDEN[waarde] : waarde;
}

function vertaalDeel(deel) {
  if (!deel || typeof deel !== 'object' || Array.isArray(deel)) return deel;
  const uit = {};
  for (const [sleutel, waarde] of Object.entries(deel)) {
    uit[DEELSLEUTELS[sleutel] || sleutel] = vertaalWaarde(waarde);
  }
  return uit;
}

/**
 * Normaliseer een opgave met Engelse sleutels naar de interne (Nederlandse)
 * vorm. Nederlandse sleutels blijven staan, zodat beide schrijfwijzen werken.
 */
export function normaliseerOpgave(params = {}) {
  const uit = {};
  for (const [sleutel, waarde] of Object.entries(params)) {
    const naam = SLEUTELS[sleutel] || sleutel;
    if (['kolommen', 'balken', 'vloeren', 'staat'].includes(naam)) {
      uit[naam] = (waarde === false || waarde === true) ? waarde : vertaalDeel(waarde);
    } else if (naam === 'labelStijlX' || naam === 'labelStijlY') {
      uit[naam] = vertaalWaarde(waarde);
    } else {
      uit[naam] = waarde;
    }
  }
  return uit;
}

/**
 * Bouw een volledig constructieplan.
 *
 * @param {object} spec
 * @param {number} [spec.pagina]                 1-gebaseerd; weggelaten = huidige pagina.
 * @param {{x:number,y:number}} spec.oorsprong   Eerste rasterknoop in paginapunten.
 * @param {number[]|string} spec.veldenX
 * @param {number[]|string} spec.veldenY
 * @param {string|number} [spec.schaal='1:100']
 * @param {'letters'|'cijfers'} [spec.labelStijlX]
 * @param {'letters'|'cijfers'} [spec.labelStijlY]
 * @param {boolean} [spec.labelsYVanOnder]
 * @param {number} [spec.uitloopMm]
 * @param {number} [spec.tekstMm=2.5]            Teksthoogte in PAPIER-mm.
 * @param {number} [spec.bolMm=4]                Straal stramienbol in PAPIER-mm.
 * @param {object|false} [spec.kolommen]         { profiel, voorvoegsel, peilMm, overslaan }
 * @param {object|false} [spec.balken]           { profiel, richting, voorvoegsel, peilMm, alleenRand }
 * @param {object|false} [spec.vloeren]          { richting, dikteMm, peilMm, voorvoegsel, tekst }
 * @param {boolean} [spec.peilmaten=true]        Peilmaat per vloerveld.
 * @param {boolean} [spec.tags=true]             Positienummer/profiel bij elk element.
 * @param {boolean|object} [spec.staat=true]     Staat-configuratie meeleveren.
 *
 * @param {object} [opts]
 * @param {(symbolId:string, maat:string) => ({breedteMm:number,hoogteMm:number}|null)}
 *        [opts.maatVanProfiel]  Werkelijke doorsnedemaat van een stalen
 *        profielsymbool. Wordt door de app gevuld uit de symbolenbibliotheek;
 *        ontbreekt hij, dan krijgt het symbool alleen een invoegpunt mee en
 *        bepaalt de app zelf de maat.
 * @param {(symbolId:string, maat:string) => boolean} [opts.kentMaat]
 *        Controle of het symbool deze `maat` kent. Levert hij false, dan
 *        wordt het plan geweigerd in plaats van stilzwijgend een ander
 *        profiel te tekenen.
 *
 * @returns {{ok:true, plan:object, annotaties:object[], meetschaal:object,
 *            staat:object|null, samenvatting:object}
 *         | {ok:false, code:string, fout:string}}
 */
export function bouwConstructieplan(spec = {}, opts = {}) {
  try {
    return bouw(normaliseerOpgave(spec), opts);
  } catch (e) {
    if (e instanceof RasterFout) return { ok: false, code: e.code, fout: e.message };
    throw e;
  }
}

function bouw(spec, opts) {
  const raster = maakRaster(spec);
  const pxPerMm = raster.schaal.pxPerMm;
  const pagina = Number.isInteger(Number(spec.pagina)) && Number(spec.pagina) >= 1
    ? Number(spec.pagina) : null;

  const tekstMm = Number(spec.tekstMm) > 0 ? Number(spec.tekstMm) : STANDAARD_TEKST_MM;
  const fontSize = tekstMm * MM_TO_PX;
  const bolMm = Number(spec.bolMm) > 0 ? Number(spec.bolMm) : STANDAARD_BOL_MM;
  const bolStraal = bolMm * MM_TO_PX;
  const metTags = spec.tags !== false;

  const annotaties = [];
  const voegToe = (rol, id, opgave) => {
    annotaties.push({
      rol, id,
      type: opgave.type,
      props: { ...(pagina ? { page: pagina } : {}), ...opgave.props },
    });
  };

  // --- 1. Stramien -------------------------------------------------------
  for (const lijn of raster.lijnenX) {
    voegToe('stramien', lijn.label, {
      type: 'parametricSymbol',
      props: {
        symbolId: 'stramien',
        x: lijn.x - bolStraal, y: lijn.yBoven,
        width: bolStraal * 2, height: lijn.yOnder - lijn.yBoven,
        params: { label: lijn.label, orientation: 'verticaal', bollen: 'begin', dashed: true },
        color: ZWART, strokeColor: ZWART,
        ifcCategory: 'IfcGrid', label: lijn.label,
      },
    });
  }
  for (const lijn of raster.lijnenY) {
    voegToe('stramien', lijn.label, {
      type: 'parametricSymbol',
      props: {
        symbolId: 'stramien',
        x: lijn.xLinks, y: lijn.y - bolStraal,
        width: lijn.xRechts - lijn.xLinks, height: bolStraal * 2,
        params: { label: lijn.label, orientation: 'horizontaal', bollen: 'begin', dashed: true },
        color: ZWART, strokeColor: ZWART,
        ifcCategory: 'IfcGrid', label: lijn.label,
      },
    });
  }

  // --- 2. Vloervelden: overspanningspijl + peilmaat -----------------------
  const vloerOpties = spec.vloeren === false ? null : (spec.vloeren || {});
  const vloeren = vloerOpties ? vloervelden(raster, vloerOpties) : [];
  const vloerSjabloon = vloerOpties?.tekst || STANDAARD_VLOERTEKST;
  for (const vloer of vloeren) {
    const langs = vloer.overspanningsrichting === 'x' ? vloer.breedte : vloer.hoogte;
    const dwars = vloer.overspanningsrichting === 'x' ? vloer.hoogte : vloer.breedte;
    const breedte = langs * 0.9;
    const hoogte = Math.max(16, Math.min(breedte * 0.12, dwars * 0.5));
    voegToe('vloerpijl', vloer.id, {
      type: 'parametricSymbol',
      props: {
        symbolId: 'overspanningspijl-vloer',
        x: vloer.midden.x - breedte / 2, y: vloer.midden.y - hoogte / 2,
        width: breedte, height: hoogte,
        rotation: vloer.overspanningsrichting === 'y' ? 90 : 0,
        params: {
          lengte: vloer.overspanningMm,
          tekst: vulIn(vloerSjabloon, {
            id: vloer.id, veld: vloer.veld,
            overspanning: Math.round(vloer.overspanningMm),
            dikte: vloer.dikteMm ?? '',
            peil: peilTekst(vloer.peilMm),
          }),
        },
        color: ZWART, strokeColor: ZWART,
        ifcCategory: vloer.ifcCategory, label: vloer.id,
      },
    });

    if (spec.peilmaten !== false && vloer.peilMm != null) {
      const breedtePeil = Math.max(90, fontSize * 7);
      const hoogtePeil = Math.max(36, fontSize * 3.6);
      const apexY = vloer.y + vloer.hoogte * 0.74;
      voegToe('peilmaat', vloer.id, {
        type: 'parametricSymbol',
        props: {
          symbolId: 'peilmaat',
          x: vloer.midden.x - breedtePeil / 2, y: apexY - hoogtePeil,
          width: breedtePeil, height: hoogtePeil,
          params: { value: peilTekst(vloer.peilMm), filled: false, baseline: true },
          color: ZWART, strokeColor: ZWART,
          ifcCategory: 'IfcAnnotation', label: vloer.id,
        },
      });
    }
  }

  // --- 3. Balken ---------------------------------------------------------
  const balkOpties = spec.balken === false ? null : (spec.balken || {});
  const balkLijst = balkOpties ? balken(raster, balkOpties) : [];
  for (const balk of balkLijst) {
    const regels = tagRegels(balk);
    if (balk.profiel.soort === 'beton') {
      voegToe('balk', balk.id, {
        type: 'betonbalk',
        props: {
          startX: balk.startX, startY: balk.startY, endX: balk.endX, endY: balk.endY,
          breedteMm: balk.profiel.breedteMm, hoogteMm: balk.profiel.hoogteMm,
          lijnstijl: 'doorgetrokken',
          tagTonen: metTags, tagTekst: regels.join(' '), tagFontSize: fontSize,
          color: ZWART, strokeColor: ZWART,
          ifcCategory: balk.ifcCategory, label: balk.id,
        },
      });
    } else {
      // Stalen ligger in plattegrond: de as als lijn; het profiel staat in de tag.
      voegToe('balk', balk.id, {
        type: 'line',
        props: {
          startX: balk.startX, startY: balk.startY, endX: balk.endX, endY: balk.endY,
          color: ZWART, strokeColor: ZWART,
          ifcCategory: balk.ifcCategory, label: balk.id,
        },
      });
      if (metTags) {
        const mx = (balk.startX + balk.endX) / 2;
        const my = (balk.startY + balk.endY) / 2;
        const hoogteTag = regels.length * fontSize * 1.35 + 4;
        const tag = balk.as === 'x'
          ? tekstvak(regels, mx - tekstBreedte(regels, fontSize) / 2, my - hoogteTag - 2, fontSize)
          : tekstvak(regels, mx + 4, my - hoogteTag / 2, fontSize);
        voegToe('tag', balk.id, { type: tag.type, props: { ...tag.props, label: balk.id } });
      }
    }
  }

  // --- 4. Kolommen -------------------------------------------------------
  const kolomOpties = spec.kolommen === false ? null : (spec.kolommen || {});
  const kolomLijst = kolomOpties ? kolommen(raster, kolomOpties) : [];
  for (const kolom of kolomLijst) {
    voegToe('kolom', kolom.id, kolomOpgave(kolom, pxPerMm, opts));
    if (metTags) {
      const regels = tagRegels(kolom);
      const hoogteTag = regels.length * fontSize * 1.35 + 4;
      const tag = tekstvak(regels, kolom.x + bolStraal * 0.6, kolom.y - bolStraal * 0.6 - hoogteTag, fontSize);
      voegToe('tag', kolom.id, { type: tag.type, props: { ...tag.props, label: kolom.id } });
    }
  }

  // --- 5. Staat ----------------------------------------------------------
  const staat = spec.staat === false ? null : staatConfig(raster, spec.staat, pagina);

  return {
    ok: true,
    plan: { raster, kolommen: kolomLijst, balken: balkLijst, vloervelden: vloeren },
    annotaties,
    meetschaal: meetschaalVoor(raster.schaal.noemer),
    staat,
    samenvatting: {
      schaal: raster.schaal.tekst,
      pagina,
      raster: `${raster.veldenX.length} x ${raster.veldenY.length} velden`,
      afmetingMm: { breedte: raster.maat.breedteMm, hoogte: raster.maat.hoogteMm },
      aantallen: {
        stramienlijnen: raster.lijnenX.length + raster.lijnenY.length,
        kolommen: kolomLijst.length,
        balken: balkLijst.length,
        vloervelden: vloeren.length,
        annotaties: annotaties.length,
      },
    },
  };
}

/** Tagregels van een element: positienummer, profiel en — als hij er is — peil. */
function tagRegels(element) {
  const regels = [element.id];
  if (element.profiel?.naam) regels.push(element.profiel.naam);
  if (element.peilMm != null) regels.push(peilTekst(element.peilMm));
  return regels;
}

/** Annotatie-opgave voor één kolom: stalen profielsymbool of betonnen vlak. */
function kolomOpgave(kolom, pxPerMm, opts) {
  if (kolom.profiel.soort === 'beton') {
    const breedte = kolom.profiel.breedteMm * pxPerMm;
    const hoogte = kolom.profiel.hoogteMm * pxPerMm;
    return {
      type: 'box',
      props: {
        x: kolom.x - breedte / 2, y: kolom.y - hoogte / 2,
        width: breedte, height: hoogte,
        color: ZWART, strokeColor: ZWART, fillColor: ZWART, opacity: 1,
        ifcCategory: kolom.ifcCategory, label: kolom.id,
      },
    };
  }

  const { symbolId, maat } = kolom.profiel;
  if (typeof opts.kentMaat === 'function' && !opts.kentMaat(symbolId, maat)) {
    throw new RasterFout('profiel', `het symbool ${symbolId} kent de maat "${maat}" niet`);
  }
  const basis = {
    symbolId, params: { maat, aanzicht: 'doorsnede' },
    color: ZWART, strokeColor: ZWART,
    ifcCategory: kolom.ifcCategory, label: kolom.id,
  };
  const maten = typeof opts.maatVanProfiel === 'function' ? opts.maatVanProfiel(symbolId, maat) : null;
  if (maten && maten.breedteMm > 0 && maten.hoogteMm > 0) {
    const breedte = maten.breedteMm * pxPerMm;
    const hoogte = maten.hoogteMm * pxPerMm;
    return {
      type: 'parametricSymbol',
      props: { ...basis, x: kolom.x - breedte / 2, y: kolom.y - hoogte / 2, width: breedte, height: hoogte },
    };
  }
  // Zonder maatbron: alleen het invoegpunt — de app centreert het symbool zelf
  // op zijn werkelijke maat.
  return { type: 'parametricSymbol', props: { ...basis, x: kolom.x, y: kolom.y } };
}

/**
 * Staat-configuratie voor app_place_schedule: groepeer op IFC-categorie, zodat
 * kolommen, balken, vloeren, wapening en stramien elk hun eigen blok krijgen.
 */
function staatConfig(raster, keuze, pagina) {
  const eigen = (keuze && typeof keuze === 'object') ? keuze : {};
  return {
    templateId: 'full',
    name: eigen.naam || 'Constructiestaat',
    ...(pagina ? { page: pagina } : {}),
    // Onder het raster, maar nooit buiten het blad langs de linker- of bovenrand.
    x: Number.isFinite(Number(eigen.x)) ? Number(eigen.x) : Math.max(0, raster.maat.buiten.x),
    y: Number.isFinite(Number(eigen.y)) ? Number(eigen.y)
      : Math.max(0, raster.maat.buiten.y + raster.maat.buiten.hoogte + 24),
    config: {
      categories: ['line-based', 'symbol', 'area', 'count'],
      fields: ['ifcCategory', 'type', 'label', 'length', 'count'],
      sort: [{ field: 'ifcCategory', dir: 'asc', group: true, header: true, footer: true }],
      itemize: eigen.itemize !== false,
    },
  };
}

export { ontleedProfiel, peilTekst };
