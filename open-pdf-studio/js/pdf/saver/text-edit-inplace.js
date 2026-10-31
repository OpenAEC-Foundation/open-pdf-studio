// ── In-place tekstbewerking in de content stream ──
//
// Lokaliseert per text-edit de show-text-operatoren van de originele runs in
// de content stream(s) van de pagina — of in een Form XObject dat maar één
// keer getekend wordt (#716) — en knipt ze eruit (met behoud van de
// neveneffecten van ' en "). De saver tekent daarna de nieuwe tekst op
// hetzelfde anker — waar mogelijk in het originele font (her-encodering via
// de omgekeerde ToUnicode-/encoding-map), anders via het Standard-14-pad.
//
// Veiligheid staat voorop: bij elke twijfel (geen unieke match, niet-
// decodeerbaar font, chain-afhankelijkheid, tekst in een niet-splicebare
// stream) wordt de edit NIET geknipt en valt de saver terug op het bestaande
// afdekvlak-pad.

import {
  PDFArray,
  PDFDict,
  PDFName,
  PDFRawStream,
  PDFRef,
  PDFStream,
  decodePDFRawStream,
} from 'pdf-lib';
import {
  interpretContentStreams,
  decodeShowOpText,
  matchEditLines,
  checkChainSafety,
  planSplices,
  applySplices,
  parseToUnicodeCMap,
  buildSimpleEncodingMap,
  invertUnicodeMap,
  encodeTextToCodes,
  codesToHexString,
  isSubsetFontName,
  xobjectBBox,
  fontVariantFromBaseName,
  parseWArray,
  computeRunWidth,
  tokenizeContentStream,
  matMul,
} from '../../text/content-stream-text.js';
import { textEditLineAnchor } from '../../text/text-edit-appearance.js';

// Uint8Array ↔ latin1-string (1 char == 1 byte)
function bytesToLatin1(bytes) {
  let out = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return out;
}

function latin1ToBytes(str) {
  const out = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0xFF;
  return out;
}

function nameStr(obj) {
  return obj ? String(obj).replace(/^\//, '') : '';
}

// Bouwt per fontresource-sleutel van de pagina een decodeer-/encodeer-info:
// { bytesPerCode, map (code→Unicode), inverse (Unicode→code), subset, key }.
// Fonts zonder bruikbare mapping krijgen map=null (→ niet decodeerbaar, ops
// van dat font blokkeren een match maar veroorzaken nooit een verkeerde knip).
export function buildPageFontInfos(context, page) {
  let fontDict = null;
  try {
    const resources = page.node.Resources();
    fontDict = resources ? resources.lookupMaybe(PDFName.of('Font'), PDFDict) : null;
  } catch (_) { fontDict = null; }
  return fontDict ? buildFontInfos(context, fontDict) : new Map();
}

// Idem voor één /Font-woordenboek (van de pagina of van een Form XObject).
export function buildFontInfos(context, fontDict) {
  const infos = new Map();

  for (const key of fontDict.keys()) {
    let info = {
      bytesPerCode: 1, map: null, inverse: null, subset: false, key: nameStr(key),
      baseFont: '', variant: null, widthOf: null, hasGlyph: null, subtype: '',
    };
    try {
      const f = fontDict.lookupMaybe(key, PDFDict);
      if (!f) { infos.set(nameStr(key), info); continue; }
      const subtype = nameStr(f.lookupMaybe(PDFName.of('Subtype'), PDFName));
      const baseFont = nameStr(f.lookupMaybe(PDFName.of('BaseFont'), PDFName));
      info.subtype = subtype;
      info.subset = isSubsetFontName(baseFont);
      info.baseFont = baseFont;
      info.variant = fontVariantFromBaseName(baseFont);
      const isType0 = subtype === 'Type0';

      // Breedtes en glyf-dekking uit de font-structuur zelf (fase B): voor
      // simpele fonts /FirstChar + /Widths, voor Type0 de /W-array van het
      // descendant-font. Een code met breedte > 0 heeft (vrijwel zeker) een
      // glyf in de (subset-)font; codes daarbuiten niet.
      if (isType0) {
        const desc = f.lookupMaybe(PDFName.of('DescendantFonts'), PDFArray);
        const cidFont = desc && desc.size() > 0 ? context.lookup(desc.get(0)) : null;
        if (cidFont instanceof PDFDict) {
          const wArr = cidFont.lookupMaybe(PDFName.of('W'), PDFArray);
          const dwObj = cidFont.get(PDFName.of('DW'));
          const dw = typeof context.lookup(dwObj)?.asNumber === 'function'
            ? context.lookup(dwObj).asNumber() : 1000;
          if (wArr) {
            const toJs = (a) => {
              const out = [];
              for (let i = 0; i < a.size(); i++) {
                const el = context.lookup(a.get(i));
                if (el instanceof PDFArray) out.push(toJs(el));
                else if (typeof el?.asNumber === 'function') out.push(el.asNumber());
              }
              return out;
            };
            const wMap = parseWArray(toJs(wArr));
            info.widthOf = (code) => (wMap.has(code) ? wMap.get(code) : dw);
            info.hasGlyph = (code) => wMap.has(code) && wMap.get(code) > 0;
          }
        }
      } else {
        const fc = context.lookup(f.get(PDFName.of('FirstChar')));
        const widthsArr = f.lookupMaybe(PDFName.of('Widths'), PDFArray);
        if (widthsArr && typeof fc?.asNumber === 'function') {
          const first = fc.asNumber();
          // Type3: de /Widths staan in glyfruimte; de /FontMatrix zet ze om
          // naar tekstruimte. In 1000-units is dat × FontMatrix[0] × 1000
          // (voor de gangbare [0.001 0 0 0.001 0 0] precies 1).
          const schaal = subtype === 'Type3' ? type3BreedteSchaal(context, f) : 1;
          const widths = [];
          for (let i = 0; i < widthsArr.size(); i++) {
            const el = context.lookup(widthsArr.get(i));
            widths.push(typeof el?.asNumber === 'function' ? el.asNumber() * schaal : 0);
          }
          info.widthOf = (code) => {
            const w = widths[code - first];
            return w === undefined ? undefined : w;
          };
          info.hasGlyph = (code) => code >= first && (widths[code - first] || 0) > 0;
          if (subtype === 'Type3') {
            // Een Type3-glyf bestaat alleen als zijn naam (uit /Differences)
            // een /CharProcs-procedure heeft (#723). Ontbreekt die, dan
            // schrijft de saver de run in Standard-14, net als de weergave.
            const metProc = type3CodesMetProcedure(context, f);
            info.hasGlyph = (code) => code >= first && metProc.has(code);
          }
        }
      }

      // 1) ToUnicode is de meest betrouwbare bron (en de bron die extractie-
      //    tools en de tekstlaag ook gebruiken).
      let tuMap = null;
      let tuBytes = 0;
      const tu = f.lookupMaybe(PDFName.of('ToUnicode'), PDFStream);
      if (tu instanceof PDFRawStream) {
        try {
          const parsed = parseToUnicodeCMap(bytesToLatin1(decodePDFRawStream(tu).decode()));
          if (parsed.map.size > 0) { tuMap = parsed.map; tuBytes = parsed.codeBytes; }
        } catch (_) { /* kapotte CMap → geen decodering */ }
      }

      if (isType0) {
        // Composite font: alleen Identity-H/V met ToUnicode ondersteunen.
        const enc = nameStr(f.lookupMaybe(PDFName.of('Encoding'), PDFName));
        if (tuMap && (enc === 'Identity-H' || enc === 'Identity-V' || enc === '')) {
          info.bytesPerCode = tuBytes === 1 ? 1 : 2;
          info.map = tuMap;
        }
      } else if (tuMap && tuBytes === 1) {
        info.bytesPerCode = 1;
        info.map = tuMap;
      } else {
        // 2) Simpele fonts zonder (bruikbare) ToUnicode: /Encoding.
        const encRaw = f.get(PDFName.of('Encoding'));
        const enc = encRaw ? context.lookup(encRaw) : null;
        if (enc instanceof PDFName) {
          const { map } = buildSimpleEncodingMap(nameStr(enc), null);
          info.map = map;
        } else if (enc instanceof PDFDict) {
          const base = nameStr(enc.lookupMaybe(PDFName.of('BaseEncoding'), PDFName));
          const diffsArr = enc.lookupMaybe(PDFName.of('Differences'), PDFArray);
          let diffs = null;
          if (diffsArr) {
            diffs = [];
            for (let i = 0; i < diffsArr.size(); i++) {
              const el = context.lookup(diffsArr.get(i));
              if (el instanceof PDFName) diffs.push(nameStr(el));
              else if (typeof el?.asNumber === 'function') diffs.push(el.asNumber());
            }
          }
          const { map } = buildSimpleEncodingMap(base, diffs);
          info.map = map;
        }
        // geen Encoding en geen ToUnicode (symbolisch font) → niet decodeerbaar
      }
      if (info.map) info.inverse = invertUnicodeMap(info.map);
    } catch (_) {
      info = {
        bytesPerCode: 1, map: null, inverse: null, subset: false, key: nameStr(key),
        baseFont: '', variant: null, widthOf: null, hasGlyph: null, subtype: '',
      };
    }
    infos.set(nameStr(key), info);
  }
  return infos;
}

// Type3: FontMatrix[0] × 1000 (breedte in glyfruimte → 1000-units), of 1.
function type3BreedteSchaal(context, f) {
  try {
    const arr = f.lookupMaybe(PDFName.of('FontMatrix'), PDFArray);
    const a = arr && arr.size() === 6 ? context.lookup(arr.get(0)) : null;
    const v = typeof a?.asNumber === 'function' ? a.asNumber() : NaN;
    return Number.isFinite(v) && v > 0 ? v * 1000 : 1;
  } catch (_) { return 1; }
}

// Type3: de codes waarvan de glyfnaam (uit /Encoding /Differences) een
// procedure in /CharProcs heeft.
function type3CodesMetProcedure(context, f) {
  const codes = new Set();
  try {
    const procs = f.lookupMaybe(PDFName.of('CharProcs'), PDFDict);
    const enc = context.lookup(f.get(PDFName.of('Encoding')));
    const diffs = enc instanceof PDFDict ? enc.lookupMaybe(PDFName.of('Differences'), PDFArray) : null;
    if (!procs || !diffs) return codes;
    let code = 0;
    for (let i = 0; i < diffs.size(); i++) {
      const el = context.lookup(diffs.get(i));
      if (typeof el?.asNumber === 'function') { code = el.asNumber(); continue; }
      if (el instanceof PDFName) {
        if (procs.has(el)) codes.add(code);
        code++;
      }
    }
  } catch (_) { /* geen bruikbare procedures */ }
  return codes;
}

// Familie-index over de pagina-fonts: genormaliseerde familie → per
// vet/cursief-combinatie de resource-sleutel. Alleen fonts met een bruikbare
// omgekeerde Unicode-map tellen mee (anders valt er niets te encoderen).
function buildFamilyIndex(fontInfos) {
  const index = new Map();
  for (const [key, fi] of fontInfos) {
    if (!fi.inverse || !fi.variant || !fi.variant.family) continue;
    const slot = `${fi.variant.bold ? 'b' : ''}${fi.variant.italic ? 'i' : ''}` || 'r';
    if (!index.has(fi.variant.family)) index.set(fi.variant.family, {});
    const entry = index.get(fi.variant.family);
    if (!entry[slot]) entry[slot] = key;
  }
  return index;
}

// De te matchen regelsets voor een edit, in volgorde van voorkeur:
// 1. de bij een eerdere in-place-save weggeschreven regels (her-bewerken),
// 2. de per-regel vastgelegde originele posities/teksten (originalLineInfo),
// 3. afgeleide ankers uit pdfX/pdfY + lineSpacing (oudere records).
function buildLineCandidateSets(edit) {
  const sets = [];
  if (Array.isArray(edit.inplaceBaked?.lines) && edit.inplaceBaked.lines.length) {
    sets.push(edit.inplaceBaked.lines.map(l => ({
      x: Number(l.x) || 0,
      y: Number(l.y) || 0,
      text: String(l.text ?? ''),
      fontSize: Number(l.fontSize) > 0 ? Number(l.fontSize) : edit.fontSize,
      angle: Number(l.angle) || 0,
    })));
  }
  if (Array.isArray(edit.originalLineInfo) && edit.originalLineInfo.length) {
    sets.push(edit.originalLineInfo.map(l => ({
      x: Number(l.x) || 0,
      y: Number(l.y) || 0,
      text: String(l.text ?? ''),
      fontSize: Number(l.fontSize) > 0 ? Number(l.fontSize) : edit.fontSize,
      angle: Number(l.angle) || 0,
    })));
  } else if (edit.originalText) {
    const angle = Number(edit.textAngle) || 0;
    const ls = edit.lineSpacing || edit.fontSize * 1.2;
    const origLines = String(edit.originalText).split('\n');
    sets.push(origLines.map((t, i) => {
      const anchor = textEditLineAnchor(edit.pdfX, edit.pdfY, i, ls, angle);
      const spanText = Array.isArray(edit.originalSpanTexts?.[i])
        ? edit.originalSpanTexts[i].join('')
        : t;
      return { x: anchor.x, y: anchor.y, text: spanText, fontSize: edit.fontSize, angle };
    }));
  }
  return sets;
}

// Voert de in-place-analyse en -knip uit voor alle kandidaat-edits.
// Retourneert Map<edit, { removedOriginal, encodeLine }>. Edits zonder entry
// volgen het bestaande afdekvlak-pad.
export function applyInPlaceTextEdits(pdfDocLib, pages, edits) {
  const results = new Map();
  const perPage = new Map();
  for (const edit of edits) {
    if (!edit || edit.baked) continue;
    // Toegevoegde tekst heeft geen origineel om te knippen.
    if (!edit.originalText) continue;
    // Eerder met afdekvlak ingebakken: origineel zit al onder een wit vlak;
    // opnieuw knippen zou het gebakken resultaat dupliceren. Blijf legacy.
    if (edit.bakedNewText && !edit.inplaceBaked) continue;
    const pi = edit.page - 1;
    if (pi < 0 || pi >= pages.length) continue;
    if (!perPage.has(pi)) perPage.set(pi, []);
    perPage.get(pi).push(edit);
  }

  for (const [pi, pageEdits] of perPage) {
    try {
      applyForPage(pdfDocLib, pages[pi], pageEdits, results);
    } catch (err) {
      console.warn(
        `[text-edits] In-place analyse mislukt voor pagina ${pi + 1}; ` +
        'terugval op afdekvlak.', err,
      );
    }
  }
  return results;
}

function applyForPage(pdfDocLib, page, pageEdits, results) {
  page.node.normalize();
  const contents = page.node.Contents();
  if (!(contents instanceof PDFArray)) return;
  const ana = analyseerPagina(pdfDocLib, page, pageEdits);
  if (!ana || ana.editMatches.length === 0) return;
  const context = pdfDocLib.context;
  const { editMatches, ops, entries, fontInfos, resources } = ana;

  // Splices toepassen en de betrokken streams vervangen (opnieuw geflate't).
  const removeIdx = [...new Set(editMatches.flatMap(ana.removalFor))];
  const splices = planSplices(ops, removeIdx);
  const perStream = new Map();
  for (const sp of splices) {
    if (!perStream.has(sp.si)) perStream.set(sp.si, []);
    perStream.get(sp.si).push(sp);
  }
  for (const [si, list] of perStream) {
    const entry = entries[si];
    const newText = applySplices(entry.text, list);
    if (entry.form) {
      // Formulier: de stream onder dezelfde verwijzing vervangen, met zijn
      // eigen woordenboek (BBox, Matrix, Resources, ...).
      const dict = entry.form.xo.dict.clone(context);
      dict.delete(PDFName.of('DecodeParms'));
      dict.delete(PDFName.of('Length'));
      dict.set(PDFName.of('Filter'), PDFName.of('FlateDecode'));
      const ingepakt = context.flateStream(latin1ToBytes(newText)).getContents();
      context.assign(entry.form.ref, PDFRawStream.of(dict, ingepakt));
      continue;
    }
    const newStream = context.flateStream(latin1ToBytes(newText));
    const newRef = context.register(newStream);
    contents.set(entry.arrayIdx, newRef);
  }

  // De nieuwe tekst komt in de pagina zelf. Een font uit een formulier krijgt
  // daarom ook een sleutel in de /Font van de pagina: dezelfde als het font
  // daar al staat, anders een vrije naam.
  const paginaSleutel = (fontKey) => {
    const fi = fontInfos.get(fontKey);
    if (!fi?.bron) return fontKey;
    if (fi.paginaSleutel) return fi.paginaSleutel;
    let paginaFonts = resources.lookupMaybe(PDFName.of('Font'), PDFDict);
    if (!paginaFonts) {
      paginaFonts = context.obj({});
      resources.set(PDFName.of('Font'), paginaFonts);
    }
    const waarde = fi.bron.dict.get(PDFName.of(fi.bron.naam));
    for (const [k, v] of paginaFonts.entries()) {
      if (v === waarde) { fi.paginaSleutel = nameStr(k); return fi.paginaSleutel; }
    }
    let naam = fi.bron.naam;
    for (let n = 1; paginaFonts.has(PDFName.of(naam)); n++) naam = `${fi.bron.naam}_fx${n}`;
    paginaFonts.set(PDFName.of(naam), waarde);
    fi.paginaSleutel = naam;
    return naam;
  };
  for (const m of editMatches) results.set(m.edit, maakInPlaceResultaat(ana, m, paginaSleutel));
}

/**
 * Het lees-deel van de in-place-analyse: decodeert de content streams van de
 * pagina, zoekt per edit een unieke match en houdt alleen edits over die
 * veilig te knippen zijn. Verandert niets aan het document (ook geen
 * normalize), zodat de live weergave (#723) het op het gedeelde document kan
 * draaien en precies dezelfde match en codering krijgt als de saver.
 *
 * @returns {null|{ editMatches, ops, entries, fontInfos, usedCodes,
 *   familyIndex, resources, removalFor }}
 */
export function analyseerPagina(pdfDocLib, page, pageEdits) {
  const context = pdfDocLib.context;
  const contents = page.node.Contents();
  // Na normalize altijd een array; zonder normalize kan het één stream zijn.
  const inhoud = contents instanceof PDFArray ? contents.asArray()
    : (contents instanceof PDFStream ? [contents] : null);
  if (!inhoud) return null;

  // Content streams decoderen; alleen ruwe (originele) streams zijn splicebaar.
  const entries = [];
  const streamTexts = [];
  for (let i = 0; i < inhoud.length; i++) {
    const ref = inhoud[i];
    const stream = context.lookup(ref);
    let text = '';
    let spliceable = false;
    if (stream instanceof PDFRawStream) {
      try {
        text = bytesToLatin1(decodePDFRawStream(stream).decode());
        spliceable = true;
      } catch (_) { text = ''; }
    } else if (stream && typeof stream.getUnencodedContents === 'function') {
      try { text = bytesToLatin1(stream.getUnencodedContents()); } catch (_) { text = ''; }
    }
    entries.push({ arrayIdx: i, text, spliceable });
    streamTexts.push(text);
  }

  const fontInfos = buildPageFontInfos(context, page);
  const ops = interpretContentStreams(streamTexts);
  const resources = page.node.Resources();

  // Afbeeldings-XObjects (bv. een scan-achtergrond) met hun user-space-bbox:
  // ligt er een afbeelding onder een bewerkte regel, dan blijft het witte
  // afdekvlak nodig — de gescande pixels van de oude tekst knippen wij niet.
  // `form` is de index van het formulier waarin de afbeelding staat (of null).
  const imageRects = [];
  voegBeeldenToe(imageRects, resources, ops.xobjects, null);
  // Waar op de pagina een formulier getekend wordt (de Do): de volgorde van
  // tekst en afbeelding tussen pagina en formulier.
  const formPlek = new Map();
  const plekOpPagina = (x) => (x.form != null ? formPlek.get(x.form) : x);
  const later = (a, b) => a.si > b.si || (a.si === b.si && a.s > b.s);
  const opImage = (r, x, y) => x >= r.minX - 1 && x <= r.maxX + 1 && y >= r.minY - 1 && y <= r.maxY + 1;
  // Zit de oude tekst in de pixels van een afbeelding? Alleen als hij er niet
  // zelf zichtbaar overheen staat: onzichtbare tekst (Tr 3/7, een OCR-laag
  // over een scan) of tekst die de afbeelding daarna overschildert. Zichtbare
  // tekst over een foto staat niet in de foto; een wit vlak sloeg daar een
  // gat in de afbeelding.
  const tekstInBeeld = (op) => imageRects.some(r => opImage(r, op.x, op.y)
    && ((Number(op.tr) & 7) === 3 || (Number(op.tr) & 7) === 7
      || ((r.form ?? null) === (op.form ?? null) ? later(r, op) : later(plekOpPagina(r), plekOpPagina(op)))));

  // Decoderen + gebruikte codes per font verzamelen (voor subset-her-encodering).
  const usedCodes = new Map();
  const decodeer = (lijst) => {
    for (const op of lijst) {
      const fi = fontInfos.get(op.font) || null;
      const d = decodeShowOpText(op, fi);
      op.text = d.text;
      op.ok = d.ok;
      op.codes = d.codes;
      if (fi && fi.map) {
        let set = usedCodes.get(op.font);
        if (!set) { set = new Set(); usedCodes.set(op.font, set); }
        for (const c of d.codes) set.add(c);
      }
    }
  };
  decodeer(ops);

  // Per edit een unieke match zoeken; ops mogen maar door één edit geclaimd worden.
  const editMatches = [];
  const claimed = new Set();
  const zoek = (edit) => {
    for (const lines of buildLineCandidateSets(edit)) {
      const res = matchEditLines(ops, lines);
      if (res.ok) return { matched: res, matchedLines: lines };
    }
    return null;
  };
  const neem = (edit, { matched, matchedLines }) => {
    const idxs = matched.lineMatches.flat();
    if (idxs.some(i => claimed.has(i))) {
      console.warn(
        `[text-edits] Edit ${edit.id ?? '?'} overlapt met een andere edit; afdekvlak-pad.`,
      );
      return;
    }
    if (idxs.some(i => !entries[ops[i].si].spliceable)) {
      console.warn(
        `[text-edits] Edit ${edit.id ?? '?'}: tekst staat in een niet-splicebare ` +
        'stream; afdekvlak-pad.',
      );
      return;
    }
    idxs.forEach(i => claimed.add(i));
    // Staat de oude tekst (ook) in de pixels van een afbeelding, zoals bij een
    // scan met OCR-laag? Dan is hij niet weg te knippen -> afdekvlak behouden.
    const needsCover = idxs.some(i => tekstInBeeld(ops[i]));
    editMatches.push({ edit, idxs, lineMatches: matched.lineMatches, matchedLines, needsCover });
  };
  const nietGevonden = (edit) => console.warn(
    `[text-edits] Edit ${edit.id ?? '?'} (pagina ${edit.page}): originele ` +
    'tekstrun niet eenduidig gevonden in de content stream; afdekvlak-pad.',
  );
  const open = [];
  for (const edit of pageEdits) {
    const m = zoek(edit);
    if (m) neem(edit, m);
    else open.push(edit);
  }
  // Niet in de pagina zelf gevonden: misschien staat de tekst in een Form
  // XObject (#716). Dan ook daar zoeken, maar alleen in formulieren die maar
  // één keer getekend worden — knippen in een gedeeld formulier zou de tekst
  // ook elders weghalen. Pas hier, zodat edits die al in de pagina gevonden
  // zijn precies zo blijven als voorheen.
  if (open.length) {
    const eerste = ops.length;
    try {
      voegFormulierenToe(pdfDocLib, page, resources, ops, entries, fontInfos, imageRects, formPlek);
    } catch (err) {
      console.warn('[text-edits] Formulieren niet geanalyseerd:', err);
      ops.length = eerste;
    }
    if (ops.length > eerste) decodeer(ops.slice(eerste));
    for (const edit of open) {
      const m = ops.length > eerste ? zoek(edit) : null;
      if (m) neem(edit, m);
      else nietGevonden(edit);
    }
  }

  // C3: welke ops moeten echt weg? Ongewijzigde regels van een blok blijven
  // op het pure in-place-pad fysiek onaangeroerd (behoudt o.a. de originele
  // uitvulling); met afdekvlak moet alles weg en wordt alles hertekend,
  // anders zou de extractie de tekst dubbel bevatten.
  const removalFor = (m) => {
    if (m.needsCover) return m.idxs;
    const un = Array.isArray(m.edit.unchangedLines) ? m.edit.unchangedLines : null;
    if (!un) return m.idxs;
    const out = [];
    m.lineMatches.forEach((win, li) => {
      if (un[li] === true) return;
      if (win) out.push(...win);
    });
    return out;
  };

  // Chain-veiligheid: een verwijderde op mag geen niet-verwijderde op in
  // dezelfde chain vóór zich laten verschuiven. Overtredende edits vervallen.
  let guard = 0;
  while (guard++ < 50) {
    const removeSet = new Set(editMatches.flatMap(removalFor));
    const chk = checkChainSafety(ops, removeSet);
    if (chk.safe) break;
    const chainId = ops[chk.offending].chain;
    const victim = editMatches.findIndex(m => m.idxs.some(i => ops[i].chain === chainId));
    if (victim < 0) break;
    console.warn(
      `[text-edits] Edit ${editMatches[victim].edit.id ?? '?'}: run deelt zijn ` +
      'positioneringsreeks met andere tekst; afdekvlak-pad.',
    );
    editMatches.splice(victim, 1);
  }
  return {
    editMatches, ops, entries, fontInfos, usedCodes, resources, removalFor,
    familyIndex: buildFamilyIndex(fontInfos),
  };
}

/**
 * Resultaat van één gematchte edit: hoe de saver de nieuwe tekst in het
 * originele font codeert (encodeRun), met tekst-state en afdekgegevens.
 * `paginaSleutel` zet een interne fontsleutel om naar de naam waaronder het
 * font in de doelpagina staat (de saver: de /Font van de pagina; de live
 * weergave: het tijdelijke voorbeeld-document).
 */
export function maakInPlaceResultaat(ana, m, paginaSleutel = (k) => k) {
  const { ops, fontInfos, usedCodes, familyIndex } = ana;
  const lineFirstOps = m.lineMatches.map(win => (win && win.length ? ops[win[0]] : null));
  const lineFontKeys = lineFirstOps.map(op => (op ? op.font : null));
  const lastKnown = [...lineFontKeys].reverse().find(k => k) || null;
  const fontForLine = (lineIdx) => {
    const k = lineFontKeys[Math.min(lineIdx, lineFontKeys.length - 1)] ?? null;
    return k || lastKnown;
  };
  // Tekst-state (Tc/Tw/Tz) van de eerste op van de regel — de terugge-
  // schreven run neemt die over zodat de visuele breedte klopt.
  const lineTextState = (lineIdx) => {
    const op = lineFirstOps[Math.min(lineIdx, Math.max(0, lineFirstOps.length - 1))]
      || lineFirstOps.find(o => o) || null;
    return op ? { tc: op.tc || 0, tw: op.tw || 0, tz: op.tz ?? 100 } : { tc: 0, tw: 0, tz: 100 };
  };
  // Glyf beschikbaar? Eerst de font-structuur (Widths/W: dekt de hele
  // subset, ook codes die op deze pagina toevallig niet voorkwamen),
  // met de op deze pagina gebruikte codes als vangnet.
  const glyphAvailable = (fi, fontKey, code) => {
    if (usedCodes.get(fontKey)?.has(code)) return true;
    if (fi.hasGlyph) return fi.hasGlyph(code);
    return !fi.subset;
  };
  // Werkelijke uitgestrektheid van de ORIGINELE runs langs de baseline,
  // t.o.v. het anker van de eerste regel: het afdekvlak moet ook verre
  // kolommen (en de scan-pixels eronder) volledig dekken. De oude
  // tekenaantal-schatting telde kolom-gaten niet mee, waardoor het laatste
  // cijfer van een buurgetal buiten het vlak kon vallen en als 'extra'
  // cijfer zichtbaar bleef.
  let coverExtent = 0;
  {
    const l0 = (m.matchedLines || [])[0];
    if (l0) {
      const rad0 = ((Number(l0.angle) || 0) * Math.PI) / 180;
      const cos0 = Math.cos(rad0);
      const sin0 = Math.sin(rad0);
      const u0 = (Number(l0.x) || 0) * cos0 + (Number(l0.y) || 0) * sin0;
      for (const win of m.lineMatches) {
        if (!win) continue;
        for (const oi of win) {
          const op = ops[oi];
          const fi2 = fontInfos.get(op.font);
          let w;
          if (fi2 && fi2.widthOf && Array.isArray(op.codes) && op.codes.length) {
            w = computeRunWidth(op.codes, fi2.widthOf, {
              size: op.sizeEff, tc: op.tc, tw: op.tw, tz: op.tz,
              bytesPerCode: fi2.bytesPerCode,
            });
          } else {
            w = (op.text ? op.text.length : 0) * (op.sizeEff || 10) * 0.6;
          }
          const u = op.x * cos0 + op.y * sin0;
          coverExtent = Math.max(coverExtent, (u - u0) + w);
        }
      }
    }
  }
  return {
    removedOriginal: true,
    // Vet/cursief van het originele font van de regel (uit de BaseFont), of
    // null. Voor een terugvalfont dat dezelfde dikte moet houden.
    lineFontVariant: (lineIdx) => fontInfos.get(fontForLine(lineIdx))?.variant || null,
    needsCover: m.needsCover,
    coverExtent,
    lineTextState,
    // Codeert één run naar het originele font van de regel — of naar een
    // vet/cursief-variant uit dezelfde familie als het document die draagt.
    // flags: { bold, italic, baseBold, baseItalic } (absoluut t.o.v. de
    // gedetecteerde regelbasis). sizePt bepaalt de berekende breedte.
    // Retour: { fontKey, hex, bronFontKey, codes, width, bytesPerCode, tc,
    // tw, tz } of null
    // (→ Standard-14-pad voor precies deze run).
    encodeRun: (text, lineIdx, sizePt, flags = null) => {
      let fontKey = fontForLine(lineIdx);
      if (!fontKey) return null;
      if (flags && (flags.bold !== flags.baseBold || flags.italic !== flags.baseItalic)) {
        // De gebruiker week af van de regelbasis: zoek de juiste variant
        // binnen dezelfde familie; ontbreekt die → Standard-14-pad.
        const fam = fontInfos.get(fontKey)?.variant?.family;
        const slot = `${flags.bold ? 'b' : ''}${flags.italic ? 'i' : ''}` || 'r';
        fontKey = (fam && familyIndex.get(fam)?.[slot]) || null;
        if (!fontKey) return null;
      }
      const fi = fontInfos.get(fontKey);
      if (!fi || !fi.inverse) return null;
      // Zonder breedte-informatie is de pen-advance niet te bepalen —
      // dan liever het meetbare Standard-14-pad.
      if (!fi.widthOf) return null;
      const codes = encodeTextToCodes(text, fi.inverse);
      if (!codes) return null;
      if (!codes.every(c => glyphAvailable(fi, fontKey, c))) return null;
      const st = lineTextState(lineIdx);
      const width = computeRunWidth(codes, fi.widthOf, {
        size: sizePt, tc: st.tc, tw: st.tw, tz: st.tz, bytesPerCode: fi.bytesPerCode,
      });
      return {
        fontKey: paginaSleutel(fontKey),
        hex: codesToHexString(codes, fi.bytesPerCode),
        // De interne sleutel en de codes zelf, voor de live weergave (#723).
        bronFontKey: fontKey,
        codes,
        width,
        bytesPerCode: fi.bytesPerCode,
        tc: st.tc,
        tw: st.tw,
        tz: st.tz,
      };
    },
  };
}

// Afbeeldingen uit de Do-records van een content stream (de pagina, of een
// formulier met index `form`) met hun bbox op de pagina.
function voegBeeldenToe(imageRects, resources, xobjects, form) {
  try {
    const xoDict = resources ? resources.lookupMaybe(PDFName.of('XObject'), PDFDict) : null;
    if (!xoDict) return;
    const imageNames = new Set();
    for (const key of xoDict.keys()) {
      const xo = xoDict.lookupMaybe(key, PDFStream);
      const sub = xo ? nameStr(xo.dict.get(PDFName.of('Subtype'))) : '';
      if (sub === 'Image') imageNames.add(nameStr(key));
    }
    for (const rec of (xobjects || [])) {
      if (imageNames.has(rec.name)) {
        imageRects.push({ ...xobjectBBox(rec.ctm), si: form ?? rec.si, s: rec.s, form });
      }
    }
  } catch (_) { /* geen afbeeldingsinfo → geen cover-forcering */ }
}

function leesMatrix(context, dict) {
  const arr = dict.lookupMaybe(PDFName.of('Matrix'), PDFArray);
  if (!arr || arr.size() !== 6) return [1, 0, 0, 1, 0, 0];
  const m = arr.asArray().map(el => context.lookup(el))
    .map(el => (typeof el?.asNumber === 'function' ? el.asNumber() : NaN));
  return m.every(Number.isFinite) ? m : [1, 0, 0, 1, 0, 0];
}

// Voegt de show-ops van de Form XObjects van deze pagina die maar één keer
// getekend worden toe aan `ops` (met CTM = Matrix × CTM bij de Do), met een
// eigen entry per formulier en hun fonts in `fontInfos` (sleutels met een
// voorvoegsel; `bron` zegt waar het font staat). Een formulier zonder eigen
// /Resources gebruikt die van de pagina. Eén niveau diep: een formulier in
// een formulier blijft op het afdekvlak-pad.
function voegFormulierenToe(pdfDocLib, page, resources, ops, entries, fontInfos, imageRects, formPlek) {
  const context = pdfDocLib.context;
  const xoDict = resources ? resources.lookupMaybe(PDFName.of('XObject'), PDFDict) : null;
  if (!xoDict) return;
  const perNaam = new Map();
  for (const rec of (ops.xobjects || [])) {
    if (!perNaam.has(rec.name)) perNaam.set(rec.name, []);
    perNaam.get(rec.name).push(rec);
  }
  const kandidaten = [];
  for (const [naam, recs] of perNaam) {
    if (recs.length !== 1) continue; // twee keer op deze pagina getekend
    const ref = xoDict.get(PDFName.of(naam));
    if (!(ref instanceof PDFRef)) continue;
    const xo = context.lookup(ref);
    if (!(xo instanceof PDFRawStream)) continue;
    if (nameStr(xo.dict.get(PDFName.of('Subtype'))) !== 'Form') continue;
    kandidaten.push({ naam, ref, xo, rec: recs[0] });
  }
  if (kandidaten.length === 0) return;

  for (const k of enkelGetekend(pdfDocLib, page, resources, xoDict, kandidaten)) {
    let text;
    try { text = bytesToLatin1(decodePDFRawStream(k.xo).decode()); } catch (_) { continue; }
    const eigen = k.xo.dict.lookupMaybe(PDFName.of('Resources'), PDFDict) || null;
    const res = eigen || resources;
    const form = entries.length;
    const prefix = res === resources ? '' : `\u0000fx${form}\u0000`;
    const ts = k.rec.tekstState || {};
    const formOps = interpretContentStreams([text], {
      ...ts,
      ctm: matMul(leesMatrix(context, k.xo.dict), k.rec.ctm),
      // Een fontnaam van de pagina betekent in de eigen resources iets anders.
      font: prefix ? null : ts.font,
    });
    if (prefix) {
      const fd = res.lookupMaybe(PDFName.of('Font'), PDFDict);
      if (fd) {
        for (const [key, info] of buildFontInfos(context, fd)) {
          fontInfos.set(prefix + key, { ...info, key: prefix + key, bron: { dict: fd, naam: key } });
        }
      }
    }
    entries.push({ arrayIdx: -1, form: k, text, spliceable: true });
    formPlek.set(form, { si: k.rec.si, s: k.rec.s });
    for (const op of formOps) {
      op.si = form;
      op.form = form;
      op.chain = `fx${form}:${op.chain}`;
      if (prefix && op.font != null) op.font = prefix + op.font;
      ops.push(op);
    }
    voegBeeldenToe(imageRects, res, formOps.xobjects, form);
  }
}

// Welke kandidaat-formulieren worden maar één keer getekend? Eén Do op deze
// pagina is niet genoeg: hetzelfde XObject kan ook in een andere pagina, een
// ander formulier of de weergave van een annotatie staan. Daarom moet:
// - alleen het /XObject-woordenboek van deze pagina naar het formulier wijzen;
// - dat woordenboek alleen bij de resources van deze pagina horen;
// - die resources alleen bij pagina's horen (niet bij een formulier of een
//   annotatie), en geen andere pagina met dezelfde resources het tekenen.
function enkelGetekend(pdfDocLib, page, resources, xoDict, kandidaten) {
  const context = pdfDocLib.context;
  const doelen = new Set([xoDict, resources, ...kandidaten.map(k => k.ref)]);
  const indirect = context.enumerateIndirectObjects();
  const refVan = new Map();
  for (const [ref, obj] of indirect) {
    if (obj === xoDict || obj === resources) { doelen.add(ref); refVan.set(obj, ref); }
  }
  const ouders = new Map();
  const gezien = new Set();
  const bezoek = (obj) => {
    const c = obj instanceof PDFStream ? obj.dict : obj;
    if (!(c instanceof PDFDict) && !(c instanceof PDFArray)) return;
    if (gezien.has(c)) return;
    gezien.add(c);
    for (const v of (c instanceof PDFDict ? c.values() : c.asArray())) {
      if (doelen.has(v)) {
        if (!ouders.has(v)) ouders.set(v, new Set());
        ouders.get(v).add(c);
      }
      if (!(v instanceof PDFRef)) bezoek(v);
    }
  };
  for (const [, obj] of indirect) bezoek(obj);
  const oudersVan = (obj) => {
    const out = new Set(ouders.get(obj) || []);
    const ref = refVan.get(obj);
    for (const o of (ref ? ouders.get(ref) || [] : [])) out.add(o);
    return out;
  };
  if ([...oudersVan(xoDict)].some(o => o !== resources)) return [];
  const isPagina = (d) => d instanceof PDFDict
    && ['Page', 'Pages'].includes(nameStr(d.lookupMaybe(PDFName.of('Type'), PDFName)));
  if ([...oudersVan(resources)].some(o => !isPagina(o))) return [];

  // Andere pagina's met dezelfde resources: tekenen die het formulier ook?
  const anderen = pdfDocLib.getPages().filter(p => p !== page && p.node.Resources() === resources);
  const getekendDoor = (p, naam) => {
    const inhoud = p.node.Contents();
    const lijst = inhoud instanceof PDFArray ? inhoud.asArray().map(r => context.lookup(r))
      : (inhoud ? [inhoud] : []);
    for (const st of lijst) {
      if (!(st instanceof PDFRawStream)) return true; // onbekend: niet aanraken
      let tokens;
      try {
        tokens = tokenizeContentStream(bytesToLatin1(decodePDFRawStream(st).decode()));
      } catch (_) { return true; }
      for (let i = 1; i < tokens.length; i++) {
        if (tokens[i].t === 'op' && tokens[i].v === 'Do'
          && tokens[i - 1].t === 'name' && tokens[i - 1].v === naam) return true;
      }
    }
    return false;
  };
  return kandidaten.filter(k => {
    const o = ouders.get(k.ref);
    if (!o || o.size !== 1 || !o.has(xoDict)) return false;
    return !anderen.some(p => getekendDoor(p, k.naam));
  });
}
