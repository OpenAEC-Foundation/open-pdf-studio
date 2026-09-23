// Bouwdoel `web-unit` — los van de bureaubladversie.
//
// Deze config raakt `vite.config.js` en `npm run build` niet aan: eigen root,
// eigen entry, eigen uitvoermap (`dist-web-unit`). De Tauri-app blijft dus bit
// voor bit dezelfde. Zie docs/superpowers/specs/2026-09-23-web-unit-design.md.

import { defineConfig } from 'vite';
import { resolve } from 'path';
import { existsSync, readFileSync, realpathSync } from 'fs';

const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8'));

// In een git-worktree is node_modules vaak een junction naar de hoofdcheckout.
// Vite kijkt naar het OPGELOSTE pad en weigert anders de PDF.js-worker en de
// MuPDF-wasm met 403 — dan laadt er in dev nooit een document.
const nodeModules = resolve(__dirname, 'node_modules');
const echteNodeModules = existsSync(nodeModules) ? realpathSync(nodeModules) : nodeModules;

export default defineConfig({
  root: resolve(__dirname, 'web-unit'),
  // De unit heeft geen publieke map; alles wat hij nodig heeft komt uit de
  // module-graph (worker, wasm, taalbestanden).
  publicDir: false,
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    port: 3077,
    strictPort: false,
    fs: {
      // De unit importeert twee modules uit de app-boom (`mupdf-renderer.js`
      // en de appearance-bouwers), en node_modules staat een niveau hoger.
      allow: [resolve(__dirname, '..'), resolve(__dirname), echteNodeModules],
    },
  },
  optimizeDeps: {
    exclude: ['mupdf'],
  },
  build: {
    outDir: resolve(__dirname, 'dist-web-unit'),
    emptyOutDir: true,
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      input: {
        'open-pdf-studio': resolve(__dirname, 'web-unit/src/index.js'),
        demo: resolve(__dirname, 'web-unit/demo/index.html'),
      },
      output: {
        // Een vaste naam voor het script dat de gastheer insluit; alles wat
        // op aanvraag komt (worker, wasm, talen) krijgt wel een hash.
        entryFileNames: '[name].js',
        chunkFileNames: 'brokken/[name]-[hash].js',
        assetFileNames: (info) => (String(info.name || '').endsWith('.mjs')
          ? 'brokken/[name]-[hash].js'
          : 'middelen/[name]-[hash][extname]'),
      },
    },
  },
});
