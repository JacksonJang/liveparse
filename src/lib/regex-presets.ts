import type { RegexFlag } from './regex-tools';

export interface RegexPreset {
  readonly label: string;
  readonly pattern: string;
  readonly flags: readonly RegexFlag[];
  readonly text: string;
  readonly replacement: string | null;
}

export const REGEX_PRESETS: readonly RegexPreset[] = [
  {
    label: 'Log levels',
    pattern: '^(?<timestamp>\\d{4}-\\d{2}-\\d{2}T[^ ]+Z) (?<level>INFO|WARN|ERROR) (?<message>.+)$',
    flags: ['g', 'm'],
    text: [
      '2026-09-16T01:02:03Z INFO service started',
      '2026-09-16T01:02:09Z WARN cache miss',
      '2026-09-16T01:03:20Z ERROR database timeout',
    ].join('\n'),
    replacement: '$<level>: $<message>',
  },
  {
    label: 'URLs',
    pattern: 'https?://[^\\s<>"\')]+',
    flags: ['g', 'i'],
    text: 'Read https://example.com/docs and https://liveparse.com/json-formatter/ before filing the issue.',
    replacement: '<a href="$&">$&</a>',
  },
  {
    label: 'Email addresses',
    pattern: '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}',
    flags: ['g', 'i'],
    text: 'Contact ada@example.com or grace.hopper@navy.mil for the release review.',
    replacement: '[$&](mailto:$&)',
  },
  {
    label: 'IPv4 addresses',
    pattern: '(?<!\\d)(?:(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)\\.){3}(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)(?!\\d)',
    flags: ['g'],
    text: 'Gateways 192.168.1.1 and 10.0.0.254; invalid edges 256.1.1.1 and 1.2.3.999.',
    replacement: null,
  },
  {
    label: 'Hex colors',
    pattern: '#(?:[0-9a-f]{3}|[0-9a-f]{6})\\b',
    flags: ['g', 'i'],
    text: 'Brand colors #0b7 and #0A6E78 contrast with background #fff.',
    replacement: null,
  },
  {
    label: 'Whitespace runs',
    pattern: '\\s+',
    flags: ['g'],
    text: 'Normalize\tthis\n\nmessy   spacing.',
    replacement: ' ',
  },
  {
    label: 'Duplicate words',
    pattern: '\\b(\\w+)\\s+\\1\\b',
    flags: ['g', 'i'],
    text: 'The the release notes repeat a a value, but THIS this is intentional.',
    replacement: '$1',
  },
  {
    label: 'ISO dates',
    pattern: '\\d{4}-\\d{2}-\\d{2}(?:[T ]\\d{2}:\\d{2}(?::\\d{2}(?:\\.\\d+)?)?(?:Z|[+-]\\d{2}:?\\d{2})?)?',
    flags: ['g'],
    text: 'Created 2026-09-16 and updated 2026-09-15T19:45:00+09:00.',
    replacement: null,
  },
  {
    label: 'Emoji',
    pattern: '\\p{Extended_Pictographic}',
    flags: ['g', 'u'],
    text: 'Ship it 🚀 then review ✅ and relax 🍵.',
    replacement: '[$&]',
  },
];
