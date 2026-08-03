export const MAX_YAML_INPUT_CHARACTERS = 200_000;
export const YAML_LARGE_INPUT_WARNING_CHARACTERS = 100_000;
export const MAX_YAML_OUTPUT_CHARACTERS = 1_000_000;
export const MAX_YAML_DEPTH = 256;
export const MAX_YAML_NODES = 25_000;
export const MAX_YAML_VIEWER_ROWS = 10_000;
export const MAX_YAML_ALIAS_EXPANSION = 50;
export const MAX_YAML_DIAGNOSTICS = 100;

export type YamlMode = 'format' | 'validate' | 'view' | 'yaml-to-json' | 'json-to-yaml';
export type YamlVersion = '1.2' | '1.1';
export type YamlIndent = 2 | 4;

export interface YamlOptions {
  version: YamlVersion;
  indent: YamlIndent;
  jsonIndent: YamlIndent;
}

export const DEFAULT_YAML_OPTIONS: Readonly<YamlOptions> = Object.freeze({
  version: '1.2',
  indent: 2,
  jsonIndent: 2,
});
