// Narrow fix for PDF.js bidi classification (mozilla/pdf.js issue #22433,
// no upstream fix merged yet), Apache-2.0. The bidi code is derived from
// PDF.js, Copyright Mozilla Foundation.
// Licensed under the Apache License, Version 2.0: https://www.apache.org/licenses/LICENSE-2.0
// Remove this patch only after qualifying a pdfjs-dist release that types
// combining marks by their Unicode Bidi_Class.
//
// #957: bidi() in PDF.js 6.4.299 geeft elk teken boven U+00FF buiten de
// Hebreeuwse/Arabische blokken het sterke type "L". Combinerende tekens
// daarbuiten (o.a. U+034F COMBINING GRAPHEME JOINER, U+0300-036F en de
// variatiekiezers U+FE00-FE0F) hebben echter Bidi_Class NSM. In een RTL-regel
// werd zo'n teken een eigen LTR-run en erfde een volgend NSM-teken (regel W1)
// ook "L", waardoor bij tekstextractie bijvoorbeeld de fatha en de CGJ van
// plaats wisselden. Deze patch typt de combinerende blokken als NSM; de rest
// van het algoritme blijft ongewijzigd.
//
// Blokken (alle toegewezen tekens daarin hebben Bidi_Class NSM):
//   U+0300-036F Combining Diacritical Marks (incl. U+034F CGJ)
//   U+0483-0489 Cyrillic combining marks
//   U+08D3-08E1, U+08E3-08FF Arabic Extended-A marks (U+08E2 is AN)
//   U+1AB0-1AFF Combining Diacritical Marks Extended
//   U+1DC0-1DFF Combining Diacritical Marks Supplement
//   U+20D0-20F0 Combining Diacritical Marks for Symbols
//   U+FE00-FE0F Variation Selectors
//   U+FE20-FE2F Combining Half Marks

const BEFORE = String.raw`    } else if (0x0700 <= charCode && charCode <= 0x08ac || 0xfb50 <= charCode && charCode <= 0xfdff || 0xfe70 <= charCode && charCode <= 0xfeff) {
      charType = "AL";
    }
`;
const AFTER = String.raw`    } else if (0x0300 <= charCode && charCode <= 0x036f || 0x0483 <= charCode && charCode <= 0x0489 || 0x08d3 <= charCode && charCode <= 0x08e1 || 0x08e3 <= charCode && charCode <= 0x08ff || 0x1ab0 <= charCode && charCode <= 0x1aff || 0x1dc0 <= charCode && charCode <= 0x1dff || 0x20d0 <= charCode && charCode <= 0x20f0 || 0xfe00 <= charCode && charCode <= 0xfe0f || 0xfe20 <= charCode && charCode <= 0xfe2f) {
      // Combining marks have Bidi_Class NSM, not strong L (#957).
      charType = "NSM";
    } else if (0x0700 <= charCode && charCode <= 0x08ac || 0xfb50 <= charCode && charCode <= 0xfdff || 0xfe70 <= charCode && charCode <= 0xfeff) {
      charType = "AL";
    }
`;

export function patchBidiCombiningMarks(source) {
  // Fail closed on dependency drift instead of silently shipping an unpatched worker.
  // AFTER bevat BEFORE (de AL-tak blijft staan): al gepatcht = AFTER precies
  // één keer en BEFORE nergens anders.
  if (source.split(AFTER).length === 2 && source.split(BEFORE).length === 2) return source;
  if (source.split(BEFORE).length !== 2) {
    throw new Error('PDF.js bidi combining-mark patch no longer matches; qualify the worker before updating PDF.js (#957).');
  }
  return source.replace(BEFORE, AFTER);
}
