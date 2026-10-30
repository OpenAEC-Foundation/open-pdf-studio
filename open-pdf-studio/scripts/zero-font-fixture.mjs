import { PDFDocument, PDFName, StandardFonts } from 'pdf-lib';
// Tiny generated fixture: no third-party PDF assets or user documents.
export async function zeroFontFixture({ form = false, zero = true, broken = false } = {}) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([400, 300]);
  const resources = pdf.context.obj({ Font: { F1: font.ref } });
  const program = `BT /F1 ${zero ? 0 : 12} Tf 30 220 Td (hidden) Tj ET\nBT /F1 24 Tf 30 180 Td (Visible text) Tj ET`;
  let contents = program;
  if (form || broken) {
    const ref = pdf.context.register(pdf.context.flateStream(program, {
      Type: 'XObject', Subtype: broken ? 'Invalid' : 'Form', BBox: [0, 0, 400, 300], Resources: resources,
    }));
    resources.set(PDFName.of('XObject'), pdf.context.obj({ X1: ref }));
    contents = broken ? '/Missing Do' : '/X1 Do';
  }
  page.node.set(PDFName.of('Resources'), resources);
  page.node.set(PDFName.of('Contents'), pdf.context.register(pdf.context.flateStream(contents)));
  return pdf.save();
}
