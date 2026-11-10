// Gekozen lettertypen inbedden in tekstvakken en callouts (#1020).
//
// Een tekstvak in een geïnstalleerd lettertype dat geen standaardletter is
// (Cascadia Mono, Segoe UI, ...) ging tot nu toe alleen op naam mee: een lezer
// zonder dat lettertype toonde Helvetica, Times of Courier. Deze keten zoekt
// het lettertypebestand op (src-tauri/src/systeem_lettertypen.rs), bedt het
// één keer per opslag in als deelverzameling (alleen de gebruikte tekens) en
// geeft de appearance van het tekstvak er tekst mee. Vijf tekstvakken in
// hetzelfde lettertype delen één ingebed font.
//
// Wat niet kan (geen bestand, licentie verbiedt inbedden, een collectie, de
// webversie) valt terug op het oude gedrag: het lettertype op naam met de
// standaardletter als vervanging. Tekens die het lettertype niet heeft,
// gaan ook langs die oude weg in plaats van als lege vakjes.

import { invoke, isTauri } from '../../core/platform.js';
import { laadFontkit } from './ocr-text-layer.js';
import { isStandaardFamilie } from '../../text/lettertype-inbedding.js';

const zoekCache = new Map();

/**
 * Het lettertypebestand voor een familie en stijl, of null in de webversie.
 * @returns {Promise<null | { pad: string|null, exact: boolean, insluitbaar: boolean, reden: string|null }>}
 */
export function zoekSysteemFont(familie, vet = false, cursief = false) {
  if (!isTauri() || !familie) return Promise.resolve(null);
  const sleutel = `${String(familie).trim().toLowerCase()}|${vet ? 1 : 0}|${cursief ? 1 : 0}`;
  if (!zoekCache.has(sleutel)) {
    zoekCache.set(sleutel, invoke('systeem_lettertype_zoeken', { familie: String(familie), vet: !!vet, cursief: !!cursief })
      .catch((e) => { console.warn('[fonts] zoeken mislukt:', e?.message || e); return null; }));
  }
  return zoekCache.get(sleutel);
}

/** Wordt dit lettertype ingebed bij opslaan? (voor de melding in het paneel) */
export async function wordtIngebed(familie) {
  if (!familie || familie === 'mixed' || isStandaardFamilie(familie)) return { ingebed: false, reden: null };
  const r = await zoekSysteemFont(familie, false, false);
  if (!r) return { ingebed: false, reden: null };
  return { ingebed: !!r.insluitbaar, reden: r.reden || null };
}

async function leesBytes(pad) {
  const data = await invoke('systeem_lettertype_lezen', { pad });
  return data instanceof Uint8Array ? data : new Uint8Array(data);
}

/** Zes hoofdletters, vast per naam (geen toeval: dezelfde opslag geeft dezelfde bytes). */
export function subsetTag(naam) {
  let h = 2166136261;
  for (const c of String(naam)) h = Math.imul(h ^ c.codePointAt(0), 16777619) >>> 0;
  let tag = '';
  for (let i = 0; i < 6; i++) { tag += String.fromCharCode(65 + (h % 26)); h = Math.floor(h / 26) || (h ^ 0x9e3779b9) >>> 0; }
  return tag;
}

function resourceNaam(familie, vet, cursief, nummer) {
  const basis = String(familie).replace(/[^A-Za-z0-9]/g, '').slice(0, 40) || 'Font';
  return `OPSE${nummer}${basis}${vet ? 'B' : ''}${cursief ? 'I' : ''}`;
}

/**
 * Keten voor één opslag van `pdfDocLib`.
 * @param {*} pdfDocLib
 * @param {{ zoek?: Function, laadBytes?: Function, waarschuw?: Function }} [opties]
 */
export function maakSysteemFontKeten(pdfDocLib, {
  zoek = zoekSysteemFont,
  laadBytes = leesBytes,
  waarschuw = (m) => console.warn(m),
} = {}) {
  const perPad = new Map();      // pad -> Promise<{ naam, font, glyphs } | null>
  const perStijl = new Map();    // familie|vet|cursief -> Promise<... | null>
  const gebruikt = new Map();    // naam -> PDFFont

  const laadFont = (pad, familie, vet, cursief) => {
    if (!perPad.has(pad)) {
      perPad.set(pad, (async () => {
        try {
          const bytes = await laadBytes(pad);
          const fontkit = await laadFontkit();
          const glyphs = fontkit.create(bytes);
          if (glyphs?.fonts) throw new Error('font collection');
          // Een deelverzameling heet in PDF "ABCDEF+Naam" (PDF 32000 9.6.4):
          // zo tonen lezers en PDF/A-controles het font als ingebed subset.
          pdfDocLib.registerFontkit(fontkit);
          const ps = String(glyphs.postscriptName || familie).replace(/[^A-Za-z0-9-]/g, '') || 'Font';
          const font = await pdfDocLib.embedFont(bytes, { subset: true, customName: `${subsetTag(ps + perPad.size)}+${ps}` });
          return { naam: resourceNaam(familie, vet, cursief, perPad.size), font, glyphs };
        } catch (e) {
          waarschuw(`[save] font ${familie} not embedded (${e?.message || e}); the text box keeps the standard font`);
          return null;
        }
      })());
    }
    return perPad.get(pad);
  };

  return {
    /**
     * Het ingebedde font voor deze familie en stijl, of null (dan het oude gedrag).
     * @returns {Promise<null | { naam: string, font: import('pdf-lib').PDFFont, glyphs: any }>}
     */
    async voor(familie, vet = false, cursief = false) {
      if (!familie || familie === 'mixed' || isStandaardFamilie(familie)) return null;
      const sleutel = `${String(familie).trim().toLowerCase()}|${vet ? 1 : 0}|${cursief ? 1 : 0}`;
      if (!perStijl.has(sleutel)) {
        perStijl.set(sleutel, (async () => {
          const r = await zoek(familie, vet, cursief);
          if (!r?.insluitbaar || !r.pad) return null;
          return laadFont(r.pad, familie, vet && r.exact, cursief && r.exact);
        })());
      }
      return perStijl.get(sleutel);
    },
    /** Markeer een font als gebruikt in een appearance. */
    gebruik(f) {
      if (f) gebruikt.set(f.naam, f.font);
    },
    /** Ref voor /Resources /Font, of undefined. */
    ref(naam) {
      return gebruikt.get(naam)?.ref;
    },
  };
}

/**
 * Verdeelt tekst in stukken die het ingebedde font wel en niet heeft.
 * @returns {Array<{ tekst: string, ingebed: boolean }>}
 */
export function splitsOpDekking(tekst, heeftTeken) {
  const uit = [];
  for (const teken of String(tekst ?? '')) {
    const cp = teken.codePointAt(0);
    // Spaties en regeltekens horen bij de lopende run.
    const ingebed = cp <= 0x20 ? (uit[uit.length - 1]?.ingebed ?? true) : !!heeftTeken(cp);
    const laatste = uit[uit.length - 1];
    if (laatste && laatste.ingebed === ingebed) laatste.tekst += teken;
    else uit.push({ tekst: teken, ingebed });
  }
  return uit;
}
