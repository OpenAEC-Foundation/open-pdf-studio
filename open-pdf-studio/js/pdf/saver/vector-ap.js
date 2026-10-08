import { PDFName } from 'pdf-lib';
import { apOpacityPlan } from './ap-opacity.js';

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
  // Doorzichtigheid in de appearance zelf: viewers die de opgeslagen /AP tonen
  // (i.p.v. hem uit /CA opnieuw op te bouwen) lieten een annotatie van 40% anders
  // op 100% zien. /GSo geldt voor de hele appearance; /GSf is de aparte
  // vul-doorzichtigheid (de content refereert /GSf gs rond de vul-operator) en
  // wordt met de algemene vermenigvuldigd. Zonder GSf verloor een polygoon met
  // transparante vulling zijn vlak bij opslaan (The.Map-regressie).
  const caObj = annotDict.get(PDFName.of('CA'));
  const plan = apOpacityPlan(caObj && typeof caObj.asNumber === 'function' ? caObj.asNumber() : undefined, built.fillAlpha);
  const gstates = {};
  if (plan.overall !== undefined) {
    gstates.GSo = context.obj({ Type: 'ExtGState', ca: plan.overall, CA: plan.overall });
  }
  if (plan.fill !== undefined) {
    gstates.GSf = context.obj({ Type: 'ExtGState', ca: plan.fill });
  }
  if (Object.keys(gstates).length) resources.ExtGState = context.obj(gstates);
  // Een appearance die een Form XObject tekent (het vectorknipsel) heeft dat
  // XObject in zijn eigen resources nodig; zonder deze regel blijft de /Do
  // zonder doel en is het knipsel leeg.
  if (built.xobjects) {
    resources.XObject = context.obj(built.xobjects);
  }
  const apStream = context.stream(plan.prefix + built.content, {
    Type: 'XObject', Subtype: 'Form', BBox: [x1, y1, x2, y2],
    Matrix: [1, 0, 0, 1, -x1, -y1], Resources: context.obj(resources),
  });
  annotDict.set(PDFName.of('AP'), context.obj({ N: context.register(apStream) }));
}
