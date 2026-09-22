// Weergaverotatie en doosmaat van een tekstvak (FreeText/callout) bij het
// inlezen.
//
// Staat los van annotation-converter.js zodat de afleiding zonder de rest van
// de app te testen is. Invoer is wat color-extraction.js uit het bestand leest
// (`extra`), de /Rotate van de annotatie zoals PDF.js hem geeft
// (annot.rotation) en de /Rotate van de pagina (viewport.rotation).

/**
 * Weergaverotatie van een tekstvak in graden (zoals het model hem draagt).
 *
 * @param {object} p
 * @param {object} [p.extra]          uitvoer van extractAnnotationColors voor deze annotatie
 * @param {number} [p.annotRotatie]   annot.rotation van PDF.js (/Rotate van de annotatie)
 * @param {number} [p.paginaRotatie]  /Rotate van de pagina
 * @returns {number}
 */
export function tekstvakRotatie({ extra = {}, annotRotatie = 0, paginaRotatie = 0 } = {}) {
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
  const ftMatrixHoek = Math.abs(extraColors.matrixAngle || 0) % 360;
  const ftMatrixRotatievrij = ftMatrixHoek <= 1 || ftMatrixHoek >= 359;
  if (ftRotation !== 0 && extraColors.apHasRotationOp === false && extraColors.apInnerRect
      && ftMatrixRotatievrij) {
    ftRotation = 0;
  }
  return ftRotation;
}

/**
 * Doosmaat van een tekstvak in weergaveruimte.
 *
 * @param {object} p
 * @param {number} p.rotatie   weergaverotatie uit tekstvakRotatie
 * @param {object} [p.extra]   uitvoer van extractAnnotationColors
 * @param {number[]} p.rect    /Rect in PDF-ruimte
 * @param {{width:number,height:number}} p.rectVp  /Rect in weergaveruimte
 * @returns {{width:number,height:number}}
 */
export function tekstvakMaat({ rotatie, extra = {}, rect, rectVp }) {
  const extraColors = extra || {};
  const ftRotation = rotatie;
  // Recover the original (unrotated) textbox dimensions from Rect.
  const rectW = rect[2] - rect[0];
  const rectH = rect[3] - rect[1];
  let ftWidth, ftHeight;
  if (ftRotation !== 0) {
    // PREFERRED: read the unrotated dims straight from the appearance
    // stream. The AP draws the textbox plane with one `x y w h re`
    // operator INSIDE the rotation transform, so its w/h ARE the original
    // box dims — no reconstruction needed. See color-extraction.js.
    const apInner = extraColors.apInnerRect;
    if (apInner && apInner.w > 1 && apInner.h > 1) {
      ftWidth = apInner.w;
      ftHeight = apInner.h;
    } else {
      // FALLBACK (no unambiguous `re` in the AP): recover the dims from the
      // axis-aligned bounding box /Rect via inverse rotation:
      //   rectW = |w*cos| + |h*sin|, rectH = |w*sin| + |h*cos|
      // This is lossy — singular at 45° (det = cos²−sin² = 0) and it swaps
      // W/H at 90° — hence it is only used when the AP tells us nothing.
      const c = Math.abs(Math.cos(ftRotation * Math.PI / 180));
      const s = Math.abs(Math.sin(ftRotation * Math.PI / 180));
      const det = c * c - s * s;
      if (Math.abs(det) > 0.01) {
        ftWidth = Math.round((rectW * c - rectH * s) / det);
        ftHeight = Math.round((rectH * c - rectW * s) / det);
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
