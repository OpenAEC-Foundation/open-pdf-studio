// @pdf-lib/fontkit 1.1.1 cannot decode or apply GSUB lookup type 8 (#1124).
// Qualified source correction, covering Vite's optimizer and production build.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const hashes = {
  es: '62ad9c769e6a7a9028b0c711504908f0a231955b39619aaabd56dd4eabe800be',
  umd: 'd60739f02b41b636ee0cc2fb79ba589958144f9240e585dbc19e6a3b08d82825',
};
const pattern = /[\\/]@pdf-lib[\\/]fontkit[\\/]dist[\\/]fontkit\.(es|umd)\.js$/;

// Installed inside the dependency scope; other lookup types retain their implementation.
function installReverseSubstitution(Processor, Iterator) {
  const applyLookup = Processor.prototype.applyLookup;
  const applyLookups = Processor.prototype.applyLookups;
  Processor.prototype.applyLookup = function (type, table) {
    if (type !== 8) return applyLookup.call(this, type, table);
    if (table.substFormat !== 1) throw new Error('Unsupported reverse substitution format');
    const index = this.coverageIndex(table.coverage);
    if (index < 0) return false;
    // OpenType stores backtrack coverage nearest-first, irrespective of script direction.
    for (const [coverages, direction] of [[table.backtrackCoverage, -1], [table.lookaheadCoverage, 1]]) {
      for (let i = 0; i < coverages.length; i++) {
        const glyph = this.glyphIterator.peek(direction * (i + 1));
        if (!glyph || this.coverageIndex(coverages[i], glyph.id) < 0) return false;
      }
    }
    this.glyphIterator.cur.id = table.substitutes[index];
    return true;
  };
  Processor.prototype.applyLookups = function (lookups, glyphs, positions) {
    for (const item of lookups) {
      const { lookup, feature } = item;
      const reverse = lookup.lookupType === 8 || (lookup.lookupType === 7 &&
        lookup.subTables.length > 0 && lookup.subTables.every(table => table.lookupType === 8));
      if (!reverse) {
        applyLookups.call(this, [item], glyphs, positions);
        continue;
      }
      this.glyphs = glyphs;
      this.positions = positions;
      this.currentFeature = feature;
      const iterator = this.glyphIterator = new Iterator(glyphs);
      iterator.reset(lookup.flags, glyphs.length);
      while (iterator.prev()) {
        if (!(feature in iterator.cur.features)) continue;
        for (const table of lookup.subTables) {
          if (this.applyLookup(lookup.lookupType, table)) break;
        }
      }
    }
  };
}

export function patchFontkitReverse(source, format = 'es') {
  if (createHash('sha256').update(source).digest('hex') !== hashes[format]) {
    throw new Error('Unqualified fontkit source: revalidate GSUB type 8 correction (#1124) before upgrading');
  }
  const missing = /(\/\/ Reverse Chaining Contextual Single Substitution\s+substFormat: restructure.uint16,\s+coverage: new restructure.Pointer\(restructure.uint16, Coverage\),)/;
  const end = /return GSUBProcessor;\s*}\(OTProcessor\);/;
  return source.replace(missing, '$1\n    backtrackGlyphCount: restructure.uint16,')
    .replace(end, match => `${match}\n(${installReverseSubstitution.toString()})(GSUBProcessor, GlyphIterator);`);
}
export function fontkitReverseEsbuild() {
  return { name: 'opds-fontkit-reverse', setup(build) {
    build.onLoad({ filter: pattern }, ({ path }) => ({
      contents: patchFontkitReverse(readFileSync(path, 'utf8'), path.match(pattern)[1]), loader: 'js',
    }));
  } };
}
export function fontkitReverseSubstitution() {
  return {
    name: 'opds-fontkit-reverse', enforce: 'pre',
    config() { return { optimizeDeps: { esbuildOptions: { plugins: [fontkitReverseEsbuild()] } } }; },
    transform(source, id) {
      const match = id.match(pattern);
      return match ? { code: patchFontkitReverse(source, match[1]), map: null } : null;
    },
  };
}
