

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig(async () => {
  const hmrHost = process.env.VITE_HMR_HOST || 'localhost';
  const hmrProtocol = process.env.VITE_HMR_PROTOCOL || 'ws';
  const hmrClientPort = Number(process.env.VITE_HMR_CLIENT_PORT || 5173);
  return {
    plugins: [react()],
    server: {
      host: '0.0.0.0',
      port: 5173,
      strictPort: true,
      allowedHosts: true,
      hmr: {
        host: hmrHost,
        protocol: hmrProtocol,
        clientPort: hmrClientPort,
      },
      watch: {
        usePolling: true,
        interval: 300,
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
      },
    },
  };
});
