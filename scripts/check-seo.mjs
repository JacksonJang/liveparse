#!/usr/bin/env node

import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseXml } from '@rgrove/parse-xml';

const CANONICAL_ORIGIN = 'https://liveparse.com';
const ATOM_NAMESPACE = 'http://www.w3.org/2005/Atom';
const ATOM_FEED_URL = `${CANONICAL_ORIGIN}/feed.xml`;
const ATOM_FEED_TITLE = 'LiveParse Developer Tool Updates';
const ATOM_HUB_URL = 'https://pubsubhubbub.appspot.com/';
const XML_SITEMAP_URL = `${CANONICAL_ORIGIN}/sitemap.xml`;
const EXPECTED_ROBOTS_SITEMAPS = new Set([XML_SITEMAP_URL, ATOM_FEED_URL]);
const RFC3339_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;
const PROJECT_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DIST_ROOT = resolve(process.argv[2] || process.env.DIST_DIR || join(PROJECT_ROOT, 'dist'));
const failures = [];
const FAQ_PARITY_PATHS = new Set([
  '/hash-generator/',
  '/sha256-generator/',
  '/md5-generator/',
  '/file-checksum/',
  '/guides/sha256-vs-md5/',
  '/guides/hash-vs-encryption/',
  '/guides/how-to-verify-file-checksum/',
  '/guides/hashing-utf8-newlines/',
  '/url-encoder/',
  '/url-decoder/',
  '/url-parser/',
  '/query-string-parser/',
  '/guides/url-percent-encoding/',
  '/guides/encodeuri-vs-encodeuricomponent/',
  '/guides/percent20-vs-plus/',
  '/guides/double-url-encoding/',
  '/binary-converter/',
  '/hex-converter/',
  '/binary-translator/',
  '/ascii-table/',
  '/morse-code-translator/',
  '/image-compressor/',
  '/image-resizer/',
  '/png-to-jpg/',
  '/webp-to-jpg/',
  '/webp-to-png/',
  '/age-calculator/',
  '/age-calculator-on-specific-date/',
  '/date-calculator/',
  '/days-between-dates/',
  '/business-days-calculator/',
  '/time-duration-calculator/',
  '/week-number-calculator/',
  '/birthday-countdown/',
  '/guides/calendar-date-arithmetic-dst-leap-years/',
  '/word-counter/',
  '/character-counter/',
  '/es/contador-de-palabras/',
  '/es/contador-de-caracteres/',
  '/ja/character-counter/',
  '/ko/character-counter/',
  '/guides/how-word-counting-works/',
  '/guides/grapheme-clusters-vs-code-points-and-bytes/',
  '/guides/international-morse-code/',
  '/guides/image-compression-formats-and-file-size/',
  '/guides/binary-decimal-hex-octal-conversion/',
  '/guides/twos-complement-signed-binary/',
  '/guides/ascii-vs-unicode-utf8/',
  '/uuid-v4-generator/',
  '/uuid-decoder/',
  '/guides/uuid-versions-explained/',
  '/guides/uuid-collision-probability/',
  '/yaml-to-json/',
  '/guides/yaml-1-1-vs-1-2/',
  '/guides/yaml-to-json-types/',
  '/guides/yaml-anchors-aliases-merge-keys/',
  '/guides/common-yaml-errors/',
  '/2-business-days-from-today/',
  '/3-business-days-from-today/',
  '/4-business-days-from-today/',
  '/5-business-days-from-today/',
  '/7-business-days-from-today/',
  '/10-business-days-from-today/',
  '/14-business-days-from-today/',
  '/15-business-days-from-today/',
  '/20-business-days-from-today/',
  '/30-business-days-from-today/',
  '/45-business-days-from-today/',
  '/morse-code-alphabet/',
]);
const requiredPages = [
  { relativePath: 'json-formatter/index.html', canonical: `${CANONICAL_ORIGIN}/json-formatter/`, label: 'JSON Formatter tool' },
  { relativePath: 'ko/json-parser/index.html', canonical: `${CANONICAL_ORIGIN}/ko/json-parser/`, label: 'Korean JSON parser' },
  { relativePath: 'json-repair/index.html', canonical: `${CANONICAL_ORIGIN}/json-repair/`, label: 'JSON Repair tool' },
  { relativePath: 'jsonl-parser/index.html', canonical: `${CANONICAL_ORIGIN}/jsonl-parser/`, label: 'JSONL Parser tool' },
  { relativePath: 'json-compare/index.html', canonical: `${CANONICAL_ORIGIN}/json-compare/`, label: 'JSON Compare tool' },
  { relativePath: 'json-to-csv/index.html', canonical: `${CANONICAL_ORIGIN}/json-to-csv/`, label: 'JSON to CSV tool' },
  { relativePath: 'csv-to-json/index.html', canonical: `${CANONICAL_ORIGIN}/csv-to-json/`, label: 'CSV to JSON tool', requireParsing: false },
  { relativePath: 'unix-timestamp-converter/index.html', canonical: `${CANONICAL_ORIGIN}/unix-timestamp-converter/`, label: 'Unix Timestamp Converter tool', requireJson: false, requireParsing: false, requireJsonLd: true },
  { relativePath: 'discord-timestamp-generator/index.html', canonical: `${CANONICAL_ORIGIN}/discord-timestamp-generator/`, label: 'Discord Timestamp Generator tool', requireJson: false, requireParsing: false, requireJsonLd: true, topicPattern: /\bdiscord\s+timestamps?\b/i, topicLabel: 'Discord timestamp' },
  { relativePath: 'base64-decoder/index.html', canonical: `${CANONICAL_ORIGIN}/base64-decoder/`, label: 'Base64 Decoder tool', requireJson: false, requireParsing: false, requireJsonLd: true, topicPattern: /\bbase64(?:url)?\s+(?:decode|decoder|decoding)\b/i, topicLabel: 'Base64 decoding' },
  { relativePath: 'base64-encoder/index.html', canonical: `${CANONICAL_ORIGIN}/base64-encoder/`, label: 'Base64 Encoder tool', requireJson: false, requireParsing: false, requireJsonLd: true, topicPattern: /\bbase64(?:url)?\s+(?:encode|encoder|encoding)\b/i, topicLabel: 'Base64 encoding' },
  { relativePath: 'binary-converter/index.html', canonical: `${CANONICAL_ORIGIN}/binary-converter/`, label: 'Binary Converter tool', requireJson: false, requireParsing: false, requireJsonLd: true, minimumCharacters: 800, topicPattern: /(?=.*\bbinary\b)(?=.*\bconvert(?:er|ing|s|ed)?\b)/i, topicLabel: 'binary conversion' },
  { relativePath: 'hex-converter/index.html', canonical: `${CANONICAL_ORIGIN}/hex-converter/`, label: 'Hex Converter tool', requireJson: false, requireParsing: false, requireJsonLd: true, minimumCharacters: 800, topicPattern: /(?=.*\b(?:hex|hexadecimal)\b)(?=.*\bconvert(?:er|ing|s|ed)?\b)/i, topicLabel: 'hexadecimal conversion' },
  { relativePath: 'binary-translator/index.html', canonical: `${CANONICAL_ORIGIN}/binary-translator/`, label: 'Binary Translator tool', requireJson: false, requireParsing: false, requireJsonLd: true, minimumCharacters: 800, topicPattern: /(?=.*\bbinary\b)(?=.*\btranslat(?:e|or|ing|ion)\b)/i, topicLabel: 'binary text translation' },
  { relativePath: 'ascii-table/index.html', canonical: `${CANONICAL_ORIGIN}/ascii-table/`, label: 'ASCII Table tool', requireJson: false, requireParsing: false, requireJsonLd: true, minimumCharacters: 800, topicPattern: /(?=.*\bascii\b)(?=.*\b(?:table|codes?|chart)\b)/i, topicLabel: 'ASCII table' },
  { relativePath: 'morse-code-translator/index.html', canonical: `${CANONICAL_ORIGIN}/morse-code-translator/`, label: 'Morse Code Translator tool', requireJson: false, requireParsing: false, requireJsonLd: true, minimumCharacters: 1_000, topicPattern: /(?=.*\bmorse\s+code\b)(?=.*\b(?:translat(?:e|or|ing|ion)|decod(?:e|er|ing))\b)/i, topicLabel: 'Morse code translation' },
  { relativePath: 'image-compressor/index.html', canonical: `${CANONICAL_ORIGIN}/image-compressor/`, label: 'Image Compressor tool', requireJson: false, requireParsing: false, requireJsonLd: true, minimumCharacters: 1_000, topicPattern: /(?=.*\b(?:images?|photos?)\b)(?=.*\bcompress(?:or|ion|ing|ed)?\b)(?=.*\b(?:kb|file\s+size|size)\b)/i, topicLabel: 'image compression to a file-size target' },
  { relativePath: 'image-resizer/index.html', canonical: `${CANONICAL_ORIGIN}/image-resizer/`, label: 'Image Resizer tool', requireJson: false, requireParsing: false, requireJsonLd: true, minimumCharacters: 1_000, topicPattern: /(?=.*\b(?:images?|photos?)\b)(?=.*\b(?:resize|resizer|resizing)\b)(?=.*\b(?:pixels?|percent|dimensions?)\b)/i, topicLabel: 'image resizing by pixels or percent' },
  { relativePath: 'png-to-jpg/index.html', canonical: `${CANONICAL_ORIGIN}/png-to-jpg/`, label: 'PNG to JPG Converter tool', requireJson: false, requireParsing: false, requireJsonLd: true, minimumCharacters: 1_000, topicPattern: /(?=.*\bpng\b)(?=.*\bjp(?:e)?g\b)(?=.*\bconvert(?:er|ing|ed|s)?\b)/i, topicLabel: 'PNG to JPG conversion' },
  { relativePath: 'webp-to-jpg/index.html', canonical: `${CANONICAL_ORIGIN}/webp-to-jpg/`, label: 'WebP to JPG Converter tool', requireJson: false, requireParsing: false, requireJsonLd: true, minimumCharacters: 1_000, topicPattern: /(?=.*\bwebp\b)(?=.*\bjp(?:e)?g\b)(?=.*\bconvert(?:er|ing|ed|s)?\b)/i, topicLabel: 'WebP to JPG conversion' },
  { relativePath: 'webp-to-png/index.html', canonical: `${CANONICAL_ORIGIN}/webp-to-png/`, label: 'WebP to PNG Converter tool', requireJson: false, requireParsing: false, requireJsonLd: true, minimumCharacters: 1_000, topicPattern: /(?=.*\bwebp\b)(?=.*\bpng\b)(?=.*\bconvert(?:er|ing|ed|s)?\b)/i, topicLabel: 'WebP to PNG conversion' },
  { relativePath: 'age-calculator/index.html', canonical: `${CANONICAL_ORIGIN}/age-calculator/`, label: 'Age Calculator tool', requireJson: false, requireParsing: false, requireJsonLd: true, minimumCharacters: 1_200, topicPattern: /\b(?:age\s+calculator|calculat(?:e|ing|or)\s+(?:a\s+)?(?:calendar\s+)?age)\b/i, topicLabel: 'age calculation' },
  { relativePath: 'age-calculator-on-specific-date/index.html', canonical: `${CANONICAL_ORIGIN}/age-calculator-on-specific-date/`, label: 'Age on Specific Date Calculator tool', requireJson: false, requireParsing: false, requireJsonLd: true, minimumCharacters: 1_200, topicPattern: /(?=.*\bage\b)(?=.*\b(?:specific|selected|reference|chosen|event)\s+date\b)/i, topicLabel: 'age on a selected date' },
  { relativePath: 'date-calculator/index.html', canonical: `${CANONICAL_ORIGIN}/date-calculator/`, label: 'Date Calculator tool', requireJson: false, requireParsing: false, requireJsonLd: true, minimumCharacters: 1_200, topicPattern: /(?=.*\b(?:date|days?)\b)(?=.*\b(?:calculator|add|subtract|move|shift)\b)/i, topicLabel: 'date calculation' },
  { relativePath: 'days-between-dates/index.html', canonical: `${CANONICAL_ORIGIN}/days-between-dates/`, label: 'Days Between Dates tool', requireJson: false, requireParsing: false, requireJsonLd: true, minimumCharacters: 1_200, topicPattern: /(?=.*\bdays?\b)(?=.*\b(?:between|difference)\b)(?=.*\bdates?\b)/i, topicLabel: 'days between two dates' },
  { relativePath: '2-business-days-from-today/index.html', canonical: `${CANONICAL_ORIGIN}/2-business-days-from-today/`, label: '2 business days from today page', requireJson: false, requireParsing: false, requireJsonLd: true, minimumCharacters: 800, topicPattern: /(?=.*\b2\s+business\s+days\b)(?=.*\bfrom\s+today\b)/i, topicLabel: '2 business days from today' },
  { relativePath: '3-business-days-from-today/index.html', canonical: `${CANONICAL_ORIGIN}/3-business-days-from-today/`, label: '3 business days from today page', requireJson: false, requireParsing: false, requireJsonLd: true, minimumCharacters: 800, topicPattern: /(?=.*\b3\s+business\s+days\b)(?=.*\bfrom\s+today\b)/i, topicLabel: '3 business days from today' },
  { relativePath: '4-business-days-from-today/index.html', canonical: `${CANONICAL_ORIGIN}/4-business-days-from-today/`, label: '4 business days from today page', requireJson: false, requireParsing: false, requireJsonLd: true, minimumCharacters: 800, topicPattern: /(?=.*\b4\s+business\s+days\b)(?=.*\bfrom\s+today\b)/i, topicLabel: '4 business days from today' },
  { relativePath: '5-business-days-from-today/index.html', canonical: `${CANONICAL_ORIGIN}/5-business-days-from-today/`, label: '5 business days from today page', requireJson: false, requireParsing: false, requireJsonLd: true, minimumCharacters: 800, topicPattern: /(?=.*\b5\s+business\s+days\b)(?=.*\bfrom\s+today\b)/i, topicLabel: '5 business days from today' },
  { relativePath: '7-business-days-from-today/index.html', canonical: `${CANONICAL_ORIGIN}/7-business-days-from-today/`, label: '7 business days from today page', requireJson: false, requireParsing: false, requireJsonLd: true, minimumCharacters: 800, topicPattern: /(?=.*\b7\s+business\s+days\b)(?=.*\bfrom\s+today\b)/i, topicLabel: '7 business days from today' },
  { relativePath: '10-business-days-from-today/index.html', canonical: `${CANONICAL_ORIGIN}/10-business-days-from-today/`, label: '10 business days from today page', requireJson: false, requireParsing: false, requireJsonLd: true, minimumCharacters: 800, topicPattern: /(?=.*\b10\s+business\s+days\b)(?=.*\bfrom\s+today\b)/i, topicLabel: '10 business days from today' },
  { relativePath: '14-business-days-from-today/index.html', canonical: `${CANONICAL_ORIGIN}/14-business-days-from-today/`, label: '14 business days from today page', requireJson: false, requireParsing: false, requireJsonLd: true, minimumCharacters: 800, topicPattern: /(?=.*\b14\s+business\s+days\b)(?=.*\bfrom\s+today\b)/i, topicLabel: '14 business days from today' },
  { relativePath: '15-business-days-from-today/index.html', canonical: `${CANONICAL_ORIGIN}/15-business-days-from-today/`, label: '15 business days from today page', requireJson: false, requireParsing: false, requireJsonLd: true, minimumCharacters: 800, topicPattern: /(?=.*\b15\s+business\s+days\b)(?=.*\bfrom\s+today\b)/i, topicLabel: '15 business days from today' },
  { relativePath: '20-business-days-from-today/index.html', canonical: `${CANONICAL_ORIGIN}/20-business-days-from-today/`, label: '20 business days from today page', requireJson: false, requireParsing: false, requireJsonLd: true, minimumCharacters: 800, topicPattern: /(?=.*\b20\s+business\s+days\b)(?=.*\bfrom\s+today\b)/i, topicLabel: '20 business days from today' },
  { relativePath: '30-business-days-from-today/index.html', canonical: `${CANONICAL_ORIGIN}/30-business-days-from-today/`, label: '30 business days from today page', requireJson: false, requireParsing: false, requireJsonLd: true, minimumCharacters: 800, topicPattern: /(?=.*\b30\s+business\s+days\b)(?=.*\bfrom\s+today\b)/i, topicLabel: '30 business days from today' },
  { relativePath: '45-business-days-from-today/index.html', canonical: `${CANONICAL_ORIGIN}/45-business-days-from-today/`, label: '45 business days from today page', requireJson: false, requireParsing: false, requireJsonLd: true, minimumCharacters: 800, topicPattern: /(?=.*\b45\s+business\s+days\b)(?=.*\bfrom\s+today\b)/i, topicLabel: '45 business days from today' },
  { relativePath: 'morse-code-alphabet/index.html', canonical: `${CANONICAL_ORIGIN}/morse-code-alphabet/`, label: 'Morse code alphabet page', requireJson: false, requireParsing: false, requireJsonLd: true, minimumCharacters: 1_000, topicPattern: /\bmorse\s+code\s+alphabet\b/i, topicLabel: 'the Morse code alphabet' },
  { relativePath: 'business-days-calculator/index.html', canonical: `${CANONICAL_ORIGIN}/business-days-calculator/`, label: 'Business Days Calculator tool', requireJson: false, requireParsing: false, requireJsonLd: true, minimumCharacters: 1_200, topicPattern: /(?=.*\b(?:business|work(?:ing)?)\s+days?\b)(?=.*\b(?:calculator|count|add)\b)/i, topicLabel: 'business day calculation' },
  { relativePath: 'time-duration-calculator/index.html', canonical: `${CANONICAL_ORIGIN}/time-duration-calculator/`, label: 'Time Duration Calculator tool', requireJson: false, requireParsing: false, requireJsonLd: true, minimumCharacters: 1_200, topicPattern: /(?=.*\b(?:time|clock)\b)(?=.*\b(?:duration|interval|difference)\b)/i, topicLabel: 'clock-time duration' },
  { relativePath: 'week-number-calculator/index.html', canonical: `${CANONICAL_ORIGIN}/week-number-calculator/`, label: 'Week Number Calculator tool', requireJson: false, requireParsing: false, requireJsonLd: true, minimumCharacters: 1_200, topicPattern: /(?=.*\biso\b)(?=.*\bweek\b)(?=.*\b(?:number|date|year)\b)/i, topicLabel: 'ISO week numbering' },
  { relativePath: 'birthday-countdown/index.html', canonical: `${CANONICAL_ORIGIN}/birthday-countdown/`, label: 'Birthday Countdown tool', requireJson: false, requireParsing: false, requireJsonLd: true, minimumCharacters: 1_200, topicPattern: /(?=.*\bbirthday\b)(?=.*\b(?:countdown|count|next|days?\s+until)\b)/i, topicLabel: 'birthday countdown' },
  { relativePath: 'word-counter/index.html', canonical: `${CANONICAL_ORIGIN}/word-counter/`, label: 'Word Counter tool', requireJson: false, requireParsing: false, requireJsonLd: true, minimumCharacters: 1_000, topicPattern: /(?=.*\bwords?\b)(?=.*\b(?:counter|count(?:ing)?)\b)/i, topicLabel: 'word counting' },
  { relativePath: 'character-counter/index.html', canonical: `${CANONICAL_ORIGIN}/character-counter/`, label: 'Character Counter tool', requireJson: false, requireParsing: false, requireJsonLd: true, minimumCharacters: 1_000, topicPattern: /(?=.*\bcharacters?\b)(?=.*\b(?:counter|count(?:ing)?)\b)/i, topicLabel: 'character counting' },
  { relativePath: 'es/contador-de-palabras/index.html', canonical: `${CANONICAL_ORIGIN}/es/contador-de-palabras/`, label: 'Spanish Word Counter tool', requireJson: false, requireParsing: false, requireJsonLd: true, minimumCharacters: 1_000, topicPattern: /contador\s+de\s+palabras/i, topicLabel: 'contador de palabras' },
  { relativePath: 'es/contador-de-caracteres/index.html', canonical: `${CANONICAL_ORIGIN}/es/contador-de-caracteres/`, label: 'Spanish Character Counter tool', requireJson: false, requireParsing: false, requireJsonLd: true, minimumCharacters: 1_000, topicPattern: /contador\s+de\s+caracteres/i, topicLabel: 'contador de caracteres' },
  { relativePath: 'ja/character-counter/index.html', canonical: `${CANONICAL_ORIGIN}/ja/character-counter/`, label: 'Japanese Character Counter tool', requireJson: false, requireParsing: false, requireJsonLd: true, minimumCharacters: 1_000, minimumWords: 12, topicPattern: /文字数(?:を)?カウント|文字(?:を)?カウント/i, topicLabel: '文字数カウント' },
  { relativePath: 'ko/character-counter/index.html', canonical: `${CANONICAL_ORIGIN}/ko/character-counter/`, label: 'Korean Character Counter tool', requireJson: false, requireParsing: false, requireJsonLd: true, minimumCharacters: 1_000, topicPattern: /글자\s*수(?:를)?\s*세기|글자수\s*세기/i, topicLabel: '글자수 세기' },
  { relativePath: 'url-encoder/index.html', canonical: `${CANONICAL_ORIGIN}/url-encoder/`, label: 'URL Encoder tool', requireJson: false, requireParsing: false, requireJsonLd: true, minimumCharacters: 800, topicPattern: /(?=.*\burls?\b)(?=.*\bencod(?:e|er|ing)\b)/i, topicLabel: 'URL encoding' },
  { relativePath: 'url-decoder/index.html', canonical: `${CANONICAL_ORIGIN}/url-decoder/`, label: 'URL Decoder tool', requireJson: false, requireParsing: false, requireJsonLd: true, minimumCharacters: 800, topicPattern: /(?=.*\burls?\b)(?=.*\bdecod(?:e|er|ing)\b)/i, topicLabel: 'URL decoding' },
  { relativePath: 'url-parser/index.html', canonical: `${CANONICAL_ORIGIN}/url-parser/`, label: 'URL Parser tool', requireJson: false, requireParsing: false, requireJsonLd: true, minimumCharacters: 800, topicPattern: /(?=.*\burls?\b)(?=.*\bpars(?:e|er|ing)\b)/i, topicLabel: 'URL parsing' },
  { relativePath: 'query-string-parser/index.html', canonical: `${CANONICAL_ORIGIN}/query-string-parser/`, label: 'Query String Parser tool', requireJson: false, requireParsing: false, requireJsonLd: true, minimumCharacters: 800, topicPattern: /(?=.*\bquery\s+strings?\b)(?=.*\bpars(?:e|er|ing)\b)/i, topicLabel: 'query string parsing' },
  { relativePath: 'hash-generator/index.html', canonical: `${CANONICAL_ORIGIN}/hash-generator/`, label: 'Hash Generator tool', requireJson: false, requireParsing: false, requireJsonLd: true, minimumCharacters: 800, topicPattern: /(?=.*\bhash(?:es|ing)?\b)(?=.*\bgenerat(?:e|or|ing)\b)/i, topicLabel: 'hash generation' },
  { relativePath: 'sha256-generator/index.html', canonical: `${CANONICAL_ORIGIN}/sha256-generator/`, label: 'SHA-256 Generator tool', requireJson: false, requireParsing: false, requireJsonLd: true, minimumCharacters: 800, topicPattern: /(?=.*\bsha-?256\b)(?=.*\bgenerat(?:e|or|ing)\b)/i, topicLabel: 'SHA-256 generation' },
  { relativePath: 'md5-generator/index.html', canonical: `${CANONICAL_ORIGIN}/md5-generator/`, label: 'MD5 Generator tool', requireJson: false, requireParsing: false, requireJsonLd: true, minimumCharacters: 800, topicPattern: /(?=.*\bmd5\b)(?=.*\bgenerat(?:e|or|ing)\b)/i, topicLabel: 'MD5 generation' },
  { relativePath: 'file-checksum/index.html', canonical: `${CANONICAL_ORIGIN}/file-checksum/`, label: 'File Checksum tool', requireJson: false, requireParsing: false, requireJsonLd: true, minimumCharacters: 800, topicPattern: /(?=.*\bfiles?\b)(?=.*\bchecksums?\b)/i, topicLabel: 'file checksums' },
  { relativePath: 'uuid-generator/index.html', canonical: `${CANONICAL_ORIGIN}/uuid-generator/`, label: 'UUID Generator tool', requireJson: false, requireParsing: false, requireJsonLd: true, topicPattern: /\buuid\s+(?:and\s+guid\s+)?generator\b/i, topicLabel: 'UUID generator' },
  { relativePath: 'uuid-v4-generator/index.html', canonical: `${CANONICAL_ORIGIN}/uuid-v4-generator/`, label: 'UUID v4 Generator tool', requireJson: false, requireParsing: false, requireJsonLd: true, minimumCharacters: 800, topicPattern: /(?=.*\buuid\b)(?=.*\bv?4\b)(?=.*\bgenerat(?:e|or|ing)\b)/i, topicLabel: 'UUID v4 generation' },
  { relativePath: 'uuid-v7-generator/index.html', canonical: `${CANONICAL_ORIGIN}/uuid-v7-generator/`, label: 'UUID v7 Generator tool', requireJson: false, requireParsing: false, requireJsonLd: true, topicPattern: /\buuid\s+(?:version\s+)?v?7\s+generator\b/i, topicLabel: 'UUID v7 generator' },
  { relativePath: 'uuid-validator/index.html', canonical: `${CANONICAL_ORIGIN}/uuid-validator/`, label: 'UUID Validator tool', requireJson: false, requireParsing: false, requireJsonLd: true, topicPattern: /\buuid\s+(?:validator|checker|validation)\b/i, topicLabel: 'UUID validation' },
  { relativePath: 'uuid-decoder/index.html', canonical: `${CANONICAL_ORIGIN}/uuid-decoder/`, label: 'UUID Decoder tool', requireJson: false, requireParsing: false, requireJsonLd: true, minimumCharacters: 800, topicPattern: /(?=.*\buuid\b)(?=.*\bdecod(?:e|er|ing)\b)/i, topicLabel: 'UUID decoding' },
  { relativePath: 'jwt-decoder/index.html', canonical: `${CANONICAL_ORIGIN}/jwt-decoder/`, label: 'JWT Decoder tool', requireJson: false, requireParsing: false, requireJsonLd: true, topicPattern: /\bjwt\s+(?:token\s+)?(?:decode|decoder|decoding)\b/i, topicLabel: 'JWT decoding' },
  { relativePath: 'jwt-expiration-checker/index.html', canonical: `${CANONICAL_ORIGIN}/jwt-expiration-checker/`, label: 'JWT Expiration Checker tool', requireJson: false, requireParsing: false, requireJsonLd: true, topicPattern: /\bjwt\s+(?:token\s+)?(?:expiration|expiry|exp)\s+(?:checker|check|checking)\b/i, topicLabel: 'JWT expiration checking' },
  { relativePath: 'sql-formatter/index.html', canonical: `${CANONICAL_ORIGIN}/sql-formatter/`, label: 'SQL Formatter tool', requireJson: false, requireParsing: false, requireJsonLd: true, topicPattern: /\bsql\s+(?:query\s+)?(?:formatter|formatting|beautifier)\b/i, topicLabel: 'SQL formatting' },
  { relativePath: 'mysql-sql-formatter/index.html', canonical: `${CANONICAL_ORIGIN}/mysql-sql-formatter/`, label: 'MySQL SQL Formatter tool', requireJson: false, requireParsing: false, requireJsonLd: true, topicPattern: /\bmysql\s+(?:sql\s+)?(?:formatter|formatting|beautifier)\b/i, topicLabel: 'MySQL SQL formatting' },
  { relativePath: 'postgresql-sql-formatter/index.html', canonical: `${CANONICAL_ORIGIN}/postgresql-sql-formatter/`, label: 'PostgreSQL SQL Formatter tool', requireJson: false, requireParsing: false, requireJsonLd: true, topicPattern: /\bpostgres(?:ql)?\s+(?:sql\s+)?(?:formatter|formatting|beautifier)\b/i, topicLabel: 'PostgreSQL SQL formatting' },
  { relativePath: 'bigquery-sql-formatter/index.html', canonical: `${CANONICAL_ORIGIN}/bigquery-sql-formatter/`, label: 'BigQuery SQL Formatter tool', requireJson: false, requireParsing: false, requireJsonLd: true, topicPattern: /\bbigquery\s+(?:google)?sql\s+(?:formatter|formatting|beautifier)\b/i, topicLabel: 'BigQuery SQL formatting' },
  { relativePath: 'sql-server-formatter/index.html', canonical: `${CANONICAL_ORIGIN}/sql-server-formatter/`, label: 'SQL Server Formatter tool', requireJson: false, requireParsing: false, requireJsonLd: true, topicPattern: /\bsql\s+server\s+(?:t-sql\s+)?(?:formatter|formatting|beautifier)\b/i, topicLabel: 'SQL Server formatting' },
  { relativePath: 'xml-formatter/index.html', canonical: `${CANONICAL_ORIGIN}/xml-formatter/`, label: 'XML Formatter tool', requireJson: false, requireParsing: false, requireJsonLd: true, minimumCharacters: 800, topicPattern: /(?=.*\bxml\b)(?=.*\b(?:format(?:ter|ting)?|beautif(?:y|ier)|pretty[-\s]?print(?:er|ing)?)\b)/i, topicLabel: 'XML formatting', forbiddenHeadingPattern: /\b(?:xsd|xml\s+schema|schema\s+valid(?:ate|ator|ation))\b/i },
  { relativePath: 'xml-validator/index.html', canonical: `${CANONICAL_ORIGIN}/xml-validator/`, label: 'XML Validator tool', requireJson: false, requireParsing: false, requireJsonLd: true, minimumCharacters: 800, topicPattern: /(?=.*\bxml\b)(?=.*\b(?:valid(?:ate|ator|ation)|well[-\s]?formed(?:ness)?(?:\s+(?:check(?:er|ing)?))?)\b)/i, topicLabel: 'XML well-formedness validation', forbiddenHeadingPattern: /\b(?:xsd|xml\s+schema|schema\s+valid(?:ate|ator|ation))\b/i },
  { relativePath: 'xml-viewer/index.html', canonical: `${CANONICAL_ORIGIN}/xml-viewer/`, label: 'XML Viewer tool', requireJson: false, requireParsing: false, requireJsonLd: true, minimumCharacters: 800, topicPattern: /(?=.*\bxml\b)(?=.*\b(?:view(?:er|ing)?|tree|explor(?:e|er|ing))\b)/i, topicLabel: 'XML viewing', forbiddenHeadingPattern: /\b(?:xsd|xml\s+schema|schema\s+valid(?:ate|ator|ation))\b/i },
  { relativePath: 'yaml-formatter/index.html', canonical: `${CANONICAL_ORIGIN}/yaml-formatter/`, label: 'YAML Formatter tool', requireJson: false, requireParsing: false, requireJsonLd: true, minimumCharacters: 800, topicPattern: /(?=.*\byaml\b)(?=.*\b(?:format(?:ter|ting)?|beautif(?:y|ier)|pretty[-\s]?print(?:er|ing)?)\b)/i, topicLabel: 'YAML formatting' },
  { relativePath: 'yaml-validator/index.html', canonical: `${CANONICAL_ORIGIN}/yaml-validator/`, label: 'YAML Validator tool', requireJson: false, requireParsing: false, requireJsonLd: true, minimumCharacters: 800, topicPattern: /(?=.*\byaml\b)(?=.*\b(?:valid(?:ate|ator|ation)|syntax\s+check(?:er|ing)?)\b)/i, topicLabel: 'YAML syntax validation', forbiddenHeadingPattern: /\byaml\s+(?:schema|lint(?:er|ing)?|fixer)\b|\b(?:schema|lint(?:er|ing)?|fixer)\s+(?:for\s+)?yaml\b/i, forbiddenHeadingLabel: 'schema validation, linting, or automatic fixing' },
  { relativePath: 'yaml-viewer/index.html', canonical: `${CANONICAL_ORIGIN}/yaml-viewer/`, label: 'YAML Viewer tool', requireJson: false, requireParsing: false, requireJsonLd: true, minimumCharacters: 800, topicPattern: /(?=.*\byaml\b)(?=.*\b(?:view(?:er|ing)?|tree|explor(?:e|er|ing))\b)/i, topicLabel: 'YAML viewing' },
  { relativePath: 'yaml-to-json/index.html', canonical: `${CANONICAL_ORIGIN}/yaml-to-json/`, label: 'YAML to JSON tool', requireJson: false, requireParsing: false, requireJsonLd: true, minimumCharacters: 900, topicPattern: /(?=.*\byaml\b)(?=.*\bjson\b)(?=.*\b(?:convert(?:er|ing)?|conversion)\b)/i, topicLabel: 'YAML to JSON conversion' },
  { relativePath: 'json-to-yaml/index.html', canonical: `${CANONICAL_ORIGIN}/json-to-yaml/`, label: 'JSON to YAML tool', requireJson: false, requireParsing: false, requireJsonLd: true, minimumCharacters: 900, topicPattern: /(?=.*\bjson\b)(?=.*\byaml\b)(?=.*\b(?:convert(?:er|ing)?|conversion)\b)/i, topicLabel: 'JSON to YAML conversion' },
  { relativePath: 'privacy/index.html', canonical: `${CANONICAL_ORIGIN}/privacy/`, label: 'privacy page', requireJson: false, requireParsing: false },
  { relativePath: 'about/index.html', canonical: `${CANONICAL_ORIGIN}/about/`, label: 'about page', requireJson: false, requireParsing: false, requireJsonLd: true, topicPattern: /\bliveparse\b/i, topicLabel: 'the LiveParse brand name' },
  { relativePath: 'guides/index.html', canonical: `${CANONICAL_ORIGIN}/guides/`, label: 'guides hub', requireJson: false, requireParsing: false, requireJsonLd: true, minimumCharacters: 1_000, topicPattern: /(?=.*\bdeveloper\b)(?=.*\bdata\b)(?=.*\bguides?\b)/i, topicLabel: 'developer data guides' },
];
const WORD_COUNTER_HREFLANGS = new Map([
  ['en', `${CANONICAL_ORIGIN}/word-counter/`],
  ['es', `${CANONICAL_ORIGIN}/es/contador-de-palabras/`],
  ['x-default', `${CANONICAL_ORIGIN}/word-counter/`],
]);
const CHARACTER_COUNTER_HREFLANGS = new Map([
  ['en', `${CANONICAL_ORIGIN}/character-counter/`],
  ['es', `${CANONICAL_ORIGIN}/es/contador-de-caracteres/`],
  ['ja', `${CANONICAL_ORIGIN}/ja/character-counter/`],
  ['ko', `${CANONICAL_ORIGIN}/ko/character-counter/`],
  ['x-default', `${CANONICAL_ORIGIN}/character-counter/`],
]);
const JSON_FORMATTER_HREFLANGS = new Map([
  ['en', `${CANONICAL_ORIGIN}/json-formatter/`],
  ['ko', `${CANONICAL_ORIGIN}/ko/json-parser/`],
  ['x-default', `${CANONICAL_ORIGIN}/json-formatter/`],
]);
const EXPECTED_HREFLANGS = new Map([
  [`${CANONICAL_ORIGIN}/json-formatter/`, JSON_FORMATTER_HREFLANGS],
  [`${CANONICAL_ORIGIN}/ko/json-parser/`, JSON_FORMATTER_HREFLANGS],
  [`${CANONICAL_ORIGIN}/word-counter/`, WORD_COUNTER_HREFLANGS],
  [`${CANONICAL_ORIGIN}/es/contador-de-palabras/`, WORD_COUNTER_HREFLANGS],
  [`${CANONICAL_ORIGIN}/character-counter/`, CHARACTER_COUNTER_HREFLANGS],
  [`${CANONICAL_ORIGIN}/es/contador-de-caracteres/`, CHARACTER_COUNTER_HREFLANGS],
  [`${CANONICAL_ORIGIN}/ja/character-counter/`, CHARACTER_COUNTER_HREFLANGS],
  [`${CANONICAL_ORIGIN}/ko/character-counter/`, CHARACTER_COUNTER_HREFLANGS],
]);

function fail(message) {
  failures.push(message);
}

function decodeEntities(value) {
  const named = new Map([
    ['amp', '&'],
    ['apos', "'"],
    ['gt', '>'],
    ['lt', '<'],
    ['nbsp', ' '],
    ['quot', '"'],
  ]);
  return value.replace(/&(#(?:x[\da-f]+|\d+)|[a-z]+);/gi, (entity, name) => {
    if (name[0] === '#') {
      const hexadecimal = name[1]?.toLowerCase() === 'x';
      const codePoint = Number.parseInt(name.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
      if (Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff) {
        try {
          return String.fromCodePoint(codePoint);
        } catch {
          return entity;
        }
      }
      return entity;
    }
    return named.get(name.toLowerCase()) ?? entity;
  });
}

function parseAttributes(source) {
  const attributes = new Map();
  const pattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match;
  while ((match = pattern.exec(source))) {
    attributes.set(match[1].toLowerCase(), decodeEntities(match[2] ?? match[3] ?? match[4] ?? ''));
  }
  return attributes;
}

function openingTags(html, name) {
  const matches = [];
  const pattern = new RegExp(`<${name}\\b([^>]*)>`, 'gi');
  let match;
  while ((match = pattern.exec(html))) matches.push(parseAttributes(match[1]));
  return matches;
}

function elementContents(html, name) {
  const matches = [];
  const pattern = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}\\s*>`, 'gi');
  let match;
  while ((match = pattern.exec(html))) matches.push(match[1]);
  return matches;
}

function plainText(fragment) {
  return decodeEntities(fragment.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function visibleText(html) {
  const body = elementContents(html, 'body')[0] ?? html;
  return plainText(
    body
      .replace(/<(script|style|template|svg|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
      .replace(/<(script|style|template|svg|noscript)\b[^>]*\/\s*>/gi, ' '),
  );
}

function titleValues(html) {
  return elementContents(html, 'title').map(plainText).filter(Boolean);
}

function descriptionValues(html) {
  return openingTags(html, 'meta')
    .filter((attributes) => attributes.get('name')?.toLowerCase() === 'description')
    .map((attributes) => attributes.get('content')?.trim() || '')
    .filter(Boolean);
}

function canonicalValues(html) {
  return openingTags(html, 'link')
    .filter((attributes) => (attributes.get('rel') || '').toLowerCase().split(/\s+/).includes('canonical'))
    .map((attributes) => attributes.get('href')?.trim() || '')
    .filter(Boolean);
}

function validateHreflangAlternates(html, label, expected) {
  const actual = new Map();
  for (const attributes of openingTags(html, 'link')) {
    const rel = (attributes.get('rel') || '').toLowerCase().split(/\s+/);
    const hreflang = (attributes.get('hreflang') || '').trim().toLowerCase();
    if (!rel.includes('alternate') || !hreflang) continue;
    const href = (attributes.get('href') || '').trim();
    if (actual.has(hreflang)) {
      fail(`${label}: duplicate hreflang ${JSON.stringify(hreflang)}`);
      continue;
    }
    actual.set(hreflang, href);
  }
  for (const [language, href] of expected) {
    if (actual.get(language) !== href) {
      fail(`${label}: hreflang ${JSON.stringify(language)} must point to ${href}, found ${JSON.stringify(actual.get(language) ?? null)}`);
    }
  }
  for (const language of actual.keys()) {
    if (!expected.has(language)) fail(`${label}: unexpected hreflang ${JSON.stringify(language)}`);
  }
}

function h1Values(html) {
  return elementContents(html, 'h1').map(plainText).filter(Boolean);
}

function jsonLdBlocks(html) {
  const blocks = [];
  const pattern = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let match;
  while ((match = pattern.exec(html))) {
    const attributes = parseAttributes(match[1]);
    if ((attributes.get('type') || '').toLowerCase() === 'application/ld+json') blocks.push(match[2].trim());
  }
  return blocks;
}

function validateJsonLd(html, label, required = false) {
  const blocks = jsonLdBlocks(html);
  if (required && blocks.length === 0) fail(`${label}: at least one JSON-LD block is required`);
  blocks.forEach((block, index) => {
    if (!block) {
      fail(`${label}: JSON-LD block ${index + 1} is empty`);
      return;
    }
    try {
      const parsed = JSON.parse(block);
      if (parsed === null || (typeof parsed !== 'object' && !Array.isArray(parsed))) {
        fail(`${label}: JSON-LD block ${index + 1} must contain an object or array`);
      }
    } catch (error) {
      fail(`${label}: JSON-LD block ${index + 1} is invalid JSON (${error.message})`);
    }
  });
}

function validateAsciiTableRows(html, label) {
  const rowCodes = openingTags(html, 'tr')
    .filter((attributes) => attributes.has('data-ascii-code'))
    .map((attributes) => attributes.get('data-ascii-code')?.trim() ?? '');

  if (rowCodes.length !== 128) {
    fail(`${label}: expected exactly 128 static ASCII rows, found ${rowCodes.length}`);
  }

  const seen = new Set();
  for (const rawCode of rowCodes) {
    if (!/^(?:0|[1-9]\d*)$/.test(rawCode)) {
      fail(`${label}: invalid data-ascii-code value ${JSON.stringify(rawCode)}`);
      continue;
    }
    const code = Number(rawCode);
    if (code < 0 || code > 127) {
      fail(`${label}: data-ascii-code must be between 0 and 127, found ${code}`);
      continue;
    }
    if (seen.has(code)) fail(`${label}: duplicate static ASCII row ${code}`);
    seen.add(code);
  }

  for (let code = 0; code <= 127; code += 1) {
    if (!seen.has(code)) fail(`${label}: missing static ASCII row ${code}`);
  }
}

function collectJsonLdNodes(value, nodes = []) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectJsonLdNodes(item, nodes));
  } else if (value && typeof value === 'object') {
    nodes.push(value);
    Object.values(value).forEach((item) => collectJsonLdNodes(item, nodes));
  }
  return nodes;
}

function validateGuideItemList(html, expectedGuideUrls) {
  const itemLists = [];
  for (const block of jsonLdBlocks(html)) {
    try {
      const parsed = JSON.parse(block);
      itemLists.push(...collectJsonLdNodes(parsed).filter((node) => node['@type'] === 'ItemList'));
    } catch {
      return;
    }
  }

  if (itemLists.length !== 1) {
    fail(`guides hub: expected exactly one ItemList JSON-LD node, found ${itemLists.length}`);
    return;
  }

  const itemList = itemLists[0];
  const elements = Array.isArray(itemList.itemListElement) ? itemList.itemListElement : [];
  if (itemList.numberOfItems !== expectedGuideUrls.size) {
    fail(`guides hub: ItemList numberOfItems must be ${expectedGuideUrls.size}, found ${JSON.stringify(itemList.numberOfItems)}`);
  }
  if (elements.length !== expectedGuideUrls.size) {
    fail(`guides hub: ItemList must contain ${expectedGuideUrls.size} entries, found ${elements.length}`);
  }

  const listedUrls = new Set();
  elements.forEach((entry, index) => {
    if (entry?.position !== index + 1) {
      fail(`guides hub: ItemList entry ${index + 1} has position ${JSON.stringify(entry?.position)}`);
    }
    const url = typeof entry?.url === 'string' ? entry.url : '';
    if (!expectedGuideUrls.has(url)) fail(`guides hub: ItemList contains unexpected guide URL ${JSON.stringify(url)}`);
    if (listedUrls.has(url)) fail(`guides hub: ItemList contains duplicate guide URL ${JSON.stringify(url)}`);
    listedUrls.add(url);
  });
  for (const url of expectedGuideUrls.keys()) {
    if (!listedUrls.has(url)) fail(`guides hub: ItemList is missing guide URL ${url}`);
  }
}

function normalizeFaqText(value) {
  return value.replace(/\s+/g, ' ').trim().replace(/\s+([,.;:!?/])/g, '$1').replace(/\/\s+/g, '/');
}

function visibleFaqPairs(html) {
  const sections = [];
  const sectionPattern = /<section\b([^>]*)>([\s\S]*?)<\/section\s*>/gi;
  let sectionMatch;
  while ((sectionMatch = sectionPattern.exec(html))) {
    const attributes = parseAttributes(sectionMatch[1]);
    if (attributes.get('id') === 'faq' || attributes.get('aria-labelledby') === 'faq-title') sections.push(sectionMatch[2]);
  }
  const pairs = [];
  for (const section of sections) {
    const details = elementContents(section, 'details');
    if (details.length) {
      for (const detail of details) {
        const question = elementContents(detail, 'summary').map((value) => normalizeFaqText(plainText(value))).find(Boolean);
        const answer = elementContents(detail, 'p').map((value) => normalizeFaqText(plainText(value))).find(Boolean);
        if (question && answer) pairs.push({ question, answer });
      }
      continue;
    }
    const pairPattern = /<h3\b[^>]*>([\s\S]*?)<\/h3\s*>\s*<p\b[^>]*>([\s\S]*?)<\/p\s*>/gi;
    let pairMatch;
    while ((pairMatch = pairPattern.exec(section))) {
      pairs.push({ question: normalizeFaqText(plainText(pairMatch[1])), answer: normalizeFaqText(plainText(pairMatch[2])) });
    }
  }
  return pairs;
}

function validateFaqParity(html, label) {
  const faqNodes = [];
  for (const block of jsonLdBlocks(html)) {
    try {
      const parsed = JSON.parse(block);
      faqNodes.push(...collectJsonLdNodes(parsed).filter((node) => node['@type'] === 'FAQPage'));
    } catch {
      return;
    }
  }
  if (faqNodes.length !== 1) {
    fail(`${label}: expected exactly one FAQPage JSON-LD node, found ${faqNodes.length}`);
    return;
  }
  const structuredPairs = Array.isArray(faqNodes[0].mainEntity)
    ? faqNodes[0].mainEntity.map((entity) => ({
      question: typeof entity?.name === 'string' ? normalizeFaqText(entity.name) : '',
      answer: typeof entity?.acceptedAnswer?.text === 'string' ? normalizeFaqText(entity.acceptedAnswer.text) : '',
    }))
    : [];
  const visiblePairs = visibleFaqPairs(html);
  if (structuredPairs.length !== visiblePairs.length) {
    fail(`${label}: FAQPage has ${structuredPairs.length} question-answer pairs but visible FAQ has ${visiblePairs.length}`);
    return;
  }
  structuredPairs.forEach((pair, index) => {
    const visible = visiblePairs[index];
    if (pair.question !== visible.question || pair.answer !== visible.answer) {
      fail(`${label}: FAQ pair ${index + 1} does not exactly match the visible question and answer`);
    }
  });
}

function validatePageBasics(html, label, expectedCanonical, { minimumCharacters = 200, minimumWords = 30, requireJson = true, requireParsing = true } = {}) {
  const titles = titleValues(html);
  if (titles.length !== 1) fail(`${label}: expected exactly one non-empty <title>, found ${titles.length}`);
  else {
    if (requireJson && !/json/i.test(titles[0])) fail(`${label}: title must mention JSON`);
    if (titles[0].length < 15 || titles[0].length > 90) fail(`${label}: title should be 15-90 characters`);
  }

  const descriptions = descriptionValues(html);
  if (descriptions.length !== 1) fail(`${label}: expected exactly one meta description, found ${descriptions.length}`);
  else {
    if (requireJson && !/json/i.test(descriptions[0])) fail(`${label}: meta description must mention JSON`);
    if (descriptions[0].length < 50 || descriptions[0].length > 200) {
      fail(`${label}: meta description should be 50-200 characters`);
    }
  }

  const canonicals = canonicalValues(html);
  if (canonicals.length !== 1) fail(`${label}: expected exactly one canonical link, found ${canonicals.length}`);
  else {
    try {
      const canonical = new URL(canonicals[0]);
      if (canonical.href !== expectedCanonical) {
        fail(`${label}: canonical is ${canonical.href}, expected ${expectedCanonical}`);
      }
    } catch {
      fail(`${label}: canonical is not an absolute URL (${JSON.stringify(canonicals[0])})`);
    }
  }

  const headings = h1Values(html);
  if (headings.length !== 1) fail(`${label}: expected exactly one non-empty H1, found ${headings.length}`);
  else if (requireJson && !/json/i.test(headings[0])) fail(`${label}: H1 must mention JSON`);

  const text = visibleText(html);
  const words = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || [];
  if (text.length < minimumCharacters || words.length < minimumWords) {
    fail(`${label}: visible static copy is too thin (${text.length} characters, ${words.length} words)`);
  }
  if (requireJson && !/json/i.test(text)) fail(`${label}: visible static copy must discuss JSON`);
  if (requireParsing && !/pars(?:e|er|ing)/i.test(text)) fail(`${label}: visible static copy must explain JSON parsing`);

}

function isWithin(root, candidate) {
  const pathFromRoot = relative(root, candidate);
  return pathFromRoot === '' || (!isAbsolute(pathFromRoot) && pathFromRoot !== '..' && !pathFromRoot.startsWith(`..${sep}`));
}

async function walkFiles(root) {
  const files = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (directory === root && entry.isDirectory() && entry.name === 'client') continue;
      const entryPath = join(directory, entry.name);
      if (entry.isDirectory()) await visit(entryPath);
      else if (entry.isFile()) files.push(entryPath);
    }
  }
  await visit(root);
  return files;
}

function publicPathForHtml(relativePath) {
  const normalized = relativePath.split(sep).join('/');
  if (normalized === 'index.html') return '/';
  if (normalized.endsWith('/index.html')) return `/${normalized.slice(0, -'index.html'.length)}`;
  return `/${normalized}`;
}

function isGuideHtml(relativePath) {
  const normalized = relativePath.split(sep).join('/').toLowerCase();
  if (normalized === 'guides/index.html') return false;
  return /(?:^|[\/_-])(?:guide|guides|tutorial|tutorials)(?:[\/_.-]|$)/.test(normalized);
}

function guideValidationProfile(relativePath) {
  const normalized = relativePath.split(sep).join('/').toLowerCase();
  if (normalized.includes('binary-decimal-hex-octal-conversion')) {
    return {
      requireJson: false,
      requireParsing: false,
      minimumCharacters: 1_000,
      topicPattern: /(?=.*\bbinary\b)(?=.*\bdecimal\b)(?=.*\b(?:hex|hexadecimal)\b)(?=.*\boctal\b)/i,
      topicLabel: 'binary, decimal, hexadecimal, and octal conversion',
    };
  }
  if (normalized.includes('twos-complement-signed-binary')) {
    return {
      requireJson: false,
      requireParsing: false,
      minimumCharacters: 1_000,
      topicPattern: /(?=.*\btwo['’]?s\s+complement\b)(?=.*\bsigned\b)(?=.*\bbinary\b)/i,
      topicLabel: "two's complement signed binary",
    };
  }
  if (normalized.includes('ascii-vs-unicode-utf8')) {
    return {
      requireJson: false,
      requireParsing: false,
      minimumCharacters: 1_000,
      topicPattern: /(?=.*\bascii\b)(?=.*\bunicode\b)(?=.*\butf-?8\b)/i,
      topicLabel: 'ASCII, Unicode, and UTF-8',
    };
  }
  if (normalized.includes('how-word-counting-works')) {
    return {
      requireJson: false,
      requireParsing: false,
      minimumCharacters: 1_000,
      topicPattern: /(?=.*\bwords?\b)(?=.*\bcount(?:er|ing|s|ed)?\b)/i,
      topicLabel: 'how word counting works',
    };
  }
  if (normalized.includes('grapheme-clusters-vs-code-points-and-bytes')) {
    return {
      requireJson: false,
      requireParsing: false,
      minimumCharacters: 1_000,
      topicPattern: /(?=.*\bgrapheme(?:s|\s+clusters?)?\b)(?=.*\bcode\s+points?\b)(?=.*\bbytes?\b)/i,
      topicLabel: 'grapheme clusters, code points, and bytes',
    };
  }
  if (normalized.includes('international-morse-code')) {
    return {
      requireJson: false,
      requireParsing: false,
      minimumCharacters: 1_000,
      topicPattern: /(?=.*\binternational\s+morse\s+code\b)(?=.*\b(?:itu|recommendation|standard|reference)\b)/i,
      topicLabel: 'International Morse code and the ITU recommendation',
    };
  }
  if (normalized.includes('image-compression-formats-and-file-size')) {
    return {
      requireJson: false,
      requireParsing: false,
      minimumCharacters: 1_000,
      topicPattern: /(?=.*\bimages?\b)(?=.*\bcompress(?:ion|ing|ed)?\b)(?=.*\b(?:formats?|file\s+size|dimensions?|quality)\b)/i,
      topicLabel: 'image compression, formats, and file size',
    };
  }
  if (normalized.includes('calendar-date-arithmetic-dst-leap-years')) {
    return {
      requireJson: false,
      requireParsing: false,
      minimumCharacters: 1_800,
      topicPattern: /(?=.*\b(?:calendar|gregorian)\b)(?=.*\b(?:arithmetic|calculations?)\b)(?=.*\b(?:dst|daylight[-\s]?saving)\b)(?=.*\bleap\s+years?\b)/i,
      topicLabel: 'calendar date arithmetic, DST, and leap years',
    };
  }
  if (normalized.includes('url-percent-encoding')) {
    return {
      requireJson: false,
      requireParsing: false,
      minimumCharacters: 1_000,
      topicPattern: /(?=.*\burls?\b)(?=.*\bpercent[-\s]?encod(?:e|ed|ing)\b)/i,
      topicLabel: 'URL percent-encoding',
    };
  }
  if (normalized.includes('encodeuri-vs-encodeuricomponent')) {
    return {
      requireJson: false,
      requireParsing: false,
      minimumCharacters: 1_000,
      topicPattern: /(?=.*\bencodeuri\b)(?=.*\bencodeuricomponent\b)/i,
      topicLabel: 'encodeURI and encodeURIComponent',
    };
  }
  if (normalized.includes('percent20-vs-plus')) {
    return {
      requireJson: false,
      requireParsing: false,
      minimumCharacters: 1_000,
      topicPattern: /(?=.*%20)(?=.*(?:\+|\bplus\b))/i,
      topicLabel: '%20 and plus',
    };
  }
  if (normalized.includes('double-url-encoding')) {
    return {
      requireJson: false,
      requireParsing: false,
      minimumCharacters: 1_000,
      topicPattern: /(?=.*\bdouble\b)(?=.*\burls?\b)(?=.*\bencod(?:e|ed|ing)\b)/i,
      topicLabel: 'double URL encoding',
    };
  }
  if (normalized.includes('sha256-vs-md5')) {
    return {
      requireJson: false,
      requireParsing: false,
      minimumCharacters: 1_000,
      topicPattern: /(?=.*\bsha-?256\b)(?=.*\bmd5\b)/i,
      topicLabel: 'SHA-256 and MD5',
    };
  }
  if (normalized.includes('hash-vs-encryption')) {
    return {
      requireJson: false,
      requireParsing: false,
      minimumCharacters: 1_000,
      topicPattern: /(?=.*\bhash(?:es|ing)?\b)(?=.*\bencrypt(?:ion|ed|ing)?\b)/i,
      topicLabel: 'hashing and encryption',
    };
  }
  if (normalized.includes('how-to-verify-file-checksum')) {
    return {
      requireJson: false,
      requireParsing: false,
      minimumCharacters: 1_000,
      topicPattern: /(?=.*\bfiles?\b)(?=.*\bchecksums?\b)(?=.*\bverif(?:y|ying|ication)\b)/i,
      topicLabel: 'file checksum verification',
    };
  }
  if (normalized.includes('hashing-utf8-newlines')) {
    return {
      requireJson: false,
      requireParsing: false,
      minimumCharacters: 1_000,
      topicPattern: /(?=.*\bhash(?:es|ing)?\b)(?=.*\butf-?8\b)(?=.*\bnewlines?\b)/i,
      topicLabel: 'hashing UTF-8 and newlines',
    };
  }
  if (normalized.includes('yaml-1-1-vs-1-2')) {
    return {
      requireJson: false,
      requireParsing: false,
      minimumCharacters: 1_000,
      topicPattern: /(?=.*\byaml\b)(?=.*\b1\.1\b)(?=.*\b1\.2\b)/i,
      topicLabel: 'YAML 1.1 and YAML 1.2',
    };
  }
  if (normalized.includes('yaml-to-json-types')) {
    return {
      requireJson: false,
      requireParsing: false,
      minimumCharacters: 1_000,
      topicPattern: /(?=.*\byaml\b)(?=.*\bjson\b)(?=.*\btypes?\b)/i,
      topicLabel: 'YAML to JSON types',
    };
  }
  if (normalized.includes('yaml-anchors-aliases-merge-keys')) {
    return {
      requireJson: false,
      requireParsing: false,
      minimumCharacters: 1_000,
      topicPattern: /(?=.*\byaml\b)(?=.*\banchors?\b)(?=.*\balias(?:es)?\b)(?=.*\bmerge\s+keys?\b)/i,
      topicLabel: 'YAML anchors, aliases, and merge keys',
    };
  }
  if (normalized.includes('common-yaml-errors')) {
    return {
      requireJson: false,
      requireParsing: false,
      minimumCharacters: 1_000,
      topicPattern: /(?=.*\byaml\b)(?=.*\b(?:errors?|mistakes?|problems?)\b)/i,
      topicLabel: 'common YAML errors',
    };
  }
  if (normalized.includes('xml-well-formed-vs-valid')) {
    return {
      requireJson: false,
      requireParsing: false,
      minimumCharacters: 1_000,
      topicPattern: /(?=.*\bxml\b)(?=.*\bwell[-\s]?formed(?:ness)?\b)(?=.*\bvalid(?:ity|ation)?\b)/i,
      topicLabel: 'well-formed XML and valid XML',
    };
  }
  if (normalized.includes('sql-dialect')) {
    return {
      requireJson: false,
      requireParsing: false,
      topicPattern: /(?=.*\bsql\b)(?=.*\bdialects?\b)(?=.*\bformat(?:ter|ting)?\b)/i,
      topicLabel: 'SQL dialect formatting',
    };
  }
  if (normalized.includes('jwt')) {
    return {
      requireJson: false,
      requireParsing: false,
      topicPattern: /(?=.*\bjwt\b)(?=.*\bdecod(?:e|ing)\b)(?=.*\bverif(?:y|ication)\b)/i,
      topicLabel: 'JWT decoding and verification',
    };
  }
  if (normalized.includes('uuid-versions-explained')) {
    return {
      requireJson: false,
      requireParsing: false,
      minimumCharacters: 1_000,
      topicPattern: /(?=.*\buuid\b)(?=.*\bversions?\b)/i,
      topicLabel: 'UUID versions',
    };
  }
  if (normalized.includes('uuid-collision-probability')) {
    return {
      requireJson: false,
      requireParsing: false,
      minimumCharacters: 1_000,
      topicPattern: /(?=.*\buuid\b)(?=.*\bcollisions?\b)(?=.*\bprobabilit(?:y|ies)\b)/i,
      topicLabel: 'UUID collision probability',
    };
  }
  if (normalized.includes('uuid')) {
    return {
      requireJson: false,
      requireParsing: false,
      topicPattern: /\buuid\s+v(?:4|7)\b/i,
      topicLabel: 'UUID v4 or UUID v7',
    };
  }
  if (normalized.includes('base64')) {
    return {
      requireJson: false,
      requireParsing: false,
      topicPattern: /\bbase64(?:url)?\b/i,
      topicLabel: 'Base64 or Base64URL',
    };
  }
  if (normalized.includes('discord-timestamp')) {
    return {
      requireJson: false,
      requireParsing: false,
      topicPattern: /\bdiscord\s+timestamps?\b/i,
      topicLabel: 'Discord timestamp',
    };
  }
  if (normalized.includes('unix-timestamp')) {
    return {
      requireJson: false,
      requireParsing: false,
      topicPattern: /\b(?:unix\s+timestamps?|epoch(?:\s+time)?|timestamps?)\b/i,
      topicLabel: 'Unix timestamp or epoch',
    };
  }
  return { requireJson: true, requireParsing: true, topicPattern: /\bjson\b/i, topicLabel: 'JSON' };
}

function validateMetadataUniqueness(htmlByPath, distRoot) {
  const fields = [
    ['title', (html) => titleValues(html)[0] || ''],
    ['meta description', (html) => descriptionValues(html)[0] || ''],
    ['H1', (html) => h1Values(html)[0] || ''],
    ['canonical', (html) => canonicalValues(html)[0] || ''],
  ];

  for (const [label, readValue] of fields) {
    const seen = new Map();
    for (const [path, html] of htmlByPath) {
      const value = readValue(html).replace(/\s+/g, ' ').trim();
      if (!value) continue;
      const key = value.toLocaleLowerCase('en-US');
      const publicPath = publicPathForHtml(relative(distRoot, path));
      const previousPath = seen.get(key);
      if (previousPath) {
        fail(`${label}: duplicate value on ${previousPath} and ${publicPath} (${JSON.stringify(value)})`);
      } else {
        seen.set(key, publicPath);
      }
    }
  }
}

async function staticFileForUrl(distRoot, url) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  if (!decodedPath.startsWith('/') || decodedPath.includes('\0') || decodedPath.includes('\\')) return null;
  if (decodedPath.split('/').some((segment) => segment === '..')) return null;

  let candidate = resolve(distRoot, decodedPath.slice(1));
  if (!isWithin(distRoot, candidate)) return null;
  try {
    let fileStat = await stat(candidate);
    if (fileStat.isDirectory()) {
      candidate = join(candidate, 'index.html');
      fileStat = await stat(candidate);
    }
    if (!fileStat.isFile()) return null;
    const realCandidate = await realpath(candidate);
    return isWithin(distRoot, realCandidate) ? realCandidate : null;
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return null;
    throw error;
  }
}

function extractLinks(html) {
  return openingTags(html, 'a').map((attributes) => attributes.get('href')?.trim() || '').filter(Boolean);
}

function normalizeUrl(value, base, label) {
  try {
    return new URL(value, base);
  } catch {
    fail(`${label}: invalid URL ${JSON.stringify(value)}`);
    return null;
  }
}

async function readRequired(path, label) {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    fail(`${label}: cannot read ${path} (${error.message})`);
    return null;
  }
}

function directXmlElements(node, name) {
  return node.children.filter((child) => child.type === 'element' && (name === undefined || child.name === name));
}

function singleXmlElement(parent, name, label) {
  const elements = directXmlElements(parent, name);
  if (elements.length !== 1) {
    fail(`${label}: expected exactly one <${name}> element, found ${elements.length}`);
  }
  return elements[0] ?? null;
}

function singleXmlText(parent, name, label) {
  const element = singleXmlElement(parent, name, label);
  if (!element) return '';
  if (directXmlElements(element).length > 0) {
    fail(`${label}: <${name}> must contain text only`);
  }
  const value = element.text.trim();
  if (!value) fail(`${label}: <${name}> must not be empty`);
  return value;
}

function isLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function parseRfc3339(value, label) {
  const match = RFC3339_PATTERN.exec(value);
  if (!match) {
    fail(`${label}: must be an RFC 3339 date-time with seconds and a time-zone offset (${JSON.stringify(value)})`);
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const daysInMonth = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth[month - 1]) {
    fail(`${label}: contains an invalid calendar date (${JSON.stringify(value)})`);
    return null;
  }

  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    fail(`${label}: is not a parseable RFC 3339 date-time (${JSON.stringify(value)})`);
    return null;
  }
  return timestamp;
}

function validateAtomNamespace(element, inheritedNamespace = null) {
  const namespace = Object.hasOwn(element.attributes, 'xmlns') ? element.attributes.xmlns : inheritedNamespace;
  if (namespace !== ATOM_NAMESPACE) {
    fail(`feed.xml: <${element.name}> must be in the Atom 1.0 namespace ${ATOM_NAMESPACE}`);
  }
  if (element.name.includes(':')) fail(`feed.xml: unexpected prefixed element <${element.name}>`);
  for (const child of directXmlElements(element)) validateAtomNamespace(child, namespace);
}

function validateExactAtomLink(parent, rel, expectedHref, expectedType, label) {
  const matches = directXmlElements(parent, 'link').filter((link) => link.attributes.rel?.trim() === rel);
  if (matches.length !== 1) {
    fail(`${label}: expected exactly one <link rel=${JSON.stringify(rel)}> element, found ${matches.length}`);
  }
  const link = matches[0] ?? null;
  if (!link) return null;
  const href = link.attributes.href?.trim() ?? '';
  if (href !== expectedHref) fail(`${label}: rel=${JSON.stringify(rel)} href must be ${expectedHref}`);
  if (expectedType !== undefined && (link.attributes.type?.trim() ?? '') !== expectedType) {
    fail(`${label}: rel=${JSON.stringify(rel)} type must be ${expectedType}`);
  }
  return link;
}

function parseCanonicalAtomUrl(value, label) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail(`${label}: invalid absolute URL ${JSON.stringify(value)}`);
    return null;
  }
  if (url.protocol !== 'https:' || url.origin !== CANONICAL_ORIGIN || url.username || url.password) {
    fail(`${label}: URL must use the canonical ${CANONICAL_ORIGIN} HTTPS origin without credentials (${url.href})`);
  }
  if (url.search || url.hash) fail(`${label}: URL must not contain a query or fragment (${url.href})`);
  if (url.href !== value) fail(`${label}: URL is not in canonical serialized form (${JSON.stringify(value)})`);
  return url;
}

function validateAtomAutodiscovery(html, label) {
  const candidates = openingTags(html, 'link').filter((attributes) => {
    const type = attributes.get('type')?.trim().toLowerCase() ?? '';
    const href = attributes.get('href')?.trim() ?? '';
    return type === 'application/atom+xml' || href === ATOM_FEED_URL;
  });
  if (candidates.length !== 1) {
    fail(`${label}: expected exactly one Atom autodiscovery link, found ${candidates.length}`);
  }
  const link = candidates[0];
  if (!link) return;
  if ((link.get('rel')?.trim() ?? '') !== 'alternate') {
    fail(`${label}: Atom autodiscovery link rel must be alternate`);
  }
  if ((link.get('type')?.trim() ?? '') !== 'application/atom+xml') {
    fail(`${label}: Atom autodiscovery link type must be application/atom+xml`);
  }
  if ((link.get('title')?.trim() ?? '') !== ATOM_FEED_TITLE) {
    fail(`${label}: Atom autodiscovery link title must be ${JSON.stringify(ATOM_FEED_TITLE)}`);
  }
  if ((link.get('href')?.trim() ?? '') !== ATOM_FEED_URL) {
    fail(`${label}: Atom autodiscovery link href must be ${ATOM_FEED_URL}`);
  }
}

async function validateAtomFeed(source, distRoot, htmlByPath, sitemapUrlSet) {
  let document;
  try {
    document = parseXml(source, {
      ignoreUndefinedEntities: false,
      preserveCdata: true,
      preserveComments: true,
      preserveDocumentType: true,
      preserveXmlDeclaration: true,
    });
  } catch (error) {
    fail(`feed.xml: malformed XML (${error.message.split(/\r?\n/, 1)[0]})`);
    return 0;
  }

  if (document.children.some((child) => child.type === 'doctype')) {
    fail('feed.xml: document type declarations are not allowed');
  }
  const root = document.root;
  if (!root || root.name !== 'feed') {
    fail(`feed.xml: root element must be <feed>, found ${root ? `<${root.name}>` : 'none'}`);
    return 0;
  }
  validateAtomNamespace(root);

  const feedId = singleXmlText(root, 'id', 'feed.xml');
  if (feedId !== ATOM_FEED_URL) fail(`feed.xml: feed <id> must be ${ATOM_FEED_URL}`);
  singleXmlText(root, 'title', 'feed.xml');
  validateExactAtomLink(root, 'self', ATOM_FEED_URL, 'application/atom+xml', 'feed.xml');
  validateExactAtomLink(root, 'alternate', `${CANONICAL_ORIGIN}/`, 'text/html', 'feed.xml');
  validateExactAtomLink(root, 'hub', ATOM_HUB_URL, undefined, 'feed.xml');

  const feedLinks = directXmlElements(root, 'link');
  const expectedFeedLinkRels = new Set(['self', 'alternate', 'hub']);
  for (const link of feedLinks) {
    const rel = link.attributes.rel?.trim() ?? '';
    if (!expectedFeedLinkRels.has(rel)) fail(`feed.xml: unexpected feed-level link relation ${JSON.stringify(rel)}`);
  }
  if (feedLinks.length !== expectedFeedLinkRels.size) {
    fail(`feed.xml: expected exactly ${expectedFeedLinkRels.size} feed-level links, found ${feedLinks.length}`);
  }

  const authors = directXmlElements(root, 'author');
  if (authors.length !== 1) fail(`feed.xml: expected exactly one <author> element, found ${authors.length}`);
  if (authors[0]) singleXmlText(authors[0], 'name', 'feed.xml author');

  const feedUpdatedValue = singleXmlText(root, 'updated', 'feed.xml');
  const feedUpdated = parseRfc3339(feedUpdatedValue, 'feed.xml <updated>');
  const entries = directXmlElements(root, 'entry');
  if (entries.length < 1 || entries.length > 50) {
    fail(`feed.xml: must contain between 1 and 50 recent entries, found ${entries.length}`);
  }

  const entryIds = new Set();
  const entryLinks = new Set();
  let previousUpdated = Number.POSITIVE_INFINITY;
  let maximumUpdated = Number.NEGATIVE_INFINITY;

  for (const [index, entry] of entries.entries()) {
    const entryLabel = `feed.xml entry ${index + 1}`;
    const id = singleXmlText(entry, 'id', entryLabel);
    singleXmlText(entry, 'title', entryLabel);
    singleXmlText(entry, 'summary', entryLabel);
    const categories = directXmlElements(entry, 'category');
    if (categories.length !== 1) {
      fail(`${entryLabel}: expected exactly one <category> element, found ${categories.length}`);
    }
    if (categories[0] && !(categories[0].attributes.term?.trim())) {
      fail(`${entryLabel}: <category> must have a non-empty term attribute`);
    }
    const idUrl = parseCanonicalAtomUrl(id, `${entryLabel} <id>`);
    if (entryIds.has(id)) fail(`${entryLabel}: duplicate <id> ${id}`);
    entryIds.add(id);

    const links = directXmlElements(entry, 'link');
    if (links.length !== 1) fail(`${entryLabel}: expected exactly one <link> element, found ${links.length}`);
    const alternateLinks = links.filter((link) => link.attributes.rel?.trim() === 'alternate');
    if (alternateLinks.length !== 1) {
      fail(`${entryLabel}: expected exactly one <link rel="alternate"> element, found ${alternateLinks.length}`);
    }
    const alternateLink = alternateLinks[0] ?? null;
    const href = alternateLink?.attributes.href?.trim() ?? '';
    const hrefUrl = href ? parseCanonicalAtomUrl(href, `${entryLabel} alternate link`) : null;
    if (alternateLink && (alternateLink.attributes.type?.trim() ?? '') !== 'text/html') {
      fail(`${entryLabel}: alternate link type must be text/html`);
    }
    if (href !== id) fail(`${entryLabel}: <id> and alternate link href must be identical`);
    if (entryLinks.has(href)) fail(`${entryLabel}: duplicate alternate link ${href}`);
    entryLinks.add(href);

    const publishedValue = singleXmlText(entry, 'published', entryLabel);
    const updatedValue = singleXmlText(entry, 'updated', entryLabel);
    const published = parseRfc3339(publishedValue, `${entryLabel} <published>`);
    const updated = parseRfc3339(updatedValue, `${entryLabel} <updated>`);
    if (published !== null && updated !== null && updated < published) {
      fail(`${entryLabel}: <updated> must not be earlier than <published>`);
    }
    if (updated !== null) {
      if (updated > previousUpdated) fail(`${entryLabel}: entries must be ordered by nonincreasing <updated> time`);
      previousUpdated = updated;
      maximumUpdated = Math.max(maximumUpdated, updated);
    }

    const canonicalHref = hrefUrl?.href ?? idUrl?.href ?? '';
    if (!canonicalHref) continue;
    if (!sitemapUrlSet.has(canonicalHref)) fail(`${entryLabel}: ${canonicalHref} is missing from sitemap.xml`);
    const staticFile = await staticFileForUrl(distRoot, hrefUrl ?? idUrl);
    if (!staticFile || !staticFile.toLowerCase().endsWith('.html')) {
      fail(`${entryLabel}: ${canonicalHref} has no corresponding static HTML page`);
      continue;
    }
    const page = htmlByPath.get(staticFile) ?? (await readFile(staticFile, 'utf8'));
    const canonicals = canonicalValues(page);
    if (canonicals.length !== 1) {
      fail(`${entryLabel}: corresponding page must have exactly one canonical link, found ${canonicals.length}`);
    } else {
      const canonical = normalizeUrl(canonicals[0], CANONICAL_ORIGIN, entryLabel);
      if (canonical?.href !== canonicalHref) {
        fail(`${entryLabel}: ${canonicalHref} does not match its page canonical ${canonicals[0]}`);
      }
    }
  }

  if (feedUpdated !== null && Number.isFinite(maximumUpdated) && feedUpdated !== maximumUpdated) {
    fail('feed.xml: feed <updated> must equal the maximum entry <updated> time');
  }
  return entries.length;
}

async function main() {
  let distRoot;
  try {
    distRoot = await realpath(DIST_ROOT);
    if (!(await stat(distRoot)).isDirectory()) throw new Error('not a directory');
  } catch (error) {
    console.error(`SEO smoke check failed: dist directory is unavailable at ${DIST_ROOT} (${error.message})`);
    process.exitCode = 1;
    return;
  }

  const allFiles = await walkFiles(distRoot);
  const htmlFiles = allFiles.filter((path) => path.toLowerCase().endsWith('.html'));
  const htmlByPath = new Map();
  for (const path of htmlFiles) htmlByPath.set(path, await readFile(path, 'utf8'));
  validateMetadataUniqueness(htmlByPath, distRoot);

  const homepagePath = join(distRoot, 'index.html');
  const homepage = htmlByPath.get(homepagePath) ?? (await readRequired(homepagePath, 'homepage'));
  if (homepage !== null) {
    validatePageBasics(homepage, 'homepage', `${CANONICAL_ORIGIN}/`, { requireJson: false, requireParsing: false });
    validateAtomAutodiscovery(homepage, 'homepage');
    const homepageTitle = titleValues(homepage)[0] || '';
    const homepageH1 = h1Values(homepage)[0] || '';
    if (!/\bliveparse\b/i.test(homepageTitle)) fail('homepage: title must name the LiveParse brand');
    if (!/\bliveparse\b/i.test(homepageH1)) fail('homepage: H1 must name the LiveParse brand');
    if (!/\bdeveloper\s+tools\b/i.test(homepageTitle)) fail('homepage: title must describe the developer tools hub');
    if (!/href="\/json-formatter\/"/.test(homepage)) fail('homepage: must link to the JSON formatter page');
  }

  const guidesIndexPath = join(distRoot, 'guides', 'index.html');
  const guidesIndex = htmlByPath.get(guidesIndexPath) ?? (await readRequired(guidesIndexPath, 'guides hub'));
  if (guidesIndex !== null) validateAtomAutodiscovery(guidesIndex, 'guides hub');

  const robotsPath = join(distRoot, 'robots.txt');
  const sitemapPath = join(distRoot, 'sitemap.xml');
  const feedPath = join(distRoot, 'feed.xml');
  const [robots, sitemap, feed] = await Promise.all([
    readRequired(robotsPath, 'robots.txt'),
    readRequired(sitemapPath, 'sitemap.xml'),
    readRequired(feedPath, 'feed.xml'),
  ]);

  if (robots !== null) {
    if (!/^\s*user-agent\s*:/im.test(robots)) fail('robots.txt: missing User-agent directive');
    if (/^\s*disallow\s*:\s*\/\s*(?:#.*)?$/im.test(robots)) fail('robots.txt: the entire site is disallowed');
    const declaredSitemaps = [...robots.matchAll(/^\s*sitemap\s*:\s*(\S+)\s*$/gim)].map((match) => match[1]);
    if (declaredSitemaps.length !== EXPECTED_ROBOTS_SITEMAPS.size) {
      fail(`robots.txt: expected exactly ${EXPECTED_ROBOTS_SITEMAPS.size} Sitemap declarations, found ${declaredSitemaps.length}`);
    }
    const uniqueDeclarations = new Set();
    for (const declaredSitemap of declaredSitemaps) {
      let url;
      try {
        url = new URL(declaredSitemap);
      } catch {
        fail(`robots.txt: invalid sitemap declaration ${declaredSitemap}`);
        continue;
      }
      if (url.protocol !== 'https:' || url.origin !== CANONICAL_ORIGIN || url.search || url.hash) {
        fail(`robots.txt: non-canonical sitemap declaration ${declaredSitemap}`);
      }
      if (url.href !== declaredSitemap) fail(`robots.txt: sitemap URL is not in canonical serialized form (${declaredSitemap})`);
      if (uniqueDeclarations.has(url.href)) fail(`robots.txt: duplicate sitemap declaration ${url.href}`);
      uniqueDeclarations.add(url.href);
      if (!EXPECTED_ROBOTS_SITEMAPS.has(url.href)) fail(`robots.txt: unexpected sitemap declaration ${url.href}`);
    }
    for (const expectedUrl of EXPECTED_ROBOTS_SITEMAPS) {
      if (!uniqueDeclarations.has(expectedUrl)) fail(`robots.txt: must declare ${expectedUrl}`);
    }
  }

  const sitemapUrls = [];
  const sitemapUrlSet = new Set();
  if (sitemap !== null) {
    if (!/<urlset\b/i.test(sitemap)) fail('sitemap.xml: missing <urlset> root');
    const locations = [...sitemap.matchAll(/<loc\b[^>]*>([\s\S]*?)<\/loc\s*>/gi)].map((match) => plainText(match[1]));
    if (locations.length === 0) fail('sitemap.xml: contains no <loc> URLs');

    for (const location of locations) {
      let url;
      try {
        url = new URL(location);
      } catch {
        fail(`sitemap.xml: invalid URL ${JSON.stringify(location)}`);
        continue;
      }
      if (url.origin !== CANONICAL_ORIGIN || url.protocol !== 'https:') {
        fail(`sitemap.xml: non-canonical URL ${url.href}`);
      }
      if (url.search || url.hash) fail(`sitemap.xml: URL must not contain a query or fragment (${url.href})`);
      if (sitemapUrlSet.has(url.href)) fail(`sitemap.xml: duplicate URL ${url.href}`);
      sitemapUrlSet.add(url.href);
      sitemapUrls.push(url);

      const staticFile = await staticFileForUrl(distRoot, url);
      if (!staticFile) {
        fail(`sitemap.xml: ${url.href} has no corresponding static file`);
        continue;
      }
      if (staticFile.toLowerCase().endsWith('.html')) {
        const page = htmlByPath.get(staticFile) ?? (await readFile(staticFile, 'utf8'));
        const canonicals = canonicalValues(page);
        if (canonicals.length === 1 && normalizeUrl(canonicals[0], CANONICAL_ORIGIN, staticFile)?.href !== url.href) {
          fail(`sitemap.xml: ${url.href} does not match its page canonical ${canonicals[0]}`);
        }
      }
    }
    if (!sitemapUrlSet.has(`${CANONICAL_ORIGIN}/`)) fail('sitemap.xml: homepage URL is missing');
  }

  const feedEntryCount = feed === null ? 0 : await validateAtomFeed(feed, distRoot, htmlByPath, sitemapUrlSet);

  for (const requirement of requiredPages) {
    const pagePath = join(distRoot, requirement.relativePath);
    const page = htmlByPath.get(pagePath) ?? (await readRequired(pagePath, requirement.label));
    if (page === null) continue;
    validatePageBasics(page, requirement.label, requirement.canonical, {
      minimumCharacters: requirement.minimumCharacters ?? 200,
      minimumWords: requirement.minimumWords ?? 30,
      requireJson: requirement.requireJson ?? true,
      requireParsing: requirement.requireParsing ?? true,
    });
    const expectedHreflangs = EXPECTED_HREFLANGS.get(requirement.canonical);
    if (expectedHreflangs) validateHreflangAlternates(page, requirement.label, expectedHreflangs);
    validateJsonLd(page, requirement.label, requirement.requireJsonLd ?? (requirement.requireJson ?? true));
    if (requirement.relativePath === 'ascii-table/index.html') {
      validateAsciiTableRows(page, requirement.label);
    }
    if (requirement.relativePath === 'json-formatter/index.html') {
      const pageTitle = titleValues(page)[0] || '';
      const pageH1 = h1Values(page)[0] || '';
      if (!/\bjson\s+formatter\b/i.test(pageTitle)) fail(`${requirement.label}: title must target the phrase "JSON Formatter"`);
      if (!/\bjson\s+formatter\b/i.test(pageH1)) fail(`${requirement.label}: H1 must target the phrase "JSON Formatter"`);
      if (!/\bviewer\b/i.test(pageTitle)) fail(`${requirement.label}: title must target JSON viewer intent`);
      if (!/\bviewer\b/i.test(pageH1)) fail(`${requirement.label}: H1 must target JSON viewer intent`);
    }
    if (requirement.topicPattern) {
      const topicFields = [
        ['title', titleValues(page)[0] || ''],
        ['meta description', descriptionValues(page)[0] || ''],
        ['H1', h1Values(page)[0] || ''],
        ['visible copy', visibleText(page)],
      ];
      for (const [field, value] of topicFields) {
        if (!requirement.topicPattern.test(value)) {
          fail(`${requirement.label}: ${field} must mention ${requirement.topicLabel}`);
        }
      }
    }
    if (requirement.forbiddenHeadingPattern) {
      const claimFields = [
        ['title', titleValues(page)[0] || ''],
        ['H1', h1Values(page)[0] || ''],
      ];
      for (const [field, value] of claimFields) {
        if (requirement.forbiddenHeadingPattern.test(value)) {
          fail(`${requirement.label}: ${field} must not claim ${requirement.forbiddenHeadingLabel ?? 'XSD or XML Schema validation'}`);
        }
      }
    }
    if (!sitemapUrlSet.has(requirement.canonical)) fail(`${requirement.label}: missing from sitemap.xml`);
  }

  const guideFiles = htmlFiles.filter((path) => isGuideHtml(relative(distRoot, path)));
  const expectedGuideUrls = new Map();
  for (const path of guideFiles) {
    const relativePath = relative(distRoot, path);
    const publicPath = publicPathForHtml(relativePath);
    const expectedUrl = new URL(publicPath, CANONICAL_ORIGIN).href;
    expectedGuideUrls.set(expectedUrl, path);
    const page = htmlByPath.get(path);
    const profile = guideValidationProfile(relativePath);
    validatePageBasics(page, `guide ${publicPath}`, expectedUrl, profile);
    const topicFields = [
      ['title', titleValues(page)[0] || ''],
      ['meta description', descriptionValues(page)[0] || ''],
      ['H1', h1Values(page)[0] || ''],
      ['visible copy', visibleText(page)],
    ];
    for (const [field, value] of topicFields) {
      if (!profile.topicPattern.test(value)) {
        fail(`guide ${publicPath}: ${field} must mention ${profile.topicLabel}`);
      }
    }
    if (!sitemapUrlSet.has(expectedUrl)) fail(`guide ${publicPath}: missing from sitemap.xml`);
  }
  if (guidesIndex !== null) validateGuideItemList(guidesIndex, expectedGuideUrls);

  const guidesHubUrl = `${CANONICAL_ORIGIN}/guides/`;
  const inboundGuideSources = new Map([...expectedGuideUrls.keys()].map((url) => [url, new Set()]));
  const canonicalAdjacency = new Map([...sitemapUrlSet].map((url) => [url, new Set()]));
  const uniqueInternalEdges = new Set();
  let internalLinkCount = 0;
  const checkedTargets = new Map();
  for (const [path, html] of htmlByPath) {
    const sourcePublicPath = publicPathForHtml(relative(distRoot, path));
    const sourceUrl = new URL(sourcePublicPath, CANONICAL_ORIGIN);
    if (FAQ_PARITY_PATHS.has(sourcePublicPath)) validateFaqParity(html, `page ${sourcePublicPath}`);
    for (const href of extractLinks(html)) {
      if (/^(?:#|mailto:|tel:|javascript:|data:)/i.test(href)) continue;
      const target = normalizeUrl(href, sourceUrl, `page ${sourcePublicPath}`);
      if (!target || target.origin !== CANONICAL_ORIGIN) continue;
      internalLinkCount += 1;
      const targetWithoutFragment = new URL(target.href);
      targetWithoutFragment.hash = '';
      const guideTarget = targetWithoutFragment.href;
      if (inboundGuideSources.has(guideTarget) && guideTarget !== sourceUrl.href) {
        inboundGuideSources.get(guideTarget).add(sourceUrl.href);
      }
      if (sitemapUrlSet.has(sourceUrl.href) && sitemapUrlSet.has(targetWithoutFragment.href)) {
        canonicalAdjacency.get(sourceUrl.href).add(targetWithoutFragment.href);
        uniqueInternalEdges.add(`${sourceUrl.href}\n${targetWithoutFragment.href}`);
      }

      const lookupKey = `${targetWithoutFragment.pathname}${targetWithoutFragment.search}`;
      if (!checkedTargets.has(lookupKey)) {
        checkedTargets.set(lookupKey, await staticFileForUrl(distRoot, targetWithoutFragment));
      }
      if (!checkedTargets.get(lookupKey)) {
        fail(`page ${sourcePublicPath}: broken internal link ${JSON.stringify(href)}`);
      }
    }
    validateJsonLd(html, path === homepagePath ? 'homepage' : `page ${sourcePublicPath}`, path === homepagePath);
  }

  for (const [url, sources] of inboundGuideSources) {
    const pathname = new URL(url).pathname;
    if (!sources.has(guidesHubUrl)) fail(`guide ${pathname}: is not linked from the /guides/ hub`);
    if (sources.size < 2) {
      fail(`guide ${pathname}: needs at least two unique inbound source pages, found ${sources.size}`);
    }
  }

  const homepageUrl = `${CANONICAL_ORIGIN}/`;
  const clickDepth = new Map([[homepageUrl, 0]]);
  const queue = [homepageUrl];
  while (queue.length > 0) {
    const source = queue.shift();
    const nextDepth = clickDepth.get(source) + 1;
    for (const target of canonicalAdjacency.get(source) ?? []) {
      if (clickDepth.has(target)) continue;
      clickDepth.set(target, nextDepth);
      queue.push(target);
    }
  }
  for (const url of sitemapUrlSet) {
    if (!clickDepth.has(url)) fail(`sitemap page ${new URL(url).pathname}: is not reachable from the homepage`);
    else if (clickDepth.get(url) > 2) {
      fail(`sitemap page ${new URL(url).pathname}: is ${clickDepth.get(url)} clicks from the homepage; maximum is 2`);
    }
  }

  if (failures.length > 0) {
    console.error(`SEO smoke check failed with ${failures.length} issue${failures.length === 1 ? '' : 's'}:`);
    failures.forEach((message) => console.error(`- ${message}`));
    process.exitCode = 1;
    return;
  }

  console.log(
    `SEO smoke check passed: ${htmlFiles.length} HTML file${htmlFiles.length === 1 ? '' : 's'}, ` +
      `${sitemapUrls.length} sitemap URL${sitemapUrls.length === 1 ? '' : 's'}, ` +
      `${feedEntryCount} Atom feed entr${feedEntryCount === 1 ? 'y' : 'ies'}, ` +
      `${guideFiles.length} guide page${guideFiles.length === 1 ? '' : 's'}, ` +
      `${uniqueInternalEdges.size} unique canonical edge${uniqueInternalEdges.size === 1 ? '' : 's'}, ` +
      `${internalLinkCount} internal link${internalLinkCount === 1 ? '' : 's'}.`,
  );
}

await main();
