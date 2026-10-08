import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const backend = process.env.BACKEND_URL || 'http://127.0.0.1:8000';
// changeOrigin: false — Django сверяет Origin с Host для защиты от CSRF.
const proxy = { target: backend, changeOrigin: false };

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': proxy, '/admin': proxy, '/django-static': proxy },
  },
});
