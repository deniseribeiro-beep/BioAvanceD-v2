import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
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
    commonjsOptions: {
      include: [/xlsx/, /node_modules/],
    },
  },
})
