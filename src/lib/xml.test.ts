import { describe, expect, it } from 'vitest';
import {
  formatXmlText,
  normalizeXmlFormatOptions,
  processXmlText,
  validateXmlText,
  viewXmlText,
  XmlProcessError,
} from './xml';
import {
  DEFAULT_XML_FORMAT_OPTIONS,
  MAX_XML_ATTRIBUTES,
  MAX_XML_DEPTH,
  MAX_XML_ELEMENTS,
  MAX_XML_ERROR_CHARACTERS,
  MAX_XML_INPUT_CHARACTERS,
  MAX_XML_OUTPUT_CHARACTERS,
  MAX_XML_VIEWER_ROWS,
} from './xml-config';

function caughtXmlError(action: () => unknown): XmlProcessError {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(XmlProcessError);
    return error as XmlProcessError;
  }
  throw new Error('Expected XmlProcessError.');
}

describe('XML security preflight', () => {
  it('rejects XXE declarations before parsing while allowing an opaque external ID', () => {
    const xxe = '<!DOCTYPE root [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><root>&xxe;</root>';
    expect(caughtXmlError(() => validateXmlText(xxe)).code).toBe('CUSTOM_ENTITIES_UNSUPPORTED');

    const opaque = '<!DOCTYPE root SYSTEM "https://invalid.example/no-fetch.dtd"><root/>';
    const result = processXmlText(opaque, 'format');
    expect(result.mode).toBe('format');
    if (result.mode === 'format') {
      expect(result.output).toContain('<!DOCTYPE root SYSTEM "https://invalid.example/no-fetch.dtd">');
      expect(result.output).toContain('<root/>');
    }
  });

  it('rejects billion-laughs and parameter ENTITY declarations', () => {
    const laughs = `<!DOCTYPE lolz [
      <!ENTITY lol "lol">
      <!ENTITY lol1 "&lol;&lol;&lol;&lol;">
    ]><lolz>&lol1;</lolz>`;
    const parameterEntity = '<!DOCTYPE root [<!ENTITY % local "value">]><root/>';
    expect(caughtXmlError(() => validateXmlText(laughs)).code).toBe('CUSTOM_ENTITIES_UNSUPPORTED');
    expect(caughtXmlError(() => validateXmlText(parameterEntity)).code).toBe('CUSTOM_ENTITIES_UNSUPPORTED');
  });

  it('rejects undefined named references and accepts only predefined or numeric references', () => {
    const undefinedReference = caughtXmlError(() => validateXmlText('<root>&private;</root>'));
    expect(undefinedReference.code).toBe('UNDEFINED_ENTITY');
    expect(undefinedReference.line).toBe(1);
    expect(undefinedReference.column).toBe(7);

    const stats = validateXmlText('<root a="&quot;&#10;&#x1F600;">&amp;&lt;&gt;&apos;&#65;</root>');
    expect(stats.rootName).toBe('root');
  });

  it('reports preflight locations using XML line breaks and Unicode code-point columns', () => {
    const loneCr = caughtXmlError(() => validateXmlText('<r>\r&private;</r>'));
    expect(loneCr).toMatchObject({ code: 'UNDEFINED_ENTITY', line: 2, column: 1 });

    const crlf = caughtXmlError(() => validateXmlText('<r>\r\n😀&private;</r>'));
    expect(crlf).toMatchObject({ code: 'UNDEFINED_ENTITY', line: 2, column: 2 });

    const astralColumn = caughtXmlError(() => validateXmlText('<r>😀&private;</r>'));
    expect(astralColumn).toMatchObject({ code: 'UNDEFINED_ENTITY', line: 1, column: 5 });
  });

  it('does not treat entity-like text in comments, CDATA, processing instructions, or opaque DOCTYPE IDs as references', () => {
    const input = '<?safe value="&private;"?><!DOCTYPE root SYSTEM "urn:&private;"><root><!-- &private; --><![CDATA[&private;]]></root>';
    expect(formatXmlText(input)).toContain('<!DOCTYPE root SYSTEM "urn:&private;">');
    expect(viewXmlText(input).rows.some((row) => row.kind === 'doctype' && row.value?.includes('&private;'))).toBe(true);
  });
});

describe('DOCTYPE handling by mode', () => {
  it.each([
    ['valid-looking internal DTD', '<!DOCTYPE root [<!ELEMENT root EMPTY>]><root/>'],
    ['valid-looking external DTD', '<!DOCTYPE root SYSTEM "urn:example:external.dtd"><root/>'],
    ['malformed external DTD', '<!DOCTYPE root SYSTEM><root/>'],
    ['unclosed internal DTD', '<!DOCTYPE root [<!ELEMENT root EMPTY><root/>'],
  ])('rejects %s in validator mode before DTD grammar can be claimed', (_label, input) => {
    const error = caughtXmlError(() => validateXmlText(input));
    expect(error.code).toBe('DOCTYPE_UNSUPPORTED');
    expect(error.message).toMatch(/DTD grammar/i);
    expect(error.line).toBe(1);
    expect(error.column).toBe(1);
  });

  it('keeps bounded valid-looking DOCTYPE text opaque in format and view modes', () => {
    const input = '<!DOCTYPE root PUBLIC "-//EXAMPLE//DTD DEMO 1.0//EN" "urn:demo.dtd"><root><child/></root>';
    const formatted = formatXmlText(input);
    expect(formatted).toContain('<!DOCTYPE root PUBLIC "-//EXAMPLE//DTD DEMO 1.0//EN" "urn:demo.dtd">');
    const viewed = viewXmlText(input);
    expect(viewed.rows.find((row) => row.kind === 'doctype')).toMatchObject({
      label: 'DOCTYPE',
      value: '<!DOCTYPE root PUBLIC "-//EXAMPLE//DTD DEMO 1.0//EN" "urn:demo.dtd">',
    });
    expect(viewed.stats.documentTypes).toBe(1);
  });
});

describe('XML version and processing-instruction namespace rules', () => {
  it.each(['format', 'validate', 'view'] as const)('rejects XML 1.1 in %s mode before parsing', (mode) => {
    const error = caughtXmlError(() => processXmlText('<?xml version="1.1"?><root/>', mode));
    expect(error.code).toBe('UNSUPPORTED_XML_VERSION');
    expect(error.message).toMatch(/XML 1\.0/i);
  });

  it('distinguishes valid unsupported 1.x versions from malformed version syntax', () => {
    expect(caughtXmlError(() => validateXmlText("<?xml version='1.9'?><root/>")).code)
      .toBe('UNSUPPORTED_XML_VERSION');
    expect(caughtXmlError(() => validateXmlText("<?xml version='1.x'?><root/>")).code)
      .toBe('MALFORMED_XML');
    expect(caughtXmlError(() => formatXmlText('<?xml version="2.0"?><root/>')).code)
      .toBe('MALFORMED_XML');
  });

  it.each([
    ['empty encoding', '<?xml version="1.0" encoding=""?><root/>'],
    ['empty standalone', '<?xml version="1.0" standalone=""?><root/>'],
    ['joined optional fields', '<?xml version="1.0" encoding="UTF-8"standalone="yes"?><root/>'],
    ['optional fields out of order', '<?xml version="1.0" standalone="yes" encoding="UTF-8"?><root/>'],
    ['duplicate encoding', '<?xml version="1.0" encoding="UTF-8" encoding="UTF-8"?><root/>'],
    ['duplicate standalone', '<?xml version="1.0" standalone="yes" standalone="no"?><root/>'],
    ['duplicate version', '<?xml version="1.0" version="1.0"?><root/>'],
    ['invalid encoding name', '<?xml version="1.0" encoding="8BIT"?><root/>'],
    ['invalid standalone value', '<?xml version="1.0" standalone="true"?><root/>'],
  ])('rejects malformed XML declaration: %s in every mode', (_label, input) => {
    for (const mode of ['format', 'validate', 'view'] as const) {
      const error = caughtXmlError(() => processXmlText(input, mode));
      expect(error.code).toBe('MALFORMED_XML');
      expect(error.message).toMatch(/XML declaration/i);
    }
  });

  it.each([
    '<?xml version="1.0"?>',
    '<?xml   version = \'1.0\' encoding = "UTF-8" standalone = \'yes\'   ?>',
    '<?xml\tversion=\'1.0\'\r\nencoding=\'iso-8859-1\'\nstandalone="no"?>',
  ])('accepts a grammar-valid XML 1.0 declaration in every mode: %s', (declaration) => {
    const input = `${declaration}<root/>`;
    for (const mode of ['format', 'validate', 'view'] as const) {
      const result = processXmlText(input, mode);
      expect(result.stats.rootName).toBe('root');
    }
  });

  it('preserves xml-stylesheet as an ordinary processing instruction', () => {
    const instruction = '<?xml-stylesheet type="text/xsl" href="style.xsl"?>';
    const input = `${instruction}<root/>`;
    expect(formatXmlText(input)).toContain(instruction);
    expect(validateXmlText(input).processingInstructions).toBe(1);
    expect(viewXmlText(input).rows.find((row) => row.kind === 'processing-instruction'))
      .toMatchObject({ label: 'xml-stylesheet', value: instruction });
  });

  it.each([
    ['prolog colon target', '<?a:b value?><root/>'],
    ['content colon target', '<root><?a:b value?></root>'],
    ['multiple-colon target', '<root><?a:b:c?></root>'],
  ])('rejects %s as a non-NCName processing-instruction target', (_label, input) => {
    for (const mode of ['format', 'validate', 'view'] as const) {
      expect(caughtXmlError(() => processXmlText(input, mode)).code).toBe('NAMESPACE_ERROR');
    }
  });

  it('accepts valid ASCII and non-ASCII NCName processing-instruction targets', () => {
    const stats = validateXmlText('<?xml-stylesheet type="text/xsl"?><?처리 값?><root><?inside ok?></root>');
    expect(stats.processingInstructions).toBe(3);
  });
});

describe('XML well-formedness and namespaces', () => {
  it.each([
    '<root><child></root>',
    '<root unquoted=value/>',
    '<root><!-- unclosed</root>',
    '<root><![CDATA[unclosed</root>',
    '<root>bare & ampersand</root>',
    '<root/><extra/>',
  ])('rejects malformed input: %s', (input) => {
    const error = caughtXmlError(() => validateXmlText(input));
    expect(['MALFORMED_XML', 'UNDEFINED_ENTITY']).toContain(error.code);
    expect(error.message.length).toBeLessThanOrEqual(MAX_XML_ERROR_CHARACTERS);
  });

  it('validates namespace scope, records used URIs, and preserves the actual root QName', () => {
    const stats = validateXmlText(
      '<feed xmlns="urn:feed" xmlns:m="urn:meta"><m:item xml:lang="ko" m:id="7" plain="yes"/></feed>',
    );
    expect(stats).toMatchObject({
      rootName: 'feed',
      elements: 2,
      attributes: 5,
      maxDepth: 2,
      namespaces: 3,
    });
  });

  it.each([
    ['unbound element prefix', '<p:root/>'],
    ['unbound attribute prefix', '<root p:id="1"/>'],
    ['reserved xmlns prefix', '<xmlns:root/>'],
    ['wrong xml binding', '<root xmlns:xml="urn:not-xml"/>'],
    ['reserved xmlns URI', '<root xmlns:p="http://www.w3.org/2000/xmlns/"/>'],
    ['empty prefixed namespace', '<root xmlns:p=""/>'],
    ['digit-starting local name', '<root xmlns:a="urn:a"><a:1/></root>'],
    ['digit-starting prefix', '<root><1:a/></root>'],
    ['multiple QName colons', '<a:b:c xmlns:a="urn:a"/>'],
  ])('rejects %s', (_label, input) => {
    expect(caughtXmlError(() => validateXmlText(input)).code).toBe('NAMESPACE_ERROR');
  });

  it('rejects duplicate expanded attribute names even when prefixes differ', () => {
    const input = '<root xmlns:a="urn:same" xmlns:b="urn:same" a:id="1" b:id="2"/>';
    expect(caughtXmlError(() => validateXmlText(input)).code).toBe('NAMESPACE_ERROR');
  });

  it('does not apply the default namespace to unprefixed attributes', () => {
    expect(() => validateXmlText('<root xmlns="urn:root" id="1"/>')).not.toThrow();
  });

  it('accepts namespace-conforming non-ASCII NCNames', () => {
    const stats = validateXmlText('<뿌리 xmlns:자료="urn:data"><자료:항목 자료:값="예"/></뿌리>');
    expect(stats.rootName).toBe('뿌리');
    expect(stats.namespaces).toBe(1);
  });

  it('reports bounded parser errors with source locations', () => {
    const error = caughtXmlError(() => validateXmlText('<root>\n  <bad key="x\u0000y"/>\n</root>'));
    expect(error.code).toBe('MALFORMED_XML');
    expect(error.line).toBeGreaterThanOrEqual(2);
    expect(error.column).toBeGreaterThan(0);
    expect(error.message.length).toBeLessThanOrEqual(MAX_XML_ERROR_CHARACTERS);
    expect(error.message).not.toMatch(/\(line\s+\d+,\s*column\s+\d+\)/i);
  });

  it('normalizes parser-provided error locations for XML line breaks', () => {
    const error = caughtXmlError(() => validateXmlText('<root>\r<!--bad--x--></root>'));
    expect(error.code).toBe('MALFORMED_XML');
    expect(error.line).toBe(2);
    expect(error.message).not.toMatch(/\(line\s+\d+,\s*column\s+\d+\)/i);
  });
});

describe('formatXmlText', () => {
  it('preserves raw tokens while normalizing only element-only inter-tag whitespace', () => {
    const input = `<root><p>Hello <b data-x='&quot;'>world</b> &amp; friends.</p><items><i id='1'/><i id="2"></i></items><!--keep--><?next exact?></root>`;
    const output = formatXmlText(input);
    expect(output).toBe(`<root>
  <p>Hello <b data-x='&quot;'>world</b> &amp; friends.</p>
  <items>
    <i id='1'/>
    <i id="2"></i>
  </items>
  <!--keep-->
  <?next exact?>
</root>`);
    expect(output).toContain("data-x='&quot;'");
    expect(output).toContain("<i id='1'/>");
    expect(output).toContain('<i id="2"></i>');
  });

  it('leaves mixed content, CDATA, and inherited xml:space preserve subtrees byte-for-code-unit exact', () => {
    const mixed = '<p>Hello <b>world</b> &amp; friends.</p>';
    expect(formatXmlText(mixed)).toBe(mixed);

    const cdata = '<root><![CDATA[  <not-markup>\n]]><child/></root>';
    expect(formatXmlText(cdata)).toBe(cdata);

    const preserved = `<root><pre xml:space='preserve'>
 <x> a </x>
 <inner xml:space="default">  <y/> </inner>
</pre><normal><x/></normal></root>`;
    const output = formatXmlText(preserved);
    const exactPre = `<pre xml:space='preserve'>
 <x> a </x>
 <inner xml:space="default">  <y/> </inner>
</pre>`;
    expect(output).toContain(exactPre);
    expect(output).toContain('<normal>\n    <x/>\n  </normal>');
  });

  it('preserves non-ASCII and astral tokens using lexer code-unit indices', () => {
    const input = '<根 emoji="😀"><子>값 &amp; 😀</子><빈/></根>';
    expect(formatXmlText(input)).toBe('<根 emoji="😀">\n  <子>값 &amp; 😀</子>\n  <빈/>\n</根>');
  });

  it('preserves XML declarations, comments, PI, and opaque DOCTYPE spelling', () => {
    const input = `<?xml version='1.0'?>
<!DOCTYPE root [<!ELEMENT root (child)> <!ELEMENT child EMPTY>]>
<!-- exact -->
<root><child /></root>
<?after keep?>`;
    const output = formatXmlText(input, { indentation: 'tabs', lineEnding: 'lf' });
    expect(output).toContain("<?xml version='1.0'?>");
    expect(output).toContain('<!DOCTYPE root [<!ELEMENT root (child)> <!ELEMENT child EMPTY>]>');
    expect(output).toContain('\t<child />');
    expect(output).toContain('<?after keep?>');
  });

  it.each([
    ['2-spaces', 'lf'],
    ['4-spaces', 'crlf'],
    ['tabs', 'lf'],
  ] as const)('is idempotent with %s and %s output', (indentation, lineEnding) => {
    const input = '<root> <group><one/><two><leaf/></two></group><!-- c --> </root>';
    const once = formatXmlText(input, { indentation, lineEnding });
    const twice = formatXmlText(once, { indentation, lineEnding });
    expect(twice).toBe(once);
    if (lineEnding === 'crlf') expect(once).toContain('\r\n');
  });

  it('validates options without mutating shared defaults', () => {
    expect(normalizeXmlFormatOptions({ indentation: 'tabs' })).toEqual({ indentation: 'tabs', lineEnding: 'lf' });
    expect(DEFAULT_XML_FORMAT_OPTIONS).toEqual({ indentation: '2-spaces', lineEnding: 'lf' });
    expect(() => normalizeXmlFormatOptions({ indentation: 'eight' as never })).toThrow(/indentation/i);
    expect(() => processXmlText('<root/>', 'unknown' as never)).toThrow(/mode/i);
  });
});

describe('XML stats and viewer DTO', () => {
  it('returns well-formedness-only statistics in validate mode', () => {
    const result = processXmlText(
      '<?xml version="1.0"?><r a="1"><x>text</x><!--c--><![CDATA[d]]><?go x?></r>',
      'validate',
    );
    expect(result.mode).toBe('validate');
    expect(result.stats).toEqual({
      rootName: 'r',
      elements: 2,
      attributes: 1,
      textNodes: 1,
      comments: 1,
      cdataSections: 1,
      processingInstructions: 1,
      documentTypes: 0,
      maxDepth: 2,
      namespaces: 0,
    });
  });

  it('returns JSON-safe flat rows in lexical order with raw text values', () => {
    const result = viewXmlText('<r b="2" a=\'1\'>before<x/>after<!--c--></r>');
    expect(result.truncated).toBe(false);
    expect(result.rows.map((row) => row.kind)).toEqual([
      'element-open', 'attribute', 'attribute', 'text', 'element-empty', 'text', 'comment', 'element-close',
    ]);
    expect(result.rows[1]).toMatchObject({ label: 'b', value: 'b="2"' });
    expect(result.rows[3]).toMatchObject({ label: '#text', value: 'before' });
    expect(() => structuredClone(result.rows)).not.toThrow();
    expect(JSON.stringify(result.rows).length).toBeLessThanOrEqual(MAX_XML_OUTPUT_CHARACTERS);
  });

  it('caps viewer rows and marks the result truncated before worker transfer', () => {
    const input = `<root>${'<x></x>'.repeat((MAX_XML_VIEWER_ROWS / 2) + 10)}</root>`;
    const result = viewXmlText(input);
    expect(result.rows).toHaveLength(MAX_XML_VIEWER_ROWS);
    expect(result.truncated).toBe(true);
    expect(JSON.stringify(result.rows).length).toBeLessThanOrEqual(MAX_XML_OUTPUT_CHARACTERS);
  });
});

describe('XML resource boundaries', () => {
  it('accepts the exact input limit and rejects one additional character', () => {
    const exact = `<r>${' '.repeat(MAX_XML_INPUT_CHARACTERS - 7)}</r>`;
    expect(exact).toHaveLength(MAX_XML_INPUT_CHARACTERS);
    expect(validateXmlText(exact).rootName).toBe('r');
    const error = caughtXmlError(() => validateXmlText(`${exact} `));
    expect(error.code).toBe('INPUT_TOO_LARGE');
  });

  it('allows the exact depth limit and rejects the next nested element', () => {
    const nested = (depth: number) => `${'<a>'.repeat(depth)}${'</a>'.repeat(depth)}`;
    expect(validateXmlText(nested(MAX_XML_DEPTH)).maxDepth).toBe(MAX_XML_DEPTH);
    expect(caughtXmlError(() => validateXmlText(nested(MAX_XML_DEPTH + 1))).code).toBe('INPUT_TOO_COMPLEX');
  });

  it('allows the exact element limit and rejects one additional element', () => {
    const withElements = (count: number) => `<r>${'<e/>'.repeat(count - 1)}</r>`;
    expect(validateXmlText(withElements(MAX_XML_ELEMENTS)).elements).toBe(MAX_XML_ELEMENTS);
    expect(caughtXmlError(() => validateXmlText(withElements(MAX_XML_ELEMENTS + 1))).code).toBe('INPUT_TOO_COMPLEX');
  });

  it('allows the exact attribute limit and rejects one additional attribute', () => {
    const withAttributes = (count: number) => {
      const attributes = Array.from({ length: count }, (_, index) => ` ${String.fromCharCode(0x3001 + index)}=""`).join('');
      return `<r${attributes}/>`;
    };
    expect(validateXmlText(withAttributes(MAX_XML_ATTRIBUTES)).attributes).toBe(MAX_XML_ATTRIBUTES);
    expect(caughtXmlError(() => validateXmlText(withAttributes(MAX_XML_ATTRIBUTES + 1))).code).toBe('INPUT_TOO_COMPLEX');
  });

  it('discards formatter indentation amplification beyond the output limit', () => {
    const chain = `${'<a>'.repeat(MAX_XML_DEPTH - 2)}<z/>${'</a>'.repeat(MAX_XML_DEPTH - 2)}`;
    const input = `<r>${chain.repeat(80)}</r>`;
    expect(input.length).toBeLessThan(MAX_XML_INPUT_CHARACTERS);
    expect(caughtXmlError(() => formatXmlText(input, { indentation: '4-spaces' })).code).toBe('OUTPUT_TOO_LARGE');
  });

  it('rejects empty input with a bounded error', () => {
    const error = caughtXmlError(() => validateXmlText(' \n\t'));
    expect(error.code).toBe('EMPTY_INPUT');
    expect(error.message.length).toBeLessThanOrEqual(MAX_XML_ERROR_CHARACTERS);
  });
});
