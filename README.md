# LiveParse

LiveParse is a local-first JSON parser for validating, formatting, and exploring JSON directly in the browser.

## Features

- JSON parsing as you type in the browser
- Parse JSON / Eval JSON modes
- Side-by-side and top-bottom layouts
- Minify toggle
- Syntax colorizing toggle
- Tree view with collapsible objects/arrays
- Optional array indexes and sample JSON payloads
- No server-side JSON processing; pasted data remains local to the browser

## Local run

```bash
npm install
npm run dev
```

Open `http://localhost:5173`.

## Production preview

```bash
npm run build
npm run preview
```

Preview serves the built app at `http://localhost:4173`.

## Cloudflare Tunnel deployment for liveparse.com

This project can be served from a local machine through Cloudflare Tunnel (`cloudflared`).

Prerequisites:

1. `cloudflared` installed (`brew install cloudflared`)
2. `liveparse.com` added to the same Cloudflare account you log in with
3. DNS for `liveparse.com` managed by Cloudflare

One-time setup:

```bash
chmod +x scripts/setup-cloudflare-tunnel.sh
scripts/setup-cloudflare-tunnel.sh liveparse.com
```

That script logs in to Cloudflare if needed, creates/reuses a named tunnel called `liveparse`, routes `liveparse.com` to it, and writes `cloudflared/config.yml` locally. The generated config is intentionally gitignored because it contains a machine-specific credentials path.

Run deployment locally:

```bash
npm run build
npm run preview
npm run tunnel:liveparse
```

For a temporary public URL without custom domain DNS:

```bash
npm run build
npm run preview
npm run tunnel:quick
```
