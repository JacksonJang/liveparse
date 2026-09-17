/// <reference lib="webworker" />

import {
  analyzeRegex,
  RegexToolError,
} from './lib/regex-tools';
import type { RegexWorkerRequest, RegexWorkerResponse } from './lib/regex-worker-protocol';

const worker = self as DedicatedWorkerGlobalScope;

function post(response: RegexWorkerResponse): void {
  worker.postMessage(response);
}

function isRequest(value: unknown): value is RegexWorkerRequest {
  if (typeof value !== 'object' || value === null) return false;
  const request = value as Partial<RegexWorkerRequest>;
  return request.type === 'analyze'
    && Number.isSafeInteger(request.jobId)
    && Number(request.jobId) >= 0
    && typeof request.pattern === 'string'
    && typeof request.flags === 'string'
    && typeof request.text === 'string'
    && (request.replacement === null || typeof request.replacement === 'string');
}

worker.addEventListener('message', (event: MessageEvent<unknown>) => {
  const request = event.data;
  if (!isRequest(request)) {
    post({
      type: 'protocol-error',
      code: 'INVALID_REQUEST',
      message: 'The regex worker received an invalid local request.',
    });
    return;
  }

  try {
    const analysis = analyzeRegex({
      pattern: request.pattern,
      flags: request.flags,
      text: request.text,
      replacement: request.replacement,
    });
    post({ type: 'result', jobId: request.jobId, ok: true, analysis });
  } catch (error) {
    post({
      type: 'result',
      jobId: request.jobId,
      ok: false,
      code: error instanceof RegexToolError ? error.code : 'REGEX_FAILED',
      message: error instanceof Error && error.message
        ? error.message.slice(0, 400)
        : 'The local regex analysis could not finish.',
    });
  }
});

worker.addEventListener('messageerror', () => {
  post({
    type: 'protocol-error',
    code: 'REQUEST_DESERIALIZATION_FAILED',
    message: 'The regex worker could not read the local request.',
  });
});

post({ type: 'ready' });
