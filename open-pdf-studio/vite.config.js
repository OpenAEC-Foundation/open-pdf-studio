import { defineConfig } from 'vite';
import { uiScaleCss } from './scripts/ui-scale-css.mjs';
import solidPlugin from 'vite-plugin-solid';
import { pdfjsPostscriptProgress } from './scripts/pdfjs-postscript-progress.mjs';
import { pdfjsAssets } from './scripts/pdfjs-assets.mjs';
import { readFileSync } from 'fs';
import { pdfjsWorkerOudeWebview, voorafScriptPlugin } from './scripts/oude-webview.mjs';
import { gehostHtmlPlugin } from './scripts/gehost-html.mjs';
import { webAliassen } from './scripts/web-bouw.mjs';
import { fileURLToPath } from 'url';

const APP = fileURLToPath(new URL('.', import.meta.url));

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));

// Het script vóór de app-boot (thema, opstartdiagnose) staat in een eigen
// bestand, geen inline script: de Android-WebView weigert inline scripts
// (#596). De PDF.js-worker wordt omgezet voor oudere WebViews. Zie
// scripts/oude-webview.mjs. In de gehoste bouw (--mode hosted) krijgt
// index.html daarna SRI en geen inline code, voor een strikte CSP (#693,
// scripts/gehost-html.mjs); de desktopbouw blijft gelijk. In elke webbouw
// (gehost of OPDS_WEB_BUILD=1) krijgen desktopmodules als de sleepplugin een
// lege vervanger (#776, scripts/web-bouw.mjs).
export default defineConfig(({ mode }) => ({
  css: { postcss: { plugins: [uiScaleCss()] } },
  plugins: [solidPlugin(), pdfjsAssets(), voorafScriptPlugin(), pdfjsPostscriptProgress(), pdfjsWorkerOudeWebview(), gehostHtmlPlugin()],
  resolve: {
    alias: [
      // PDF.js 6's modern build calls Map.prototype.getOrInsertComputed and
      // other recent APIs without fallbacks; the WebViews on older macOS and
      // Linux lack them. The legacy build ships the polyfills.
      { find: /^pdfjs-dist$/, replacement: 'pdfjs-dist/legacy/build/pdf.mjs' },
      ...webAliassen(APP, mode),
    ],
  },
  define: {
    '__APP_VERSION__': JSON.stringify(pkg.version),
  },
  server: {
    port: 3041,
    strictPort: true,
    host: '0.0.0.0',
    fs: {
      // Sta /@fs/-requests binnen de hele repo toe (dev-project + workspace-
      // crates). Zonder dit weigert Vite o.a. de PDF.js-worker-URL met 403 in
      // een verse webview — het document laadt dan nooit (zie js/pdf/loader.js).
      allow: ['..'],
    },
    watch: {
      ignored: ['**/src-tauri/**'],
    },
    hmr: {
      protocol: 'ws',
      host: 'localhost',
      port: 3041,
    },
  },
  optimizeDeps: {
    exclude: ['mupdf'],
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 6000,
    rollupOptions: {
      output: {
        // Force .js extensions on entry chunks and dynamic-import chunks
        // so the web host serves them with the correct MIME type
        // (some hosts return application/octet-stream for .mjs).
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        // Same treatment for assets, but ONLY for .mjs files (don't touch
        // CSS, images, fonts, etc). PDF.js's worker is loaded via
        //   virtual:opds-pdfjs-worker-url (scripts/pdfjs-postscript-progress.mjs)
        // is emitted as an asset — without this, the
        // worker is emitted as `pdf.worker-HASH.mjs` and the web build
        // can't fetch it.
        assetFileNames: (assetInfo) => {
          const name = assetInfo.name || '';
          if (name.endsWith('.mjs')) {
            return 'assets/[name]-[hash].js';
          }
          return 'assets/[name]-[hash][extname]';
        },
      },
    },
  },
}));
