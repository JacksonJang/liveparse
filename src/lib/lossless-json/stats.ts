import type { JsonNode, JsonStats } from './types';

export function buildJsonStats(root: JsonNode, characters = root.end - root.start): JsonStats {
  const stats: JsonStats = {
    objects: 0,
    arrays: 0,
    properties: 0,
    strings: 0,
    numbers: 0,
    booleans: 0,
    nulls: 0,
    characters,
  };

  const stack: JsonNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    switch (node.type) {
      case 'object':
        stats.objects += 1;
        stats.properties += node.members.length;
        for (let index = node.members.length - 1; index >= 0; index -= 1) {
          stack.push(node.members[index].value);
        }
        break;
      case 'array':
        stats.arrays += 1;
        for (let index = node.elements.length - 1; index >= 0; index -= 1) {
          stack.push(node.elements[index]);
        }
        break;
      case 'string': stats.strings += 1; break;
      case 'number': stats.numbers += 1; break;
      case 'boolean': stats.booleans += 1; break;
      case 'null': stats.nulls += 1; break;
    }
  }
  return stats;
}
