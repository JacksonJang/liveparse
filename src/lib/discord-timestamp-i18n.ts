import {
  DISCORD_STYLE_DEFINITIONS,
  type DiscordStyleDefinition,
  type DiscordTimestampStyle,
} from './discord-timestamp';

export type DiscordUiLocale = 'en' | 'es';

const SPANISH_STYLE_DEFINITIONS: Record<DiscordTimestampStyle, Omit<DiscordStyleDefinition, 'style'>> = {
  t: { name: 'Hora corta', description: 'Hora sin segundos' },
  T: { name: 'Hora media', description: 'Hora con segundos' },
  d: { name: 'Fecha corta', description: 'Fecha numérica compacta' },
  D: { name: 'Fecha larga', description: 'Mes y fecha escritos' },
  f: { name: 'Fecha larga, hora corta', description: 'Valor predeterminado documentado por Discord' },
  F: { name: 'Fecha completa, hora corta', description: 'Día de la semana, fecha y hora' },
  s: { name: 'Fecha corta, hora corta', description: 'Fecha y hora compactas' },
  S: { name: 'Fecha corta, hora media', description: 'Fecha y hora compactas con segundos' },
  R: { name: 'Tiempo relativo', description: 'Relativo al momento actual del lector' },
};

const SPANISH_UNIT_LABELS = {
  milliseconds: 'milisegundos',
  microseconds: 'microsegundos',
  nanoseconds: 'nanosegundos',
} as const;

export function localizedDiscordStyleDefinitions(locale: DiscordUiLocale): readonly DiscordStyleDefinition[] {
  if (locale !== 'es') return DISCORD_STYLE_DEFINITIONS;
  return DISCORD_STYLE_DEFINITIONS.map(({ style }) => ({ style, ...SPANISH_STYLE_DEFINITIONS[style] }));
}

export function localizedDiscordUnitLabel(
  unit: 'milliseconds' | 'microseconds' | 'nanoseconds' | null | undefined,
  locale: DiscordUiLocale,
): string {
  if (locale === 'es' && unit) return SPANISH_UNIT_LABELS[unit];
  return unit ?? '';
}

export function localizeDiscordDiagnostic(message: string | null | undefined, locale: DiscordUiLocale): string {
  const value = message ?? '';
  if (locale !== 'es' || !value) return value;

  const spanishMessages: Array<[RegExp, (match: RegExpMatchArray) => string]> = [
    [/^Input is limited to (\d+) characters\.$/, ([limit]) => `La entrada está limitada a ${limit} caracteres.`],
    [/^Enter Unix seconds or a Discord timestamp tag\.$/, () => 'Introduce segundos Unix o una etiqueta de timestamp de Discord.'],
    [/^Use <t:UNIX_SECONDS> or <t:UNIX_SECONDS:STYLE> with a documented style letter\.$/, () => 'Usa <t:SEGUNDOS_UNIX> o <t:SEGUNDOS_UNIX:ESTILO> con una letra documentada.'],
    [/^Enter non-negative whole Unix seconds, not a signed, decimal, or formatted time\.$/, () => 'Introduce segundos Unix enteros no negativos, no un valor con signo, decimal ni hora formateada.'],
    [/^The Unix seconds value is not a valid integer\.$/, () => 'El valor de segundos Unix no es un entero válido.'],
    [/^That value is outside the seconds range and looks like Unix (milliseconds|microseconds|nanoseconds)\. Discord’s documented tag syntax uses seconds\.$/, (match) => `Ese valor está fuera del rango de segundos y parece Unix ${SPANISH_UNIT_LABELS[match[1] as keyof typeof SPANISH_UNIT_LABELS]}. La sintaxis documentada por Discord usa segundos.`],
    [/^That value is outside the date range this browser can preview safely\.$/, () => 'Ese valor está fuera del rango de fechas que este navegador puede previsualizar de forma segura.'],
    [/^Unsupported style “(.+)”\. Use t, T, d, D, f, F, s, S, or R\.$/, ([style]) => `Estilo no admitido “${style}”. Usa t, T, d, D, f, F, s, S o R.`],
    [/^This looks like Unix (milliseconds|microseconds|nanoseconds), but Discord’s documented tag syntax uses seconds\.$/, (match) => `Parece Unix ${SPANISH_UNIT_LABELS[match[1] as keyof typeof SPANISH_UNIT_LABELS]}, pero la sintaxis documentada por Discord usa segundos.`],
    [/^Enter a real calendar date and time with a year of at least four digits\.$/, () => 'Introduce una fecha y hora reales con un año de al menos cuatro dígitos.'],
    [/^Choose a valid IANA timezone\.$/, () => 'Elige una zona horaria IANA válida.'],
    [/^This generator does not create pre-1970 tags because the Discord reference does not define negative timestamp support\.$/, () => 'Este generador no crea etiquetas anteriores a 1970 porque la referencia de Discord no define compatibilidad con valores negativos.'],
    [/^That wall-clock time does not exist in the selected timezone, usually because clocks move forward for daylight saving time\.$/, () => 'Esa hora local no existe en la zona horaria seleccionada, normalmente porque el reloj se adelanta en el horario de verano.'],
    [/^That wall-clock time occurs more than once in the selected timezone\. Choose the earlier or later occurrence\.$/, () => 'Esa hora local ocurre más de una vez en la zona horaria seleccionada. Elige la aparición anterior o posterior.'],
  ];

  for (const [pattern, translate] of spanishMessages) {
    const match = value.match(pattern);
    if (match) return translate(match);
  }
  return value;
}

export function discordUiLocaleFromBody(value: string | undefined): DiscordUiLocale {
  return value === 'es' ? 'es' : 'en';
}
