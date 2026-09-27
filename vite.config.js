import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { watch: { usePolling: true, interval: 200 } },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000, assetsInlineLimit: 0 },
});
