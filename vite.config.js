import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiPort = process.env.PORT || 8787;

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // The browser only ever talks to /api on its own origin; Vite forwards it
    // to the Express server, which is the only place the API key exists.
    proxy: { '/api': `http://localhost:${apiPort}` },
  },
  test: { environment: 'node' },
});
