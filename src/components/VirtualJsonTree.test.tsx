import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { parseLosslessJson, type JsonDocument } from '../lib/lossless-json';
import { VirtualJsonTree } from './VirtualJsonTree';

function parse(source: string): JsonDocument {
  const result = parseLosslessJson(source);
  if (!result.ok) throw new Error(result.error.message);
  return result.document;
}

describe('VirtualJsonTree', () => {
  it('renders a viewport-sized DOM regardless of the expanded row count', () => {
    const document = parse(JSON.stringify(Array.from({ length: 5_000 }, (_, index) => index)));
    const html = renderToStaticMarkup(<VirtualJsonTree document={document} />);
    const renderedTreeItems = html.match(/role="treeitem"/g)?.length ?? 0;

    expect(renderedTreeItems).toBeGreaterThan(0);
    expect(renderedTreeItems).toBeLessThanOrEqual(25);
    expect(html).toContain('role="tree"');
  });

  it('keeps array index and type display controlled by explicit props', () => {
    const document = parse('[{"id":1}]');
    const html = renderToStaticMarkup(
      <VirtualJsonTree document={document} showArrayIndexes={false} showTypes />,
    );

    expect(html).not.toContain('lp-tree-index');
    expect(html).toContain('lp-tree-type');
  });

  it('publishes sibling position metadata for a virtualized flat tree', () => {
    const document = parse('[{"id":1},{"id":2}]');
    const html = renderToStaticMarkup(<VirtualJsonTree document={document} />);

    expect(html.match(/aria-setsize="2"/g)).toHaveLength(2);
    expect(html).toContain('aria-posinset="1"');
    expect(html).toContain('aria-posinset="2"');
  });
});
