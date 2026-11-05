// OCR review for the active document: the queue of words to check and the
// accept/correct actions (dialog, MCP and plugin API).

import { PDFDocument } from 'pdf-lib';
import { getActiveDocument } from '../core/state.js';
import { execute } from '../core/undo-manager.js';
import { opslaanGeweigerd } from './wachtwoord-pdf.js';
import {
  readOcrReview, reviewQueue, archivedReviewQueue, sortQueue, reviewWord, unencodableCharacters,
} from './ocr-review.js';
import { laadFontkit, loadDefaultOcrFontBytes } from './saver/ocr-text-layer.js';
import { ocrPaginaSignaturen } from './ocr-laag.js';

let codePointsPromise = null;

/** The code points of the bundled OCR font (rejects when it is missing). */
function ocrFontCodePoints() {
  if (!codePointsPromise) {
    codePointsPromise = (async () => {
      const [fontkit, bytes] = await Promise.all([laadFontkit(), loadDefaultOcrFontBytes()]);
      const font = fontkit.create(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
      return new Set(font.characterSet);
    })();
    codePointsPromise.catch(() => { codePointsPromise = null; });
  }
  return codePointsPromise;
}

/**
 * The characters of `text` that the OCR text layer cannot show. Empty when
 * the OCR font is not available: the save then writes no layer at all.
 */
export async function missingOcrFontCharacters(text) {
  let codePoints;
  try {
    codePoints = await ocrFontCodePoints();
  } catch {
    return [];
  }
  return unencodableCharacters(text, codePoints);
}

async function documentFor(id) {
  const doc = getActiveDocument();
  if (!doc?.pdfDoc || doc.id !== id) throw new Error('DOCUMENT_CHANGED');
  const pdf = doc.pdfDoc;
  if (!Object.keys(doc.ocrResults || {}).length) {
    const parsed = await PDFDocument.load((await pdf.getData()).slice(), { updateMetadata: false });
    if (getActiveDocument() !== doc || doc.pdfDoc !== pdf) throw new Error('DOCUMENT_CHANGED');
    if (!Object.keys(doc.ocrResults || {}).length) {
      // Old files store every word (usable as OCR results); newer files
      // store only the reviews, which are shown but never become results.
      const { complete, reviewsOnly } = readOcrReview(parsed);
      doc.ocrResults = complete;
      doc.ocrReviewArchive = reviewsOnly;
      // Deze woorden komen uit het bestand: hun laag staat er al in (zoeken
      // neemt ze dan niet nog eens uit het geheugen mee, ocr-laag.js).
      doc.ocrLaagInBestand = ocrPaginaSignaturen(complete);
    }
  }
  return doc;
}

export async function listOcrReview(documentId, threshold = 80, options = {}) {
  const doc = await documentFor(documentId);
  const words = sortQueue([
    ...reviewQueue(doc.ocrResults, threshold),
    ...archivedReviewQueue(doc.ocrReviewArchive, doc.ocrResults),
  ]);
  const offset = Math.max(0, Math.floor(Number(options.offset) || 0));
  const limit = Math.min(1000, Math.max(1, Math.floor(Number(options.limit) || 100)));
  return {
    documentId,
    offset,
    limit,
    revision: doc.inhoudRevisie || 0,
    words: words.slice(offset, offset + limit),
    total: words.length,
    reviewed: words.filter((w) => w.review).length,
  };
}

/**
 * A reviewed word the OCR layer cannot show refuses the save (#657), so the
 * review refuses such text up front: a correction, and also accepting a
 * recognized text with such characters.
 */
async function refuseUnencodable(text) {
  const missing = await missingOcrFontCharacters(text);
  if (missing.length) {
    const error = new Error('OCR_REVIEW_TEXT_NOT_ENCODABLE');
    error.characters = missing;
    throw error;
  }
}

export async function updateOcrReview(request) {
  if (request.action === 'correct' && typeof request.text === 'string') await refuseUnencodable(request.text);
  const doc = await documentFor(request.documentId);
  if (opslaanGeweigerd(doc)) throw new Error('READ_ONLY_DOCUMENT');
  if (request.revision !== (doc.inhoudRevisie || 0)) throw new Error('DOCUMENT_CHANGED');
  const word = doc.ocrResults[request.page]?.[request.index];
  if (!word) throw new Error('OCR_WORD_NOT_FOUND');
  if (request.action === 'accept') {
    await refuseUnencodable(word.text);
    if (getActiveDocument() !== doc || request.revision !== (doc.inhoudRevisie || 0)
      || doc.ocrResults[request.page]?.[request.index] !== word) throw new Error('DOCUMENT_CHANGED');
  }
  reviewQueue(doc.ocrResults, request.threshold ?? 80);
  const oldWord = JSON.parse(JSON.stringify(word));
  const newWord = reviewWord(oldWord, request);
  doc.ocrResults[request.page][request.index] = newWord;
  execute({ type: 'ocrWord', page: request.page, index: request.index, oldWord, newWord });
  return listOcrReview(request.documentId, request.threshold ?? 80, request);
}
