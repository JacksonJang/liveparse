# LiveParse

**Free developer tools that never upload your data.** Format JSON, SQL, YAML, and XML; test regular expressions; calculate business days, ages, and timestamps; compress images; encode Base64 and URLs; hash files; generate UUIDs; decode JWTs; translate Morse code. Every tool runs inside your browser tab, so pasted data and selected files stay on your machine.

### → [liveparse.com](https://liveparse.com/)

No account, no advertising, no analytics cookies, no upload endpoint.

## Tools

| | |
| --- | --- |
| **JSON** | [Formatter & viewer](https://liveparse.com/json-formatter/) · [Compare](https://liveparse.com/json-compare/) · [Repair](https://liveparse.com/json-repair/) · [JSONL](https://liveparse.com/jsonl-parser/) · [to CSV](https://liveparse.com/json-to-csv/) · [from CSV](https://liveparse.com/csv-to-json/) |
| **YAML & XML** | [YAML formatter](https://liveparse.com/yaml-formatter/) · [YAML to JSON](https://liveparse.com/yaml-to-json/) · [XML formatter](https://liveparse.com/xml-formatter/) · [XML validator](https://liveparse.com/xml-validator/) |
| **SQL** | [Formatter for 15 dialects](https://liveparse.com/sql-formatter/) |
| **Regex** | [Tester & debugger](https://liveparse.com/regex-tester/) |
| **Dates & time** | [Business days](https://liveparse.com/business-days-calculator/) · [Unix timestamp](https://liveparse.com/unix-timestamp-converter/) · [Discord timestamp](https://liveparse.com/discord-timestamp-generator/) · [Age](https://liveparse.com/age-calculator/) · [Week number](https://liveparse.com/week-number-calculator/) |
| **Encoding** | [Base64](https://liveparse.com/base64-decoder/) · [URL](https://liveparse.com/url-encoder/) · [Binary & hex](https://liveparse.com/binary-converter/) · [ASCII table](https://liveparse.com/ascii-table/) · [Morse code](https://liveparse.com/morse-code-translator/) |
| **Security** | [Hashes](https://liveparse.com/hash-generator/) · [File checksum](https://liveparse.com/file-checksum/) · [UUIDs](https://liveparse.com/uuid-generator/) · [JWT decoder](https://liveparse.com/jwt-decoder/) |
| **Images & text** | [Batch compressor](https://liveparse.com/image-compressor/) · [Resizer](https://liveparse.com/image-resizer/) · [Word counter](https://liveparse.com/word-counter/) · [Character counter](https://liveparse.com/character-counter/) |
| **Reading** | [Guides](https://liveparse.com/guides/) · [About](https://liveparse.com/about/) · [Privacy](https://liveparse.com/privacy/) |

## What makes it different

- **Lossless JSON.** 64-bit IDs, exponent notation, trailing zeroes, member order, and duplicate keys survive formatting instead of being silently rewritten by `JSON.parse`.
- **Nothing is uploaded.** There is no formatter API or database behind the tools. Heavy work runs in disposable Web Workers with explicit size and time limits.
- **Honest limits.** Each tool states what it does not do: no JWT signature verification, no XML schema validation, no guessed Morse spacing, no silent target-size failures.
- **Standards first.** Tools cite the RFC, W3C, WHATWG, ECMA, or ITU document they implement.

## In detail

LiveParse is a local-first developer data toolkit for validating, formatting, comparing, repairing, generating, encoding, decoding, converting, calculating, and exploring data directly in the browser. Its JSON tools preserve original numeric lexemes and duplicate object members instead of silently changing them, its YAML tools format, validate syntax, display a non-expanding tree, and convert between YAML and JSON with explicit type and alias policies, its SQL tools format fifteen database dialects in a time-bounded Web Worker without executing queries, and its XML tools format, check well-formedness, and build a safe text-only tree in a disposable worker without external DTD or schema retrieval. Its regex tester highlights ordered matches, inspects capture groups, previews JavaScript replacements, and terminates a backtracking-heavy worker after one second before it can freeze the tab. Its URL tools distinguish component, full-URI, RFC 3986, and form encoding; strictly decode one intentional round; inspect WHATWG URL components; and preserve ordered duplicate query fields. Its timestamp tools cover exact epoch conversion and timezone-aware Discord timestamp generation, its calendar tools calculate ages, date differences, business days, clock durations, ISO week numbers, and birthday countdowns without timezone-dependent date-only math, its image tools resize, compress, and convert supported static images locally, its Base64 tools handle text, files, Base64URL, and Data URLs with RFC diagnostics, and its number and byte tools convert arbitrary-precision integers, interpret explicit-width two's complement, translate strict UTF-8 bytes, and expose the complete 7-bit ASCII table. Its hash and checksum tools calculate SHA-256, SHA-384, SHA-512, and legacy MD5 digests from UTF-8 text or exact file bytes, its UUID tools generate RFC 9562 UUID v4 and v7 values, inspect versions 1 through 8, and decode the standard fields defined for v1, v6, and v7, and its JWT tools decode strict compact JWS input while keeping cryptographic verification separate.

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
- Separate Binary Converter, Hex Converter, Binary Translator, and ASCII Table pages with arbitrary-precision integer conversion, explicit-width two's complement, strict UTF-8 byte translation, and all 128 standard ASCII entries
- A bidirectional International Morse Code Translator with explicit token separators, strict diagnostics, and a standards-based reference guide
- Separate Image Compressor, Image Resizer, PNG-to-JPG, WebP-to-JPG, and WebP-to-PNG tools with local static-image decoding, explicit format and transparency tradeoffs, and honest file-size reporting
- Eight calendar utilities for exact age, age on a reference date, date addition and subtraction, elapsed days, configurable business days, clock-time duration, ISO week numbers, and birthday countdowns
- Date-only calculations use pure proleptic Gregorian integer arithmetic for years 0001 through 9999, with explicit month-end, leap-day, endpoint, weekend, and overnight policies instead of hidden timezone conversions
- Locale-aware Word Counter and Unicode Character Counter pages, with an English interface and multilingual Unicode input support
- Separate URL Encoder, URL Decoder, URL Parser, and Query String Parser pages with component, RFC 3986, full-URI, and form modes; strict percent-escape and UTF-8 diagnostics; WHATWG serialization; IDN and credential warnings; and lossless ordered query-pair output
- URL encoding, decoding, and query input is capped at 200,000 UTF-16 code units, URL and optional base input at 32,768 code units each, and parsed query output at 10,000 non-empty fields
- Separate Hash Generator, SHA-256 Generator, MD5 Generator, and File Checksum pages with SHA-256, SHA-384, SHA-512, and legacy MD5; UTF-8 text or exact file-byte hashing, hex/Base64 output, and expected-digest comparison all run locally in the browser
- Hash text is capped at 5,000,000 UTF-16 code units and hash files at 64 MiB because browser digest processing buffers the complete input in memory
- Dedicated UUID v4 and v7 generation with browser CSPRNG, monotonic v7 batches, GUID-compatible text formatting, bulk export, strict or normalized validation, version 1-8 and variant inspection, Nil and Max detection, raw-byte views, and v1, v6, or v7 timestamp decoding
- Strict local JWT decoding with unpadded Base64URL validation, fatal UTF-8, lossless JSON numbers, duplicate claim diagnostics, signature-not-verified status, and exact exp/nbf/iat evaluation
- SQL formatting for Standard SQL, MySQL, MariaDB, PostgreSQL, SQLite, SQL Server, BigQuery, Snowflake, Redshift, Oracle PL/SQL, DuckDB, ClickHouse, Spark, Trino, and DB2, with an exact-pinned engine, explicit layout controls, a 50,000-character cap, and a two-second disposable-worker watchdog
- Separate XML formatter, well-formedness validator, and tree viewer pages with namespace, comment, CDATA, processing-instruction, depth, node, input, output, and time safeguards in a disposable browser worker
- Separate YAML formatter, syntax validator, tree viewer, YAML-to-JSON converter, and JSON-to-YAML converter pages with YAML 1.1/1.2 selection, exact JSON number tokens, bounded aliases, explicit lossy-conversion warnings, and disposable-worker limits
- Local file input, output copying, and JSON download
- Optional type labels, array indexes, and sample payloads
- No server-side tool-input processing; pasted JSON, YAML, XML, SQL, URLs, query strings, tokens, identifiers, hashes, checksums, calendar inputs, and files remain local to the browser
- No advertising, affiliate widgets, client-side analytics, or optional third-party cookies in the current build
- Cookie-free daily search-referral aggregates on the primary server, storing only search engine and landing-page counts
- Cookie-free claimed-crawler aggregates on the primary server, storing only observed KST hour buckets and crawler/canonical-page counts without raw User-Agent strings, IP addresses, or referrers
- Crawlable, independent tool pages, an `/about/` brand page, a privacy notice, and a topic-indexed `/guides/` hub for in-depth guides
- Brand identity assets for search and browsers: `favicon.ico` (48/32/16), `favicon.svg`, `apple-touch-icon.png`, `icon-192.png`, `icon-512.png`, `site.webmanifest`, plus `Organization` and `WebSite` structured data with `alternateName` spellings (Liveparse, Live Parse)

## Local run

```bash
npm install
npm run dev
```

Open `http://localhost:5173`.

The main routes include `/` (the tool hub), `/json-formatter/`, `/json-compare/`, `/json-repair/`, `/jsonl-parser/`, `/json-to-csv/`, `/csv-to-json/`, `/unix-timestamp-converter/`, `/discord-timestamp-generator/`, `/age-calculator/`, `/age-calculator-on-specific-date/`, `/date-calculator/`, `/days-between-dates/`, `/business-days-calculator/`, its `/N-business-days-from-today/` landing pages, `/time-duration-calculator/`, `/week-number-calculator/`, `/birthday-countdown/`, `/base64-decoder/`, `/base64-encoder/`, `/binary-converter/`, `/hex-converter/`, `/binary-translator/`, `/ascii-table/`, `/morse-code-translator/`, `/morse-code-alphabet/`, `/image-compressor/`, `/image-resizer/`, `/png-to-jpg/`, `/webp-to-jpg/`, `/webp-to-png/`, `/word-counter/`, `/character-counter/`, `/url-encoder/`, `/url-decoder/`, `/url-parser/`, `/query-string-parser/`, `/hash-generator/`, `/sha256-generator/`, `/md5-generator/`, `/file-checksum/`, `/uuid-generator/`, `/uuid-v4-generator/`, `/uuid-v7-generator/`, `/uuid-validator/`, `/uuid-decoder/`, `/jwt-decoder/`, `/jwt-expiration-checker/`, `/sql-formatter/`, its dialect-specific formatter pages, `/xml-formatter/`, `/xml-validator/`, `/xml-viewer/`, `/yaml-formatter/`, `/yaml-validator/`, `/yaml-viewer/`, `/yaml-to-json/`, `/json-to-yaml/`, `/about/`, and `/privacy/`. The topic-indexed `/guides/` hub links the calendar, text measurement, image, Morse code, number-base, binary, ASCII, URL, UUID, hashing, format, timestamp, and security guides.

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

## English search migration (September 2026)

All public interfaces and search metadata use English. Former Korean, Japanese, and Spanish tool URLs permanently redirect (HTTP 308) to the corresponding English tools, including slashless URLs, `index.html`, and historical Spanish aliases. Keep these redirects for at least a year, and preferably indefinitely for old links. Unicode input and locale-aware text segmentation remain supported.

Search branding uses the existing logo: a stable `/icon-192.png` PNG declaration, `/favicon.ico`, `/favicon.svg`, app icons, and the organization's 512px logo. `npm run check:public-seo` now checks English metadata for every sitemap page plus legacy redirects and image responses. Claimed Googlebot user agents test access only; they do not prove that Google has crawled or indexed a page.

For staged verification without changing the running production build:

```bash
npx tsc -b
npx vite build --outDir /tmp/liveparse-release
node scripts/check-yaml-bundle-isolation.mjs /tmp/liveparse-release
node scripts/prepare-sites-build.mjs /tmp/liveparse-release
node scripts/check-seo.mjs /tmp/liveparse-release
DIST_DIR=/tmp/liveparse-release PORT=4182 SEARCH_REFERRAL_DIR=/tmp/liveparse-qa-referrals SEARCH_CRAWLER_DIR=/tmp/liveparse-qa-crawlers node scripts/serve-production.mjs
```

Check that server with `node scripts/check-public-seo.mjs http://127.0.0.1:4182` and `node scripts/check-search-branding.mjs http://127.0.0.1:4182`. The checkers send the canonical forwarded host and scheme. Promote the verified build and restart the existing Node process before checking the public site; do not create another Cloudflare tunnel.

After release, use the verified `liveparse.com` property in Google Search Console:

1. Submit `https://liveparse.com/sitemap.xml` in Sitemaps.
2. Inspect `https://liveparse.com/` and `https://liveparse.com/json-formatter/`, test their live URLs, and request indexing. The home page is the discovery point for the search favicon.
3. Export Search results performance for the 28 days before release. After 28 complete post-release days, export the matching search type, country and device filters; compare with `npm run report:search-console -- /path/to/new-export.zip --compare /path/to/baseline-export.zip`. Review JSON query impressions, clicks, CTR, and average position, plus indexing of the final English URLs. Keep raw exports outside the repository.

Search Console login is required for submissions and performance exports. Indexing, English title selection, favicon display, and rankings are controlled by Google and may change over days or weeks; code deployment is not proof of their completion. Do not use the general Indexing API, IndexNow, or WebSub as a substitute for Google URL inspection.
