// Vectorknipsel — de bronpagina terugsnoeien tot wat het knipvak raakt (#509).
//
// Een knipsel droeg tot nu toe de héle bronpagina mee: de mini-PDF voor de
// voorvertoning, de bron op de catalogus en het Form XObject in de appearance
// bevatten allemaal de volledige inhoudsstroom, met alleen een /BBox die het
// zichtbare deel begrenst. Bij een zware tekening is dat megabytes per knipsel,
// en de pdfium-worker verwerkt die hele stroom voor elke tegel van elk
// zoomniveau.
//
// Hier gaat alles uit de inhoudsstroom wat AANTOONBAAR buiten het vak valt:
//   - paden (m/l/c/v/y/re … S/f/B/n) waarvan de omhullende — inclusief
//     lijndikte en verstek — het vak niet raakt;
//   - tekstobjecten (BT … ET) waarvan een ruime bovengrens van alle glyfen
//     het vak niet raakt;
//   - afbeeldingen en Form XObjects (Do, BI … EI) waarvan het kader buiten
//     het vak ligt.
// Alles wat de grafische toestand verandert blijft staan (q/Q, cm, gs,
// kleuren, lijnstijl, tekst-state, uitsnijpaden, marked content), zodat wat
// wél getekend wordt precies dezelfde toestand ziet. Een tekstobject dat
// wegvalt laat zijn tekst-state achter (Tf, Tc, TL …): die geldt ook na ET.
// Daarna vallen lege q … Q-blokken en lege marked-content-paren weg, en de
// resources waar niemand meer naar verwijst.
//
// Bij twijfel blijft het staan: een onbekend font (Type3, verticaal schrift),
// tekst die uitsnijdt (Tr 4–7), shadings (sh) en alles binnen BX … EX. Kan de
// stroom niet zonder twijfel gelezen worden, dan blijft de pagina zoals hij
// was — snoeien is een optimalisatie, nooit een reden voor een ander beeld.
//
// Zuiver (alleen pdf-lib), zodat het onder `node --test` draait.

import {
  PDFArray, PDFDict, PDFName, PDFNumber, PDFRawStream, PDFRef, PDFStream, decodePDFRawStream,
} from 'pdf-lib';
import { tokenizeContentStream, matMul } from '../text/content-stream-text.js';

/** Vaste speling (pt) rond alles wat getekend wordt: anti-aliasing en
 *  haarlijnen die een renderer minstens één beeldpunt breed maakt. */
const SPELING = 4;
/** Glyfbreedte (em) als een font er zelf geen opgeeft (standaard-14). */
const STANDAARD_BREEDTE = 1.5;
/** Minimale uitsteek van een glyf rond zijn oorsprong (em). */
const MIN_GLYF_UITSTEEK = 2;

const IDENTITEIT = [1, 0, 0, 1, 0, 0];

const PAD_BOUW = new Set(['m', 'l', 'c', 'v', 'y', 'h', 're']);
const PAD_VERF = new Set(['S', 's', 'f', 'F', 'f*', 'B', 'B*', 'b', 'b*', 'n']);
const PAD_STREEK = new Set(['S', 's', 'B', 'B*', 'b', 'b*']);
const TEKST_STAAT = new Set(['Tc', 'Tw', 'Tz', 'TL', 'Tf', 'Tr', 'Ts']);
const ALGEMENE_STAAT = new Set([
  'w', 'J', 'j', 'M', 'd', 'ri', 'i', 'gs',
  'CS', 'cs', 'SC', 'SCN', 'sc', 'scn', 'G', 'g', 'RG', 'rg', 'K', 'k',
]);
const TEKST_POSITIE = new Set(['Td', 'TD', 'Tm', 'T*']);
const TEKST_TONEN = new Set(['Tj', 'TJ', "'", '"']);

/** Grootste rek van een matrix (bovengrens van de grootste singuliere waarde). */
function rek(m) {
  return Math.hypot(m[0], m[1], m[2], m[3]);
}

function punt(m, x, y) {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/** Omhullende van een rechthoek (lokale ruimte) onder matrix `m`. */
function kaderOnder(m, x0, y0, x1, y1) {
  const p = [punt(m, x0, y0), punt(m, x1, y0), punt(m, x0, y1), punt(m, x1, y1)];
  return {
    minX: Math.min(p[0][0], p[1][0], p[2][0], p[3][0]),
    minY: Math.min(p[0][1], p[1][1], p[2][1], p[3][1]),
    maxX: Math.max(p[0][0], p[1][0], p[2][0], p[3][0]),
    maxY: Math.max(p[0][1], p[1][1], p[2][1], p[3][1]),
  };
}

/** Ligt omhullende `o`, met `marge` eromheen, helemaal buiten het vak? */
function buiten(o, vak, marge) {
  const r = marge + SPELING;
  if (![o.minX, o.minY, o.maxX, o.maxY, r].every(Number.isFinite)) return false;
  return o.maxX + r < vak.left || o.minX - r > vak.right
    || o.maxY + r < vak.bottom || o.minY - r > vak.top;
}

function getal(n) {
  const t = Number(n).toFixed(4).replace(/\.?0+$/, '');
  return t === '-0' || t === '' ? '0' : t;
}

class Onleesbaar extends Error {}

/**
 * Snoeit een inhoudsstroom tot wat het vak kan raken.
 *
 * @param {string} src  de inhoudsstroom als latin1-string (1 teken = 1 byte)
 * @param {{left:number,bottom:number,right:number,top:number}} vak  in de
 *   gebruikersruimte van de stroom
 * @param {object} [bronnen]  opzoekfuncties voor resources, elk mag null geven
 *   (= onbekend, dus behouden):
 *   - font(naam) → { breedte, uitsteek } in em, of null
 *   - xobject(naam) → { soort: 'image' } | { soort: 'form', bbox, matrix } | null
 *   - extGState(naam) → { LW?, ML?, font? } | null
 * @returns {{inhoud:string, namen:Set<string>, weg:number, totaal:number}|null}
 *   null als de stroom niet zeker te lezen is; laat de pagina dan staan.
 */
export function snoeiInhoud(src, vak, bronnen = {}) {
  try {
    return _snoei(src, vak, bronnen);
  } catch (err) {
    if (err instanceof Onleesbaar) return null;
    throw err;
  }
}

function _snoei(src, vak, bronnen) {
  const fontVan = bronnen.font || (() => null);
  const xobjectVan = bronnen.xobject || (() => null);
  const gsVan = bronnen.extGState || (() => null);

  // Eenheden van de uitvoer: { s, e } (stuk bron) of { tekst }, met een soort:
  // 'q' | 'Q' | 'mc' | 'emc' | 'staat' (verandert alleen toestand) | 'verf'.
  const eenheden = [];
  let weg = 0;
  let totaal = 0;

  let st = {
    ctm: IDENTITEIT, lw: 1, ml: 10,
    font: null, tfs: 0, tc: 0, tw: 0, th: 1, tl: 0, rise: 0, tr: 0,
  };
  const stapel = [];
  let compat = 0;
  let pad = null;     // { s, minX, minY, maxX, maxY, punten, clip, namen }
  let cx = 0, cy = 0; // huidig punt (lokale ruimte), voor v
  let tekst = null;   // lopend tekstobject
  const reserves = []; // weggevallen transparante beelden, zie onderaan
  let transparantGetekend = false;

  const namenVan = (operanden) => operanden.filter((t) => t.t === 'name').map((t) => t.v);
  const getallen = (operanden) => operanden.filter((t) => t.t === 'num').map((t) => t.v);

  const voegPuntToe = (x, y) => {
    const [px, py] = punt(st.ctm, x, y);
    if (px < pad.minX) pad.minX = px;
    if (px > pad.maxX) pad.maxX = px;
    if (py < pad.minY) pad.minY = py;
    if (py > pad.maxY) pad.maxY = py;
    pad.punten++;
  };
  const streekMarge = () => (st.lw > 0 ? st.lw : 0) / 2 * rek(st.ctm) * Math.max(st.ml, 1.5);

  const voegToe = (eenheid) => {
    totaal++;
    eenheden.push(eenheid);
  };
  const laatVallen = () => { totaal++; weg++; };

  const verwerkStaat = (op, ops, nums) => {
    switch (op) {
      case 'q': stapel.push(st); st = { ...st }; return;
      case 'Q': if (stapel.length) st = stapel.pop(); return;
      case 'cm':
        if (nums.length !== 6) throw new Onleesbaar('cm');
        st.ctm = matMul(nums, st.ctm);
        return;
      case 'w': if (nums.length) st.lw = Math.abs(nums[nums.length - 1]); return;
      case 'M': if (nums.length) st.ml = Math.abs(nums[nums.length - 1]); return;
      case 'gs': {
        const naam = namenVan(ops).pop();
        const info = naam != null ? gsVan(naam) : null;
        if (!info) { st.lw = Infinity; st.font = null; return; }
        if (Number.isFinite(info.LW)) st.lw = Math.abs(info.LW);
        if (Number.isFinite(info.ML)) st.ml = Math.abs(info.ML);
        if (info.font) st.font = null; // font via ExtGState: niet gevolgd, dus onbekend
        return;
      }
      case 'Tf': {
        const naam = namenVan(ops).pop();
        st.font = naam != null ? fontVan(naam) : null;
        if (nums.length) st.tfs = Math.abs(nums[nums.length - 1]);
        return;
      }
      case 'Tc': if (nums.length) st.tc = nums[nums.length - 1]; return;
      case 'Tw': if (nums.length) st.tw = nums[nums.length - 1]; return;
      case 'Tz': if (nums.length) st.th = nums[nums.length - 1] / 100; return;
      case 'TL': if (nums.length) st.tl = nums[nums.length - 1]; return;
      case 'Ts': if (nums.length) st.rise = nums[nums.length - 1]; return;
      case 'Tr': if (nums.length) st.tr = nums[nums.length - 1]; return;
      default:
    }
  };

  // ── tekstobjecten ──
  const beginTekst = (s) => {
    tekst = { s, lm: IDENTITEIT, r: 0, weg: true, mc: 0, rest: [], namen: [] };
  };
  const toonGebied = (strings, aanpassing) => {
    // Bovengrens van alles wat deze tekenreeks kan raken, in de ruimte van de
    // regelmatrix: de pen staat op afstand ≤ r van de regeloorsprong, schuift
    // per glyf hooguit (breedte·Tfs + |Tc| + |Tw|)·|Th| op, en een glyf steekt
    // hooguit `uitsteek` em rond zijn oorsprong uit.
    const f = st.font;
    if (!f || st.tr >= 4 || !Number.isFinite(st.lw)) { tekst.weg = false; return; }
    const th = Math.abs(st.th);
    const glyfen = strings.reduce((n, s) => n + s.length, 0);
    const opschuiving = (glyfen * (f.breedte * st.tfs + Math.abs(st.tc) + Math.abs(st.tw))
      + aanpassing / 1000 * st.tfs) * th;
    const m = st.tfs * f.uitsteek;
    const hx = tekst.r + opschuiving + m * Math.max(th, 1);
    const hy = Math.abs(st.rise) + m;
    tekst.r += opschuiving;
    const marge = (st.tr === 1 || st.tr === 2) ? streekMarge() : 0;
    const o = kaderOnder(matMul(tekst.lm, st.ctm), -hx, -hy, hx, hy);
    if (!buiten(o, vak, marge)) tekst.weg = false;
  };
  const volgendeRegel = () => {
    tekst.lm = matMul([1, 0, 0, 1, 0, -st.tl], tekst.lm);
    tekst.r = 0;
  };

  const verwerkInTekst = (op, ops, nums, s, e) => {
    tekst.namen.push(...namenVan(ops));
    const ruw = () => src.slice(s, e);
    if (TEKST_STAAT.has(op) || ALGEMENE_STAAT.has(op)) {
      verwerkStaat(op, ops, nums);
      tekst.rest.push(ruw());
      return;
    }
    switch (op) {
      case 'Td': case 'TD':
        if (nums.length !== 2) throw new Onleesbaar(op);
        if (op === 'TD') { st.tl = -nums[1]; tekst.rest.push(`${getal(-nums[1])} TL`); }
        tekst.lm = matMul([1, 0, 0, 1, nums[0], nums[1]], tekst.lm);
        tekst.r = 0;
        return;
      case 'Tm':
        if (nums.length !== 6) throw new Onleesbaar('Tm');
        tekst.lm = nums;
        tekst.r = 0;
        return;
      case 'T*': volgendeRegel(); return;
      case 'Tj': case "'":
        if (op === "'") volgendeRegel();
        toonGebied(ops.filter((t) => t.t === 'str').map((t) => t.v), 0);
        return;
      case '"': {
        if (nums.length !== 2) throw new Onleesbaar('"');
        st.tw = nums[0];
        st.tc = nums[1];
        tekst.rest.push(`${getal(nums[0])} Tw ${getal(nums[1])} Tc`);
        volgendeRegel();
        toonGebied(ops.filter((t) => t.t === 'str').map((t) => t.v), 0);
        return;
      }
      case 'TJ': {
        const strs = ops.filter((t) => t.t === 'str').map((t) => t.v);
        const aanp = ops.filter((t) => t.t === 'num').reduce((n, t) => n + Math.abs(t.v), 0);
        toonGebied(strs, aanp);
        return;
      }
      case 'BMC': case 'BDC': tekst.mc++; return;
      case 'EMC': if (--tekst.mc < 0) tekst.weg = false; return;
      case 'MP': case 'DP': return;
      default:
        // Wat niet in een tekstobject hoort (paden, Do, q/Q, cm): het object
        // blijft dan heel staan, maar de toestand volgen we wel.
        tekst.weg = false;
        if (op === 'q' || op === 'Q' || op === 'cm') verwerkStaat(op, ops, nums);
        else if (op === 'BX') compat++;
        else if (op === 'EX') compat = Math.max(0, compat - 1);
    }
  };
  const eindTekst = (e) => {
    const t = tekst;
    tekst = null;
    if (t.weg && t.mc === 0) {
      laatVallen();
      // Wat het object aan toestand zette, geldt ook na ET: dat blijft staan.
      if (t.rest.length) {
        const namen = [];
        for (const r of t.rest) {
          for (const tok of tokenizeContentStream(r)) if (tok.t === 'name') namen.push(tok.v);
        }
        eenheden.push({ tekst: t.rest.join('\n'), soort: 'staat', namen });
      }
      return;
    }
    voegToe({ s: t.s, e, soort: 'verf', namen: t.namen });
  };

  // ── de lus ──
  const tokens = tokenizeContentStream(src);
  let ops = [];
  let opStart = -1;
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.t !== 'op') {
      if (!ops.length) opStart = tok.s;
      ops.push(tok);
      continue;
    }
    const op = tok.v;
    const s = ops.length ? opStart : tok.s;
    const e = tok.e;
    const operanden = ops;
    ops = [];
    const nums = getallen(operanden);

    if (tekst) {
      if (op === 'ET') eindTekst(e);
      else verwerkInTekst(op, operanden, nums, s, e);
      continue;
    }

    if (pad && !PAD_BOUW.has(op) && !PAD_VERF.has(op) && op !== 'W' && op !== 'W*') {
      throw new Onleesbaar(`pad onderbroken door ${op}`);
    }

    if (PAD_BOUW.has(op)) {
      if (!pad) pad = { s, minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity, punten: 0, clip: false };
      const n = nums;
      const verwacht = { m: 2, l: 2, c: 6, v: 4, y: 4, h: 0, re: 4 }[op];
      if (n.length !== verwacht) throw new Onleesbaar(op);
      if (op === 're') {
        voegPuntToe(n[0], n[1]); voegPuntToe(n[0] + n[2], n[1]);
        voegPuntToe(n[0], n[1] + n[3]); voegPuntToe(n[0] + n[2], n[1] + n[3]);
        cx = n[0]; cy = n[1];
      } else if (op !== 'h') {
        // De omhullende van de controlepunten omvat de hele Bézierkromme.
        if (op === 'v') voegPuntToe(cx, cy);
        for (let k = 0; k < n.length; k += 2) voegPuntToe(n[k], n[k + 1]);
        cx = n[n.length - 2]; cy = n[n.length - 1];
      }
      continue;
    }
    if (op === 'W' || op === 'W*') {
      if (!pad) pad = { s, minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity, punten: 0, clip: false };
      pad.clip = true;
      continue;
    }
    if (PAD_VERF.has(op)) {
      const p = pad || { s, minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity, punten: 0, clip: false };
      pad = null;
      // Een uitsnijpad blijft altijd staan; met `n` verandert het alleen de
      // toestand (Q zet het terug), met een verfoperator tekent het ook.
      if (p.clip) { voegToe({ s: p.s, e, soort: op === 'n' ? 'staat' : 'verf', namen: [] }); continue; }
      if (op === 'n') { laatVallen(); continue; } // pad zonder verf en zonder uitsnede
      const marge = PAD_STREEK.has(op) ? streekMarge() : 0;
      if (p.punten > 0 && buiten(p, vak, marge)) { laatVallen(); continue; }
      voegToe({ s: p.s, e, soort: 'verf', namen: [] });
      continue;
    }

    switch (op) {
      case 'BT':
        beginTekst(s);
        continue;
      case 'ET':
        throw new Onleesbaar('ET zonder BT');
      case 'q':
        verwerkStaat(op, operanden, nums);
        voegToe({ s, e, soort: 'q', namen: [] });
        continue;
      case 'Q':
        verwerkStaat(op, operanden, nums);
        voegToe({ s, e, soort: 'Q', namen: [] });
        continue;
      case 'BMC': case 'BDC':
        voegToe({ s, e, soort: 'mc', namen: namenVan(operanden) });
        continue;
      case 'EMC':
        voegToe({ s, e, soort: 'emc', namen: [] });
        continue;
      case 'MP': case 'DP':
        voegToe({ s, e, soort: 'staat', namen: namenVan(operanden) });
        continue;
      case 'Do': {
        const naam = namenVan(operanden).pop();
        const info = naam != null ? xobjectVan(naam) : null;
        let o = null;
        if (info?.soort === 'image') o = kaderOnder(st.ctm, 0, 0, 1, 1);
        else if (info?.soort === 'form' && info.bbox?.length === 4) {
          const [x0, y0, x1, y1] = info.bbox;
          o = kaderOnder(matMul(info.matrix || IDENTITEIT, st.ctm), x0, y0, x1, y1);
        }
        if (o && buiten(o, vak, 0)) {
          if (info.transparant) {
            // Zie `reserves` hieronder: misschien blijft deze toch staan.
            reserves.push({ s, e, soort: 'verf', namen: [naam], grootte: info.grootte || 0 });
            eenheden.push(reserves[reserves.length - 1]);
          }
          laatVallen();
          continue;
        }
        if (info?.transparant) transparantGetekend = true;
        voegToe({ s, e, soort: 'verf', namen: naam != null ? [naam] : [] });
        continue;
      }
      case 'BI..EI': {
        const kop = src.slice(s, e);
        const idx = kop.search(/\sID[\s\S]/);
        const namen = [...(idx > 0 ? kop.slice(0, idx) : '').matchAll(/\/([^\s/<>[\]()%{}]+)/g)].map((m) => m[1]);
        if (buiten(kaderOnder(st.ctm, 0, 0, 1, 1), vak, 0)) { laatVallen(); continue; }
        voegToe({ s, e, soort: 'verf', namen });
        continue;
      }
      case 'BX': compat++; voegToe({ s, e, soort: 'verf', namen: [] }); continue;
      case 'EX': compat = Math.max(0, compat - 1); voegToe({ s, e, soort: 'verf', namen: [] }); continue;
      default:
    }
    if (TEKST_STAAT.has(op) || ALGEMENE_STAAT.has(op) || op === 'cm') {
      verwerkStaat(op, operanden, nums);
      voegToe({ s, e, soort: 'staat', namen: namenVan(operanden) });
      continue;
    }
    if (op === 'sh' || op === 'd0' || op === 'd1') {
      voegToe({ s, e, soort: 'verf', namen: namenVan(operanden) });
      continue;
    }
    if (compat > 0) { voegToe({ s, e, soort: 'verf', namen: namenVan(operanden) }); continue; }
    if (TEKST_POSITIE.has(op) || TEKST_TONEN.has(op)) throw new Onleesbaar(`${op} buiten BT`);
    throw new Onleesbaar(`onbekende operator ${op}`);
  }
  if (pad || tekst) throw new Onleesbaar('stroom eindigt midden in een pad of tekstobject');

  // Een afbeelding met SMask (of een Form met transparantiegroep) maakt dat
  // renderers de hele pagina met transparantie mengen: PDFium zodra er zo'n
  // beeld getekend wordt, MuPDF zodra er een in de resources staat. Valt die
  // keuze na het snoeien anders uit, dan schuift de anti-aliasing van alles
  // een paar tinten. Daarom blijft, als er zo'n beeld was maar er binnen het
  // vak geen overblijft, het kleinste ervan staan — buiten het vak, dus
  // onzichtbaar in het knipsel.
  if (reserves.length) {
    const bewaar = transparantGetekend ? null
      : reserves.reduce((a, b) => (b.grootte < a.grootte ? b : a));
    for (const r of reserves) r.weg = r !== bewaar;
    if (bewaar) weg--;
  }
  const weggevallen = verwijderLegeBlokken(eenheden.filter((u) => !u.weg));
  const stukken = [];
  const namen = new Set();
  const over = eenheden.filter((u) => !u.weg);
  for (let i = 0; i < over.length; i++) {
    if (weggevallen[i]) continue;
    const u = over[i];
    stukken.push(u.tekst ?? src.slice(u.s, u.e));
    for (const n of u.namen) namen.add(n);
  }
  return { inhoud: stukken.join('\n'), namen, weg, totaal };
}

/**
 * q … Q zonder iets dat tekent (alleen toestand, die Q terugzet) en
 * BMC/BDC … EMC zonder iets erin vallen weg. Klopt de nesting niet, dan
 * blijft alles staan.
 * @returns {boolean[]} per eenheid: valt weg
 */
function verwijderLegeBlokken(eenheden) {
  const weg = new Array(eenheden.length).fill(false);
  const lagen = [{ soort: 'top', start: -1, verf: false, iets: false }];
  for (let i = 0; i < eenheden.length; i++) {
    const soort = eenheden[i].soort;
    const top = lagen[lagen.length - 1];
    if (soort === 'q' || soort === 'mc') {
      lagen.push({ soort, start: i, verf: false, iets: false });
      continue;
    }
    if (soort === 'Q' || soort === 'emc') {
      const verwacht = soort === 'Q' ? 'q' : 'mc';
      if (top.soort === 'top' && soort === 'Q') { top.verf = top.iets = true; continue; } // Q te veel
      if (top.soort !== verwacht) return new Array(eenheden.length).fill(false);
      lagen.pop();
      const ouder = lagen[lagen.length - 1];
      const leeg = soort === 'Q' ? !top.verf : !top.iets;
      if (leeg) { for (let k = top.start; k <= i; k++) weg[k] = true; continue; }
      ouder.verf ||= top.verf;
      ouder.iets = true;
      continue;
    }
    top.iets = true;
    if (soort === 'verf') top.verf = true;
  }
  return weg;
}

// ── pdf-lib-kant ──────────────────────────────────────────────────────────

const BRON_SOORTEN = ['Font', 'XObject', 'ExtGState', 'Pattern', 'Shading', 'Properties', 'ColorSpace'];

function latin1(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return s;
}

function naarBytes(s) {
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff;
  return b;
}

function streamBytes(stream) {
  if (stream instanceof PDFRawStream) return decodePDFRawStream(stream).decode();
  if (typeof stream?.getUnencodedContents === 'function') return stream.getUnencodedContents();
  if (typeof stream?.getContents === 'function') return stream.getContents();
  throw new Onleesbaar('onleesbare stroom');
}

/** De inhoud van een pagina als één latin1-string, of null. */
function paginaInhoud(context, node) {
  const c = node.Contents();
  if (!c) return '';
  const delen = c instanceof PDFArray ? c.asArray().map((r) => context.lookup(r)) : [c];
  const stukken = [];
  for (const d of delen) {
    if (!(d instanceof PDFStream)) return null;
    try { stukken.push(latin1(streamBytes(d))); } catch { return null; }
  }
  // Tokens lopen niet over stroomgrenzen heen; een witregel ertussen is genoeg.
  return stukken.join('\n');
}

function getalVan(context, v) {
  const o = v instanceof PDFRef ? context.lookup(v) : v;
  return o instanceof PDFNumber ? o.asNumber() : null;
}

function getallenVan(context, v) {
  const o = v instanceof PDFRef ? context.lookup(v) : v;
  if (!(o instanceof PDFArray)) return null;
  const uit = [];
  for (const x of o.asArray()) {
    const n = getalVan(context, x);
    if (n == null) return null;
    uit.push(n);
  }
  return uit;
}

function dictVan(context, v) {
  const o = v instanceof PDFRef ? context.lookup(v) : v;
  if (o instanceof PDFDict) return o;
  if (o instanceof PDFStream) return o.dict;
  return null;
}

function naamVan(context, v) {
  const o = v instanceof PDFRef ? context.lookup(v) : v;
  return o instanceof PDFName ? o.asString().replace(/^\//, '') : null;
}

/** Grootste glyfbreedte en uitsteek (em) van een font, of null als onbekend. */
export function fontMaten(context, fontDict) {
  const d = dictVan(context, fontDict);
  if (!d) return null;
  const soort = naamVan(context, d.get(PDFName.of('Subtype')));
  if (!soort || soort === 'Type3') return null;
  let breedtes = [];
  let beschrijving = null;
  if (soort === 'Type0') {
    const codering = d.get(PDFName.of('Encoding'));
    const cnaam = naamVan(context, codering);
    if (cnaam ? /-V$/.test(cnaam) : getalVan(context, dictVan(context, codering)?.get(PDFName.of('WMode'))) === 1) {
      return null; // verticaal schrift: de pen loopt omlaag, niet gevolgd
    }
    if (!cnaam && !dictVan(context, codering)) return null;
    const afstammelingen = d.get(PDFName.of('DescendantFonts'));
    const lijst = afstammelingen instanceof PDFRef ? context.lookup(afstammelingen) : afstammelingen;
    const cid = lijst instanceof PDFArray ? dictVan(context, lijst.get(0)) : null;
    if (!cid) return null;
    const dw = getalVan(context, cid.get(PDFName.of('DW')));
    breedtes.push(dw ?? 1000);
    const w = cid.get(PDFName.of('W'));
    const wa = w instanceof PDFRef ? context.lookup(w) : w;
    if (wa instanceof PDFArray) {
      for (const x of wa.asArray()) {
        const o = x instanceof PDFRef ? context.lookup(x) : x;
        if (o instanceof PDFArray) {
          const g = getallenVan(context, o);
          if (!g) return null;
          breedtes.push(...g);
        } else if (o instanceof PDFNumber) {
          breedtes.push(o.asNumber()); // ook begin/eind-codes: alleen een ruimere grens
        } else return null;
      }
    } else if (wa) return null;
    beschrijving = dictVan(context, cid.get(PDFName.of('FontDescriptor')));
  } else {
    const w = getallenVan(context, d.get(PDFName.of('Widths')));
    beschrijving = dictVan(context, d.get(PDFName.of('FontDescriptor')));
    if (w) breedtes = w;
    const ontbrekend = getalVan(context, beschrijving?.get(PDFName.of('MissingWidth')));
    if (ontbrekend != null) breedtes.push(ontbrekend);
    if (!w) breedtes.push(STANDAARD_BREEDTE * 1000);
  }
  const breedte = Math.max(0, ...breedtes.map(Math.abs)) / 1000;
  const bbox = getallenVan(context, beschrijving?.get(PDFName.of('FontBBox')));
  const uitsteek = Math.max(MIN_GLYF_UITSTEEK, breedte, ...(bbox?.length === 4 ? bbox.map((n) => Math.abs(n) / 1000) : []));
  if (!Number.isFinite(breedte) || !Number.isFinite(uitsteek)) return null;
  return { breedte, uitsteek };
}

function bronOpzoekers(context, bronDict) {
  const sub = (soort) => dictVan(context, bronDict?.get(PDFName.of(soort)));
  const fonts = sub('Font');
  const xobjs = sub('XObject');
  const gss = sub('ExtGState');
  const cache = new Map();
  const eenmaal = (k, f) => { if (!cache.has(k)) cache.set(k, f()); return cache.get(k); };
  return {
    font: (naam) => eenmaal(`F/${naam}`, () => {
      const v = fonts?.get(PDFName.of(naam));
      return v ? fontMaten(context, v) : null;
    }),
    xobject: (naam) => eenmaal(`X/${naam}`, () => {
      const v = xobjs?.get(PDFName.of(naam));
      const o = v instanceof PDFRef ? context.lookup(v) : v;
      if (!(o instanceof PDFStream)) return null;
      const soort = naamVan(context, o.dict.get(PDFName.of('Subtype')));
      const grootte = (st) => (st instanceof PDFStream ? (st.contents?.length ?? 0) : 0);
      if (soort === 'Image') {
        const smask = o.dict.get(PDFName.of('SMask'));
        const smaskStroom = smask instanceof PDFRef ? context.lookup(smask) : smask;
        const transparant = smaskStroom instanceof PDFStream
          || (getalVan(context, o.dict.get(PDFName.of('SMaskInData'))) || 0) > 0;
        return { soort: 'image', transparant, grootte: grootte(o) + grootte(smaskStroom) };
      }
      if (soort !== 'Form') return null;
      const bbox = getallenVan(context, o.dict.get(PDFName.of('BBox')));
      const matrix = o.dict.has(PDFName.of('Matrix')) ? getallenVan(context, o.dict.get(PDFName.of('Matrix'))) : IDENTITEIT;
      if (bbox?.length !== 4 || matrix?.length !== 6) return null;
      return { soort: 'form', bbox, matrix, transparant: o.dict.has(PDFName.of('Group')), grootte: grootte(o) };
    }),
    extGState: (naam) => eenmaal(`G/${naam}`, () => {
      const g = dictVan(context, gss?.get(PDFName.of(naam)));
      if (!g) return null;
      const info = {};
      if (g.has(PDFName.of('LW'))) {
        info.LW = getalVan(context, g.get(PDFName.of('LW')));
        if (info.LW == null) return null;
      }
      if (g.has(PDFName.of('ML'))) {
        info.ML = getalVan(context, g.get(PDFName.of('ML')));
        if (info.ML == null) return null;
      }
      if (g.has(PDFName.of('Font'))) info.font = true;
      return info;
    }),
  };
}

/**
 * Een ExtGState met transparantie blijft staan, ook als niets er meer naar
 * verwijst: MuPDF kijkt naar de resources om te kiezen of hij de pagina als
 * transparantiegroep mengt (zie ook de `reserves` in _snoei). Zo'n
 * woordenboek kost een paar bytes.
 */
function mengt(context, soort, v) {
  if (soort !== 'ExtGState') return false;
  const d = dictVan(context, v);
  if (!d) return false;
  const bm = d.get(PDFName.of('BM'));
  const bmNaam = naamVan(context, bm);
  if (bm && bmNaam !== 'Normal' && bmNaam !== 'Compatible') return true;
  const sm = d.get(PDFName.of('SMask'));
  if (sm && naamVan(context, sm) !== 'None') return true;
  for (const k of ['ca', 'CA']) {
    const n = getalVan(context, d.get(PDFName.of(k)));
    if (n != null && n < 1) return true;
  }
  return false;
}

/** Gebruikt dit object de resources van de pagina omdat het er zelf geen heeft? */
function leentPaginaBronnen(context, v) {
  const d = dictVan(context, v);
  if (!d || d.has(PDFName.of('Resources'))) return false;
  const soort = naamVan(context, d.get(PDFName.of('Subtype')));
  const patroon = getalVan(context, d.get(PDFName.of('PatternType')));
  return soort === 'Form' || soort === 'Type3' || patroon === 1;
}

/**
 * Snoeit een pdf-lib-pagina in place tot wat `vak` (ongedraaide
 * gebruikersruimte) kan raken: inhoudsstroom én resources.
 * @returns {{voor:number, na:number, weg:number, totaal:number}|null} null als
 *   er niets veilig te snoeien viel; de pagina is dan onaangeroerd.
 */
export function snoeiPagina(doc, page, vak) {
  const context = doc.context;
  const node = page.node;
  const src = paginaInhoud(context, node);
  if (src == null || src === '') return null;
  const bronDict = node.Resources();
  const r = snoeiInhoud(src, vak, bronOpzoekers(context, bronDict));
  if (!r || r.weg === 0) return null;

  node.set(PDFName.of('Contents'), context.register(context.flateStream(naarBytes(r.inhoud))));

  if (bronDict instanceof PDFDict) {
    const nieuw = context.obj({});
    let lenen = false;
    const soorten = new Map();
    for (const [sleutel, waarde] of bronDict.entries()) {
      const soort = sleutel.asString().replace(/^\//, '');
      const sub = BRON_SOORTEN.includes(soort) ? dictVan(context, waarde) : null;
      if (!sub) { nieuw.set(sleutel, waarde); continue; }
      const gehouden = context.obj({});
      for (const [naam, v] of sub.entries()) {
        // decodeText: de tokenizer leest #xx in namen al als het teken zelf.
        if (!r.namen.has(naam.decodeText()) && !mengt(context, soort, v)) continue;
        gehouden.set(naam, v);
        if (leentPaginaBronnen(context, v)) lenen = true;
      }
      soorten.set(sleutel, gehouden);
    }
    // Een Form, tiling-patroon of Type3-font zonder eigen resources leest die
    // van de pagina: welke namen daarin gebruikt worden zien we hier niet.
    if (!lenen) {
      for (const [sleutel, gehouden] of soorten) nieuw.set(sleutel, gehouden);
      node.set(PDFName.of('Resources'), nieuw);
    }
  }
  return { voor: src.length, na: r.inhoud.length, weg: r.weg, totaal: r.totaal };
}

// ── ontdubbelen ───────────────────────────────────────────────────────────

function fnv(bytes) {
  let h1 = 0x811c9dc5 >>> 0;
  let h2 = 0x01000193 >>> 0;
  for (let i = 0; i < bytes.length; i++) {
    h1 = Math.imul(h1 ^ bytes[i], 0x01000193) >>> 0;
    h2 = Math.imul(h2 + bytes[i] + i, 0x85ebca6b) >>> 0;
  }
  return `${h1.toString(16)}${h2.toString(16)}:${bytes.length}`;
}

const ruweBytes = (s) => (s instanceof PDFRawStream ? s.contents : s.getContents());

function gelijk(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Voegt identieke indirecte objecten samen die vanaf `wortels` bereikbaar
 * zijn. Bedoeld voor de resources van de knipsels in één document: elk
 * gesnoeid knipsel is een eigen mini-PDF, dus pdf-lib kopieert fonts en
 * afbeeldingen van dezelfde bronpagina per knipsel opnieuw. Alleen
 * aanroepen op objecten die net gekopieerd zijn en waar verder niemand naar
 * verwijst — dan maakt het samenvoegen niets anders dan het bestand kleiner.
 *
 * @param {import('pdf-lib').PDFContext} context
 * @param {Array<PDFDict|PDFRef>} wortels  bv. de /Resources van de knipsel-Forms
 * @returns {number} aantal weggehaalde dubbele objecten
 */
export function ontdubbel(context, wortels) {
  // Alle indirecte objecten onder de wortels (de wortels zelf niet).
  const refs = new Map();
  const stapel = [...wortels];
  const directen = [];
  while (stapel.length) {
    const o = stapel.pop();
    if (o instanceof PDFRef) {
      if (refs.has(o.tag)) continue;
      const doel = context.lookup(o);
      if (!doel) continue;
      refs.set(o.tag, o);
      stapel.push(doel);
      continue;
    }
    if (o instanceof PDFDict) { directen.push(o); for (const [, v] of o.entries()) stapel.push(v); }
    else if (o instanceof PDFArray) { directen.push(o); for (const v of o.asArray()) stapel.push(v); }
    else if (o instanceof PDFStream) { directen.push(o.dict); for (const [, v] of o.dict.entries()) stapel.push(v); }
  }

  // Canonieke vorm per object; verwijzingen worden de vorm van wat ze aanwijzen.
  // Objecten in een kring krijgen hun eigen tag erbij en worden nooit samengevoegd.
  const vorm = new Map();
  const bezig = new Set();
  const vormVan = (o) => {
    if (o instanceof PDFRef) {
      if (vorm.has(o.tag)) return vorm.get(o.tag);
      if (bezig.has(o.tag)) return `@${o.tag}`;
      bezig.add(o.tag);
      const doel = context.lookup(o);
      let v = doel ? vormVan(doel) : 'null';
      if (v.includes('@')) v = `${v}#${o.tag}`;
      bezig.delete(o.tag);
      vorm.set(o.tag, v);
      return v;
    }
    if (o instanceof PDFDict) {
      const delen = o.entries().map(([k, v]) => `${k.asString()} ${vormVan(v)}`).sort();
      return `<<${delen.join(' ')}>>`;
    }
    if (o instanceof PDFArray) return `[${o.asArray().map(vormVan).join(' ')}]`;
    if (o instanceof PDFStream) return `S${vormVan(o.dict)}${fnv(ruweBytes(o))}`;
    return String(o);
  };

  const eerste = new Map();   // vorm → canonieke ref
  const vervang = new Map();  // tag → canonieke ref
  for (const ref of refs.values()) {
    const v = vormVan(ref);
    if (v.includes('@')) continue;
    const kandidaat = eerste.get(v);
    if (!kandidaat) { eerste.set(v, ref); continue; }
    const a = context.lookup(kandidaat);
    const b = context.lookup(ref);
    if (a instanceof PDFStream && !gelijk(ruweBytes(a), ruweBytes(b))) continue;
    vervang.set(ref.tag, kandidaat);
  }
  if (!vervang.size) return 0;

  const herschrijf = (c) => {
    if (c instanceof PDFDict) {
      for (const [k, v] of c.entries()) if (v instanceof PDFRef && vervang.has(v.tag)) c.set(k, vervang.get(v.tag));
    } else if (c instanceof PDFArray) {
      for (let i = 0; i < c.size(); i++) {
        const v = c.get(i);
        if (v instanceof PDFRef && vervang.has(v.tag)) c.set(i, vervang.get(v.tag));
      }
    }
  };
  for (const c of directen) herschrijf(c);
  for (const w of wortels) if (!(w instanceof PDFRef)) herschrijf(w);
  let weg = 0;
  for (const tag of vervang.keys()) if (context.delete(refs.get(tag))) weg++;
  return weg;
}
