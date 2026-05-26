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

// Local dev mirror of netlify/functions/alpaca.mts so `npm run dev` works.
// Reads ALPACA_* env vars from .env / .env.local via process.env.
const alpacaProxyDev = {
  name: 'alpaca-proxy-dev',
  configureServer(server: any) {
    server.middlewares.use('/api/alpaca', async (req: any, res: any) => {
      try {
        const url = new URL(req.url, 'http://localhost');
        const path = url.pathname.replace(/^\/?/, '');
        const env = (req.headers['x-alpaca-env'] ?? 'paper')
          .toString()
          .toLowerCase();
        const target = (req.headers['x-alpaca-target'] ?? 'trading')
          .toString()
          .toLowerCase();
        const isPaper = env !== 'live';
        const keyId = isPaper
          ? process.env.ALPACA_PAPER_KEY_ID
          : process.env.ALPACA_LIVE_KEY_ID;
        const secret = isPaper
          ? process.env.ALPACA_PAPER_SECRET
          : process.env.ALPACA_LIVE_SECRET;
        if (!keyId || !secret) {
          res.statusCode = 503;
          res.setHeader('content-type', 'application/json');
          res.end(
            JSON.stringify({
              error: `Alpaca ${isPaper ? 'paper' : 'live'} keys missing locally. Add ALPACA_${
                isPaper ? 'PAPER' : 'LIVE'
              }_KEY_ID and ALPACA_${
                isPaper ? 'PAPER' : 'LIVE'
              }_SECRET to .env.local`,
            }),
          );
          return;
        }
        const base =
          target === 'data'
            ? 'https://data.alpaca.markets'
            : isPaper
            ? 'https://paper-api.alpaca.markets'
            : 'https://api.alpaca.markets';
        const targetUrl = `${base}/${path}${url.search}`;
        const headers: Record<string, string> = {
          'APCA-API-KEY-ID': keyId,
          'APCA-API-SECRET-KEY': secret,
          accept: 'application/json',
        };
        if (req.headers['content-type']) {
          headers['content-type'] = req.headers['content-type'] as string;
        }
        let body: string | undefined;
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          body = await new Promise<string>((resolve) => {
            const chunks: Buffer[] = [];
            req.on('data', (c: Buffer) => chunks.push(c));
            req.on('end', () =>
              resolve(Buffer.concat(chunks).toString('utf8')),
            );
          });
        }
        const upstream = await fetch(targetUrl, {
          method: req.method,
          headers,
          body,
        });
        const text = await upstream.text();
        res.statusCode = upstream.status;
        res.setHeader(
          'content-type',
          upstream.headers.get('content-type') ?? 'application/json',
        );
        res.end(text);
      } catch (err) {
        res.statusCode = 500;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: (err as Error).message }));
      }
    });
  },
};

export default defineConfig({
  plugins: [react(), crossOriginIsolation, alpacaProxyDev],
  server: {
    host: true,
    port: 5173,
  },
  optimizeDeps: {
    exclude: ['@webcontainer/api'],
  },
});
