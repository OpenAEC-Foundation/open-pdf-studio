// Zelf gegenereerde Type3/ToUnicode-gevallen; geen externe PDF nodig in CI.
export const glyphCases = [
  { name: 'lam-alef', glyphs: ['م', 'لا', 'س'], normal: 'سلام', raw: 'سلام' },
  { name: 'presentation-form', glyphs: ['م', '\uFC42', 'س'], normal: 'سلمم', raw: 'س\uFC42م' },
  { name: 'Arabic-digits', glyphs: ['١٢', 'م'], normal: 'م١٢', raw: 'م١٢' },
  { name: 'mixed-LTR', glyphs: ['fi', 'م', 'س'], normal: 'سمfi', raw: 'سمfi' },
  { name: 'mixed-level-glyph', glyphs: ['لa', 'م'], normal: 'مaل', raw: 'مaل' },
  { name: 'punctuation', glyphs: ['<>', 'م'], normal: 'م', raw: 'م' },
  ...['a', '1', '١', ' '].map(previous => ({ name: `mark-${previous}`, glyphs: [previous, 'لَ'], normal: `لَ${previous}`, raw: `لَ${previous}` })),
  { name: 'LTR-control', glyphs: ['hello', ' ', '12.5'], normal: 'hello 12.5', raw: 'hello 12.5' },
];
