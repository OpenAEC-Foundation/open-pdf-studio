// First strong-directional character decides the base direction of a text run,
// mirroring CSS `dir="auto"` (which the free-text/callout editors use, issue #61).
// Returns true when the first strongly-typed character is RTL (Hebrew, Arabic,
// Syriac, Thaana, NKo and Arabic presentation forms). Latin/digits → false.
const _RTL_STRONG = /[֐-׿؀-ۿ܀-ݏݐ-ݿހ-޿߀-ࣿיִ-ﭏﭐ-﷿ﹰ-﻿]/;
const _LTR_STRONG = /[A-Za-zÀ-ʯͰ-ԯऀ-῿Ⰰ-퟿]/;
export function isRTLText(s) {
  if (!s) return false;
  for (const ch of s) {
    if (_RTL_STRONG.test(ch)) return true;
    if (_LTR_STRONG.test(ch)) return false;
  }
  return false;
}

// Build polygon path without stroking (for fill/hatch/stroke to be applied by caller)
export function buildPolygonPath(ctx, x, y, width, height, sides = 6) {
  const cx = x + width / 2;
  const cy = y + height / 2;
  const rx = width / 2;
  const ry = height / 2;

  ctx.beginPath();
  for (let i = 0; i <= sides; i++) {
    const angle = (i * 2 * Math.PI / sides) - Math.PI / 2;
    const px = cx + rx * Math.cos(angle);
    const py = cy + ry * Math.sin(angle);
    if (i === 0) {
      ctx.moveTo(px, py);
    } else {
      ctx.lineTo(px, py);
    }
  }
  ctx.closePath();
}

// Draw polygon shape (stroke only - legacy convenience wrapper)
export function drawPolygonShape(ctx, x, y, width, height, sides = 6) {
  buildPolygonPath(ctx, x, y, width, height, sides);
  ctx.stroke();
}

// Build a closed path along explicit polygon vertices, mapped into the target
// bounding box (x, y, width, height). Used for /Polygon annotations imported
// from a PDF: they carry real vertices instead of the regular-N-gon geometry
// that buildPolygonPath synthesises. Mapping through the box keeps bbox-based
// resize handles working (the box is the vertices' own bounds on import, so it
// is an identity mapping until the user resizes). Issue #286.
export function buildPolygonPointsPath(ctx, points, x, y, width, height) {
  if (!points || points.length < 2) return;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  const sx = spanX > 1e-6 ? width / spanX : 1;
  const sy = spanY > 1e-6 ? height / spanY : 1;
  ctx.beginPath();
  points.forEach((p, i) => {
    const px = x + (p.x - minX) * sx;
    const py = y + (p.y - minY) * sy;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.closePath();
}

// Build cloud path without stroking (for fill/hatch/stroke to be applied by caller).
//
// Revisiewolk-constructie zoals CAD-tools en PDF-editors hem tekenen: langs de
// rechthoek-omtrek liggen "puffs" — cirkelbogen met een booghoek > 180° die
// elkaar in naar binnen wijzende cusps raken. De puff-maat is (per stuk)
// vast i.p.v. boxafhankelijk, zodat grote ballonnen dezelfde wolkjes krijgen
// als kleine (gedrag van externe editors bij /BE cloudy).
export function buildCloudPath(ctx, x, y, width, height, puffSize = 15) {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  // Booghoek per puff: ~252° geeft de diepe krullen met naar binnen wijzende
  // cusps zoals de "grote wolk"-randstijl van externe editors (dunne lijn
  // langs diep ingesneden scallops).
  const THETA = 252 * Math.PI / 180;

  // Omtrek-punten met de klok mee; per zijde een geheel aantal koorden van
  // ~puffSize (minimaal 2, zodat mini-boxen nog steeds wolken).
  const pts = [];
  const addEdge = (x0, y0, x1, y1) => {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.max(2, Math.round(len / puffSize));
    for (let i = 0; i < n; i++) {
      pts.push([x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n]);
    }
  };
  addEdge(x, y, x + w, y);
  addEdge(x + w, y, x + w, y + h);
  addEdge(x + w, y + h, x, y + h);
  addEdge(x, y + h, x, y);

  ctx.beginPath();
  const sinHalf = Math.sin(THETA / 2);
  const cosHalf = Math.cos(THETA / 2); // negatief voor THETA > 180°
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % pts.length];
    const dx = x1 - x0;
    const dy = y1 - y0;
    const c = Math.hypot(dx, dy);
    if (c < 0.01) continue;
    // Straal uit koorde + booghoek; middelpunt ligt (voor >180°) aan de
    // binnenzijde van de koorde zodat de boog naar buiten bolt.
    const r = c / (2 * sinHalf);
    const nx = dy / c;   // buitennormaal bij een kloksgewijze wandeling (y-omlaag)
    const ny = -dx / c;
    const cx = (x0 + x1) / 2 + nx * r * cosHalf;
    const cy = (y0 + y1) / 2 + ny * r * cosHalf;
    const a0 = Math.atan2(y0 - cy, x0 - cx);
    const a1 = Math.atan2(y1 - cy, x1 - cx);
    ctx.arc(cx, cy, r, a0, a1, false);
  }
  ctx.closePath();
}

// Draw cloud shape (stroke only - legacy convenience wrapper)
export function drawCloudShape(ctx, x, y, width, height) {
  buildCloudPath(ctx, x, y, width, height);
  ctx.stroke();
}

// Build cloud path along arbitrary points (closed polygon with scallop edges)
export function buildCloudPolylinePath(ctx, points, closed = true) {
  if (!points || points.length < 2) return;
  const TARGET_BUMP = 12; // target bump radius in user units

  ctx.beginPath();
  const len = closed ? points.length : points.length - 1;
  for (let i = 0; i < len; i++) {
    const p1 = points[i];
    const p2 = points[(i + 1) % points.length];
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const edgeLen = Math.sqrt(dx * dx + dy * dy);
    if (edgeLen < 1) continue;

    const numBumps = Math.max(1, Math.round(edgeLen / (TARGET_BUMP * 1.5)));
    const bumpRadius = edgeLen / numBumps / 2;
    const angle = Math.atan2(dy, dx);
    // Normal direction (perpendicular, pointing outward for CW winding)
    const nx = -Math.sin(angle);
    const ny = Math.cos(angle);

    for (let j = 0; j < numBumps; j++) {
      const t = (j + 0.5) / numBumps;
      const cx = p1.x + dx * t;
      const cy = p1.y + dy * t;
      // Arc center offset outward
      const arcCx = cx + nx * 0;
      const arcCy = cy + ny * 0;
      // Start and end angles for the arc (perpendicular to edge, sweeping outward)
      const startAngle = angle + Math.PI;
      const endAngle = angle;
      ctx.arc(arcCx, arcCy, bumpRadius, startAngle, endAngle, false);
    }
  }
  if (closed) ctx.closePath();
}

// Compute the minimum height needed for textbox content (same word-wrap logic as drawTextboxContent)
// Line-spacing default 1.2 matches CSS "normal" line-height for most fonts
// AND matches what reference desktop PDF editors use when /DS has no explicit line-height.
// Was 1.0 (too tight — two lines of text in a 36pt box visibly stuck together
// instead of showing the gap reference viewers render).
const DEFAULT_LINE_SPACING = 1.2;

export function computeTextboxContentHeight(annotation) {
  if (!annotation.text) return annotation.height || 50;

  const width = annotation.width || 150;
  const fontSize = annotation.fontSize || 14;
  const lineSpacing = annotation.lineSpacing || DEFAULT_LINE_SPACING;
  const lineHeight = fontSize * lineSpacing;
  // Match drawTextboxContent: padding == borderWidth (no minimum).
  const padding = annotation.lineWidth ?? 0;
  const maxWidth = width - padding * 2;

  // Match drawTextboxContent's font-family fallback chain so measureText
  // sees the same metrics the actual render will use.
  const rawFontFamily = annotation.fontFamily || 'Arial';
  const _cssQuote = s => `"${s.replace(/"/g, '\\"')}"`;
  const _expanded = rawFontFamily.replace(/([a-z])([A-Z])/g, '$1 $2');
  const _chain = [];
  if (_expanded !== rawFontFamily) _chain.push(_cssQuote(_expanded));
  _chain.push(/[\s"',]/.test(rawFontFamily) ? _cssQuote(rawFontFamily) : rawFontFamily);
  _chain.push('sans-serif');
  const fontFamily = _chain.join(', ');
  const fontStyle = (annotation.fontItalic ? 'italic ' : '') + (annotation.fontBold ? 'bold ' : '');
  const font = `${fontStyle}${fontSize}px ${fontFamily}`;

  // Use offscreen canvas for text measurement
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  ctx.font = font;

  const paragraphs = annotation.text.split('\n');
  let totalLines = 0;

  for (const para of paragraphs) {
    if (!para) {
      // Empty line counts as one line
      totalLines++;
      continue;
    }
    const words = para.split(' ');
    let line = '';
    let paraLines = 0;

    for (let i = 0; i < words.length; i++) {
      const testLine = line + words[i] + ' ';
      if (ctx.measureText(testLine).width > maxWidth && i > 0) {
        paraLines++;
        line = words[i] + ' ';
      } else {
        line = testLine;
      }
    }
    if (line.trim()) paraLines++;
    totalLines += paraLines;
  }

  return padding * 2 + totalLines * lineHeight;
}

// Compute the wrapped text layout for a textbox/callout, mirroring
// drawTextboxContent's wrapping (same font fallback chain + canvas measureText,
// same padding/lineHeight/ascent). Used by the PDF saver to build a FreeText
// /AP appearance stream whose line breaks + vertical placement match what OPDS
// draws on screen — so other viewers show the same thing (no overflow).
// Returns { lines:[{text,width}], fontSize, lineHeight, padding,
//           ascent, descent, halfLeading, maxWidth }.
export function layoutTextboxForExport(annotation) {
  const text = annotation.text || '';
  const width = annotation.width || 150;
  const fontSize = annotation.fontSize || 14;
  const lineSpacing = annotation.lineSpacing || DEFAULT_LINE_SPACING;
  const lineHeight = fontSize * lineSpacing;
  const padding = annotation.lineWidth ?? 0;
  const maxWidth = Math.max(1, width - padding * 2);

  const rawFontFamily = annotation.fontFamily || 'Arial';
  const cssQuote = s => `"${s.replace(/"/g, '\\"')}"`;
  const expanded = rawFontFamily.replace(/([a-z])([A-Z])/g, '$1 $2');
  const chain = [];
  if (expanded !== rawFontFamily) chain.push(cssQuote(expanded));
  chain.push(/[\s"',]/.test(rawFontFamily) ? cssQuote(rawFontFamily) : rawFontFamily);
  chain.push('sans-serif');
  const fontFamily = chain.join(', ');
  const fontStyle = (annotation.fontItalic ? 'italic ' : '') + (annotation.fontBold ? 'bold ' : '');

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  ctx.font = `${fontStyle}${fontSize}px ${fontFamily}`;
  const sample = ctx.measureText('Mg');
  const ascent = sample.fontBoundingBoxAscent || sample.actualBoundingBoxAscent || (fontSize * 0.8);
  const descent = sample.fontBoundingBoxDescent || sample.actualBoundingBoxDescent || (fontSize * 0.2);
  const halfLeading = (lineHeight - ascent - descent) / 2;

  const lines = [];
  for (const para of text.split('\n')) {
    if (para === '') { lines.push({ text: '', width: 0 }); continue; }
    const words = para.split(' ');
    let line = '';
    for (let i = 0; i < words.length; i++) {
      const candidate = line ? line + ' ' + words[i] : words[i];
      if (ctx.measureText(candidate).width > maxWidth && line) {
        lines.push({ text: line, width: ctx.measureText(line).width });
        line = words[i];
      } else {
        line = candidate;
      }
    }
    if (line !== '') lines.push({ text: line, width: ctx.measureText(line).width });
  }
  return { lines, fontSize, lineHeight, padding, ascent, descent, halfLeading, maxWidth };
}

// Draw textbox content with word wrap
export function drawTextboxContent(ctx, annotation, padding) {
  if (!annotation.text) return;

  const width = annotation.width || 150;
  const height = annotation.height || 50;
  const fontSize = annotation.fontSize || 14;
  const lineSpacing = annotation.lineSpacing || DEFAULT_LINE_SPACING;
  const lineHeight = fontSize * lineSpacing;
  // Padding ≈ borderWidth (no extra). Reference desktop editors and most PDF viewers do
  // not add internal padding beyond the border line itself, so the text
  // content area = width − 2*borderWidth. The previous +1 reduced the
  // effective text width by 4px and made "CONSTRUCTIE OVERZICHT" wrap to
  // two lines in textboxes that reference viewers fit on one line.
  // Padding == borderWidth, no minimum. Reference viewers treat BS /W 0 as
  // "text fills the rect to its edges". The previous Math.max(_, 1)
  // forced a 1pt margin even when lineWidth==0 → text "CONSTRUCTIE
  // OVERZICHT" (275.61pt wide in Segoe UI Bold 22pt) was just barely
  // wider than the resulting 273.88pt content area → wrapped to 2 lines.
  // Real measurement (logged via [textbox-debug]): box=275.88pt,
  // text=275.61pt → fits with padding=0, doesn't with padding=1.
  if (padding === undefined) padding = annotation.lineWidth ?? 0;

  // Build font string with style options.
  // CSS font shorthand requires multi-word family names ("Segoe UI") to be
  // quoted — unquoted, Canvas parses "Segoe" + invalid token "UI" and falls
  // back to the next family (often the browser default = Arial). Concrete
  // victim: externally-authored annotations carry DS=font-family:Segoe UI;..., we
  // extract "Segoe UI" correctly, but unquoted in ctx.font it silently
  // becomes Arial → wider glyphs → wraps to 2 lines. Always quote.
  const rawFontFamily = annotation.fontFamily || 'Arial';
  // Build a CSS font-family fallback chain:
  //   1. camelCase-expanded variant ("SegoeUI" → "Segoe UI") — some editors
  //      sometimes emits the system font name without spaces; Windows
  //      registers Segoe UI WITH the space, so the unspaced form silently
  //      falls back to serif. Expanding first restores the match.
  //   2. original name (quoted if multi-word) — preserves intent if the
  //      author actually used the unspaced form on purpose.
  //   3. sans-serif — last-resort fallback (Arial on Windows).
  const cssQuote = s => `"${s.replace(/"/g, '\\"')}"`;
  const expanded = rawFontFamily.replace(/([a-z])([A-Z])/g, '$1 $2');
  const fallbackChain = [];
  if (expanded !== rawFontFamily) fallbackChain.push(cssQuote(expanded));
  fallbackChain.push(/[\s"',]/.test(rawFontFamily) ? cssQuote(rawFontFamily) : rawFontFamily);
  fallbackChain.push('sans-serif');
  const fontFamily = fallbackChain.join(', ');
  const fontStyle = (annotation.fontItalic ? 'italic ' : '') + (annotation.fontBold ? 'bold ' : '');
  ctx.fillStyle = annotation.textColor || annotation.color || '#000000';
  ctx.font = `${fontStyle}${fontSize}px ${fontFamily}`;
  // Use alphabetic baseline (PDF/CSS default). Y refers to the text BASELINE,
  // with ascent above and descent below. PDF spec FreeText appearance
  // streams position the first baseline at `lineHeight` below the box top
  // (one full line worth of space, leaving room for ascent + half-leading).
  // textBaseline='top' (former code) put the em-box top AT the box top,
  // giving only ~font's intrinsic ascent-gap (≈1-2pt) of visible margin —
  // too tight vs reference viewers which show ~lineHeight worth of gap.
  ctx.textBaseline = 'alphabetic';

  // Base direction follows the first strong-directional character, mirroring the
  // free-text editor's dir="auto" (issue #61/#255) so a committed Arabic/Hebrew
  // box renders exactly as it was typed. ctx.textAlign is pinned to physical
  // 'left' so the manual textX math below stays correct under any direction
  // (canvas 'start'/'end' would otherwise flip with ctx.direction).
  const rtl = isRTLText(annotation.text);
  ctx.direction = rtl ? 'rtl' : 'ltr';
  ctx.textAlign = 'left';

  // Get text alignment. When the user has not picked an explicit alignment, an
  // RTL box defaults to right-aligned (like the editor); LTR stays left.
  const textAlign = annotation.textAlign || (rtl ? 'right' : 'left');
  const maxWidth = width - padding * 2;

  // First-line baseline position. With textBaseline='alphabetic', y refers
  // to the baseline. To match CSS textarea rendering (which the edit-mode
  // overlay uses), we need:
  //
  //   baseline_y = box_top + padding + halfLeading + ascent
  //
  // Where ascent is the font's typographic ascent (visible top of capital
  // letters above baseline). Canvas's TextMetrics exposes this via
  // `actualBoundingBoxAscent` (per-string) and `fontBoundingBoxAscent`
  // (font-level — preferred but not on all browsers). Sample 'Mg' to
  // measure both the tall ascent (M) and a descender (g) so we get the
  // full font box, then fall back to 0.8 × fontSize if metrics unavailable.
  const _sample = ctx.measureText('Mg');
  const ascent = _sample.fontBoundingBoxAscent
              || _sample.actualBoundingBoxAscent
              || (fontSize * 0.8);
  const descent = _sample.fontBoundingBoxDescent
               || _sample.actualBoundingBoxDescent
               || (fontSize * 0.2);
  // CSS distributes line-height around the font's actual line box, not around
  // the nominal font-size. Using fontSize here moved edit-mode text upward by
  // several pixels for fonts whose ascender + descender exceeds the em size.
  const halfLeading = (lineHeight - ascent - descent) / 2;
  const paragraphs = annotation.text.split('\n');
  let y = annotation.y + padding + halfLeading + ascent;

  for (let p = 0; p < paragraphs.length; p++) {
    if (y >= annotation.y + height) break;

    // Empty line: just advance y
    if (!paragraphs[p]) {
      y += lineHeight;
      continue;
    }

    const words = paragraphs[p].split(' ');
    let line = '';

    for (let i = 0; i < words.length; i++) {
      // Measure WITHOUT trailing space — a trailing space contributes ~3-4px
      // to ctx.measureText().width but is never rendered (canvas doesn't draw
      // trailing whitespace beyond the last glyph). Including it in the
      // wrap-trigger comparison made lines wrap one word too early.
      const candidate = line + words[i];
      const metrics = ctx.measureText(candidate);
      if (metrics.width > maxWidth && i > 0) {
        // Calculate x position based on alignment
        let textX = annotation.x + padding;
        const lineWidth = ctx.measureText(line.trim()).width;
        if (textAlign === 'center') {
          textX = annotation.x + padding + (maxWidth - lineWidth) / 2;
        } else if (textAlign === 'right') {
          textX = annotation.x + width - padding - lineWidth;
        }

        ctx.fillText(line.trim(), textX, y);

        // Draw underline if enabled
        if (annotation.fontUnderline) {
          ctx.beginPath();
          ctx.moveTo(textX, y + fontSize + 1);
          ctx.lineTo(textX + lineWidth, y + fontSize + 1);
          ctx.strokeStyle = ctx.fillStyle;
          ctx.lineWidth = 1;
          ctx.stroke();
        }

        // Draw strikethrough if enabled
        if (annotation.fontStrikethrough) {
          ctx.beginPath();
          ctx.moveTo(textX, y + fontSize * 0.6);
          ctx.lineTo(textX + lineWidth, y + fontSize * 0.6);
          ctx.strokeStyle = ctx.fillStyle;
          ctx.lineWidth = 1;
          ctx.stroke();
        }

        line = words[i] + ' ';
        y += lineHeight;
        if (y >= annotation.y + height) break;
      } else {
        // Trailing space is the inter-word separator for the next concat;
        // it intentionally lives in `line` but is excluded from the wrap-
        // measurement (see candidate above).
        line = candidate + ' ';
      }
    }
    if (y < annotation.y + height && line.trim()) {
      // Calculate x position based on alignment
      let textX = annotation.x + padding;
      const lineWidth = ctx.measureText(line.trim()).width;
      if (textAlign === 'center') {
        textX = annotation.x + padding + (maxWidth - lineWidth) / 2;
      } else if (textAlign === 'right') {
        textX = annotation.x + width - padding - lineWidth;
      }

      ctx.fillText(line.trim(), textX, y);

      // Draw underline if enabled
      if (annotation.fontUnderline) {
        ctx.beginPath();
        ctx.moveTo(textX, y + fontSize + 1);
        ctx.lineTo(textX + lineWidth, y + fontSize + 1);
        ctx.strokeStyle = ctx.fillStyle;
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // Draw strikethrough if enabled
      if (annotation.fontStrikethrough) {
        ctx.beginPath();
        ctx.moveTo(textX, y + fontSize * 0.6);
        ctx.lineTo(textX + lineWidth, y + fontSize * 0.6);
        ctx.strokeStyle = ctx.fillStyle;
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      y += lineHeight;
    }
  }
  ctx.textBaseline = 'alphabetic'; // Reset
  ctx.direction = 'ltr'; // Reset base direction for subsequent draws
}
