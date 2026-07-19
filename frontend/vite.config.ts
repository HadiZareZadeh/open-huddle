import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';
import path from 'path';

const lanHttps = process.env.LAN_HTTPS === 'true';

export default defineConfig({
  plugins: [react(), ...(lanHttps ? [basicSsl()] : [])],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    https: lanHttps,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: process.env.NODE_ENV !== 'production',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (
            id.includes('@tensorflow-models/body-pix') ||
            id.includes('@tensorflow/tfjs')
          ) {
            return 'body-pix';
          }
        },
      },
    },
  },
});
