

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig(async () => {
  const enableCoverage = process.env.VITE_COVERAGE === 'true';
  const hmrHost = process.env.VITE_HMR_HOST || 'localhost';
  const hmrProtocol = process.env.VITE_HMR_PROTOCOL || 'ws';
  const hmrClientPort = Number(process.env.VITE_HMR_CLIENT_PORT || 5173);
  let istanbulPlugin = null;
  if (enableCoverage) {
    const mod = await import('vite-plugin-istanbul');
    istanbulPlugin = mod.default({
      include: 'src/*',
      extension: ['.js', '.jsx', '.ts', '.tsx'],
      cypress: false,
      requireEnv: false
    });
  }
  return {
    plugins: [
      react(),
      ...(istanbulPlugin ? [istanbulPlugin] : [])
    ],
    server: {
      host: '0.0.0.0',
      allowedHosts: ['frontend-test'],
      port: 5173,
      strictPort: true,
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
