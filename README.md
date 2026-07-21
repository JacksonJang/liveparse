# LiveParse

LiveParse is a local-first JSON parser for validating, formatting, minifying, and exploring JSON directly in the browser. The production site is available at [liveparse.com](https://liveparse.com/).

## Features

- JSON parsing as you type in the browser
- Strict JSON validation with line and column context when available
- Side-by-side and top-bottom layouts
- Two-space or four-space formatting and minified output
- Syntax highlighting and text/tree output modes
- Tree view with collapsible objects/arrays
- Local file input, output copying, and JSON download
- Optional type labels, array indexes, and sample payloads
- No server-side JSON processing; pasted data remains local to the browser
- Crawlable JSON reference content and three in-depth guides

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

The build includes an SEO smoke check. The production server listens on `http://localhost:4173`, enforces the canonical `https://liveparse.com` host behind Cloudflare, returns real 404 responses, and applies production cache and security headers.

Run the SEO checks again without rebuilding:

```bash
npm run check:seo
```

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

For a temporary Vite preview without canonical-host redirects, run `npm run preview:vite` before starting the quick tunnel:

```bash
npm run build
npm run preview:vite
npm run tunnel:quick
```
