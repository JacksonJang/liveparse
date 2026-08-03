/// <reference lib="webworker" />

import { runYamlOperation, YamlToolError } from './lib/yaml';
import type { YamlWorkerRequest, YamlWorkerResponse } from './lib/yaml-worker-protocol';

const context = self as DedicatedWorkerGlobalScope;
const YAML_MODES = new Set<YamlWorkerRequest['mode']>(['format', 'validate', 'view', 'yaml-to-json', 'json-to-yaml']);

function post(message: YamlWorkerResponse): void {
  context.postMessage(message);
}

function isWorkerRequest(value: unknown): value is YamlWorkerRequest {
  if (!value || typeof value !== 'object') return false;
  const request = value as Partial<YamlWorkerRequest>;
  if (!Number.isSafeInteger(request.id) || (request.id as number) < 0) return false;
  if (typeof request.input !== 'string' || !YAML_MODES.has(request.mode as YamlWorkerRequest['mode'])) return false;
  if (!request.options || typeof request.options !== 'object') return false;
  return (request.options.version === '1.1' || request.options.version === '1.2')
    && (request.options.indent === 2 || request.options.indent === 4)
    && (request.options.jsonIndent === 2 || request.options.jsonIndent === 4);
}

context.addEventListener('message', (event: MessageEvent<unknown>) => {
  if (!isWorkerRequest(event.data)) {
    post({ type: 'protocol-error', code: 'INVALID_REQUEST', message: 'The YAML worker received an invalid request.' });
    return;
  }
  const request = event.data;

  try {
    const result = runYamlOperation(request.mode, request.input, request.options);
    post({ type: 'result', id: request.id, ok: true, result });
  } catch (error) {
    if (error instanceof YamlToolError) {
      post({
        type: 'result',
        id: request.id,
        ok: false,
        code: error.code,
        message: error.message,
        line: error.line,
        column: error.column,
      });
      return;
    }
    post({
      type: 'result',
      id: request.id,
      ok: false,
      code: 'YAML_OPERATION_FAILED',
      message: error instanceof Error ? error.message : 'The YAML operation failed.',
    });
  }
});

post({ type: 'ready' });
