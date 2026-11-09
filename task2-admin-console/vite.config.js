import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// In dev, /api is proxied to the mock API on the host (docker compose up mock-api).
// In Docker, nginx does the same proxying; see nginx/default.conf.template.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Recharts is most of the bundle (~190 KB gzipped in total); one chunk is fine for an internal tool.
  build: { chunkSizeWarningLimit: 700 },
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: process.env.API_URL ?? 'http://localhost:8001',
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
});
