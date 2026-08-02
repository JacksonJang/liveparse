# LiveParse

LiveParse is a local-first, lossless JSON toolkit for validating, formatting, repairing, and exploring data directly in the browser. Unlike a `JSON.parse()`/`JSON.stringify()` pipeline, it preserves the original numeric lexemes and duplicate object members instead of silently changing them. The production site is available at [liveparse.com](https://liveparse.com/).

## Features

- Lossless AST parsing that preserves 64-bit IDs, exponent notation, trailing zeroes, member order, and duplicate keys
- Strict JSON validation with line and column context
- Warnings for unsafe JavaScript integers, exponent overflow, number representation changes, and duplicate keys
- Debounced Web Worker parsing so large inputs stay off the main UI thread
- Side-by-side and top-bottom layouts
- Two-space or four-space formatting and minified output
- Syntax highlighting and a virtualized tree for large documents
- Key/value search, expand/collapse all, selected-node copy, JSONPath copy, and JSON Pointer copy
- A dedicated JSON Repair tool with before/after diff, confidence, assumptions, and a detailed change log
- A dedicated JSONL/NDJSON parser with line-level diagnostics, filtering, a paged table, and safe CSV export
- Local file input, output copying, and JSON download
- Optional type labels, array indexes, and sample payloads
- No server-side JSON processing; pasted data remains local to the browser
- No advertising, affiliate widgets, analytics, or optional third-party cookies in the current build
- Crawlable, independent tool pages, a privacy notice, and three in-depth guides

## Local run

```bash
npm install
npm run dev
```

Open `http://localhost:5173`.

The main routes are `/`, `/ko/json-parser/`, `/json-repair/`, `/jsonl-parser/`, and `/privacy/`.

Run the parser and UI utility tests with:

```bash
npm test
```

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
