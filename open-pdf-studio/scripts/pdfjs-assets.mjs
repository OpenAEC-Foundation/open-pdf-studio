import { cpSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

// Worker, CMaps, fonts and decoders must come from the same installed release.
export function pdfjsAssets() {
  let root, outDir;
  const folders = ['cmaps', 'standard_fonts', 'wasm'];
  return {
    name: 'pdfjs-assets',
    configResolved(config) { root = config.root; outDir = resolve(root, config.build.outDir); },
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        for (const folder of folders) {
          const prefix = `/pdfjs/web/${folder}/`;
          if (req.url?.startsWith(prefix)) {
            req.url = `/node_modules/pdfjs-dist/${folder}/${req.url.slice(prefix.length)}`;
            break;
          }
        }
        next();
      });
    },
    writeBundle() {
      for (const folder of folders) {
        const to = resolve(outDir, 'pdfjs/web', folder);
        mkdirSync(to, { recursive: true });
        cpSync(resolve(root, 'node_modules/pdfjs-dist', folder), to, { recursive: true });
      }
    },
  };
}
