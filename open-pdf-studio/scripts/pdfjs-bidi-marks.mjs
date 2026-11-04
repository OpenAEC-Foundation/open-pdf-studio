// Local correction for PDF.js #22433 / Open PDF Studio #957; not an upstream backport.
import { BMP_NSM_PATTERN } from './unicode-bidi-nsm.mjs';

const BEFORE = `    if (charCode <= 0x00ff) {
      charType = baseTypes[charCode];`;
const AFTER = `    if (/${BMP_NSM_PATTERN}/.test(chars[i])) {
      charType = "NSM";
    } else if (charCode <= 0x00ff) {
      charType = baseTypes[charCode];`;

export function patchBidiMarks(source) {
  if (source.split(AFTER).length === 2 && !source.includes(BEFORE)) return source;
  if (source.split(BEFORE).length !== 2 || source.includes(AFTER)) {
    throw new Error('PDF.js bidi classification no longer matches; qualify combining-mark order before updating PDF.js (#957).');
  }
  return source.replace(BEFORE, AFTER);
}
