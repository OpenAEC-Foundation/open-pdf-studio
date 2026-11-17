// Counts the downloads of the installers on the GitHub releases and writes the
// table between the download-stats markers in README.md and README.nl.md.
//   node open-pdf-studio/scripts/download-stats.mjs          update the READMEs
//   node open-pdf-studio/scripts/download-stats.mjs --print  only print the table
// Only files a person installs count: installers, the portable zip, the disk
// image, the Linux packages and the APK. Update feeds, signatures, checksums
// and the archives the built-in updater fetches are left out, so an update of
// an installed copy is not counted as a download. Drafts and pre-releases
// (the nightly build) are left out too. GITHUB_TOKEN is used when it is set.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const REPO = 'OpenAEC-Foundation/open-pdf-studio';

export const PLATFORMS = ['Windows', 'macOS', 'Linux', 'Android'];

/** The platform an asset is an installer for, or null when it is not one. */
export function platformVan(naam) {
  const n = String(naam || '').toLowerCase();
  // Signatures, checksums, update feeds and updater archives.
  if (/\.(sig|asc|sha256|json|txt)$/.test(n)) return null;
  if (/\.nsis\.zip$|\.msi\.zip$|\.app\.tar\.gz$|\.appimage\.tar\.gz$/.test(n)) return null;
  if (/\.exe$|\.msi$|_portable\.zip$/.test(n)) return 'Windows';
  if (/\.dmg$/.test(n)) return 'macOS';
  if (/\.deb$|\.appimage$|\.snap$|\.rpm$|\.flatpak$/.test(n)) return 'Linux';
  if (/\.apk$/.test(n)) return 'Android';
  return null;
}

/**
 * Totals per platform over the published releases.
 * @param {Array<{tag_name:string, draft:boolean, prerelease:boolean, published_at:string, assets:Array<{name:string, download_count:number}>}>} releases
 */
export function tel(releases) {
  const gepubliceerd = (releases || []).filter((r) => !r.draft && !r.prerelease)
    .sort((a, b) => String(b.published_at).localeCompare(String(a.published_at)));
  const leeg = () => Object.fromEntries(PLATFORMS.map((p) => [p, 0]));
  const totaal = leeg();
  const laatste = leeg();
  gepubliceerd.forEach((r, i) => {
    for (const a of r.assets || []) {
      const p = platformVan(a.name);
      if (!p) continue;
      totaal[p] += a.download_count || 0;
      if (i === 0) laatste[p] += a.download_count || 0;
    }
  });
  return {
    releases: gepubliceerd.length,
    laatsteTag: gepubliceerd[0]?.tag_name || '',
    totaal,
    laatste,
  };
}

const TEKST = {
  en: {
    kop: ['Platform', 'All releases', 'Latest release', 'Share'],
    totaal: 'Total',
    titel: 'Installer downloads by platform',
    voet: (d, n, tag) => `Counted on ${d} over ${n} releases; the latest is ${tag}. Only installers count, not the updates an installed copy fetches. The Snap Store, Flathub and the web version are not in these numbers.`,
    getal: (n) => n.toLocaleString('en-US'),
  },
  nl: {
    kop: ['Platform', 'Alle releases', 'Laatste release', 'Aandeel'],
    totaal: 'Totaal',
    titel: 'Downloads van installatiebestanden per platform',
    voet: (d, n, tag) => `Geteld op ${d} over ${n} releases; de laatste is ${tag}. Alleen installatiebestanden tellen, niet de updates die een geïnstalleerde kopie ophaalt. De Snap Store, Flathub en de webversie zitten niet in deze cijfers.`,
    getal: (n) => n.toLocaleString('nl-NL'),
  },
};

/** The Markdown block for one language. */
export function tabel(stand, taal = 'en', datum = new Date().toISOString().slice(0, 10)) {
  const t = TEKST[taal] || TEKST.en;
  const som = (o) => PLATFORMS.reduce((s, p) => s + o[p], 0);
  const alles = som(stand.totaal);
  const pct = (n) => {
    const p = (alles ? ((n / alles) * 100).toFixed(1) : '0.0') + '%';
    return taal === 'nl' ? p.replace('.', ',') : p;
  };
  const regels = [
    `| ${t.kop.join(' | ')} |`,
    '|---|---:|---:|---:|',
    ...PLATFORMS.map((p) => `| ${p} | ${t.getal(stand.totaal[p])} | ${t.getal(stand.laatste[p])} | ${pct(stand.totaal[p])} |`),
    `| **${t.totaal}** | **${t.getal(alles)}** | **${t.getal(som(stand.laatste))}** | **100%** |`,
    '',
    '```mermaid',
    'pie showData',
    `    title ${t.titel}`,
    ...PLATFORMS.filter((p) => stand.totaal[p] > 0).map((p) => `    "${p}" : ${stand.totaal[p]}`),
    '```',
    '',
    t.voet(datum, stand.releases, stand.laatsteTag),
  ];
  return regels.join('\n');
}

async function haalReleases() {
  const kop = { Accept: 'application/vnd.github+json', 'User-Agent': 'open-pdf-studio-download-stats' };
  if (process.env.GITHUB_TOKEN) kop.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const alle = [];
  for (let pagina = 1; pagina <= 20; pagina += 1) {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=100&page=${pagina}`, { headers: kop });
    if (!r.ok) throw new Error(`GitHub answered ${r.status} for the releases list`);
    const deel = await r.json();
    alle.push(...deel);
    if (deel.length < 100) break;
  }
  return alle;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const stand = tel(await haalReleases());
  const re = /(<!-- download-stats:start -->)[\s\S]*?(<!-- download-stats:end -->)/;
  for (const [bestand, taal] of [['README.md', 'en'], ['README.nl.md', 'nl']]) {
    const t = tabel(stand, taal);
    if (process.argv.includes('--print')) { console.log(t + '\n'); continue; }
    const pad = path.join(root, bestand);
    const s = readFileSync(pad, 'utf8');
    if (!re.test(s)) throw new Error(`download-stats markers not found in ${bestand}`);
    writeFileSync(pad, s.replace(re, `$1\n${t}\n$2`));
    console.log(`${bestand} updated`);
  }
}
