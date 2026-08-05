// The React plugin compiles JSX; Vite owns the frontend development and production build.
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  // Frontend paths are resolved from this subdirectory, separate from the Worker build.
  root: 'frontend',
  plugins: [react()],
  server: {
    // Local browser API calls are forwarded to the Worker Vite server on port 5173.
    proxy: {
      '/api': {
        target: 'http://localhost:5173',
        changeOrigin: true,
      },
    },
  },
  build: {
    // Cloudflare Assets uploads this reproducible directory during `npm run deploy`.
    outDir: '../dist-web',
    emptyOutDir: true,
  },
});
