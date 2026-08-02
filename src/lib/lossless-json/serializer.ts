import type { JsonDocument, JsonIndent, JsonNode, JsonSerializeOptions } from './types';

function serializeNode(node: JsonNode, indent: JsonIndent, depth: number): string {
  switch (node.type) {
    case 'string': return node.raw;
    case 'number': return node.raw;
    case 'boolean': return node.value ? 'true' : 'false';
    case 'null': return 'null';
    case 'array': {
      if (node.elements.length === 0) return '[]';
      if (indent === 0) {
        return `[${node.elements.map((element) => serializeNode(element, indent, depth + 1)).join(',')}]`;
      }
      const currentPadding = ' '.repeat(indent * depth);
      const childPadding = ' '.repeat(indent * (depth + 1));
      const elements = node.elements
        .map((element) => `${childPadding}${serializeNode(element, indent, depth + 1)}`)
        .join(',\n');
      return `[\n${elements}\n${currentPadding}]`;
    }
    case 'object': {
      if (node.members.length === 0) return '{}';
      if (indent === 0) {
        const members = node.members
          .map((member) => `${member.key.raw}:${serializeNode(member.value, indent, depth + 1)}`)
          .join(',');
        return `{${members}}`;
      }
      const currentPadding = ' '.repeat(indent * depth);
      const childPadding = ' '.repeat(indent * (depth + 1));
      const members = node.members
        .map((member) => `${childPadding}${member.key.raw}: ${serializeNode(member.value, indent, depth + 1)}`)
        .join(',\n');
      return `{\n${members}\n${currentPadding}}`;
    }
  }
}

export function serializeLosslessJson(
  documentOrNode: JsonDocument | JsonNode,
  options: JsonSerializeOptions = {},
): string {
  const indent = options.indent ?? 2;
  const node = 'root' in documentOrNode ? documentOrNode.root : documentOrNode;
  return serializeNode(node, indent, 0);
}

export function getJsonNodeSource(document: JsonDocument, node: JsonNode): string {
  return document.source.slice(node.start, node.end);
}
