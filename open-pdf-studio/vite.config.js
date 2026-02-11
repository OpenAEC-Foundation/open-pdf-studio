import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 3001,
    strictPort: true,
    host: '0.0.0.0',
    watch: {
      ignored: ['**/src-tauri/**'],
    },
    hmr: {
      protocol: 'ws',
      host: 'localhost',
      port: 3001,
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
