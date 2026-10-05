// Weergaverotatie en doosmaat van een tekstvak (FreeText/callout) bij het
// inlezen.
//
// Staat los van annotation-converter.js zodat de afleiding zonder de rest van
// de app te testen is. Invoer is wat color-extraction.js uit het bestand leest
// (`extra`), de /Rotate van de annotatie zoals PDF.js hem geeft
// (annot.rotation), de /Rotate van de pagina (viewport.rotation) en de
// NoRotate-vlag van de annotatie.

/**
 * Weergaverotatie van een tekstvak in graden (zoals het model hem draagt).
 *
 * @param {object} p
 * @param {object} [p.extra]          uitvoer van extractAnnotationColors voor deze annotatie
 * @param {number} [p.annotRotatie]   annot.rotation van PDF.js (/Rotate van de annotatie)
 * @param {number} [p.paginaRotatie]  /Rotate van de pagina
 * @param {boolean} [p.noRotate]      NoRotate-vlag (/F bit 5)
 * @returns {number}
 */
export function tekstvakRotatie({ extra = {}, annotRotatie = 0, paginaRotatie = 0, noRotate = false } = {}) {
  const extraColors = extra || {};
  // Derive rotation. Priority:
  // 1. OPS_Rotation (our custom key, exact value). An EXPLICIT 0 counts
  //    too: our saver always writes the key, because on pages with
  //    /Rotate the AP content carries a page-compensation transform that
  //    the matrix heuristic below would misread as annotation rotation.
  //    Files without the key keep the heuristic behaviour unchanged.
  // 2. AP/N Matrix angle, with convention detection based on BBox orientation
  let ftRotation = 0;
  const hasOpsRotation = extraColors.rotation !== undefined;
  if (hasOpsRotation) {
    ftRotation = Math.round(extraColors.rotation);
  }
  if (!hasOpsRotation && extraColors.matrixAngle !== undefined) {
    const ma = extraColors.matrixAngle;
    // Combined formula: visual rotation = -(annot.rotation + matrixAngle - pageRotate).
    // - annot.rotation comes from PDF.js (parses /Rotate / /Rotation key).
    // - matrixAngle comes from the AP/N Matrix (or auto-generated AP).
    // - pageRotate (viewport.rotation) = the page's own /Rotate: annotations
    //   rotate along with the page display, so an annot whose /Rotate equals
    //   the page /Rotate reads UPRIGHT for the viewer (visual 0).
    // Verified against externe referentie-weergave (unrotated pages):
    //   /Rotate 90  + matrix -90 → visual 0 (horizontal)
    //   /Rotate 270 + matrix +90 → visual 0 (horizontal)
    //   /Rotate 270 + matrix 180 → visual -90 (vertical)
    //   /Rotate 270 + matrix 120 → visual -30 (diagonal)
    // And on a page with /Rotate 90 (grote CAD-bladen):
    //   annot /Rotate 90 + matrix 0 → visual 0 (horizontal)
    const annotRot = (typeof annotRotatie === 'number') ? annotRotatie : 0;
    const pageRot = (((paginaRotatie || 0) % 360) + 360) % 360;
    ftRotation = -(annotRot + ma - pageRot);
    while (ftRotation > 180) ftRotation -= 360;
    while (ftRotation < -180) ftRotation += 360;
    ftRotation = Math.round(ftRotation);
    if (Math.abs(ftRotation) <= 1) ftRotation = 0;
  }
  // Self-healing: files written by an OLDER version of our saver drew the
  // AP content unrotated in PDF space on /Rotate'd pages (no OPS_Rotation
  // key, translation-only matrices, our own text-state signature — see
  // color-extraction.js). The heuristic above then reports the page
  // rotation as annotation rotation and the text renders sideways. Treat
  // those as visually unrotated; the next save rewrites the file with the
  // proper page-compensated appearance.
  if (!hasOpsRotation && ftRotation !== 0 && extraColors.apLegacyUnrotated) {
    const pageRotHeal = (((paginaRotatie || 0) % 360) + 360) % 360;
    if (pageRotHeal !== 0) ftRotation = 0;
  }

  // AP-consistency guard. The appearance stream is what every PDF engine
  // actually paints, so it — not a rotation key — decides whether a label
  // is rotated. Older saver generations left a STALE rotation key next to
  // an UNROTATED appearance: e.g. /Rotation 270 + /OPS_Rotation -90 while
  // the AP draws a horizontal box with horizontal text. External engines
  // render such a label horizontally; honouring the key rotated it in this
  // app only — and a re-save would then bake that error into the file for
  // everyone. If the appearance contains no rotation transform at all, the
  // label IS visually unrotated.
  //
  // Deliberately narrow: it needs apInnerRect, i.e. the appearance draws
  // exactly one box and we demonstrably understood its structure. An
  // appearance we could not parse (rotation hidden in a nested XObject,
  // say) leaves apInnerRect unset and keeps the key-derived angle.
  //
  // En de /Matrix telt mee als rotatietransform: sommige externe editors
  // zetten de volledige rotatie in de AP-/Matrix (content-stream zonder
  // rotatie-cm, Rect = AABB, /Rotation als metadata). De appearance is
  // dan wel degelijk geroteerd — de guard mag alleen vuren als zowel de
  // content als de /Matrix rotatievrij zijn, anders werden zulke labels
  // plat geladen (tekst horizontaal in een AABB-doos).
  //
  // "Visueel ongedraaid" betekent: ongedraaid in PDF-ruimte. De lezer draait
  // de hele pagina — appearance inbegrepen — met /Rotate mee, dus op het
  // scherm staat zo'n vak in de paginarotatie. De saver schrijft op een
  // /Rotate-R-blad voor een vak met weergaverotatie R netto géén rotatie-cm
  // (compensatie −R plus eigen draai +R); dat vak is dus R, niet 0 (#429).
  // Alleen met de NoRotate-vlag draait de appearance niet mee en staat hij
  // rechtop. Een sleutel die al gelijk is aan dat doel (modulo 360, bv. 270
  // op een 270°-blad) blijft staan.
  const ftMatrixHoek = Math.abs(extraColors.matrixAngle || 0) % 360;
  const ftMatrixRotatievrij = ftMatrixHoek <= 1 || ftMatrixHoek >= 359;
  if (ftRotation !== 0 && extraColors.apHasRotationOp === false && extraColors.apInnerRect
      && ftMatrixRotatievrij) {
    const pageRotAp = (((paginaRotatie || 0) % 360) + 360) % 360;
    const doel = noRotate ? 0 : (pageRotAp > 180 ? pageRotAp - 360 : pageRotAp);
    if (doel === 0 || (((ftRotation - doel) % 360) + 360) % 360 !== 0) ftRotation = doel;
  }
  return ftRotation;
}

// Zoveel punt per zijde mag een apInnerRect van de omgewisselde maat uit de
// omhullende afwijken om als omgewisseld te gelden (rand- of /RD-inzet).
const OMGEWISSELD_MARGE = 4;
// Onder deze |cos²−sin²| (rond 45°) is de terugrekening uit de omhullende te
// gevoelig om de oriëntatie van apInnerRect op te beoordelen.
const OMGEWISSELD_MIN_DET = 0.2;

/**
 * Doosmaat van een tekstvak in weergaveruimte.
 *
 * @param {object} p
 * @param {number} p.rotatie   weergaverotatie uit tekstvakRotatie
 * @param {object} [p.extra]   uitvoer van extractAnnotationColors
 * @param {number[]} [p.rect]  /Rect in PDF-ruimte; niet gebruikt, de maat
 *   volgt uit de omhullende in weergaveruimte (rectVp)
 * @param {{width:number,height:number}} p.rectVp  /Rect in weergaveruimte
 * @param {boolean} [p.callout]  callout: de /Rect bevat dan ook de aanhaallijn
 * @returns {{width:number,height:number}}
 */
export function tekstvakMaat({ rotatie, extra = {}, rectVp, callout = false }) {
  const extraColors = extra || {};
  const ftRotation = rotatie;
  // De omhullende in WEERGAVERUIMTE: de hoek is een weergavehoek, dus de
  // omhullende moet in dezelfde ruimte staan. De PDF-/Rect heeft op een
  // /Rotate 90/270-blad breedte en hoogte verwisseld; een vak van 55×19 op
  // −90° kwam daarmee als 19×55 terug.
  const rectW = rectVp.width;
  const rectH = rectVp.height;
  let ftWidth, ftHeight;
  if (ftRotation !== 0) {
    // Inverse of the visual bounding box:
    //   rectW = |w*cos| + |h*sin|, rectH = |w*sin| + |h*cos|
    // Exact for a true bounding box, singular at 45° (det = cos²−sin² = 0).
    const c = Math.abs(Math.cos(ftRotation * Math.PI / 180));
    const s = Math.abs(Math.sin(ftRotation * Math.PI / 180));
    const det = c * c - s * s;
    const uitOmhullende = Math.abs(det) > 0.01
      ? { w: (rectW * c - rectH * s) / det, h: (rectH * c - rectW * s) / det }
      : null;
    // PREFERRED: read the unrotated dims straight from the appearance
    // stream. The AP draws the textbox plane with one `x y w h re`
    // operator INSIDE the rotation transform, so its w/h ARE the original
    // box dims — no reconstruction needed. See color-extraction.js.
    const apInner = extraColors.apInnerRect;
    if (apInner && apInner.w > 1 && apInner.h > 1) {
      ftWidth = apInner.w;
      ftHeight = apInner.h;
      // Een ander programma draait het vak met de /Matrix en tekent de doos
      // in formulierruimte, BUITEN de tekst-cm: die `re` staat dan een
      // kwartslag verkeerd. Ligt hij binnen een paar punt van de omgewisselde
      // maat uit de omhullende en verder van de rechte, dan telt de
      // omhullende. Niet bij een callout (Rect met aanhaallijn), niet rond
      // 45° en niet bij een onmogelijke terugrekening.
      if (!callout && uitOmhullende && Math.abs(det) >= OMGEWISSELD_MIN_DET
          && uitOmhullende.w > 0 && uitOmhullende.h > 0) {
        const recht = Math.abs(apInner.w - uitOmhullende.w) + Math.abs(apInner.h - uitOmhullende.h);
        const omgewisseld = Math.abs(apInner.w - uitOmhullende.h) + Math.abs(apInner.h - uitOmhullende.w);
        if (omgewisseld < recht
            && Math.abs(apInner.w - uitOmhullende.h) <= OMGEWISSELD_MARGE
            && Math.abs(apInner.h - uitOmhullende.w) <= OMGEWISSELD_MARGE) {
          ftWidth = uitOmhullende.w;
          ftHeight = uitOmhullende.h;
        }
      }
    } else if (uitOmhullende) {
      // FALLBACK (no unambiguous `re` in the AP): the inverse above. Niet
      // afgerond: de tak voor rotatie 0 rondt ook niet af.
      ftWidth = uitOmhullende.w;
      ftHeight = uitOmhullende.h;
      if (ftWidth <= 0 || ftHeight <= 0) {
        ftWidth = rectW;
        ftHeight = rectH;
      }
    } else {
      if (extraColors.bboxWidth && extraColors.bboxHeight &&
          (Math.abs(extraColors.bboxWidth - rectW) > 1 || Math.abs(extraColors.bboxHeight - rectH) > 1)) {
        ftWidth = extraColors.bboxWidth;
        ftHeight = extraColors.bboxHeight;
      } else {
        ftWidth = rectW;
        ftHeight = rectH;
      }
    }
  } else {
    // No text rotation: the box is axis-aligned in visual space, so the
    // rotation-aware viewport rect gives the correct visual size. Using raw
    // rectW/rectH left textboxes mis-sized and shifted on /Rotate 90/270 pages.
    ftWidth = rectVp.width;
    ftHeight = rectVp.height;
  }
  return { width: ftWidth, height: ftHeight };
}
