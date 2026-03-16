import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    allowedHosts: ['levi.taila510b.ts.net'],
    host: '0.0.0.0',
    port: 5173,
  },
});
