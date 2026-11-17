// Het lettertype van een formulierveld bij het opslaan (#1154).
//
// Een veld noemt zijn lettertype in /DA (`/Naam 12 Tf`); die naam verwijst
// naar een lettertype in de /DR van het formulier (of in de bronnen van de
// bestaande weergave van het veld). pdf-lib maakt een nieuwe weergave altijd
// in één meegegeven lettertype en zonder opgave is dat Helvetica: een veld in
// een ingebed lettertype (bijvoorbeeld cijfers in een machineleesbaar
// lettertype op een cheque) kreeg zo bij elke opslag een ander lettertype, en
// de /DA wees daarna naar dat andere lettertype.
//
// Hier krijgt pdf-lib het lettertype van het veld zelf aangereikt: een
// PDFFont rond het bestaande lettertype-object, dat tekst codeert met de
// codering van dat lettertype (ToUnicode of /Encoding) en meet met zijn
// /Widths. De weergave verwijst dan naar hetzelfde object als de /DR en de
// /DA houdt zijn naam. De indeling (uitlijning, meerdere regels, vakjes,
// rand en achtergrond) blijft die van pdf-lib.
//
// Een teken dat het ingebedde lettertype niet heeft, wordt niet stil door een
// ander lettertype vervangen: het opslaan weigert en noemt de tekens, zoals
// bij een tekstbewerking (text/glyf-dekking.js).

import {
  CustomFontEmbedder,
  PDFArray,
  PDFDict,
  PDFDropdown,
  PDFFont,
  PDFHexString,
  PDFName,
  PDFOptionList,
  PDFRef,
  PDFString,
  PDFTextField,
} from 'pdf-lib';
import { buildFontInfos } from './text-edit-inplace.js';
import { codesToHexString } from '../../text/content-stream-text.js';
import { OntbrekendeGlyfenFout, isOntbrekendeGlyfenFout } from '../../text/glyf-dekking.js';

const N = (naam) => PDFName.of(naam);

function getal(context, obj) {
  const v = obj ? context.lookup(obj) : null;
  return typeof v?.asNumber === 'function' ? v.asNumber() : null;
}

/** De lettertypenaam uit een /DA-tekenreeks (zonder schuine streep), of ''. */
export function lettertypeNaamUitDA(da) {
  const m = /\/([^\s/<>[\]()%]+)\s+[-+]?[\d.]+\s+Tf/.exec(String(da ?? ''));
  return m ? m[1] : '';
}

function tekstVan(context, obj) {
  const v = obj ? context.lookup(obj) : null;
  if (v instanceof PDFString || v instanceof PDFHexString) return v.decodeText();
  return '';
}

// De /DA van het widget, anders van het veld of een voorouder, anders van het
// formulier (de waarde erft over).
function zoekDA(context, widgetDict, acroForm) {
  let dict = widgetDict;
  for (let diepte = 0; dict instanceof PDFDict && diepte < 32; diepte++) {
    const da = tekstVan(context, dict.get(N('DA')));
    if (da) return da;
    dict = context.lookup(dict.get(N('Parent')));
  }
  return acroForm ? tekstVan(context, acroForm.get(N('DA'))) : '';
}

function fontDictVan(context, bronnen) {
  const r = bronnen ? context.lookup(bronnen) : null;
  const f = r instanceof PDFDict ? context.lookup(r.get(N('Font'))) : null;
  return f instanceof PDFDict ? f : null;
}

// De bronnen van de bestaande normale weergave van een widget.
function weergaveBronnen(context, widgetDict) {
  const ap = context.lookup(widgetDict.get(N('AP')));
  const n = ap instanceof PDFDict ? context.lookup(ap.get(N('N'))) : null;
  return n?.dict instanceof PDFDict ? n.dict.get(N('Resources')) : null;
}

function descriptorVan(context, font) {
  let dict = font;
  if (String(font.get(N('Subtype'))) === '/Type0') {
    const af = context.lookup(font.get(N('DescendantFonts')));
    dict = af instanceof PDFArray && af.size() > 0 ? context.lookup(af.get(0)) : null;
  }
  const d = dict instanceof PDFDict ? context.lookup(dict.get(N('FontDescriptor'))) : null;
  return d instanceof PDFDict ? d : null;
}

function isIngebed(descriptor) {
  return !!descriptor && ['FontFile', 'FontFile2', 'FontFile3'].some((k) => descriptor.has(N(k)));
}

// Boven- en onderkant van het lettertype in duizendsten (voor de regelhoogte).
function hoogteMaten(context, descriptor) {
  let boven = 0;
  let onder = 0;
  if (descriptor) {
    boven = getal(context, descriptor.get(N('Ascent'))) || 0;
    onder = getal(context, descriptor.get(N('Descent'))) || 0;
    const bbox = context.lookup(descriptor.get(N('FontBBox')));
    if (bbox instanceof PDFArray && bbox.size() === 4) {
      boven = boven || getal(context, bbox.get(3)) || 0;
      onder = onder || getal(context, bbox.get(1)) || 0;
    }
  }
  if (!(boven > 0)) boven = 900;
  if (!(onder < 0)) onder = onder > 0 ? -onder : -200;
  return { boven, onder };
}

const infosPerFontDict = new WeakMap();

function fontInfos(context, fontDict) {
  let infos = infosPerFontDict.get(fontDict);
  if (!infos) {
    infos = buildFontInfos(context, fontDict);
    infosPerFontDict.set(fontDict, infos);
  }
  return infos;
}

/**
 * Het lettertype van een widget volgens zijn /DA, als pdf-lib-lettertype rond
 * het bestaande object. `null` als de /DA geen lettertype noemt, het niet te
 * vinden is, of de codering of de breedtes ontbreken (dan maakt pdf-lib de
 * weergave zoals voorheen).
 *
 * @returns {{ font: PDFFont, ingebed: boolean, naam: string } | null}
 */
export function veldLettertype(pdfDocLib, widgetDict) {
  const context = pdfDocLib.context;
  const acroForm = context.lookup(pdfDocLib.catalog.get(N('AcroForm')));
  const formulier = acroForm instanceof PDFDict ? acroForm : null;
  const ruweNaam = lettertypeNaamUitDA(zoekDA(context, widgetDict, formulier));
  if (!ruweNaam) return null;
  const sleutel = N(ruweNaam);
  const naam = String(sleutel).slice(1);

  const kandidaten = [
    fontDictVan(context, formulier?.get(N('DR'))),
    fontDictVan(context, weergaveBronnen(context, widgetDict)),
  ];
  for (const fontDict of kandidaten) {
    if (!fontDict || !fontDict.has(sleutel)) continue;
    const font = context.lookup(fontDict.get(sleutel));
    if (!(font instanceof PDFDict)) continue;
    const info = fontInfos(context, fontDict).get(naam);
    if (!info?.inverse || !info.widthOf) continue;

    let ref = fontDict.get(sleutel);
    if (!(ref instanceof PDFRef)) {
      ref = context.register(font);
      fontDict.set(sleutel, ref);
    }
    const descriptor = descriptorVan(context, font);
    const { boven, onder } = hoogteMaten(context, descriptor);

    const codeVan = (teken) => {
      let code = info.inverse.get(teken);
      if (code === undefined && (teken === '\t' || teken === ' ')) code = info.inverse.get(' ');
      return code;
    };
    // pdf-lib eist een eigen inbedder-klasse; alleen de vijf functies
    // hieronder worden voor een formulierveld aangeroepen.
    const inbedder = Object.create(CustomFontEmbedder.prototype);
    inbedder.fontName = naam;
    inbedder.customName = naam;
    inbedder.encodeText = (tekst) => {
      const codes = [];
      const ontbreekt = [];
      for (const teken of String(tekst ?? '')) {
        const code = codeVan(teken);
        const zonderGlyf = code === undefined
          || (teken.trim() !== '' && info.hasGlyph && !info.hasGlyph(code));
        if (zonderGlyf) ontbreekt.push(teken);
        else codes.push(code);
      }
      if (ontbreekt.length) throw new OntbrekendeGlyfenFout(ontbreekt);
      return PDFHexString.of(codesToHexString(codes, info.bytesPerCode));
    };
    inbedder.widthOfTextAtSize = (tekst, grootte) => {
      let som = 0;
      for (const teken of String(tekst ?? '')) {
        const code = codeVan(teken);
        if (code !== undefined) som += info.widthOf(code) || 0;
      }
      return (som / 1000) * grootte;
    };
    inbedder.heightOfFontAtSize = (grootte, opties = {}) => {
      let hoogte = boven - onder;
      if (opties.descender === false) hoogte -= Math.abs(onder);
      return (hoogte / 1000) * grootte;
    };
    inbedder.sizeOfFontAtHeight = (hoogte) => (1000 * hoogte) / (boven - onder);
    inbedder.getCharacterSet = () => [...info.inverse.keys()].map((t) => String(t).codePointAt(0));
    // Het lettertype staat al in het document: er valt niets in te bedden.
    inbedder.embedIntoContext = async () => ref;

    return { font: PDFFont.of(ref, pdfDocLib, inbedder), ingebed: isIngebed(descriptor), naam };
  }
  return null;
}

/** Is de waarde van een tekstveld al `waarde`? (Dan hoeft er niets opnieuw.) */
export function tekstOngewijzigd(veld, waarde) {
  try {
    return (veld.getText() ?? '') === String(waarde ?? '');
  } catch {
    return false; // opgemaakte tekst: pdf-lib kan de waarde niet lezen
  }
}

const isWachtwoord = (veld) => veld instanceof PDFTextField && veld.isPassword();

/**
 * Maak de weergave van elk tekstveld en elke keuzelijst die een nieuwe nodig
 * heeft in het lettertype uit de /DA van het veld. Wat hier niet lukt (geen
 * bruikbaar lettertype) blijft staan voor `updateFieldAppearances` van pdf-lib.
 *
 * `weigerOntbrekend`: een gewijzigd veld met tekens die zijn ingebedde
 * lettertype niet heeft, gooit OntbrekendeGlyfenFout in plaats van een ander
 * lettertype te krijgen.
 *
 * @returns {number} het aantal velden dat zijn eigen lettertype hield
 */
export function werkVeldWeergavenBij(pdfDocLib, { weigerOntbrekend = false } = {}) {
  let form;
  try {
    if (!pdfDocLib.catalog.has(N('AcroForm'))) return 0;
    form = pdfDocLib.getForm();
  } catch {
    return 0;
  }
  let gedaan = 0;
  for (const veld of form.getFields()) {
    const tekstueel = veld instanceof PDFTextField || veld instanceof PDFDropdown
      || veld instanceof PDFOptionList;
    if (!tekstueel || isWachtwoord(veld)) continue;
    let nodig = false;
    try { nodig = veld.needsAppearancesUpdate(); } catch { nodig = false; }
    if (!nodig) continue;

    const gewijzigd = veld.isDirty();
    let eigen = null;
    try {
      const widgets = veld.acroField.getWidgets();
      if (widgets.length === 0) continue;
      // Eén lettertype per veld: pdf-lib tekent alle widgets met hetzelfde.
      eigen = veldLettertype(pdfDocLib, widgets[0].dict);
      if (!eigen) continue;
      veld.updateAppearances(eigen.font);
      gedaan += 1;
    } catch (fout) {
      if (isOntbrekendeGlyfenFout(fout) && weigerOntbrekend && gewijzigd && eigen?.ingebed) {
        fout.veld = veld.getName();
        throw fout;
      }
      // Anders: pdf-lib maakt de weergave zoals voorheen.
    }
  }
  return gedaan;
}
