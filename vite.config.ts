import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0', // Permite acesso de outros dispositivos na rede
    port: 5173,
    strictPort: false, // Permite usar outra porta se 5173 estiver ocupada
    fs: {
      strict: false, // Permite acesso a arquivos fora da raiz do projeto
    },
    hmr: {
      overlay: true, // Mostra erros na tela
    },
    headers: {
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-cache',
    },
  },
  optimizeDeps: {
    include: ['qrcode', 'socket.io-client'],
  },
  build: {
    target: 'es2020',
    sourcemap: false,
  },
  // Configure MIME types for TypeScript files
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (req.url?.endsWith('.ts') || req.url?.endsWith('.tsx')) {
        res.setHeader('Content-Type', 'text/x-typescript; charset=utf-8');
      }
      next();
    });
  },
})
