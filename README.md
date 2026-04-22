# WebContainer Studio

A self-hosted, bolt.new-style environment. Edits a project in-browser, runs it in a [StackBlitz WebContainer](https://webcontainers.io), pulls source from any public (or authenticated) GitHub repo, and deploys the built output straight to Netlify.

## Features

- **In-browser Node runtime** via `@webcontainer/api` — `npm install`, `npm run dev`, live HMR preview.
- **Monaco editor + file tree** for editing the mounted project.
- **Pull from GitHub** — paste a URL, `owner/repo`, or `owner/repo@branch`. Supports a personal access token for private repos / higher rate limits.
- **Deploy to Netlify** — runs `npm run build`, picks up `dist/` / `build/` / `out/` / `public/`, zips it, uploads via the Netlify API. Creates a new site or deploys to an existing `site_id`.
- **Integrated terminal** streams container stdout/stderr.

## Running locally

```bash
npm install
npm run dev
```

Open http://localhost:5173. The dev server sets the `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy` headers WebContainer requires.

## Notes

- WebContainer only boots on pages that are cross-origin isolated. If you host this elsewhere, replicate the COOP/COEP headers from `vite.config.ts`.
- Tokens (GitHub, Netlify) are stored in `localStorage` in the user's browser. They never leave the client.
- The starter template is a minimal Vite + React app; overwrite it by pulling any GitHub repo.
