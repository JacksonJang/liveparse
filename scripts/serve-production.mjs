#!/usr/bin/env node

import { createReadStream } from 'node:fs';
import { createBrotliCompress, createGzip, constants as zlibConstants } from 'node:zlib';
import { realpath, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ClaimedCrawlerCounter } from '../server/search-crawlers.js';
import { SearchReferralCounter, searchReferralFromRequest } from '../server/search-referrals.js';

const CANONICAL_ORIGIN = 'https://liveparse.com';
const PROJECT_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DIST_ROOT = resolve(process.env.DIST_DIR || resolve(PROJECT_ROOT, 'dist'));
const HOST = process.env.HOST || '0.0.0.0';
const PORT = parsePort(process.env.PORT || '4173');
const SEARCH_REFERRAL_DIR = resolve(PROJECT_ROOT, process.env.SEARCH_REFERRAL_DIR || '.runtime/search-referrals');
const SEARCH_CRAWLER_DIR = resolve(PROJECT_ROOT, process.env.SEARCH_CRAWLER_DIR || '.runtime/search-crawlers');
const DIRECTORY_ROUTES = new Set([
  '/es/contador-de-palabras',
  '/es/contador-de-caracteres',
  '/ko/json-parser',
  '/ko/character-counter',
  '/ja/character-counter',
  '/ko/word-counter',
  '/ja/word-counter',
  '/ja/json-formatter',
  '/es/formateador-json',
  '/es/generador-timestamp-discord',
  '/es/guides/discord-timestamp-formats',
  '/json-formatter',
  '/json-repair',
  '/jsonl-parser',
  '/json-to-csv',
  '/csv-to-json',
  '/json-compare',
  '/unix-timestamp-converter',
  '/discord-timestamp-generator',
  '/base64-decoder',
  '/base64-encoder',
  '/binary-converter',
  '/hex-converter',
  '/binary-translator',
  '/ascii-table',
  '/morse-code-translator',
  '/image-compressor',
  '/compress-image-to-20kb',
  '/compress-image-to-50kb',
  '/compress-image-to-100kb',
  '/compress-image-to-200kb',
  '/compress-image-to-500kb',
  '/compress-image-to-1mb',
  '/image-resizer',
  '/png-to-jpg',
  '/webp-to-jpg',
  '/webp-to-png',
  '/age-calculator',
  '/age-calculator-on-specific-date',
  '/date-calculator',
  '/days-between-dates',
  '/business-days-calculator',
  '/2-business-days-from-today',
  '/3-business-days-from-today',
  '/4-business-days-from-today',
  '/5-business-days-from-today',
  '/7-business-days-from-today',
  '/10-business-days-from-today',
  '/14-business-days-from-today',
  '/15-business-days-from-today',
  '/20-business-days-from-today',
  '/30-business-days-from-today',
  '/45-business-days-from-today',
  '/morse-code-alphabet',
  '/time-duration-calculator',
  '/week-number-calculator',
  '/birthday-countdown',
  '/word-counter',
  '/character-counter',
  '/url-encoder',
  '/url-decoder',
  '/url-parser',
  '/query-string-parser',
  '/hash-generator',
  '/sha256-generator',
  '/md5-generator',
  '/file-checksum',
  '/uuid-generator',
  '/uuid-v4-generator',
  '/uuid-v7-generator',
  '/uuid-validator',
  '/uuid-decoder',
  '/jwt-decoder',
  '/jwt-expiration-checker',
  '/sql-formatter',
  '/mysql-sql-formatter',
  '/postgresql-sql-formatter',
  '/bigquery-sql-formatter',
  '/sql-server-formatter',
  '/xml-formatter',
  '/xml-validator',
  '/xml-viewer',
  '/yaml-formatter',
  '/yaml-validator',
  '/yaml-viewer',
  '/yaml-to-json',
  '/json-to-yaml',
  '/privacy',
  '/about',
  '/guides',
  '/guides/what-is-a-json-parser',
  '/guides/common-json-errors',
  '/guides/json-parser-vs-formatter-validator',
  '/guides/compare-api-responses',
  '/guides/compare-json-ignore-order',
  '/guides/unix-timestamp-seconds-vs-milliseconds',
  '/guides/unix-timestamp-code-examples',
  '/guides/discord-timestamp-formats',
  '/guides/base64-vs-base64url',
  '/guides/binary-decimal-hex-octal-conversion',
  '/guides/twos-complement-signed-binary',
  '/guides/ascii-vs-unicode-utf8',
  '/guides/how-word-counting-works',
  '/guides/grapheme-clusters-vs-code-points-and-bytes',
  '/guides/international-morse-code',
  '/guides/image-compression-formats-and-file-size',
  '/guides/calendar-date-arithmetic-dst-leap-years',
  '/guides/uuid-v4-vs-v7',
  '/guides/uuid-versions-explained',
  '/guides/uuid-collision-probability',
  '/guides/jwt-decode-vs-verify',
  '/guides/sql-dialect-formatting',
  '/guides/xml-well-formed-vs-valid',
  '/guides/yaml-1-1-vs-1-2',
  '/guides/yaml-to-json-types',
  '/guides/yaml-anchors-aliases-merge-keys',
  '/guides/common-yaml-errors',
  '/guides/sha256-vs-md5',
  '/guides/hash-vs-encryption',
  '/guides/how-to-verify-file-checksum',
  '/guides/hashing-utf8-newlines',
  '/guides/url-percent-encoding',
  '/guides/encodeuri-vs-encodeuricomponent',
  '/guides/percent20-vs-plus',
  '/guides/double-url-encoding',
]);
const ROUTE_REDIRECTS = new Map([
  ['/json-parser', '/json-formatter/'],
  ['/json-parser/', '/json-formatter/'],
  ['/json-validator', '/json-formatter/'],
  ['/json-validator/', '/json-formatter/'],
  ['/json-beautifier', '/json-formatter/'],
  ['/json-beautifier/', '/json-formatter/'],
  ['/json-viewer', '/json-formatter/'],
  ['/json-viewer/', '/json-formatter/'],
  ['/format-json', '/json-formatter/'],
  ['/format-json/', '/json-formatter/'],
  ['/parse-json', '/json-formatter/'],
  ['/parse-json/', '/json-formatter/'],
  ['/json-diff', '/json-compare/'],
  ['/json-diff/', '/json-compare/'],
  ['/json-diff-checker', '/json-compare/'],
  ['/json-diff-checker/', '/json-compare/'],
  ['/epoch-converter', '/unix-timestamp-converter/'],
  ['/epoch-converter/', '/unix-timestamp-converter/'],
  ['/epoch-time-converter', '/unix-timestamp-converter/'],
  ['/epoch-time-converter/', '/unix-timestamp-converter/'],
  ['/timestamp-converter', '/unix-timestamp-converter/'],
  ['/timestamp-converter/', '/unix-timestamp-converter/'],
  ['/unix-time-converter', '/unix-timestamp-converter/'],
  ['/unix-time-converter/', '/unix-timestamp-converter/'],
  ['/discord-timestamp', '/discord-timestamp-generator/'],
  ['/discord-timestamp/', '/discord-timestamp-generator/'],
  ['/discord-timestamp-converter', '/discord-timestamp-generator/'],
  ['/discord-timestamp-converter/', '/discord-timestamp-generator/'],
  ['/discord-time-converter', '/discord-timestamp-generator/'],
  ['/discord-time-converter/', '/discord-timestamp-generator/'],
  ['/discord-time-generator', '/discord-timestamp-generator/'],
  ['/discord-time-generator/', '/discord-timestamp-generator/'],
  ['/base64-decode', '/base64-decoder/'],
  ['/base64-decode/', '/base64-decoder/'],
  ['/base64-encode', '/base64-encoder/'],
  ['/base64-encode/', '/base64-encoder/'],
  ['/base64-encoder-decoder', '/base64-decoder/'],
  ['/base64-encoder-decoder/', '/base64-decoder/'],
  ['/binary-to-decimal', '/binary-converter/'],
  ['/binary-to-decimal/', '/binary-converter/'],
  ['/decimal-to-binary', '/binary-converter/'],
  ['/decimal-to-binary/', '/binary-converter/'],
  ['/base-converter', '/binary-converter/'],
  ['/base-converter/', '/binary-converter/'],
  ['/number-base-converter', '/binary-converter/'],
  ['/number-base-converter/', '/binary-converter/'],
  ['/hex-to-decimal', '/hex-converter/'],
  ['/hex-to-decimal/', '/hex-converter/'],
  ['/decimal-to-hex', '/hex-converter/'],
  ['/decimal-to-hex/', '/hex-converter/'],
  ['/hexadecimal-converter', '/hex-converter/'],
  ['/hexadecimal-converter/', '/hex-converter/'],
  ['/binary-to-text', '/binary-translator/'],
  ['/binary-to-text/', '/binary-translator/'],
  ['/text-to-binary', '/binary-translator/'],
  ['/text-to-binary/', '/binary-translator/'],
  ['/ascii-chart', '/ascii-table/'],
  ['/ascii-chart/', '/ascii-table/'],
  ['/ascii-code-table', '/ascii-table/'],
  ['/ascii-code-table/', '/ascii-table/'],
  ['/ascii-codes', '/ascii-table/'],
  ['/ascii-codes/', '/ascii-table/'],
  ['/morse-code-decoder', '/morse-code-translator/'],
  ['/morse-code-decoder/', '/morse-code-translator/'],
  ['/morse-translator', '/morse-code-translator/'],
  ['/morse-translator/', '/morse-code-translator/'],
  ['/text-to-morse-code', '/morse-code-translator/'],
  ['/text-to-morse-code/', '/morse-code-translator/'],
  ['/morse-code-converter', '/morse-code-translator/'],
  ['/morse-code-converter/', '/morse-code-translator/'],
  ['/compress-image', '/image-compressor/'],
  ['/compress-image/', '/image-compressor/'],
  ['/compress-jpeg-to-100kb', '/compress-image-to-100kb/'],
  ['/compress-jpeg-to-100kb/', '/compress-image-to-100kb/'],
  ['/compress-png-to-100kb', '/compress-image-to-100kb/'],
  ['/compress-png-to-100kb/', '/compress-image-to-100kb/'],
  ['/compress-jpeg-to-200kb', '/compress-image-to-200kb/'],
  ['/compress-jpeg-to-200kb/', '/compress-image-to-200kb/'],
  ['/compress-image-to-1024kb', '/compress-image-to-1mb/'],
  ['/compress-image-to-1024kb/', '/compress-image-to-1mb/'],
  ['/reduce-image-size-to-100kb', '/compress-image-to-100kb/'],
  ['/reduce-image-size-to-100kb/', '/compress-image-to-100kb/'],
  ['/compress-photo-to-1mb', '/compress-image-to-1mb/'],
  ['/compress-photo-to-1mb/', '/compress-image-to-1mb/'],
  ['/image-compress', '/image-compressor/'],
  ['/image-compress/', '/image-compressor/'],
  ['/photo-compressor', '/image-compressor/'],
  ['/photo-compressor/', '/image-compressor/'],
  ['/reduce-image-size', '/image-compressor/'],
  ['/reduce-image-size/', '/image-compressor/'],
  ['/reduce-image-size-in-kb', '/image-compressor/'],
  ['/reduce-image-size-in-kb/', '/image-compressor/'],
  ['/resize-image', '/image-resizer/'],
  ['/resize-image/', '/image-resizer/'],
  ['/photo-resizer', '/image-resizer/'],
  ['/photo-resizer/', '/image-resizer/'],
  ['/resize-photo', '/image-resizer/'],
  ['/resize-photo/', '/image-resizer/'],
  ['/pixel-resizer', '/image-resizer/'],
  ['/pixel-resizer/', '/image-resizer/'],
  ['/png-to-jpeg', '/png-to-jpg/'],
  ['/png-to-jpeg/', '/png-to-jpg/'],
  ['/convert-png-to-jpg', '/png-to-jpg/'],
  ['/convert-png-to-jpg/', '/png-to-jpg/'],
  ['/convert-png-to-jpeg', '/png-to-jpg/'],
  ['/convert-png-to-jpeg/', '/png-to-jpg/'],
  ['/webp-to-jpeg', '/webp-to-jpg/'],
  ['/webp-to-jpeg/', '/webp-to-jpg/'],
  ['/convert-webp-to-jpg', '/webp-to-jpg/'],
  ['/convert-webp-to-jpg/', '/webp-to-jpg/'],
  ['/convert-webp-to-jpeg', '/webp-to-jpg/'],
  ['/convert-webp-to-jpeg/', '/webp-to-jpg/'],
  ['/convert-webp-to-png', '/webp-to-png/'],
  ['/convert-webp-to-png/', '/webp-to-png/'],
  ['/calculate-age', '/age-calculator/'],
  ['/calculate-age/', '/age-calculator/'],
  ['/date-of-birth-calculator', '/age-calculator/'],
  ['/date-of-birth-calculator/', '/age-calculator/'],
  ['/dob-calculator', '/age-calculator/'],
  ['/dob-calculator/', '/age-calculator/'],
  ['/how-old-am-i', '/age-calculator/'],
  ['/how-old-am-i/', '/age-calculator/'],
  ['/age-on-date', '/age-calculator-on-specific-date/'],
  ['/age-on-date/', '/age-calculator-on-specific-date/'],
  ['/chronological-age-calculator', '/age-calculator-on-specific-date/'],
  ['/chronological-age-calculator/', '/age-calculator-on-specific-date/'],
  ['/add-days-to-date', '/date-calculator/'],
  ['/add-days-to-date/', '/date-calculator/'],
  ['/date-add-calculator', '/date-calculator/'],
  ['/date-add-calculator/', '/date-calculator/'],
  ['/days-from-today', '/date-calculator/'],
  ['/days-from-today/', '/date-calculator/'],
  ['/date-difference-calculator', '/days-between-dates/'],
  ['/date-difference-calculator/', '/days-between-dates/'],
  ['/day-counter', '/days-between-dates/'],
  ['/day-counter/', '/days-between-dates/'],
  ['/days-calculator', '/days-between-dates/'],
  ['/days-calculator/', '/days-between-dates/'],
  ['/working-days-calculator', '/business-days-calculator/'],
  ['/working-days-calculator/', '/business-days-calculator/'],
  ['/workdays-calculator', '/business-days-calculator/'],
  ['/workdays-calculator/', '/business-days-calculator/'],
  ['/business-days-from-today', '/business-days-calculator/'],
  ['/business-days-from-today/', '/business-days-calculator/'],
  ['/business-day-calculator', '/business-days-calculator/'],
  ['/business-day-calculator/', '/business-days-calculator/'],
  ['/morse-alphabet', '/morse-code-alphabet/'],
  ['/morse-alphabet/', '/morse-code-alphabet/'],
  ['/morse-code-chart', '/morse-code-alphabet/'],
  ['/morse-code-chart/', '/morse-code-alphabet/'],
  ['/morse-code-letters', '/morse-code-alphabet/'],
  ['/morse-code-letters/', '/morse-code-alphabet/'],
  ['/morse-code-numbers', '/morse-code-alphabet/'],
  ['/morse-code-numbers/', '/morse-code-alphabet/'],
  ['/hours-calculator', '/time-duration-calculator/'],
  ['/hours-calculator/', '/time-duration-calculator/'],
  ['/time-difference-calculator', '/time-duration-calculator/'],
  ['/time-difference-calculator/', '/time-duration-calculator/'],
  ['/iso-week-number', '/week-number-calculator/'],
  ['/iso-week-number/', '/week-number-calculator/'],
  ['/week-number', '/week-number-calculator/'],
  ['/week-number/', '/week-number-calculator/'],
  ['/birthday-calculator', '/birthday-countdown/'],
  ['/birthday-calculator/', '/birthday-countdown/'],
  ['/days-until-my-birthday', '/birthday-countdown/'],
  ['/days-until-my-birthday/', '/birthday-countdown/'],
  ['/word-count', '/word-counter/'],
  ['/word-count/', '/word-counter/'],
  ['/word-count-checker', '/word-counter/'],
  ['/word-count-checker/', '/word-counter/'],
  ['/character-count', '/character-counter/'],
  ['/character-count/', '/character-counter/'],
  ['/letter-counter', '/character-counter/'],
  ['/letter-counter/', '/character-counter/'],
  ['/es/contador-palabras', '/word-counter/'],
  ['/es/contador-palabras/', '/word-counter/'],
  ['/es/contar-palabras', '/word-counter/'],
  ['/es/contar-palabras/', '/word-counter/'],
  ['/es/contador-caracteres', '/character-counter/'],
  ['/es/contador-caracteres/', '/character-counter/'],
  ['/es/contar-caracteres', '/character-counter/'],
  ['/es/contar-caracteres/', '/character-counter/'],
  ['/url-encode', '/url-encoder/'],
  ['/url-encode/', '/url-encoder/'],
  ['/encode-url', '/url-encoder/'],
  ['/encode-url/', '/url-encoder/'],
  ['/urlencode', '/url-encoder/'],
  ['/urlencode/', '/url-encoder/'],
  ['/percent-encoder', '/url-encoder/'],
  ['/percent-encoder/', '/url-encoder/'],
  ['/url-decode', '/url-decoder/'],
  ['/url-decode/', '/url-decoder/'],
  ['/decode-url', '/url-decoder/'],
  ['/decode-url/', '/url-decoder/'],
  ['/urldecode', '/url-decoder/'],
  ['/urldecode/', '/url-decoder/'],
  ['/percent-decoder', '/url-decoder/'],
  ['/percent-decoder/', '/url-decoder/'],
  ['/parse-url', '/url-parser/'],
  ['/parse-url/', '/url-parser/'],
  ['/url-inspector', '/url-parser/'],
  ['/url-inspector/', '/url-parser/'],
  ['/url-analyzer', '/url-parser/'],
  ['/url-analyzer/', '/url-parser/'],
  ['/query-string', '/query-string-parser/'],
  ['/query-string/', '/query-string-parser/'],
  ['/query-parser', '/query-string-parser/'],
  ['/query-parser/', '/query-string-parser/'],
  ['/parse-query-string', '/query-string-parser/'],
  ['/parse-query-string/', '/query-string-parser/'],
  ['/url-query-parser', '/query-string-parser/'],
  ['/url-query-parser/', '/query-string-parser/'],
  ['/hash', '/hash-generator/'],
  ['/hash/', '/hash-generator/'],
  ['/hashing-tool', '/hash-generator/'],
  ['/hashing-tool/', '/hash-generator/'],
  ['/online-hash-generator', '/hash-generator/'],
  ['/online-hash-generator/', '/hash-generator/'],
  ['/sha-256-generator', '/sha256-generator/'],
  ['/sha-256-generator/', '/sha256-generator/'],
  ['/sha256-hash', '/sha256-generator/'],
  ['/sha256-hash/', '/sha256-generator/'],
  ['/sha256', '/sha256-generator/'],
  ['/sha256/', '/sha256-generator/'],
  ['/md5-hash-generator', '/md5-generator/'],
  ['/md5-hash-generator/', '/md5-generator/'],
  ['/md5-hash', '/md5-generator/'],
  ['/md5-hash/', '/md5-generator/'],
  ['/md5', '/md5-generator/'],
  ['/md5/', '/md5-generator/'],
  ['/checksum', '/file-checksum/'],
  ['/checksum/', '/file-checksum/'],
  ['/checksum-calculator', '/file-checksum/'],
  ['/checksum-calculator/', '/file-checksum/'],
  ['/file-hash', '/file-checksum/'],
  ['/file-hash/', '/file-checksum/'],
  ['/file-hash-calculator', '/file-checksum/'],
  ['/file-hash-calculator/', '/file-checksum/'],
  ['/guid-generator', '/uuid-generator/'],
  ['/guid-generator/', '/uuid-generator/'],
  ['/generate-uuid', '/uuid-generator/'],
  ['/generate-uuid/', '/uuid-generator/'],
  ['/uuid-generator-online', '/uuid-generator/'],
  ['/uuid-generator-online/', '/uuid-generator/'],
  ['/uuid-v4', '/uuid-v4-generator/'],
  ['/uuid-v4/', '/uuid-v4-generator/'],
  ['/uuid4-generator', '/uuid-v4-generator/'],
  ['/uuid4-generator/', '/uuid-v4-generator/'],
  ['/generate-uuid-v4', '/uuid-v4-generator/'],
  ['/generate-uuid-v4/', '/uuid-v4-generator/'],
  ['/guid-v4-generator', '/uuid-v4-generator/'],
  ['/guid-v4-generator/', '/uuid-v4-generator/'],
  ['/uuid-v7', '/uuid-v7-generator/'],
  ['/uuid-v7/', '/uuid-v7-generator/'],
  ['/uuid-checker', '/uuid-validator/'],
  ['/uuid-checker/', '/uuid-validator/'],
  ['/uuid-decode', '/uuid-decoder/'],
  ['/uuid-decode/', '/uuid-decoder/'],
  ['/decode-uuid', '/uuid-decoder/'],
  ['/decode-uuid/', '/uuid-decoder/'],
  ['/uuid-parser', '/uuid-decoder/'],
  ['/uuid-parser/', '/uuid-decoder/'],
  ['/uuid-inspector', '/uuid-decoder/'],
  ['/uuid-inspector/', '/uuid-decoder/'],
  ['/guid-decoder', '/uuid-decoder/'],
  ['/guid-decoder/', '/uuid-decoder/'],
  ['/jwt-decode', '/jwt-decoder/'],
  ['/jwt-decode/', '/jwt-decoder/'],
  ['/decode-jwt', '/jwt-decoder/'],
  ['/decode-jwt/', '/jwt-decoder/'],
  ['/jwt-parser', '/jwt-decoder/'],
  ['/jwt-parser/', '/jwt-decoder/'],
  ['/jwt-debugger', '/jwt-decoder/'],
  ['/jwt-debugger/', '/jwt-decoder/'],
  ['/jwt-inspector', '/jwt-decoder/'],
  ['/jwt-inspector/', '/jwt-decoder/'],
  ['/jwt-token-decoder', '/jwt-decoder/'],
  ['/jwt-token-decoder/', '/jwt-decoder/'],
  ['/json-web-token-decoder', '/jwt-decoder/'],
  ['/json-web-token-decoder/', '/jwt-decoder/'],
  ['/jwt-exp-checker', '/jwt-expiration-checker/'],
  ['/jwt-exp-checker/', '/jwt-expiration-checker/'],
  ['/jwt-expiry-checker', '/jwt-expiration-checker/'],
  ['/jwt-expiry-checker/', '/jwt-expiration-checker/'],
  ['/jwt-token-expiration-checker', '/jwt-expiration-checker/'],
  ['/jwt-token-expiration-checker/', '/jwt-expiration-checker/'],
  ['/sql-format', '/sql-formatter/'],
  ['/sql-format/', '/sql-formatter/'],
  ['/format-sql', '/sql-formatter/'],
  ['/format-sql/', '/sql-formatter/'],
  ['/sql-query-formatter', '/sql-formatter/'],
  ['/sql-query-formatter/', '/sql-formatter/'],
  ['/sql-beautifier', '/sql-formatter/'],
  ['/sql-beautifier/', '/sql-formatter/'],
  ['/sql-pretty-printer', '/sql-formatter/'],
  ['/sql-pretty-printer/', '/sql-formatter/'],
  ['/online-sql-formatter', '/sql-formatter/'],
  ['/online-sql-formatter/', '/sql-formatter/'],
  ['/mysql-formatter', '/mysql-sql-formatter/'],
  ['/mysql-formatter/', '/mysql-sql-formatter/'],
  ['/mysql-query-formatter', '/mysql-sql-formatter/'],
  ['/mysql-query-formatter/', '/mysql-sql-formatter/'],
  ['/postgresql-formatter', '/postgresql-sql-formatter/'],
  ['/postgresql-formatter/', '/postgresql-sql-formatter/'],
  ['/postgres-formatter', '/postgresql-sql-formatter/'],
  ['/postgres-formatter/', '/postgresql-sql-formatter/'],
  ['/postgres-query-formatter', '/postgresql-sql-formatter/'],
  ['/postgres-query-formatter/', '/postgresql-sql-formatter/'],
  ['/bigquery-formatter', '/bigquery-sql-formatter/'],
  ['/bigquery-formatter/', '/bigquery-sql-formatter/'],
  ['/google-sql-formatter', '/bigquery-sql-formatter/'],
  ['/google-sql-formatter/', '/bigquery-sql-formatter/'],
  ['/tsql-formatter', '/sql-server-formatter/'],
  ['/tsql-formatter/', '/sql-server-formatter/'],
  ['/t-sql-formatter', '/sql-server-formatter/'],
  ['/t-sql-formatter/', '/sql-server-formatter/'],
  ['/mssql-formatter', '/sql-server-formatter/'],
  ['/mssql-formatter/', '/sql-server-formatter/'],
  ['/sql-server-sql-formatter', '/sql-server-formatter/'],
  ['/sql-server-sql-formatter/', '/sql-server-formatter/'],
  ['/xml-format', '/xml-formatter/'],
  ['/xml-format/', '/xml-formatter/'],
  ['/format-xml', '/xml-formatter/'],
  ['/format-xml/', '/xml-formatter/'],
  ['/xml-beautifier', '/xml-formatter/'],
  ['/xml-beautifier/', '/xml-formatter/'],
  ['/xml-pretty-printer', '/xml-formatter/'],
  ['/xml-pretty-printer/', '/xml-formatter/'],
  ['/online-xml-formatter', '/xml-formatter/'],
  ['/online-xml-formatter/', '/xml-formatter/'],
  ['/xml-formatter-online', '/xml-formatter/'],
  ['/xml-formatter-online/', '/xml-formatter/'],
  ['/validate-xml', '/xml-validator/'],
  ['/validate-xml/', '/xml-validator/'],
  ['/xml-validation', '/xml-validator/'],
  ['/xml-validation/', '/xml-validator/'],
  ['/xml-checker', '/xml-validator/'],
  ['/xml-checker/', '/xml-validator/'],
  ['/xml-syntax-checker', '/xml-validator/'],
  ['/xml-syntax-checker/', '/xml-validator/'],
  ['/online-xml-validator', '/xml-validator/'],
  ['/online-xml-validator/', '/xml-validator/'],
  ['/xml-validator-online', '/xml-validator/'],
  ['/xml-validator-online/', '/xml-validator/'],
  ['/view-xml', '/xml-viewer/'],
  ['/view-xml/', '/xml-viewer/'],
  ['/xml-tree-viewer', '/xml-viewer/'],
  ['/xml-tree-viewer/', '/xml-viewer/'],
  ['/online-xml-viewer', '/xml-viewer/'],
  ['/online-xml-viewer/', '/xml-viewer/'],
  ['/xml-viewer-online', '/xml-viewer/'],
  ['/xml-viewer-online/', '/xml-viewer/'],
  ['/yaml-beautifier', '/yaml-formatter/'],
  ['/yaml-beautifier/', '/yaml-formatter/'],
  ['/yaml-prettify', '/yaml-formatter/'],
  ['/yaml-prettify/', '/yaml-formatter/'],
  ['/format-yaml', '/yaml-formatter/'],
  ['/format-yaml/', '/yaml-formatter/'],
  ['/yml-formatter', '/yaml-formatter/'],
  ['/yml-formatter/', '/yaml-formatter/'],
  ['/yml-validator', '/yaml-validator/'],
  ['/yml-validator/', '/yaml-validator/'],
  ['/validate-yaml', '/yaml-validator/'],
  ['/validate-yaml/', '/yaml-validator/'],
  ['/yaml-checker', '/yaml-validator/'],
  ['/yaml-checker/', '/yaml-validator/'],
  ['/yaml-parser', '/yaml-viewer/'],
  ['/yaml-parser/', '/yaml-viewer/'],
  ['/yaml-tree-viewer', '/yaml-viewer/'],
  ['/yaml-tree-viewer/', '/yaml-viewer/'],
  ['/view-yaml', '/yaml-viewer/'],
  ['/view-yaml/', '/yaml-viewer/'],
  ['/convert-yaml-to-json', '/yaml-to-json/'],
  ['/convert-yaml-to-json/', '/yaml-to-json/'],
  ['/yml-to-json', '/yaml-to-json/'],
  ['/yml-to-json/', '/yaml-to-json/'],
  ['/convert-json-to-yaml', '/json-to-yaml/'],
  ['/convert-json-to-yaml/', '/json-to-yaml/'],
  ['/json-to-yml', '/json-to-yaml/'],
  ['/json-to-yml/', '/json-to-yaml/'],
]);
const CANONICAL_METRIC_PATHS = new Set(['/', ...[...DIRECTORY_ROUTES].map((pathname) => `${pathname}/`)]);

const MIME_TYPES = new Map([
  ['.avif', 'image/avif'],
  ['.css', 'text/css; charset=utf-8'],
  ['.gif', 'image/gif'],
  ['.htm', 'text/html; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.otf', 'font/otf'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml; charset=utf-8'],
  ['.ttf', 'font/ttf'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.wasm', 'application/wasm'],
  ['.webmanifest', 'application/manifest+json; charset=utf-8'],
  ['.webp', 'image/webp'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
  ['.xml', 'application/xml; charset=utf-8'],
]);

const SECURITY_HEADERS = Object.freeze({
  'Content-Security-Policy': [
    "default-src 'self'",
    "base-uri 'self'",
    "connect-src 'self'",
    "font-src 'self'",
    "form-action 'self'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "img-src 'self' data: blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "worker-src 'self'",
    'upgrade-insecure-requests',
  ].join('; '),
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), geolocation=(), microphone=(), payment=(), usb=()',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
});

function parsePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`PORT must be an integer from 1 to 65535; received ${JSON.stringify(value)}`);
  }
  return port;
}

function firstHeaderValue(value) {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === 'string' ? raw.split(',', 1)[0].trim() : '';
}

function requestProtocol(request) {
  const forwarded = firstHeaderValue(request.headers['x-forwarded-proto']).toLowerCase();
  if (forwarded) return forwarded.replace(/:$/, '');
  return request.socket.encrypted ? 'https' : 'http';
}

function requestHostname(request) {
  const forwarded = firstHeaderValue(request.headers['x-forwarded-host']);
  const host = forwarded || firstHeaderValue(request.headers.host);
  if (!host) return '';

  try {
    return new URL(`http://${host}`).hostname.toLowerCase();
  } catch {
    return host.replace(/:\d+$/, '').toLowerCase();
  }
}

function normalizeKnownRoutePath(pathname) {
  if (pathname.endsWith('/index.html')) pathname = pathname.slice(0, -'index.html'.length);
  if (ROUTE_REDIRECTS.has(pathname)) return ROUTE_REDIRECTS.get(pathname);
  if (DIRECTORY_ROUTES.has(pathname)) return `${pathname}/`;
  if (pathname === '/index.html') return '/';
  if (pathname.endsWith('/index.html')) return pathname.slice(0, -'index.html'.length);
  return pathname;
}

function setSecurityHeaders(response) {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    response.setHeader(name, value);
  }
}

function sendText(request, response, statusCode, message, extraHeaders = {}) {
  const body = Buffer.from(`${message}\n`, 'utf8');
  response.statusCode = statusCode;
  setSecurityHeaders(response);
  response.setHeader('Content-Type', 'text/plain; charset=utf-8');
  response.setHeader('Content-Length', body.byteLength);
  response.setHeader('Cache-Control', 'no-store');
  for (const [name, value] of Object.entries(extraHeaders)) response.setHeader(name, value);
  response.end(request.method === 'HEAD' ? undefined : body);
}

function redirectToCanonical(request, response) {
  let parsed;
  try {
    parsed = new URL(request.url || '/', 'http://request.invalid');
  } catch {
    parsed = new URL('/', 'http://request.invalid');
  }
  response.statusCode = 308;
  setSecurityHeaders(response);
  response.setHeader('Location', `${CANONICAL_ORIGIN}${normalizeKnownRoutePath(parsed.pathname)}${parsed.search}`);
  response.setHeader('Cache-Control', 'public, max-age=3600');
  response.setHeader('Content-Length', '0');
  response.end();
}

function redirectToTrailingSlash(request, response, pathname) {
  const parsed = new URL(request.url || '/', 'http://request.invalid');
  response.statusCode = 308;
  setSecurityHeaders(response);
  response.setHeader('Location', `${pathname}/${parsed.search}`);
  response.setHeader('Cache-Control', 'public, max-age=3600');
  response.setHeader('Content-Length', '0');
  response.end();
}

function redirectFromIndexHtml(request, response, pathname) {
  const parsed = new URL(request.url || '/', 'http://request.invalid');
  const canonicalPath = normalizeKnownRoutePath(pathname);
  response.statusCode = 308;
  setSecurityHeaders(response);
  response.setHeader('Location', `${canonicalPath}${parsed.search}`);
  response.setHeader('Cache-Control', 'public, max-age=3600');
  response.setHeader('Content-Length', '0');
  response.end();
}

function redirectToRoute(request, response, pathname) {
  const parsed = new URL(request.url || '/', 'http://request.invalid');
  response.statusCode = 308;
  setSecurityHeaders(response);
  response.setHeader('Location', `${pathname}${parsed.search}`);
  response.setHeader('Cache-Control', 'public, max-age=3600');
  response.setHeader('Content-Length', '0');
  response.end();
}

function decodedRequestPath(request) {
  let encodedPath;
  try {
    encodedPath = new URL(request.url || '/', 'http://request.invalid').pathname;
  } catch {
    return null;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(encodedPath);
  } catch {
    return null;
  }

  if (!pathname.startsWith('/') || pathname.includes('\0') || pathname.includes('\\')) return null;
  if (pathname.split('/').some((segment) => segment === '..')) return null;
  return pathname;
}

function isWithin(root, candidate) {
  const pathFromRoot = relative(root, candidate);
  return pathFromRoot === '' || (!isAbsolute(pathFromRoot) && pathFromRoot !== '..' && !pathFromRoot.startsWith(`..${sep}`));
}

// The build stages a Cloudflare Sites copy of the whole site in dist/client plus a worker
// entry and hosting metadata. Serving those from this origin would publish every page twice
// and expose deployment artifacts, so they are not reachable over HTTP.
const PRIVATE_BUILD_PREFIXES = ['/client', '/server', '/.openai'];

function isPrivateBuildPath(requestPath) {
  const normalized = requestPath.toLowerCase();
  return PRIVATE_BUILD_PREFIXES.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`));
}

async function findStaticFile(distRoot, requestPath) {
  if (isPrivateBuildPath(requestPath)) return null;
  const candidate = resolve(distRoot, requestPath.slice(1));
  if (!isWithin(distRoot, candidate)) return null;

  let candidateStat;
  try {
    candidateStat = await stat(candidate);
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return null;
    throw error;
  }

  let filePath = candidate;
  if (candidateStat.isDirectory()) {
    filePath = resolve(candidate, 'index.html');
    if (!isWithin(distRoot, filePath)) return null;
    try {
      candidateStat = await stat(filePath);
    } catch (error) {
      if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return null;
      throw error;
    }
  }

  if (!candidateStat.isFile()) return null;

  const realFilePath = await realpath(filePath);
  if (!isWithin(distRoot, realFilePath)) return null;
  return { filePath: realFilePath, fileStat: candidateStat };
}

function isHashedAsset(requestPath) {
  return requestPath.startsWith('/assets/') && /(?:^|\/)[^/]+-[A-Za-z0-9_-]{8,}\.[^/]+$/.test(requestPath);
}

function cacheControl(requestPath, filePath) {
  // `no-transform` keeps the CDN from rewriting HTML, which is what injects the
  // Cloudflare RUM beacon that this site's Content-Security-Policy then blocks.
  if (['.htm', '.html'].includes(extname(filePath).toLowerCase())) return 'no-cache, no-transform';
  if (isHashedAsset(requestPath)) return 'public, max-age=31536000, immutable';
  // Images and icons are replaced only by a deploy; feeds and sitemaps must stay fresh.
  if (LONG_LIVED_EXTENSIONS.has(extname(filePath).toLowerCase())) return 'public, max-age=86400';
  return 'public, max-age=300';
}

// Cloudflare will not compress responses marked `no-transform`, so the origin compresses
// text itself. Keeping compression here also shrinks what travels through the tunnel.
const LONG_LIVED_EXTENSIONS = new Set(['.avif', '.gif', '.ico', '.jpeg', '.jpg', '.png', '.svg', '.webp', '.woff', '.woff2']);

const COMPRESSIBLE_EXTENSIONS = new Set([
  '.css', '.htm', '.html', '.js', '.json', '.map', '.mjs', '.svg', '.txt', '.webmanifest', '.xml',
]);

function isCompressible(filePath) {
  return COMPRESSIBLE_EXTENSIONS.has(extname(filePath).toLowerCase());
}

function negotiateEncoding(request, filePath, fileStat) {
  if (!isCompressible(filePath)) return null;
  if (fileStat.size < 1024) return null;
  const accepted = firstHeaderValue(request.headers['accept-encoding']).toLowerCase();
  if (/(^|[\s,])br([;,]|$)/.test(accepted)) return 'br';
  if (/(^|[\s,])gzip([;,]|$)/.test(accepted)) return 'gzip';
  return null;
}

function compressorFor(encoding) {
  return encoding === 'br'
    ? createBrotliCompress({ params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 5 } })
    : createGzip({ level: 6 });
}

function etagFor(fileStat, encoding = null) {
  const variant = encoding ? `-${encoding}` : '';
  return `W/\"${fileStat.size.toString(16)}-${Math.trunc(fileStat.mtimeMs).toString(16)}${variant}\"`;
}

function isNotModified(request, fileStat, etag) {
  const ifNoneMatch = firstHeaderValue(request.headers['if-none-match']);
  if (ifNoneMatch && ifNoneMatch === etag) return true;

  const ifModifiedSince = firstHeaderValue(request.headers['if-modified-since']);
  if (!ifNoneMatch && ifModifiedSince) {
    const since = Date.parse(ifModifiedSince);
    if (Number.isFinite(since) && Math.trunc(fileStat.mtimeMs / 1000) <= Math.trunc(since / 1000)) return true;
  }
  return false;
}

async function handleRequest(distRoot, searchReferralCounter, claimedCrawlerCounter, request, response) {
  if (requestProtocol(request) !== 'https' || requestHostname(request) !== 'liveparse.com') {
    redirectToCanonical(request, response);
    return;
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    sendText(request, response, 405, 'Method Not Allowed', { Allow: 'GET, HEAD' });
    return;
  }

  const requestPath = decodedRequestPath(request);
  if (requestPath === null) {
    sendText(request, response, 400, 'Bad Request');
    return;
  }
  if (ROUTE_REDIRECTS.has(requestPath)) {
    redirectToRoute(request, response, ROUTE_REDIRECTS.get(requestPath));
    return;
  }
  if (DIRECTORY_ROUTES.has(requestPath)) {
    redirectToTrailingSlash(request, response, requestPath);
    return;
  }
  if (requestPath === '/index.html' || requestPath.endsWith('/index.html')) {
    redirectFromIndexHtml(request, response, requestPath);
    return;
  }

  const staticFile = await findStaticFile(distRoot, requestPath);
  if (!staticFile) {
    sendText(request, response, 404, 'Not Found');
    return;
  }

  const { filePath, fileStat } = staticFile;
  const encoding = negotiateEncoding(request, filePath, fileStat);
  const etag = etagFor(fileStat, encoding);
  response.statusCode = 200;
  setSecurityHeaders(response);
  response.setHeader(
    'Content-Type',
    requestPath === '/feed.xml'
      ? 'application/atom+xml; charset=utf-8'
      : MIME_TYPES.get(extname(filePath).toLowerCase()) || 'application/octet-stream',
  );
  // Vary must be present whether or not this particular response was compressed, so shared
  // caches key both variants instead of reusing one for every client.
  if (isCompressible(filePath)) response.setHeader('Vary', 'Accept-Encoding');
  if (encoding) response.setHeader('Content-Encoding', encoding);
  else response.setHeader('Content-Length', fileStat.size);
  response.setHeader('Cache-Control', cacheControl(requestPath, filePath));
  response.setHeader('ETag', etag);
  response.setHeader('Last-Modified', fileStat.mtime.toUTCString());

  const isHtml = ['.htm', '.html'].includes(extname(filePath).toLowerCase());
  const referral = searchReferralFromRequest({
    method: request.method,
    isHtml,
    requestPath,
    referrer: firstHeaderValue(request.headers.referer),
    userAgent: firstHeaderValue(request.headers['user-agent']),
    allowedPaths: CANONICAL_METRIC_PATHS,
    purpose: firstHeaderValue(request.headers.purpose),
    secPurpose: firstHeaderValue(request.headers['sec-purpose']),
    secFetchDest: firstHeaderValue(request.headers['sec-fetch-dest']),
  });
  if (referral) void searchReferralCounter.record(referral);
  void claimedCrawlerCounter.record({
    method: request.method,
    isHtml,
    requestPath,
    userAgent: firstHeaderValue(request.headers['user-agent']),
  }).catch(() => {});

  if (isNotModified(request, fileStat, etag)) {
    response.statusCode = 304;
    response.removeHeader('Content-Length');
    response.end();
    return;
  }

  if (request.method === 'HEAD') {
    response.end();
    return;
  }

  const stream = createReadStream(filePath);
  stream.on('error', (error) => {
    console.error(`Failed to stream ${filePath}:`, error);
    if (!response.headersSent) sendText(request, response, 500, 'Internal Server Error');
    else response.destroy(error);
  });
  if (!encoding) {
    stream.pipe(response);
    return;
  }
  const compressor = compressorFor(encoding);
  compressor.on('error', (error) => {
    console.error(`Failed to compress ${filePath}:`, error);
    response.destroy(error);
  });
  stream.pipe(compressor).pipe(response);
}

async function main() {
  let distRoot;
  try {
    distRoot = await realpath(DIST_ROOT);
    const distStat = await stat(distRoot);
    if (!distStat.isDirectory()) throw new Error(`${DIST_ROOT} is not a directory`);
  } catch (error) {
    console.error(`Cannot serve production build at ${DIST_ROOT}:`, error.message);
    process.exitCode = 1;
    return;
  }

  const searchReferralCounter = new SearchReferralCounter({
    directory: SEARCH_REFERRAL_DIR,
    onError: (...details) => console.error(...details),
  });
  const claimedCrawlerCounter = new ClaimedCrawlerCounter({
    directory: SEARCH_CRAWLER_DIR,
    allowedPaths: CANONICAL_METRIC_PATHS,
    onError: (...details) => console.error(...details),
  });
  const touchCrawlerCoverage = () => {
    void claimedCrawlerCounter.touch().catch(() => {});
  };
  touchCrawlerCoverage();
  const crawlerHeartbeat = setInterval(touchCrawlerCoverage, 60 * 60 * 1_000);
  crawlerHeartbeat.unref();

  const server = createServer((request, response) => {
    handleRequest(distRoot, searchReferralCounter, claimedCrawlerCounter, request, response).catch((error) => {
      console.error('Unhandled request error:', error);
      if (!response.headersSent) sendText(request, response, 500, 'Internal Server Error');
      else response.destroy(error);
    });
  });

  server.on('clientError', (_error, socket) => {
    socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
  });
  server.on('error', (error) => {
    console.error('Production server error:', error);
    process.exitCode = 1;
  });

  server.listen(PORT, HOST, () => {
    console.log(`Serving ${distRoot} on http://${HOST}:${PORT}`);
    console.log(`Canonical origin: ${CANONICAL_ORIGIN}`);
    console.log('Cookie-free search referral aggregation: enabled');
    console.log('Privacy-preserving claimed crawler and hourly server heartbeat aggregation: enabled');
  });

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => server.close(async () => {
      clearInterval(crawlerHeartbeat);
      await Promise.all([searchReferralCounter.flush(), claimedCrawlerCounter.flush()]);
      process.exit(0);
    }));
  }
}

await main();
