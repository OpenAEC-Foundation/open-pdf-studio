// fontkit can shorten a TrueType loca table by dividing offsets by two.
// BIZ UDGothic has odd-length glyph records: without padding, this rounds
// down their offsets and turns valid glyphs into invalid compound glyphs.
export function metTrueTypeUitlijning(fontkit) {
  return {
    ...fontkit,
    create(...args) {
      const font = fontkit.create(...args);
      if (!font.directory?.tables?.glyf) return font;
      const maakSubset = font.createSubset.bind(font);
      font.createSubset = (...subsetArgs) => {
        const subset = maakSubset(...subsetArgs);
        const voegToe = subset._addGlyph;
        subset._addGlyph = function (gid) {
          const index = voegToe.call(this, gid);
          const bytes = this.glyf[index];
          if (bytes.length % 2) {
            const aligned = bytes.constructor.alloc(bytes.length + 1);
            aligned.set(bytes);
            this.glyf[index] = aligned;
            this.offset++;
          }
          return index;
        };
        return subset;
      };
      return font;
    },
  };
}
