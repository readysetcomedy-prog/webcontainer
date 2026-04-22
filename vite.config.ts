import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const crossOriginIsolation = {
  name: 'cross-origin-isolation',
  configureServer(server: any) {
    server.middlewares.use((_req: any, res: any, next: any) => {
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
      res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
      next();
    });
  },
  configurePreviewServer(server: any) {
    server.middlewares.use((_req: any, res: any, next: any) => {
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
      res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
      next();
    });
  },
};

export default defineConfig({
  plugins: [react(), crossOriginIsolation],
  server: {
    host: true,
    port: 5173,
  },
  optimizeDeps: {
    exclude: ['@webcontainer/api'],
  },
});
