import { defineConfig } from 'vite';
import solidPlugin from 'vite-plugin-solid';
import { readFileSync } from 'fs';

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));

export default defineConfig({
  plugins: [solidPlugin()],
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
        //   new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url)
        // which Vite handles as an asset import — without this, the
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
});
