// De lagenboom van een PDF (optionele inhoud, #377), rechtstreeks uit het
// bestand gelezen met pdf-lib, en het bewaren van de laagstand als
// standaardconfiguratie (/OCProperties /D).
//
// Waarom niet alleen pdf.js: getOptionalContentConfig() geeft de lagen en
// hun stand, en schakelt de keuzegroepen (/RBGroups) goed, maar
//   - laat in /Order een geneste array zonder label vallen. Volgens de
//     PDF-standaard horen de lagen in zo'n array onder de laag die ervoor
//     staat (`[Gebouw [Wanden Deuren]]`: Wanden en Deuren onder Gebouw);
//     pdf.js zet ze achteraan, los;
//   - kent /Locked niet (lagen die de gebruiker niet mag schakelen);
//   - geeft de keuzegroepen niet terug om te tonen.
// Deze module leest die structuur. De namen en de stand komen in het paneel
// nog steeds uit pdf.js (dat ontsleutelt ook tekenreeksen in een versleuteld
// bestand); hier gaat het om de vorm van de boom.
//
// Laag-id's zijn die van pdf.js (Ref.toString): `12R`, met generatie `12R3`.
//
// Puur: geen app-state, geen DOM. Getest in lagen-boom.test.mjs.

import { PDFArray, PDFDict, PDFName, PDFRef, PDFString, PDFHexString } from 'pdf-lib';

const N = PDFName.of;
const MAX_DIEPTE = 10;

/** Het id dat pdf.js aan een OCG geeft: "12R", of "12R3". */
export function pdfjsIdVanRef(ref) {
  return ref.generationNumber ? `${ref.objectNumber}R${ref.generationNumber}` : `${ref.objectNumber}R`;
}

export { refVanPdfjsId, annotatieLaagIdVoorOcg, ocgVoorAnnotatieLaagId } from './laag-ids.js';

function opgezocht(context, raw) {
  return raw instanceof PDFRef ? context.lookup(raw) : raw;
}

function tekst(waarde) {
  if (waarde instanceof PDFHexString) return waarde.decodeText();
  if (waarde instanceof PDFString) return waarde.decodeText();
  return null;
}

function ocProperties(pdfDoc) {
  const oc = opgezocht(pdfDoc.context, pdfDoc.catalog.get(N('OCProperties')));
  return oc instanceof PDFDict ? oc : null;
}

function standaardConfig(pdfDoc) {
  const oc = ocProperties(pdfDoc);
  const d = oc ? opgezocht(pdfDoc.context, oc.get(N('D'))) : null;
  return d instanceof PDFDict ? d : null;
}

function arrayVan(context, dict, sleutel) {
  if (!(dict instanceof PDFDict)) return null;
  const v = opgezocht(context, dict.get(N(sleutel)));
  return v instanceof PDFArray ? v : null;
}

/**
 * Leest de lagen en hun boom.
 * @param {import('pdf-lib').PDFDocument} pdfDoc
 * @returns {null | {
 *   ocgs: Map<string, {name: string|null}>,
 *   order: Array<{id: string, children: object[]} | {label: string, children: object[]}>,
 *   locked: Set<string>,
 *   rbGroups: string[][],
 *   begin: Map<string, boolean>,
 * }} null als het document geen lagen heeft
 */
export function leesLagenBoom(pdfDoc) {
  const context = pdfDoc.context;
  const oc = ocProperties(pdfDoc);
  const ocgLijst = arrayVan(context, oc, 'OCGs');
  if (!ocgLijst) return null;

  const ocgs = new Map();
  for (const r of ocgLijst.asArray()) {
    if (!(r instanceof PDFRef)) continue;
    const dict = context.lookup(r);
    if (!(dict instanceof PDFDict)) continue;
    const id = pdfjsIdVanRef(r);
    if (!ocgs.has(id)) ocgs.set(id, { name: tekst(opgezocht(context, dict.get(N('Name')))) });
  }
  if (!ocgs.size) return null;

  const d = standaardConfig(pdfDoc);
  const refsIn = (sleutel) => (arrayVan(context, d, sleutel)?.asArray() || [])
    .filter((r) => r instanceof PDFRef).map(pdfjsIdVanRef).filter((id) => ocgs.has(id));

  // Beginstand: /BaseState (standaard ON), dan /ON, dan /OFF.
  const basisUit = d instanceof PDFDict && String(d.get(N('BaseState'))) === '/OFF';
  const begin = new Map([...ocgs.keys()].map((id) => [id, !basisUit]));
  for (const id of refsIn('ON')) begin.set(id, true);
  for (const id of refsIn('OFF')) begin.set(id, false);

  const rbGroups = [];
  for (const groep of arrayVan(context, d, 'RBGroups')?.asArray() || []) {
    const lijst = opgezocht(context, groep);
    if (!(lijst instanceof PDFArray)) continue;
    const ids = lijst.asArray().filter((r) => r instanceof PDFRef).map(pdfjsIdVanRef).filter((id) => ocgs.has(id));
    if (ids.length) rbGroups.push(ids);
  }

  // /Order: een OCG is een knoop; een array met een tekst vooraan is een
  // label met de rest eronder; een array zonder label hoort onder de OCG die
  // ervoor staat (of, zonder die, gewoon op dit niveau). Elke laag één keer.
  const gehad = new Set();
  const leesOrder = (array, diepte) => {
    const knopen = [];
    if (!(array instanceof PDFArray) || diepte > MAX_DIEPTE) return knopen;
    for (const raw of array.asArray()) {
      if (raw instanceof PDFRef && ocgs.has(pdfjsIdVanRef(raw))) {
        const id = pdfjsIdVanRef(raw);
        if (gehad.has(id)) continue;
        gehad.add(id);
        knopen.push({ id, children: [] });
        continue;
      }
      const genest = opgezocht(context, raw);
      if (!(genest instanceof PDFArray) || genest.size() === 0) continue;
      const eerste = opgezocht(context, genest.get(0));
      const label = tekst(eerste);
      if (label !== null) {
        const rest = PDFArray.withContext(context);
        for (let i = 1; i < genest.size(); i += 1) rest.push(genest.get(i));
        knopen.push({ label, children: leesOrder(rest, diepte + 1) });
        continue;
      }
      const kinderen = leesOrder(genest, diepte + 1);
      const vorige = knopen[knopen.length - 1];
      if (vorige && 'id' in vorige && vorige.children.length === 0) vorige.children = kinderen;
      else knopen.push(...kinderen);
    }
    return knopen;
  };
  const orderArray = arrayVan(context, d, 'Order');
  const order = orderArray
    ? leesOrder(orderArray, 0)
    : [...ocgs.keys()].map((id) => (gehad.add(id), { id, children: [] }));

  return { ocgs, order, locked: new Set(refsIn('Locked')), rbGroups, begin };
}

function vervangInhoud(array, elementen) {
  while (array.size() > 0) array.remove(0);
  for (const e of elementen) array.push(e);
}

/**
 * Bewaart een laagstand als standaardconfiguratie van het document: /D /ON en
 * /OFF krijgen de stand van de genoemde lagen. Lagen die niet in `stand`
 * staan (zoals de eigen annotatielagen, die saver/annotatie-lagen.js zelf
 * schrijft) en /BaseState blijven zoals ze waren. /AS (automatische stand
 * per gebruik) blijft ook staan.
 *
 * @param {import('pdf-lib').PDFDocument} pdfDoc
 * @param {Map<string, boolean>} stand  pdf.js-id → zichtbaar
 * @returns {boolean} of er iets veranderde
 */
export function schrijfStandaardLaagstand(pdfDoc, stand) {
  if (!(stand instanceof Map) || stand.size === 0) return false;
  const context = pdfDoc.context;
  const oc = ocProperties(pdfDoc);
  const ocgLijst = arrayVan(context, oc, 'OCGs');
  if (!ocgLijst) return false;
  const refs = new Map();
  for (const r of ocgLijst.asArray()) {
    if (r instanceof PDFRef && stand.has(pdfjsIdVanRef(r))) refs.set(pdfjsIdVanRef(r), r);
  }
  if (!refs.size) return false;

  let d = standaardConfig(pdfDoc);
  if (!d) {
    d = context.obj({});
    oc.set(N('D'), d);
  }
  const basisUit = String(d.get(N('BaseState'))) === '/OFF';
  const beeld = () => ['ON', 'OFF']
    .map((k) => arrayVan(context, d, k)?.asArray().map(String).join(' ') ?? '-').join('|');
  const voor = beeld();
  const genoemd = (r) => r instanceof PDFRef && refs.has(pdfjsIdVanRef(r));

  for (const sleutel of ['ON', 'OFF']) {
    const lijst = arrayVan(context, d, sleutel);
    if (!lijst) continue;
    const over = lijst.asArray().filter((r) => !genoemd(r));
    if (over.length !== lijst.size()) vervangInhoud(lijst, over);
  }
  const voegToe = (sleutel, nieuwe) => {
    if (!nieuwe.length) return;
    let lijst = arrayVan(context, d, sleutel);
    if (!lijst) {
      lijst = context.obj([]);
      d.set(N(sleutel), lijst);
    }
    for (const r of nieuwe) lijst.push(r);
  };
  const aan = [...refs].filter(([id]) => stand.get(id) !== false).map(([, r]) => r);
  const uit = [...refs].filter(([id]) => stand.get(id) === false).map(([, r]) => r);
  // Bij /BaseState /OFF moet een zichtbare laag in /ON; anders volstaat /OFF.
  // De andere lijst krijgt ze niet: dat zou dubbelop zijn.
  if (basisUit) voegToe('ON', aan);
  else voegToe('OFF', uit);
  return beeld() !== voor;
}
