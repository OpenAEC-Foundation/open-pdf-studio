import { PDFName } from 'pdf-lib';

// Wrap a vector /AP builder result (absolute-PDF-coord content + needsFont flag)
// into a Form XObject and set it as the annotation's /AP /N — same BBox/Matrix
// convention as the FreeText appearance path. `rect` is the annotation /Rect
// [x1,y1,x2,y2] the appearance is drawn against. Types that previously wrote NO
// appearance stream were invisible (or showed only a bare outline) in other PDF
// viewers, which rely on /AP; see issue #256.
export function attachVectorAP(context, annotDict, built, rect) {
  if (!built || !built.content) return;
  const [x1, y1, x2, y2] = rect;
  const resources = {};
  if (built.needsFont) {
    resources.Font = context.obj({
      Helv: context.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica', Encoding: 'WinAnsiEncoding' }),
    });
  }
  // Aparte vul-doorzichtigheid: de content refereert /GSf gs rond de
  // vul-operator; de graphics-state zelf hoort in de Resources. Zonder deze
  // ExtGState verloor een polygoon met transparante vulling zijn vlak bij
  // opslaan (The.Map-regressie in de opslag-rondgang).
  if (built.fillAlpha !== undefined && built.fillAlpha !== null && built.fillAlpha < 1) {
    resources.ExtGState = context.obj({
      GSf: context.obj({ Type: 'ExtGState', ca: built.fillAlpha }),
    });
  }
  // Een appearance die een Form XObject tekent (het vectorknipsel) heeft dat
  // XObject in zijn eigen resources nodig; zonder deze regel blijft de /Do
  // zonder doel en is het knipsel leeg.
  if (built.xobjects) {
    resources.XObject = context.obj(built.xobjects);
  }
  const apStream = context.stream(built.content, {
    Type: 'XObject', Subtype: 'Form', BBox: [x1, y1, x2, y2],
    Matrix: [1, 0, 0, 1, -x1, -y1], Resources: context.obj(resources),
  });
  annotDict.set(PDFName.of('AP'), context.obj({ N: context.register(apStream) }));
}
