#!/usr/bin/env node
// Set each sitemap <lastmod> to the last git commit date of the page's source HTML,
// so search engines see accurate change signals instead of stale hand-maintained dates.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const sitemapPath = resolve(projectRoot, 'public/sitemap.xml');
const ORIGIN = 'https://liveparse.com';

export function sourceFileForPath(pathname) {
  const relative = pathname === '/' ? 'index.html' : `${pathname.replace(/^\/|\/$/g, '')}/index.html`;
  for (const candidate of [resolve(projectRoot, relative), resolve(projectRoot, 'public', relative)]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export function lastCommitDate(file) {
  const out = execFileSync('git', ['log', '-1', '--format=%cs', '--', file], { cwd: projectRoot, encoding: 'utf8' }).trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(out) ? out : null;
}

export function updateSitemap(xml, dateFor) {
  let changed = 0;
  const next = xml.replace(/(<loc>)([^<]+)(<\/loc>\s*<lastmod>)([^<]+)(<\/lastmod>)/g, (m, a, loc, b, old, c) => {
    const date = dateFor(new URL(loc).pathname);
    if (!date || date === old) return m;
    changed += 1;
    return `${a}${loc}${b}${date}${c}`;
  });
  return { xml: next, changed };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const xml = readFileSync(sitemapPath, 'utf8');
  const { xml: next, changed } = updateSitemap(xml, (pathname) => {
    const file = sourceFileForPath(pathname);
    if (!file) { console.warn(`no source file for ${pathname}`); return null; }
    // Uncommitted edits count as today.
    const dirty = execFileSync('git', ['status', '--porcelain', '--', file], { cwd: projectRoot, encoding: 'utf8' }).trim();
    return dirty ? new Date().toISOString().slice(0, 10) : lastCommitDate(file);
  });
  writeFileSync(sitemapPath, next);
  console.log(`sitemap lastmod updated for ${changed} URL${changed === 1 ? '' : 's'} (origin ${ORIGIN}).`);
}
