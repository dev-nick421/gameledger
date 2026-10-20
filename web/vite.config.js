import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// Dev server proxies API + WebSocket to the Express service so the browser only
// ever talks to one origin (matches the nginx prod setup).
export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
      '/ws': { target: 'ws://localhost:3000', ws: true },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
  },
});
