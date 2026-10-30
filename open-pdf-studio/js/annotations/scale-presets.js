// Ratios stay dimensionless in saved document scales. Imperial labels are
// familiar paper-inch / real-foot notation; choosing one defaults to feet.
export const METRIC_SCALE_PRESETS = [
  '1:1', '1:2', '1:5', '1:10', '1:20', '1:25', '1:50',
  '1:100', '1:200', '1:250', '1:500', '1:1000',
];

export const IMPERIAL_SCALE_PRESETS = [
  ['1/32', 384], ['1/16', 192], ['3/32', 128], ['1/8', 96],
  ['3/16', 64], ['1/4', 48], ['3/8', 32], ['1/2', 24],
  ['3/4', 16], ['1', 12], ['1 1/2', 8], ['3', 4],
].map(([inches, denominator]) => ({
  ratio: `1:${denominator}`, label: `${inches}" = 1'-0" (1:${denominator})`,
})).concat([10, 20, 30, 40, 50, 60, 100].map(feet => ({
  ratio: `1:${feet * 12}`, label: `1" = ${feet}'-0" (1:${feet * 12})`,
})));

export const SCALE_PRESETS = [
  ...METRIC_SCALE_PRESETS,
  ...IMPERIAL_SCALE_PRESETS.map(preset => preset.ratio),
];
