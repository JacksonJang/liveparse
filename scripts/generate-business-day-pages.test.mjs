import { describe, expect, it } from 'vitest';
import { buildPage } from './generate-business-day-pages.mjs';

describe('business-day search answers', () => {
  it.each([[5, 6, 5], [10, 13, 12], [30, 41, 40]])(
    '%i business days uses the Saturday and Sunday offsets in the prose',
    (days, saturday, sunday) => {
      const html = buildPage(days);
      expect(html).toContain(`From Saturday it is ${saturday} calendar days; from Sunday it is ${sunday} calendar days`);
      expect(html).toContain(`${sunday}–${saturday + 1} calendar days away without holidays`);
      expect(html).not.toContain('reach further into the following week than from a Monday');
      expect(html).toContain('when no holiday intervenes');
    },
  );

  it('uses the full start-day range for a partial working week in the snippet', () => {
    const html = buildPage(3);
    expect(html).toContain('3 business days from today is 3–5 calendar days away without holidays');
    const graph = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1])['@graph'];
    const faq = graph.find((item) => item['@type'] === 'FAQPage');
    for (const question of faq.mainEntity) {
      expect(html).toContain(`<summary>${question.name}</summary><p>${question.acceptedAnswer.text}</p>`);
    }
  });
});
