import { describe, expect, it } from 'vitest';
import { analyzeRegex, normalizeRegexFlags } from './regex-tools';
import { REGEX_PRESETS } from './regex-presets';

describe('regex preset library', () => {
  it('has stable, unique labels', () => {
    const labels = REGEX_PRESETS.map((preset) => preset.label);
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels).toContain('Email addresses');
    expect(labels).toContain('IPv4 addresses');
  });

  it('keeps every preset valid and useful against its sample', () => {
    for (const preset of REGEX_PRESETS) {
      const flags = normalizeRegexFlags(preset.flags);
      const result = analyzeRegex({
        pattern: preset.pattern,
        flags,
        text: preset.text,
        replacement: preset.replacement,
      });
      expect(result.matches.length, preset.label).toBeGreaterThan(0);
      if (preset.replacement !== null) expect(result.replacement, preset.label).not.toBe('');
    }
  });

  it('uses representative boundary-aware samples', () => {
    const addresses = analyzeRegex({
      pattern: REGEX_PRESETS.find((preset) => preset.label === 'IPv4 addresses')!.pattern,
      flags: 'g',
      text: '256.1.1.1 1.2.3.999 10.0.0.254',
    });
    expect(addresses.matches.map((match) => match.text)).toEqual(['10.0.0.254']);

    const duplicates = analyzeRegex({
      pattern: REGEX_PRESETS.find((preset) => preset.label === 'Duplicate words')!.pattern,
      flags: 'gi',
      text: 'the the value value unique',
      replacement: '$1',
    });
    expect(duplicates.replacement).toBe('the value unique');
  });
});
