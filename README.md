# LiveParse

LiveParse is a local-first developer data toolkit for validating, formatting, comparing, repairing, generating, encoding, decoding, converting, and exploring data directly in the browser. Its JSON tools preserve original numeric lexemes and duplicate object members instead of silently changing them, its YAML tools format, validate syntax, display a non-expanding tree, and convert between YAML and JSON with explicit type and alias policies, its SQL tools format fifteen database dialects in a time-bounded Web Worker without executing queries, and its XML tools format, check well-formedness, and build a safe text-only tree in a disposable worker without external DTD or schema retrieval. Its timestamp tools cover exact epoch conversion and timezone-aware Discord timestamp generation, its Base64 tools handle text, files, Base64URL, and Data URLs with RFC diagnostics, its hash and checksum tools calculate SHA-256, SHA-384, SHA-512, and legacy MD5 digests from UTF-8 text or exact file bytes, its UUID tools generate RFC 9562 UUID v4 and v7 values, inspect versions 1 through 8, and decode the standard fields defined for v1, v6, and v7, and its JWT tools decode strict compact JWS input while keeping cryptographic verification separate. The production site is available at [liveparse.com](https://liveparse.com/).

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
- A lossless Unix timestamp converter for epoch seconds, milliseconds, microseconds, and nanoseconds
- A Discord timestamp generator with all nine current styles, IANA timezones, DST diagnostics, tag decoding, and unit warnings
- Separate Base64 decoder and encoder pages with strict canonical validation, Base64URL conversion, local file handling, Data URLs, UTF-8/hex output, and safe raster previews
- Separate Hash Generator, SHA-256 Generator, MD5 Generator, and File Checksum pages with SHA-256, SHA-384, SHA-512, and legacy MD5; UTF-8 text or exact file-byte hashing, hex/Base64 output, and expected-digest comparison all run locally in the browser
- Hash text is capped at 5,000,000 UTF-16 code units and hash files at 64 MiB because browser digest processing buffers the complete input in memory
- Dedicated UUID v4 and v7 generation with browser CSPRNG, monotonic v7 batches, GUID-compatible text formatting, bulk export, strict or normalized validation, version 1-8 and variant inspection, Nil and Max detection, raw-byte views, and v1, v6, or v7 timestamp decoding
- Strict local JWT decoding with unpadded Base64URL validation, fatal UTF-8, lossless JSON numbers, duplicate claim diagnostics, signature-not-verified status, and exact exp/nbf/iat evaluation
- SQL formatting for Standard SQL, MySQL, MariaDB, PostgreSQL, SQLite, SQL Server, BigQuery, Snowflake, Redshift, Oracle PL/SQL, DuckDB, ClickHouse, Spark, Trino, and DB2, with an exact-pinned engine, explicit layout controls, a 50,000-character cap, and a two-second disposable-worker watchdog
- Separate XML formatter, well-formedness validator, and tree viewer pages with namespace, comment, CDATA, processing-instruction, depth, node, input, output, and time safeguards in a disposable browser worker
- Separate YAML formatter, syntax validator, tree viewer, YAML-to-JSON converter, and JSON-to-YAML converter pages with YAML 1.1/1.2 selection, exact JSON number tokens, bounded aliases, explicit lossy-conversion warnings, and disposable-worker limits
- Local file input, output copying, and JSON download
- Optional type labels, array indexes, and sample payloads
- No server-side tool-input processing; pasted JSON, YAML, XML, SQL, tokens, identifiers, hashes, checksums, and files remain local to the browser
- No advertising, affiliate widgets, client-side analytics, or optional third-party cookies in the current build
- Cookie-free daily search-referral aggregates on the primary server, storing only search engine and landing-page counts
- Cookie-free claimed-crawler aggregates on the primary server, storing only observed KST hour buckets and crawler/canonical-page counts without raw User-Agent strings, IP addresses, or referrers
- Crawlable, independent tool pages, a privacy notice, and a topic-indexed `/guides/` hub for in-depth guides

## Local run

```bash
npm install
npm run dev
```

Open `http://localhost:5173`.

The main routes include `/`, `/json-compare/`, `/json-repair/`, `/jsonl-parser/`, `/json-to-csv/`, `/csv-to-json/`, `/unix-timestamp-converter/`, `/discord-timestamp-generator/`, `/base64-decoder/`, `/base64-encoder/`, `/hash-generator/`, `/sha256-generator/`, `/md5-generator/`, `/file-checksum/`, `/uuid-generator/`, `/uuid-v4-generator/`, `/uuid-v7-generator/`, `/uuid-validator/`, `/uuid-decoder/`, `/jwt-decoder/`, `/jwt-expiration-checker/`, `/sql-formatter/`, its dialect-specific formatter pages, `/xml-formatter/`, `/xml-validator/`, `/xml-viewer/`, `/yaml-formatter/`, `/yaml-validator/`, `/yaml-viewer/`, `/yaml-to-json/`, `/json-to-yaml/`, `/ko/json-parser/`, and `/privacy/`. The topic-indexed `/guides/` hub links the UUID, hashing, format, timestamp, and security guides.

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

Report recent search-engine referral landing visits (an aggregate operational metric, not unique visitors or Search Console clicks):

```bash
npm run report:search-referrals -- 30
```

Report the production process heartbeat and requests whose User-Agent claims a recognized search crawler:

```bash
npm run report:search-crawlers -- 30
```

An observed heartbeat means only that the primary Node production process recorded that KST hour; it does not prove site uptime, crawling, or indexing. `UNOBSERVED` means that no aggregate was recorded for that day, not that the request count was zero. Crawler names come from unverified, spoofable User-Agent claims, so the report is neither authenticated crawler identity data nor Search Console data. It stores only hourly observation buckets plus crawler and canonical-page counts, without raw User-Agent strings, IP addresses, or referrers.

After a successful build, optionally submit changed canonical URLs to IndexNow:

```bash
npm run submit:indexnow
```

This submission is not part of the build. The first successful run submits every canonical sitemap URL; later runs use local built-HTML hash state to submit only changed or removed URLs, skip the request when nothing changed, and advance the state only after a successful IndexNow response.

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
