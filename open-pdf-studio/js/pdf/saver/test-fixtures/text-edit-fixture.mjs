// Testbestand voor proefleescorrecties (#508), gebouwd met pdf-lib.
//
// Vier pagina's met /Rotate 0, 90, 180 en 270; pagina 2 heeft daarbij een
// verschoven CropBox. Elke pagina draagt in /Annots de referentie-opbouw die
// andere PDF-lezers voor tekstcorrecties gebruiken:
//
//   1. een doorhaling als kind (/IRT naar het invoegteken, /RT /Group,
//      /IT /StrikeOutTextEdit, eigen /C en /T), vóór haar ouder;
//   2. een invoegteken als ouder (/IT /Replace, /Contents, /Sy /None,
//      /RD [1 1 1 1], /NM, /Subj, /Popup);
//   3. de popup van dat invoegteken;
//   4. een los invoegteken (/Sy /P, met /OPS_TextDir zoals de app hem schrijft);
//   5. een losse doorhaling als tekstcorrectie over twee regels (met
//      /OPS_TextDir en /OPS_MarkedText);
//   6. een oude doorhaling zonder /IT, zoals eerdere app-versies hem schreven;
//   7. een omgekeerd paar: de doorhaling als ouder, het invoegteken als kind.
//
// Alle tekst staat in de getoonde pagina horizontaal (textDir 0), met
// lettergrootte 10 en gehele coördinaten, zodat de waarden ook na de Float32-
// afronding van pdf.js exact blijven.
//
// buildLegacyMarkupFixture() bouwt daarnaast een bestand met gewone
// markeringen, een notitie met popup, een antwoord (/IRT zonder /RT /Group) en
// een status-antwoord: die moeten na deze wijziging precies zo laden en
// opslaan als voorheen.

import { PDFDocument, PDFName, PDFString, PDFHexString, degrees } from 'pdf-lib';

export const MEDIABOX = [0, 0, 612, 792];
export const LETTER = 10; // lettergrootte; boven = basislijn - 8, onder = basislijn + 2 (y omlaag)

/** Pagina-instellingen: rotatie en (eventueel verschoven) CropBox. */
export const PAGINAS = [
  { rotate: 0, cropBox: { x: 0, y: 0, width: 612, height: 792 } },
  { rotate: 90, cropBox: { x: 36, y: 48, width: 540, height: 720 } },
  { rotate: 180, cropBox: { x: 0, y: 0, width: 612, height: 792 } },
  { rotate: 270, cropBox: { x: 0, y: 0, width: 612, height: 792 } },
];

/**
 * Getoond punt (y omlaag, oorsprong linksboven van de getoonde pagina) naar
 * PDF-gebruikersruimte. Zelfstandig uitgeschreven per rotatie, los van de
 * code die getest wordt.
 */
export function naarGebruiker(paginaIndex) {
  const { rotate, cropBox: { x: bx, y: by, width: bw, height: bh } } = PAGINAS[paginaIndex];
  switch (rotate) {
    case 90: return (x, y) => ({ x: bx + y, y: by + x });
    case 180: return (x, y) => ({ x: bx + bw - x, y: by + y });
    case 270: return (x, y) => ({ x: bx + bw - y, y: by + bh - x });
    default: return (x, y) => ({ x: bx + x, y: by + bh - y });
  }
}

/** Tekstrechthoek van een regel in de getoonde pagina. */
export const tekstRect = (x1, x2, basislijn) => ({ x: x1, y: basislijn - 8, width: x2 - x1, height: LETTER });

/** Vak van het invoegteken bij invoegpunt P: zijde 5, top 1 boven P. */
export const karetVak = (px, py) => ({ x: px - 2.5, y: py - 1, width: 5, height: 5 });

/** De opbouw per pagina in getoonde coördinaten (textDir 0). */
export const OPBOUW = {
  vervang: { rects: [tekstRect(72, 90, 100)], P: { x: 90, y: 100 }, tekst: 'the' },
  invoeg: { P: { x: 200, y: 100 }, tekst: 'and' },
  schrap: { rects: [tekstRect(120, 160, 140), tekstRect(72, 110, 156)], gemarkeerd: 'old words' },
  oud: { rects: [tekstRect(72, 150, 180)], opmerking: 'legacy note' },
  omgekeerd: { rects: [tekstRect(72, 100, 220)], P: { x: 100, y: 220 }, tekst: 'new', ouderTekst: 'struck note' },
};

/** /NM-waarden per pagina (1-gebaseerd). */
export const nm = (pagina, naam) => `fx-p${pagina}-${naam}`;

const DATUM_AANGEMAAKT = 'D:20260915103000Z';
const DATUM_GEWIJZIGD = 'D:20260915104500Z';
export const OUDE_M = '2026-09-01T08:00:00.000Z';

/** Quad in referentie-volgorde: begin-boven, eind-boven, begin-onder, eind-onder. */
function referentieQuad(map, r) {
  const p = [
    map(r.x, r.y), map(r.x + r.width, r.y),
    map(r.x, r.y + r.height), map(r.x + r.width, r.y + r.height),
  ];
  return p.flatMap((q) => [q.x, q.y]);
}

/** Quad zoals eerdere app-versies hem schreven: assen-uitgelijnd LB, RB, LO, RO in gebruikersruimte. */
function oudeQuad(map, r) {
  const a = map(r.x, r.y);
  const b = map(r.x + r.width, r.y + r.height);
  const x1 = Math.min(a.x, b.x); const x2 = Math.max(a.x, b.x);
  const y1 = Math.min(a.y, b.y); const y2 = Math.max(a.y, b.y);
  return [x1, y2, x2, y2, x1, y1, x2, y1];
}

function omhullende(punten, marge) {
  const xs = []; const ys = [];
  for (let i = 0; i < punten.length; i += 2) { xs.push(punten[i]); ys.push(punten[i + 1]); }
  return [Math.min(...xs) - marge, Math.min(...ys) - marge, Math.max(...xs) + marge, Math.max(...ys) + marge];
}

function vakRect(map, vak, marge = 0) {
  const a = map(vak.x, vak.y);
  const b = map(vak.x + vak.width, vak.y + vak.height);
  return [Math.min(a.x, b.x) - marge, Math.min(a.y, b.y) - marge, Math.max(a.x, b.x) + marge, Math.max(a.y, b.y) + marge];
}

const tekst = (s) => PDFString.of(s);

/**
 * Het viervoudige testbestand. Geeft de bytes en, per pagina, de
 * objectnummers van de annotaties.
 * @returns {Promise<{ bytes: Uint8Array, refs: Array<Record<string, string>> }>}
 */
export async function buildTextEditFixture() {
  const doc = await PDFDocument.create();
  const ctx = doc.context;
  const refs = [];

  PAGINAS.forEach((instelling, i) => {
    const pagina = doc.addPage([MEDIABOX[2], MEDIABOX[3]]);
    pagina.setRotation(degrees(instelling.rotate));
    const { x, y, width, height } = instelling.cropBox;
    if (x || y || width !== MEDIABOX[2] || height !== MEDIABOX[3]) pagina.setCropBox(x, y, width, height);
    const map = naarGebruiker(i);
    const p = i + 1;
    const opsRichting = (360 - instelling.rotate) % 360; // textDir 0 in de ongedraaide pagina

    // 2. invoegteken-ouder (eerst aanmaken; het kind verwijst ernaar)
    const vVak = karetVak(OPBOUW.vervang.P.x, OPBOUW.vervang.P.y);
    const ouderDict = ctx.obj({
      Type: 'Annot', Subtype: 'Caret', Rect: vakRect(map, vVak, 1), RD: [1, 1, 1, 1],
      IT: 'Replace', Sy: 'None', Contents: tekst(OPBOUW.vervang.tekst),
      NM: tekst(nm(p, 'replace')), Subj: tekst('Inserted Text'), T: tekst('Reviewer'),
      C: [0.6, 0, 0.8], CA: 1, F: 4,
      CreationDate: tekst(DATUM_AANGEMAAKT), M: tekst(DATUM_GEWIJZIGD),
    });
    const ouderRef = ctx.register(ouderDict);
    // 3. popup
    const popupRef = ctx.register(ctx.obj({
      Type: 'Annot', Subtype: 'Popup', Rect: [400, 600, 560, 700], Parent: ouderRef, Open: false,
    }));
    ouderDict.set(PDFName.of('Popup'), popupRef);
    // 1. doorhaling-kind
    const kindQuad = OPBOUW.vervang.rects.flatMap((r) => referentieQuad(map, r));
    const kindRef = ctx.register(ctx.obj({
      Type: 'Annot', Subtype: 'StrikeOut', Rect: omhullende(kindQuad, 1), QuadPoints: kindQuad,
      IRT: ouderRef, RT: 'Group', IT: 'StrikeOutTextEdit',
      NM: tekst(nm(p, 'replace-strike')), Subj: tekst('Cross-Out'), T: tekst('Child Author'),
      C: [1, 0, 0], CA: 1, F: 4,
      CreationDate: tekst(DATUM_AANGEMAAKT), M: tekst(DATUM_GEWIJZIGD),
    }));
    // 4. los invoegteken
    const iVak = karetVak(OPBOUW.invoeg.P.x, OPBOUW.invoeg.P.y);
    const invoegRef = ctx.register(ctx.obj({
      Type: 'Annot', Subtype: 'Caret', Rect: vakRect(map, iVak), Sy: 'P',
      Contents: tekst(OPBOUW.invoeg.tekst), NM: tekst(nm(p, 'insert')), Subj: tekst('Inserted Text'),
      T: tekst('Reviewer'), C: [0, 0.4, 1], CA: 1, F: 4, OPS_TextDir: opsRichting,
      CreationDate: tekst(DATUM_AANGEMAAKT), M: tekst(DATUM_GEWIJZIGD),
    }));
    // 5. losse doorhaling als tekstcorrectie
    const schrapQuad = OPBOUW.schrap.rects.flatMap((r) => referentieQuad(map, r));
    const schrapRef = ctx.register(ctx.obj({
      Type: 'Annot', Subtype: 'StrikeOut', Rect: omhullende(schrapQuad, 1), QuadPoints: schrapQuad,
      IT: 'StrikeOutTextEdit', NM: tekst(nm(p, 'delete')), Subj: tekst('Cross-Out'),
      T: tekst('Reviewer'), C: [1, 0, 0], CA: 1, F: 4, Contents: tekst(''),
      OPS_TextDir: opsRichting, OPS_MarkedText: tekst(OPBOUW.schrap.gemarkeerd),
      CreationDate: tekst(DATUM_AANGEMAAKT), M: tekst(DATUM_GEWIJZIGD),
    }));
    // 6. oude doorhaling zonder /IT
    const oudQuad = OPBOUW.oud.rects.flatMap((r) => oudeQuad(map, r));
    const oudRef = ctx.register(ctx.obj({
      Type: 'Annot', Subtype: 'StrikeOut', Rect: omhullende(oudQuad, 0), QuadPoints: oudQuad,
      C: [1, 0, 0], CA: 1, T: tekst('User'), Contents: tekst(OPBOUW.oud.opmerking),
      M: tekst(OUDE_M), F: 4,
    }));
    // 7. omgekeerd paar
    const omgQuad = OPBOUW.omgekeerd.rects.flatMap((r) => referentieQuad(map, r));
    const omgOuderRef = ctx.register(ctx.obj({
      Type: 'Annot', Subtype: 'StrikeOut', Rect: omhullende(omgQuad, 1), QuadPoints: omgQuad,
      IT: 'StrikeOutTextEdit', NM: tekst(nm(p, 'rev-strike')), Subj: tekst('Cross-Out'),
      T: tekst('Other Reviewer'), C: [0.6, 0, 0.8], CA: 1, F: 4,
      Contents: tekst(OPBOUW.omgekeerd.ouderTekst),
      CreationDate: tekst(DATUM_AANGEMAAKT), M: tekst(DATUM_GEWIJZIGD),
    }));
    const oVak = karetVak(OPBOUW.omgekeerd.P.x, OPBOUW.omgekeerd.P.y);
    const omgKindRef = ctx.register(ctx.obj({
      Type: 'Annot', Subtype: 'Caret', Rect: vakRect(map, oVak), Sy: 'None',
      IRT: omgOuderRef, RT: 'Group', Contents: tekst(OPBOUW.omgekeerd.tekst),
      NM: tekst(nm(p, 'rev-caret')), Subj: tekst('Inserted Text'), T: tekst('Other Reviewer'),
      C: [0.6, 0, 0.8], CA: 1, F: 4,
      CreationDate: tekst(DATUM_AANGEMAAKT), M: tekst(DATUM_GEWIJZIGD),
    }));

    pagina.node.set(PDFName.of('Annots'), ctx.obj([
      kindRef, ouderRef, popupRef, invoegRef, schrapRef, oudRef, omgOuderRef, omgKindRef,
    ]));
    refs.push({
      kind: kindRef.toString(), ouder: ouderRef.toString(), popup: popupRef.toString(),
      invoeg: invoegRef.toString(), schrap: schrapRef.toString(), oud: oudRef.toString(),
      omgOuder: omgOuderRef.toString(), omgKind: omgKindRef.toString(),
    });
  });

  return { bytes: await doc.save(), refs };
}

/** De opbouw van het bestand met gewone markeringen (getoonde coördinaten). */
export const OUDE_OPBOUW = {
  markeer: { rects: [tekstRect(72, 200, 300)], kleur: [1, 1, 0] },
  onderstreep: { rects: [tekstRect(72, 150, 330), tekstRect(72, 120, 346)], kleur: [0, 0.5, 0] },
  doorhaal: { rects: [tekstRect(72, 140, 380)], kleur: [1, 0, 0], opmerking: 'gone' },
};

/**
 * Bestand met bestaande markeringen zonder /IT, /NM of /Subj, zoals de app
 * ze schreef, plus een notitie met popup, een gewoon antwoord (/IRT zonder
 * /RT /Group) op de markering en een status-antwoord op de notitie.
 * Pagina 1 /Rotate 0, pagina 2 /Rotate 90 met verschoven CropBox.
 */
export async function buildLegacyMarkupFixture() {
  const doc = await PDFDocument.create();
  const ctx = doc.context;
  const refs = [];
  for (const i of [0, 1]) {
    const instelling = PAGINAS[i];
    const pagina = doc.addPage([MEDIABOX[2], MEDIABOX[3]]);
    pagina.setRotation(degrees(instelling.rotate));
    const { x, y, width, height } = instelling.cropBox;
    if (x || y || width !== MEDIABOX[2] || height !== MEDIABOX[3]) pagina.setCropBox(x, y, width, height);
    const map = naarGebruiker(i);
    const markup = (subtype, def) => {
      const quad = def.rects.flatMap((r) => oudeQuad(map, r));
      return ctx.register(ctx.obj({
        Type: 'Annot', Subtype: subtype, Rect: omhullende(quad, 0), QuadPoints: quad,
        C: def.kleur, CA: subtype === 'Highlight' ? 0.5 : 1, T: tekst('User'),
        Contents: tekst(def.opmerking || ''), M: tekst(OUDE_M), F: 4,
      }));
    };
    const markeerRef = markup('Highlight', OUDE_OPBOUW.markeer);
    const onderRef = markup('Underline', OUDE_OPBOUW.onderstreep);
    const doorRef = markup('StrikeOut', OUDE_OPBOUW.doorhaal);
    const notitieDict = ctx.obj({
      Type: 'Annot', Subtype: 'Text', Rect: [300, 300, 324, 324], Name: 'Comment',
      Contents: PDFHexString.fromText('Opmerking €'), T: tekst('User'), C: [1, 1, 0], F: 4,
      M: tekst(OUDE_M),
    });
    const notitieRef = ctx.register(notitieDict);
    const popupRef = ctx.register(ctx.obj({
      Type: 'Annot', Subtype: 'Popup', Rect: [330, 300, 480, 400], Parent: notitieRef, Open: false,
    }));
    notitieDict.set(PDFName.of('Popup'), popupRef);
    const antwoordRef = ctx.register(ctx.obj({
      Type: 'Annot', Subtype: 'Text', Rect: [300, 340, 324, 364], Name: 'Comment',
      IRT: markeerRef, Contents: tekst('reply text'), T: tekst('Colleague'), C: [1, 1, 0], F: 4,
      M: tekst(OUDE_M),
    }));
    const statusRef = ctx.register(ctx.obj({
      Type: 'Annot', Subtype: 'Text', Rect: [300, 300, 324, 324], IRT: notitieRef,
      State: tekst('Accepted'), StateModel: tekst('Review'), Contents: tekst('Accepted'),
      T: tekst('Colleague'), F: 30, M: tekst('D:20260920120000Z'),
    }));
    pagina.node.set(PDFName.of('Annots'), ctx.obj([
      markeerRef, onderRef, doorRef, notitieRef, popupRef, antwoordRef, statusRef,
    ]));
    refs.push({
      markeer: markeerRef.toString(), onder: onderRef.toString(), door: doorRef.toString(),
      notitie: notitieRef.toString(), popup: popupRef.toString(), antwoord: antwoordRef.toString(),
      status: statusRef.toString(),
    });
  }
  return { bytes: await doc.save(), refs };
}
