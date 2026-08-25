// ── In-place tekstbewerking in de content stream ──
//
// Lokaliseert per text-edit de show-text-operatoren van de originele runs in
// de content stream(s) van de pagina en knipt ze eruit (met behoud van de
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
  const infos = new Map();
  let fontDict = null;
  try {
    const resources = page.node.Resources();
    fontDict = resources ? resources.lookupMaybe(PDFName.of('Font'), PDFDict) : null;
  } catch (_) { fontDict = null; }
  if (!fontDict) return infos;

  for (const key of fontDict.keys()) {
    let info = {
      bytesPerCode: 1, map: null, inverse: null, subset: false, key: nameStr(key),
      baseFont: '', variant: null, widthOf: null, hasGlyph: null,
    };
    try {
      const f = fontDict.lookupMaybe(key, PDFDict);
      if (!f) { infos.set(nameStr(key), info); continue; }
      const subtype = nameStr(f.lookupMaybe(PDFName.of('Subtype'), PDFName));
      const baseFont = nameStr(f.lookupMaybe(PDFName.of('BaseFont'), PDFName));
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
          const widths = [];
          for (let i = 0; i < widthsArr.size(); i++) {
            const el = context.lookup(widthsArr.get(i));
            widths.push(typeof el?.asNumber === 'function' ? el.asNumber() : 0);
          }
          info.widthOf = (code) => {
            const w = widths[code - first];
            return w === undefined ? undefined : w;
          };
          info.hasGlyph = (code) => code >= first && (widths[code - first] || 0) > 0;
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
        baseFont: '', variant: null, widthOf: null, hasGlyph: null,
      };
    }
    infos.set(nameStr(key), info);
  }
  return infos;
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
  const context = pdfDocLib.context;
  page.node.normalize();
  const contents = page.node.Contents();
  if (!(contents instanceof PDFArray)) return;

  // Content streams decoderen; alleen ruwe (originele) streams zijn splicebaar.
  const entries = [];
  const streamTexts = [];
  for (let i = 0; i < contents.size(); i++) {
    const ref = contents.get(i);
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

  // Afbeeldings-XObjects (bv. een scan-achtergrond) met hun user-space-bbox:
  // ligt er een afbeelding onder een bewerkte regel, dan blijft het witte
  // afdekvlak nodig — de gescande pixels van de oude tekst knippen wij niet.
  const imageRects = [];
  try {
    const resources = page.node.Resources();
    const xoDict = resources ? resources.lookupMaybe(PDFName.of('XObject'), PDFDict) : null;
    if (xoDict) {
      const imageNames = new Set();
      for (const key of xoDict.keys()) {
        const xo = xoDict.lookupMaybe(key, PDFStream);
        const sub = xo ? nameStr(xo.dict.get(PDFName.of('Subtype'))) : '';
        if (sub === 'Image') imageNames.add(nameStr(key));
      }
      for (const rec of (ops.xobjects || [])) {
        if (imageNames.has(rec.name)) imageRects.push(xobjectBBox(rec.ctm));
      }
    }
  } catch (_) { /* geen afbeeldingsinfo → geen cover-forcering */ }
  const anchorOnImage = (x, y) => imageRects.some(r =>
    x >= r.minX - 1 && x <= r.maxX + 1 && y >= r.minY - 1 && y <= r.maxY + 1);

  // Decoderen + gebruikte codes per font verzamelen (voor subset-her-encodering).
  const usedCodes = new Map();
  for (const op of ops) {
    const fi = fontInfos.get(op.font) || null;
    const d = decodeShowOpText(op, fi);
    op.text = d.text;
    op.ok = d.ok;
    if (fi && fi.map) {
      let set = usedCodes.get(op.font);
      if (!set) { set = new Set(); usedCodes.set(op.font, set); }
      for (const c of d.codes) set.add(c);
    }
  }

  // Per edit een unieke match zoeken; ops mogen maar door één edit geclaimd worden.
  const editMatches = [];
  const claimed = new Set();
  for (const edit of pageEdits) {
    const lineSets = buildLineCandidateSets(edit);
    let matched = null;
    let matchedLines = null;
    for (const lines of lineSets) {
      const res = matchEditLines(ops, lines);
      if (res.ok) { matched = res; matchedLines = lines; break; }
    }
    if (!matched) {
      console.warn(
        `[text-edits] Edit ${edit.id ?? '?'} (pagina ${edit.page}): originele ` +
        'tekstrun niet eenduidig gevonden in de content stream; afdekvlak-pad.',
      );
      continue;
    }
    const idxs = matched.lineMatches.flat();
    if (idxs.some(i => claimed.has(i))) {
      console.warn(
        `[text-edits] Edit ${edit.id ?? '?'} overlapt met een andere edit; afdekvlak-pad.`,
      );
      continue;
    }
    if (idxs.some(i => !entries[ops[i].si].spliceable)) {
      console.warn(
        `[text-edits] Edit ${edit.id ?? '?'}: tekst staat in een niet-splicebare ` +
        'stream; afdekvlak-pad.',
      );
      continue;
    }
    idxs.forEach(i => claimed.add(i));
    // Ligt (een regel van) de run op een afbeelding? Dan is de gescande/
    // gerasterde oude tekst niet weg te knippen -> afdekvlak behouden.
    const needsCover = (matchedLines || []).some(l => anchorOnImage(l.x, l.y));
    editMatches.push({ edit, idxs, lineMatches: matched.lineMatches, matchedLines, needsCover });
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
  if (editMatches.length === 0) return;

  // Splices toepassen en de betrokken streams vervangen (opnieuw geflate't).
  const removeIdx = [...new Set(editMatches.flatMap(removalFor))];
  const splices = planSplices(ops, removeIdx);
  const perStream = new Map();
  for (const sp of splices) {
    if (!perStream.has(sp.si)) perStream.set(sp.si, []);
    perStream.get(sp.si).push(sp);
  }
  for (const [si, list] of perStream) {
    const entry = entries[si];
    const newText = applySplices(entry.text, list);
    const newStream = context.flateStream(latin1ToBytes(newText));
    const newRef = context.register(newStream);
    contents.set(entry.arrayIdx, newRef);
  }

  // Resultaat per edit: her-encodering van nieuwe tekst in het font van de
  // gematchte regel (of de laatste bekende regel voor extra nieuwe regels),
  // inclusief familie-varianten (vet/cursief), echte glyfbreedtes en de
  // Tc/Tw/Tz-tekst-state van de originele run.
  const familyIndex = buildFamilyIndex(fontInfos);
  for (const m of editMatches) {
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
    results.set(m.edit, {
      removedOriginal: true,
      needsCover: m.needsCover,
      lineTextState,
      // Codeert één run naar het originele font van de regel — of naar een
      // vet/cursief-variant uit dezelfde familie als het document die draagt.
      // flags: { bold, italic, baseBold, baseItalic } (absoluut t.o.v. de
      // gedetecteerde regelbasis). sizePt bepaalt de berekende breedte.
      // Retour: { fontKey, hex, width, bytesPerCode, tc, tw, tz } of null
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
          fontKey,
          hex: codesToHexString(codes, fi.bytesPerCode),
          width,
          bytesPerCode: fi.bytesPerCode,
          tc: st.tc,
          tw: st.tw,
          tz: st.tz,
        };
      },
    });
  }
}
