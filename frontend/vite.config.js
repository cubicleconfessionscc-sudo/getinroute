import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    sourcemap: true,
    minify: process.env.DIAG ? false : 'esbuild',
    chunkSizeWarningLimit: 1600
  },
  test: {
    environment: 'jsdom'
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:4000',
      '/socket.io': { target: 'http://localhost:4000', ws: true },
      '/download': 'http://localhost:4000'
    }
  }
});
