import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const stripPrefix =
  (prefix: string) =>
  (path: string) => {
    const rewritten = path.replace(new RegExp(`^${prefix}(?=/|$)`), '');
    return rewritten === '' ? '/' : rewritten;
  };

export default defineConfig({
  plugins: [react()],
  server: {
    allowedHosts: ['levi.taila510b.ts.net'],
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/app-server': {
        changeOrigin: false,
        rewrite: stripPrefix('/app-server'),
        target: 'ws://127.0.0.1:4222',
        ws: true,
      },
      '/sidecar': {
        changeOrigin: false,
        rewrite: stripPrefix('/sidecar'),
        target: 'ws://127.0.0.1:4230',
        ws: true,
      },
    },
  },
});
