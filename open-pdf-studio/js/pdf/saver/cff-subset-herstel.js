// Herstel voor de CFF-subsets die @pdf-lib/fontkit 1.1.1 schrijft.
//
// pdf-lib laat het subsetten van een ingebed OpenType/CFF-lettertype over aan
// fontkit. Voor een CID-keyed lettertype met meerdere Font DICTs, zoals het
// gebundelde Noto Sans TC van de OCR-tekstlaag, levert diens CFFSubset een
// programma af dat niet aan de CFF-specificatie (Technical Note #5176, TN5176)
// voldoet of glyphs verkeerd koppelt:
//
//  1. Kop (TN5176 tabel 2): offSize krijgt cff.length, afgekapt tot één byte
//     (bij Noto Sans TC 24). Alleen 1..4 is geldig; FreeType en de
//     lettertype-sanitizer van Chromium weigeren daardoor het hele lettertype.
//     hdrSize wordt uit de bron overgenomen, terwijl de encoder altijd precies
//     vier kopbytes schrijft.
//  2. FDSelect-opzoeking (TN5176 §19, formaat 3/4): de binaire zoektocht in
//     CFFFont#fdForGlyph test 'gid > volgende.first' in plaats van '>=', zodat
//     de eerste glyph van sommige bereiken het Font DICT van het vorige bereik
//     krijgt. Bij Noto Sans TC zijn dat 63 glyphs, waaronder '：', 'Ø' en '±'.
//  3. Subset-FDArray: bij het hernummeren van de gebruikte Font DICTs krijgt
//     elke glyph het láátst toegevoegde Font DICT in plaats van het zijne, en
//     worden zijn lokale subroutines bij dat verkeerde DICT geteld. Zodra OCR-
//     tekst tussen schriften wisselt, wijzen glyphs naar een Private DICT en
//     Subrs die niet van hen zijn en roepen hun charstrings ontbrekende of
//     weggesneden subroutines aan. Ook mét een geldige kop weigert Chromium
//     zo'n lettertype dan nog (CharStrings-validatie) en kan FreeType die
//     glyphs niet laden; punt 2 en 3 zijn dus net zo nodig als punt 1.
//  4. Een subset met alleen .notdef (OCR vond niets) geeft een charset-bereik
//     met nLeft = -1. Het coderen gooit dan een RangeError in fontkits eigen
//     nextTick, buiten pdf-lib's promise om: de opslag rondt nooit af.
//
// node_modules blijft ongemoeid. metCffHerstel() geeft pdf-lib een dunne
// omhulling rond fontkit die per lettertype-instantie precies deze plekken
// vervangt; charstrings, globale subroutines, charset, ROS en de inhoud van de
// Private DICTs komen ongewijzigd uit fontkit (zie de tests).

/** Kleinste offSize (1..4) die elke absolute offset in `lengte` bytes kan bevatten. */
function offSizeVoor(lengte) {
  if (lengte <= 0xff) return 1;
  if (lengte <= 0xffff) return 2;
  if (lengte <= 0xffffff) return 3;
  return 4;
}

/**
 * Zet de kop van een door fontkit gecodeerde CFF-subset recht (punt 1):
 * hdrSize = 4, want de Name INDEX volgt bij fontkit direct op de vier kopbytes,
 * en offSize = de kleinste geldige offsetmaat voor deze lengte. Alleen deze twee
 * bytes veranderen; er verschuift niets, dus alle offsets blijven kloppen.
 * Geeft een kopie terug; invoer die geen CFF 1.x is komt ongewijzigd terug.
 */
export function herstelCffKop(cff) {
  if (cff.length < 4 || cff[0] !== 1) return cff;
  const uit = Uint8Array.from(cff);
  uit[2] = 4;
  uit[3] = offSizeVoor(uit.length);
  return uit;
}

/**
 * Font DICT-index voor `gid` volgens de bereiken van een FDSelect in formaat 3
 * of 4 (punt 2). De bereiken staan oplopend op `first`; een glyph hoort bij het
 * laatste bereik met first <= gid.
 */
export function fdUitBereiken(ranges, gid) {
  let laag = 0;
  let hoog = ranges.length - 1;
  let fd = null;
  while (laag <= hoog) {
    const midden = (laag + hoog) >> 1;
    if (ranges[midden].first <= gid) {
      fd = ranges[midden].fd;
      laag = midden + 1;
    } else {
      hoog = midden - 1;
    }
  }
  return fd;
}

/**
 * Vervangt CFFSubset#subsetFontdict (punt 3); `this` is de fontkit-subset.
 * Neemt elk gebruikt Font DICT één keer op en laat zowel FDSelect als de
 * telling van gebruikte lokale subroutines naar het EIGEN Font DICT van elke
 * glyph wijzen. Verder gelijk aan het origineel: FontName vervalt en niet-
 * gebruikte subroutines worden door fontkits subsetSubrs tot 'return' ingekort
 * (hun aantal, en dus de bias, blijft gelijk).
 */
export function subsetFontdictPerGlyph(topDict) {
  topDict.FDArray = [];
  topDict.FDSelect = { version: 0, fds: [] };
  const subsetIndex = new Map(); // Font DICT in de bron → index in de subset
  const gebruikteSubrs = [];
  for (const gid of this.glyphs) {
    // FDSelect moet elke glyph dekken; een CID-lettertype zonder bereik voor
    // deze glyph is kapot, dan liever Font DICT 0 dan een verschoven FDSelect.
    const fd = this.cff.fdForGlyph(gid) ?? 0;
    let index = subsetIndex.get(fd);
    if (index === undefined) {
      index = topDict.FDArray.length;
      subsetIndex.set(fd, index);
      topDict.FDArray.push({ ...this.cff.topDict.FDArray[fd] });
      gebruikteSubrs.push({});
    }
    topDict.FDSelect.fds.push(index);
    const glyph = this.font.getGlyph(gid);
    void glyph.path; // het pad parsen vult glyph._usedSubrs
    for (const subr in glyph._usedSubrs) gebruikteSubrs[index][subr] = true;
  }
  topDict.FDArray.forEach((dict, i) => {
    delete dict.FontName;
    if (dict.Private && dict.Private.Subrs) {
      dict.Private = { ...dict.Private, Subrs: this.subsetSubrs(dict.Private.Subrs, gebruikteSubrs[i]) };
    }
  });
}

function voegSamen(stukken) {
  const uit = new Uint8Array(stukken.reduce((som, stuk) => som + stuk.length, 0));
  let pos = 0;
  for (const stuk of stukken) {
    uit.set(stuk, pos);
    pos += stuk.length;
  }
  return uit;
}

// Vangt de gecodeerde subset op en geeft hem met herstelde kop door. pdf-lib
// gebruikt van de stroom alleen on('data'|'end'|'error'); meer biedt deze niet.
function herstelBijEinde(bron, coderingsfout) {
  const luisteraars = { data: [], end: [], error: [] };
  const stukken = [];
  let klaar = false;
  const meld = (soort, waarde) => {
    for (const cb of luisteraars[soort] || []) cb(waarde);
  };
  const faal = (fout) => {
    if (klaar) return;
    klaar = true;
    meld('error', fout);
  };
  bron.on('data', (stuk) => stukken.push(stuk));
  bron.on('error', faal);
  bron.on('end', () => {
    if (klaar) return;
    const fout = coderingsfout();
    if (fout) {
      faal(fout);
      return;
    }
    klaar = true;
    meld('data', herstelCffKop(voegSamen(stukken)));
    meld('end');
  });
  const stroom = {
    on(soort, cb) {
      (luisteraars[soort] ||= []).push(cb);
      return stroom;
    },
  };
  return stroom;
}

function herstelSubset(subset) {
  const encode = subset.encode;
  const encodeStream = subset.encodeStream;
  let coderingsfout = null;
  subset.subsetFontdict = subsetFontdictPerGlyph;
  subset.encode = function (stroom) {
    // Punt 4: naast .notdef tijdelijk één echte glyph, zodat het charset-bereik
    // (first 1, nLeft = aantal - 2) geldig is. Alleen tijdens het coderen: de
    // subset (en pdf-lib's glyphboekhouding) blijft ongewijzigd, en geen CID in
    // de PDF verwijst naar deze glyph.
    const aanvullen = this.glyphs.length === 1 && this.font.numGlyphs > 1;
    if (aanvullen) this.glyphs.push(1);
    // fontkit roept encode() aan in zijn eigen nextTick; een fout daar bereikt
    // pdf-lib nooit en laat de opslag hangen. Hier opvangen en als 'error' melden.
    try {
      encode.call(this, stroom);
    } catch (fout) {
      coderingsfout = fout;
    } finally {
      if (aanvullen) this.glyphs.pop();
    }
  };
  subset.encodeStream = function () {
    coderingsfout = null;
    return herstelBijEinde(encodeStream.call(this), () => coderingsfout);
  };
  return subset;
}

/**
 * Omhulling rond fontkit voor pdfDoc.registerFontkit(). pdf-lib gebruikt van
 * fontkit alleen create(); voor lettertypen met een 'CFF '-tabel worden hier de
 * FDSelect-opzoeking en de subsetter hersteld. TrueType-lettertypen (glyf)
 * komen ongewijzigd terug.
 */
export function metCffHerstel(fontkit) {
  return {
    create(bytes, postscriptName) {
      const font = fontkit.create(bytes, postscriptName);
      const cff = font && font['CFF '];
      if (!cff) return font;

      const fdForGlyph = cff.fdForGlyph;
      cff.fdForGlyph = function (gid) {
        const fdSelect = this.topDict.FDSelect;
        if (fdSelect && (fdSelect.version === 3 || fdSelect.version === 4)) {
          return fdUitBereiken(fdSelect.ranges, gid);
        }
        return fdForGlyph.call(this, gid);
      };

      const createSubset = font.createSubset;
      font.createSubset = function () {
        return herstelSubset(createSubset.call(this));
      };
      return font;
    },
  };
}
