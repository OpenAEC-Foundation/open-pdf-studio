import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const FIXED_DATE = new Date('2026-01-01T00:00:00.000Z');

export async function createRenderFixture(outputPath) {
  const pdf = await PDFDocument.create({ updateMetadata: false });
  pdf.setTitle('Render regression fixture');
  pdf.setAuthor('Open PDF Studio');
  pdf.setCreator('Open PDF Studio');
  pdf.setProducer('Open PDF Studio');
  pdf.setCreationDate(FIXED_DATE);
  pdf.setModificationDate(FIXED_DATE);

  const page = pdf.addPage([595, 842]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  page.drawText('Open PDF Studio', {
    x: 64,
    y: 752,
    size: 24,
    font: bold,
    color: rgb(0.08, 0.16, 0.28),
  });
  page.drawText('Deterministic render regression fixture', {
    x: 64,
    y: 724,
    size: 12,
    font,
    color: rgb(0.24, 0.32, 0.42),
  });
  page.drawRectangle({
    x: 64,
    y: 570,
    width: 210,
    height: 100,
    color: rgb(0.12, 0.48, 0.78),
    borderColor: rgb(0.04, 0.18, 0.34),
    borderWidth: 3,
  });
  page.drawCircle({
    x: 390,
    y: 620,
    size: 52,
    color: rgb(0.92, 0.48, 0.12),
    borderColor: rgb(0.42, 0.18, 0.04),
    borderWidth: 3,
  });
  page.drawLine({
    start: { x: 64, y: 510 },
    end: { x: 531, y: 440 },
    thickness: 5,
    color: rgb(0.18, 0.62, 0.38),
  });
  page.drawText('Text 1234 - vector shapes - RGB colours', {
    x: 64,
    y: 390,
    size: 16,
    font,
    color: rgb(0.12, 0.12, 0.12),
  });

  const bytes = await pdf.save({ useObjectStreams: false });
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, bytes);
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  const outputPath = process.argv[2];
  if (!outputPath) {
    throw new Error('Usage: node scripts/create-render-fixture.mjs <output.pdf>');
  }
  await createRenderFixture(path.resolve(outputPath));
}
