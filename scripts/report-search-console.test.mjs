import { describe, expect, it } from 'vitest';
import {
  comparePerformanceRows,
  expectedCtr,
  parseCsv,
  parseExportFilters,
  parsePerformanceRows,
  rankOpportunities,
  summarizePerformanceRows,
  zipExtractionCommand,
} from './report-search-console.mjs';

describe('report-search-console', () => {
  it('parses quoted CSV fields with commas and escaped quotes', () => {
    expect(parseCsv('a,"b,c","d""e"\n1,2,3\n')).toEqual([['a', 'b,c', 'd"e'], ['1', '2', '3']]);
  });

  it('reads English and Korean Search Console headers', () => {
    const english = 'Top pages,Clicks,Impressions,CTR,Position\nhttps://liveparse.com/,3,"1,200",0.25%,8.4\n';
    const korean = '인기 페이지,클릭수,노출수,클릭률,게재순위\nhttps://liveparse.com/,3,1200,0.25%,8.4\n';
    const koreanExport = '인기 검색어,클릭수,노출,CTR,게재 순위\nhttps://liveparse.com/,3,1200,0.25%,8.4\n';
    for (const source of [english, korean, koreanExport]) {
      expect(parsePerformanceRows(source)).toEqual([
        { key: 'https://liveparse.com/', clicks: 3, impressions: 1200, ctr: 0.0025, position: 8.4 },
      ]);
    }
  });

  it('ranks by missed clicks against the expected CTR for the position', () => {
    const rows = [
      { key: 'low-impr', clicks: 0, impressions: 5, ctr: 0, position: 3 },
      { key: 'deep', clicks: 0, impressions: 500, ctr: 0, position: 45 },
      { key: 'page-a', clicks: 1, impressions: 400, ctr: 0.0025, position: 6 },
      { key: 'page-b', clicks: 0, impressions: 100, ctr: 0, position: 2 },
    ];
    const ranked = rankOpportunities(rows, { minImpressions: 20, maxPosition: 20 });
    expect(ranked.map((row) => row.key)).toEqual(['page-b', 'page-a']);
    expect(ranked[0].missedClicks).toBeCloseTo(100 * expectedCtr(2));
    expect(ranked[1].missedClicks).toBeCloseTo(400 * expectedCtr(6) - 1);
  });

  it('uses the macOS archive tool for Unicode export filenames', () => {
    expect(zipExtractionCommand('/tmp/search.zip', '/tmp/export', 'darwin')).toEqual({
      command: 'ditto',
      args: ['-x', '-k', '/tmp/search.zip', '/tmp/export'],
    });
    expect(zipExtractionCommand('/tmp/search.zip', '/tmp/export', 'linux')).toEqual({
      command: 'unzip',
      args: ['-q', '-o', '/tmp/search.zip', '-d', '/tmp/export'],
    });
  });

  it('reads Korean and English export periods', () => {
    expect(parseExportFilters('필터,값\n검색 유형,웹\n기간,지난 24시간\n')).toMatchObject({ 기간: '지난 24시간' });
    expect(parseExportFilters('Filter,Value\nSearch type,Web\nDate range,Last 3 months\n')).toMatchObject({
      'date range': 'Last 3 months',
    });
  });

  it('summarizes chart totals with an impression-weighted position', () => {
    expect(summarizePerformanceRows([
      { clicks: 1, impressions: 10, position: 20 },
      { clicks: 0, impressions: 30, position: 40 },
    ])).toEqual({ clicks: 1, ctr: 0.025, impressions: 40, weightedPosition: 35 });
  });

  it('compares only matching rows and weights position changes by current impressions', () => {
    const comparison = comparePerformanceRows([
      { key: 'a', impressions: 3, position: 20 },
      { key: 'b', impressions: 1, position: 50 },
      { key: 'new', impressions: 5, position: 10 },
    ], [
      { key: 'a', impressions: 20, position: 30 },
      { key: 'b', impressions: 10, position: 46 },
    ]);
    expect(comparison.currentImpressions).toBe(4);
    expect(comparison.matches.map((match) => match.current.key)).toEqual(['a', 'b']);
    expect(comparison.weightedPositionImprovement).toBe(6.5);
  });
});
