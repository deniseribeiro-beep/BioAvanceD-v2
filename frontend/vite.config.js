

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
    // #891/#819: the e2e stack (compose.test.yml's frontend-app-test) serves a
    // pre-built bundle through `vite preview`, not the dev server above. Preview
    // has its own host allow-list and its own default port (4173), so neither is
    // inherited from `server` and both have to be stated here.
    preview: {
      host: '0.0.0.0',
      port: 5173,
      strictPort: true,
      // Reached as frontend-app-test:5173 from inside the compose network and as
      // localhost:5173 from the host, so the allow-list cannot be enumerated.
      allowedHosts: true,
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
      },
    },
  };
});
