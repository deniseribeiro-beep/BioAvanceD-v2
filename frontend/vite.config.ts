import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

const pollingInterval = Number(process.env.CHOKIDAR_INTERVAL || '300');
const usePolling = process.env.CHOKIDAR_USEPOLLING === 'true';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  plugins: [
    react(),

    // Plugin que ajusta o MIME para arquivos TS/TSX
    {
      name: 'set-ts-mime-type',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url?.endsWith('.ts') || req.url?.endsWith('.tsx')) {
            res.setHeader('Content-Type', 'text/x-typescript; charset=utf-8');
          }
          next();
        });
      }
    }
  ],

  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: false,
    fs: { strict: false },
    hmr: { overlay: true },
    watch: {
      usePolling,
      interval: pollingInterval
    },
    proxy: {
      '/api': {
        target: process.env.VITE_PROXY_TARGET || 'http://localhost:3000',
        changeOrigin: true,
        secure: false
      }
    },
    headers: {
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-cache',
    },
  },

  optimizeDeps: {
    include: ['qrcode', 'socket.io-client', 'xlsx'],
  },

  build: {
    target: 'es2020',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return;

          if (id.includes('react-dom') || id.includes('react/jsx-runtime') || id.includes('/react/')) {
            return 'vendor-react';
          }

          if (id.includes('react-router-dom') || id.includes('@remix-run/router')) {
            return 'vendor-router';
          }

          if (id.includes('xlsx')) {
            return 'vendor-xlsx';
          }

          if (id.includes('socket.io-client') || id.includes('engine.io-client')) {
            return 'vendor-realtime';
          }

          if (id.includes('qrcode') || id.includes('html5-qrcode') || id.includes('react-barcode')) {
            return 'vendor-qr';
          }

          if (id.includes('date-fns') || id.includes('axios') || id.includes('lucide-react')) {
            return 'vendor-utils';
          }
        },
      },
    },
    commonjsOptions: {
      include: [/xlsx/, /node_modules/],
    },
  },
})
