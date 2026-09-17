#!/usr/bin/env node
// Generates the "/N-business-days-from-today/" landing pages from the shared date library so every
// table and FAQ answer is computed, not hand-typed. Run after changing the template; commit the output.
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const { addBusinessDays, dayOfWeek, daysBetween } = await import(resolve(projectRoot, 'src/lib/date-tools.ts'));

export const BUSINESS_DAY_PAGES = [2, 3, 4, 5, 7, 10, 14, 15, 20, 30, 45];
const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const STARTS = ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13'];
const ORIGIN = 'https://liveparse.com';
const PUBLISHED = '2026-09-12';
const MODIFIED = '2026-09-13';

function plural(n, word) { return `${n} ${word}${n === 1 ? '' : 's'}`; }

export function buildPage(n) {
  const rows = STARTS.map((start, i) => {
    const date = addBusinessDays(start, n, { weekend: [6, 7] });
    return { from: DAY_NAMES[i], to: DAY_NAMES[dayOfWeek(date) - 1], shift: daysBetween(start, date, { signed: true }), weekend: i >= 5 };
  });
  const weekdayShifts = rows.slice(0, 5).map((r) => r.shift);
  const min = Math.min(...rows.map((r) => r.shift));
  const max = Math.max(...rows.map((r) => r.shift));
  const weekdayMin = Math.min(...weekdayShifts);
  const weekdayMax = Math.max(...weekdayShifts);
  const weeks = Math.floor(n / 5);
  const remainder = n % 5;
  const exact = remainder === 0;
  const path = `/${n}-business-days-from-today/`;
  const url = `${ORIGIN}${path}`;
  const spanText = exact
    ? `exactly ${plural(weekdayMax, 'calendar day')} (${plural(weeks, 'full working week')}) from any weekday`
    : `${weekdayMin} to ${weekdayMax} calendar days from a weekday, depending on where the weekend falls`;
  const faq = [
    [`How long is ${n} business days?`, exact
      ? `${n} business days equal ${plural(weeks, 'full working week')}, so from any Monday-to-Friday start date the result is exactly ${plural(weekdayMax, 'calendar day')} later and lands on the same weekday. Listed holidays add one working day each.`
      : `${n} business days span ${weekdayMin} to ${weekdayMax} calendar days from a weekday start, because the count skips Saturday and Sunday. Starting on a weekend, the first counted business day is the following Monday. Listed holidays add one working day each.`],
    [`What date is ${n} business days from today?`, `The calculator at the top of this page answers with today's date already filled in: ${n} business days are added from today, weekends are skipped, and the exact result date and weekday are shown. Change the start date to check any other day, or add public holidays to exclude them.`],
    [`Does the count include today?`, `No. Today is the starting point and is never counted as one of the ${n} business days. The first business day counted is the next working day after the start date. From Friday, Saturday, or Sunday, counting begins on Monday unless it is a listed holiday.`],
    [`What happens if a holiday falls within the ${n} business days?`, `Each holiday that lands on a weekday inside the window pushes the result one working day later. Enter each holiday as YYYY-MM-DD in the calculator; the tool does not assume a country's public holidays, so the list you provide is the one that counts.`],
  ];
  const title = `${n} Business Days From Today – Date Calculator | LiveParse`;
  const description = `${n} business days from today is ${min}–${max} calendar days away without holidays. Get the exact date, skip weekends, and add your public holidays. Free calculator.`;
  if (description.length > 200) throw new Error(`description too long for ${n}: ${description.length}`);
  const siblings = BUSINESS_DAY_PAGES.filter((m) => m !== n);
  const faqJson = faq.map(([q, a]) => `              { "@type": "Question", "name": ${JSON.stringify(q)}, "acceptedAnswer": { "@type": "Answer", "text": ${JSON.stringify(a)} } }`).join(',\n');
  const faqHtml = faq.map(([q, a], i) => `        <details${i === 0 ? ' open' : ''}><summary>${q}</summary><p>${a}</p></details>`).join('\n');
  const tableRows = rows.map((r) => `<tr${r.weekend ? ' class="weekend"' : ''}><th scope="row">${r.from}</th><td>${r.to}<small>${plural(r.shift, 'calendar day')} later</small></td></tr>`).join('\n              ');
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="icon" href="/favicon.ico" sizes="16x16 32x32 48x48" />
    <link rel="icon" href="/icon-192.png" type="image/png" sizes="192x192" />
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <link rel="manifest" href="/site.webmanifest" />
    <title>${title}</title>
    <meta name="description" content="${description}" />
    <meta name="author" content="Jackson Jang" />
    <meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1" />
    <link rel="canonical" href="${url}" />
    <link rel="stylesheet" href="/src/styles.css" />
    <link rel="stylesheet" href="/src/date-tools.css" />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="${url}" />
    <meta property="og:title" content="${n} Business Days From Today" />
    <meta property="og:description" content="What date is ${n} business days from today? Skips weekends and your holidays; ${spanText}." />
    <meta property="og:site_name" content="LiveParse" />
    <meta property="og:locale" content="en_US" />
    <meta property="og:image" content="${ORIGIN}/og-date-tools.png" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="LiveParse business days calculator" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${n} Business Days From Today | LiveParse" />
    <meta name="twitter:description" content="Exact date ${n} business days from today, with weekends and listed holidays skipped." />
    <meta name="twitter:image" content="${ORIGIN}/og-date-tools.png" />
    <meta name="theme-color" content="#3458d4" />
    <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@graph": [
          {
            "@type": "WebPage",
            "@id": "${url}#webpage",
            "url": "${url}",
            "name": "${n} Business Days From Today",
            "description": "${description}",
            "datePublished": "${PUBLISHED}",
            "dateModified": "${MODIFIED}",
            "inLanguage": "en",
            "isPartOf": { "@id": "${ORIGIN}/#website" },
            "breadcrumb": { "@id": "${url}#breadcrumb" },
            "mainEntity": { "@id": "${ORIGIN}/business-days-calculator/#application" }
          },
          {
            "@type": "BreadcrumbList",
            "@id": "${url}#breadcrumb",
            "itemListElement": [
              { "@type": "ListItem", "position": 1, "name": "LiveParse", "item": "${ORIGIN}/" },
              { "@type": "ListItem", "position": 2, "name": "Business Days Calculator", "item": "${ORIGIN}/business-days-calculator/" },
              { "@type": "ListItem", "position": 3, "name": "${n} business days from today", "item": "${url}" }
            ]
          },
          {
            "@type": "FAQPage",
            "@id": "${url}#faq-schema",
            "mainEntity": [
${faqJson}
            ]
          }
        ]
      }
    </script>
  </head>
  <body class="date-page" data-page="business-days-calculator" data-business-days="${n}">
    <a class="skip-link" href="#date-tool">Skip to the ${n} business days calculator</a>
    <header class="site-header"><nav class="site-nav" aria-label="Primary navigation"><a class="brand" href="/" aria-label="LiveParse home"><span aria-hidden="true">{ }</span> LiveParse</a><div class="nav-links"><a href="#date-tool">Calculator</a><a href="#by-weekday">By weekday</a><a href="#calendar-days">Calendar days</a><a href="#faq">FAQ</a><a href="/business-days-calculator/">Any number of days</a><a href="/date-calculator/">Date calculator</a></div></nav><div class="seo-hero"><div class="seo-hero-copy"><p class="eyebrow">Free · Weekends skipped · Your holidays applied</p><h1>${n} Business Days From Today</h1><p class="hero-lead">See the exact date that is ${n} business days from today. The calculator below opens with today as the start date and ${n} business days ready to add; it skips Saturday and Sunday by default and any holidays you list. ${exact ? `Because ${n} business days are ${plural(weeks, 'full working week')}, the answer is ${plural(weekdayMax, 'calendar day')} later from a weekday when no holiday intervenes.` : `From a weekday the answer is ${weekdayMin} to ${weekdayMax} calendar days later.`}</p><div class="hero-cta-row"><a class="hero-cta" href="#date-tool">Show the date</a><span>Instant result · No sign-up · Runs in your browser</span></div></div><div class="hero-example" aria-label="${n} business days from a Monday example"><div class="example-bar"><span></span><span></span><span></span><strong>${n} business days from a Monday</strong></div><pre><code><span class="property">start</span>   <span class="string">Mon ${STARTS[0]}</span>
<span class="property">add</span>     <span class="number">${n}</span> <span class="string">business days</span>
<span class="property">result</span>  <span class="boolean">${rows[0].to.slice(0, 3)} ${addBusinessDays(STARTS[0], n, { weekend: [6, 7] }) && (() => { const d = addBusinessDays(STARTS[0], n, { weekend: [6, 7] }); return `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`; })()}</span></code></pre><p><strong>${n} business days = ${plural(rows[0].shift, 'calendar day')}</strong><span>Saturday and Sunday skipped, no holiday listed</span></p></div></div></header>
    <main>
      <section class="tool-intro" id="date-tool" aria-labelledby="date-tool-heading"><div><p class="section-kicker">Today plus ${n} business days</p><h2 id="date-tool-heading">Calculate ${n} business days from today or any start date</h2></div><p>The business days calculator is preset to add <strong>${n}</strong> business days from today. Change the start date for a different day, switch the weekend pattern if your week is not Monday to Friday, and paste public holidays as YYYY-MM-DD so they are skipped too.</p></section>
      <div id="root"><section class="parser-fallback" aria-label="Business days calculator loading"><p><strong>Loading the business days calculator…</strong></p><p>Enable JavaScript to see today's date plus ${n} business days. The weekday table, calendar-day conversion, and FAQ remain readable below.</p></section></div>

      <section class="content-section" id="by-weekday" aria-labelledby="by-weekday-heading"><div class="section-heading"><p class="section-kicker">By starting weekday</p><h2 id="by-weekday-heading">${n} business days from Monday, Friday, Saturday, or any other day</h2><p>With a Saturday and Sunday weekend and no holidays, the result depends only on the weekday you start from. Weekend starts count from the following Monday.</p></div><div class="weekday-matrix-wrap"><table class="weekday-matrix"><caption class="visually-hidden">Result weekday and calendar-day shift for ${n} business days from each starting weekday</caption><thead><tr><th scope="col">Start on</th><th scope="col">${n} business days later</th></tr></thead><tbody>
              ${tableRows}
            </tbody></table></div></section>

      <section class="content-section alt" id="calendar-days" aria-labelledby="calendar-days-heading"><div class="section-heading"><p class="section-kicker">Business days to calendar days</p><h2 id="calendar-days-heading">How long is ${n} business days in calendar days?</h2></div><div class="prose-grid"><div><p>${exact
        ? `<strong>${n} business days are ${plural(weeks, 'full working week')}.</strong> Every block of 5 business days spans 7 calendar days when no holiday intervenes, so from any Monday-to-Friday start the result is exactly ${plural(weekdayMax, 'calendar day')} later and falls on the same weekday. From Saturday it is ${plural(rows[5].shift, 'calendar day')}; from Sunday it is ${plural(rows[6].shift, 'calendar day')}, because the first counted day is Monday.`
        : `<strong>${n} business days are ${weeks > 0 ? `${plural(weeks, 'full working week')} plus ${plural(remainder, 'extra working day')}` : `${plural(n, 'working day')} inside a single week or across one weekend`}.</strong> The whole weeks always add ${weeks * 7} calendar days; the remaining ${remainder} working day${remainder === 1 ? '' : 's'} may or may not cross a weekend, which is why the total ranges from ${weekdayMin} to ${weekdayMax} calendar days depending on the start weekday.`}</p><p><strong>Holidays.</strong> A public holiday on a weekday inside the window is not a business day, so each listed holiday pushes the result one working day later. Deadline rules can differ by court, agency, carrier, or contract, so confirm the governing calendar before relying on a date.</p></div><div class="callout-card"><strong>Need a different count?</strong><p>Open the full <a href="/business-days-calculator/">business days calculator</a> to add or subtract any number of business days, count working days between two dates, or change the weekend pattern.</p><a href="/business-days-calculator/?mode=add&amp;amount=${n}">Open the calculator with ${n} days ↗</a></div></div></section>

      <section class="content-section faq-section" id="faq" aria-labelledby="faq-heading"><div class="section-heading"><p class="section-kicker">Questions about ${n} business days</p><h2 id="faq-heading">${n} business days FAQ</h2></div><div class="faq-list">
${faqHtml}
      </div></section>

      <aside class="references" aria-labelledby="related-heading"><div><p class="section-kicker">Other counts</p><h2 id="related-heading">Business days from today</h2></div><ul>${siblings.map((m) => `<li><a href="/${m}-business-days-from-today/">${m} business days from today</a></li>`).join('')}<li><a href="/business-days-calculator/">Business Days Calculator</a></li><li><a href="/days-between-dates/">Days Between Dates</a></li><li><a href="/date-calculator/">Date Calculator</a></li><li><a href="/guides/calendar-date-arithmetic-dst-leap-years/">Calendar Arithmetic Guide</a></li></ul></aside>
    </main>
    <footer class="site-footer"><div><a class="brand" href="/"><span aria-hidden="true">{ }</span> LiveParse</a><p>Private browser-based tools for exact data work.</p></div><div class="footer-links"><a href="/business-days-calculator/">Business Days</a><a href="/days-between-dates/">All Days</a><a href="/date-calculator/">Date Math</a><a href="/guides/">Guides</a><a href="/about/">About</a><a href="/privacy/">Privacy</a></div><p class="footer-note">© 2026 Jackson Jang. Define the working calendar before counting.</p></footer>
    <noscript><p class="noscript-note">JavaScript is required for the interactive calculation. The weekday table, calendar-day conversion, and FAQ remain readable without it.</p></noscript>
    <script type="module" src="/src/date-tools.tsx"></script>
  </body>
</html>
`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const n of BUSINESS_DAY_PAGES) {
    const dir = resolve(projectRoot, `${n}-business-days-from-today`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, 'index.html'), buildPage(n));
  }
  console.log(`generated ${BUSINESS_DAY_PAGES.length} business-day landing pages`);
}
