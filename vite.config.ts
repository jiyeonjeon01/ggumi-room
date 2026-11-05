/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Port plan: dev 9020 / Docker host 9021 (frontend), dev 9200 / Docker host 9201 (FastAPI, later).
  // strictPort: fail loudly instead of silently moving to another port.
  server: {
    port: 9020,
    strictPort: true,
    // Same-origin /api in development too, so cookies and CSRF behave like production.
    proxy: { '/api': 'http://localhost:9200' },
  },
  build: {
    // Phaser is large (~1MB min); keep it in its own cacheable chunk.
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        manualChunks: (id) => (id.includes('node_modules/phaser') ? 'phaser' : undefined),
      },
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
});
