import { describe, expect, it } from 'vitest';
import {
  discordUiLocaleFromBody,
  localizedDiscordStyleDefinitions,
  localizedDiscordUnitLabel,
  localizeDiscordDiagnostic,
} from './discord-timestamp-i18n';

describe('Discord timestamp UI localization', () => {
  it('localizes every documented style without changing the style letters', () => {
    const spanish = localizedDiscordStyleDefinitions('es');
    const english = localizedDiscordStyleDefinitions('en');
    expect(spanish).toHaveLength(9);
    expect(spanish.map(({ style }) => style)).toEqual(english.map(({ style }) => style));
    expect(spanish.map(({ name }) => name)).toContain('Tiempo relativo');
  });

  it('localizes dynamic parser diagnostics and unit labels', () => {
    expect(localizeDiscordDiagnostic(
      'That value is outside the seconds range and looks like Unix milliseconds. Discord’s documented tag syntax uses seconds.',
      'es',
    )).toContain('parece Unix milisegundos');
    expect(localizeDiscordDiagnostic(
      'That wall-clock time occurs more than once in the selected timezone. Choose the earlier or later occurrence.',
      'es',
    )).toContain('más de una vez');
    expect(localizeDiscordDiagnostic(
      'Bulk generation is limited to 500 non-empty lines.',
      'es',
    )).toContain('500 líneas no vacías');
    expect(localizedDiscordUnitLabel('milliseconds', 'es')).toBe('milisegundos');
    expect(localizedDiscordUnitLabel('milliseconds', 'en')).toBe('milliseconds');
  });

  it('reads only the supported Spanish body locale marker', () => {
    expect(discordUiLocaleFromBody('es')).toBe('es');
    expect(discordUiLocaleFromBody(undefined)).toBe('en');
    expect(discordUiLocaleFromBody('ko')).toBe('en');
  });
});
