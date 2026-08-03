import { describe, expect, it } from 'vitest';
import { canDownloadXmlAsUtf8, xmlDeclarationEncoding } from './xml-download';

describe('XML UTF-8 browser download guard', () => {
  it.each([
    ['<root/>', null],
    ['<?xml version="1.0"?><root/>', null],
    ['<?xml version="1.0" encoding="UTF-8"?><root/>', 'UTF-8'],
    ["<?xml version = '1.0'   encoding = 'utf-8' ?><root/>", 'utf-8'],
    ['\uFEFF<?xml version="1.0" encoding="UtF-8"?><root/>', 'UtF-8'],
  ])('allows a browser UTF-8 download for %s', (source, expectedEncoding) => {
    expect(xmlDeclarationEncoding(source)).toBe(expectedEncoding);
    expect(canDownloadXmlAsUtf8(source)).toBe(true);
  });

  it.each([
    ['<?xml version="1.0" encoding="UTF-16"?><root/>', 'UTF-16'],
    ["<?xml version='1.0' encoding = 'iso-8859-1'?><root/>", 'iso-8859-1'],
    ['\uFEFF<?xml version="1.0" encoding="Shift_JIS"?><root/>', 'Shift_JIS'],
  ])('blocks a browser UTF-8 download that would contradict %s', (source, expectedEncoding) => {
    expect(xmlDeclarationEncoding(source)).toBe(expectedEncoding);
    expect(canDownloadXmlAsUtf8(source)).toBe(false);
  });

  it('does not treat a later processing instruction as the leading XML declaration', () => {
    const source = '<root/><?xml version="1.0" encoding="UTF-16"?>';
    expect(xmlDeclarationEncoding(source)).toBeNull();
    expect(canDownloadXmlAsUtf8(source)).toBe(true);
  });
});
