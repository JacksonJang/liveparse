/// <reference lib="webworker" />

import {
  analyzeText,
  MAX_TEXT_INPUT_CODE_UNITS,
  TextAnalysisError,
  type TextAnalysisOptions,
} from './lib/text-analysis';
import type {
  TextCounterWorkerRequest,
  TextCounterWorkerResponse,
} from './lib/text-counter-worker-protocol';

const worker = self as DedicatedWorkerGlobalScope;

function isWorkerRequest(value: unknown): value is TextCounterWorkerRequest {
  if (typeof value !== 'object' || value === null) return false;
  const request = value as Partial<TextCounterWorkerRequest>;
  return request.type === 'analyze'
    && Number.isSafeInteger(request.jobId)
    && Number(request.jobId) >= 0
    && typeof request.input === 'string'
    && typeof request.locale === 'string'
    && request.locale.length <= 100;
}

function post(response: TextCounterWorkerResponse): void {
  worker.postMessage(response);
}

worker.addEventListener('message', (event: MessageEvent<unknown>) => {
  const request = event.data;
  if (!isWorkerRequest(request)) {
    post({
      type: 'protocol-error',
      code: 'INVALID_REQUEST',
      message: 'The text counter worker received an invalid local request.',
    });
    return;
  }

  if (request.input.length > MAX_TEXT_INPUT_CODE_UNITS) {
    post({
      type: 'result',
      jobId: request.jobId,
      ok: false,
      code: 'INPUT_TOO_LARGE',
      message: `Text is limited to ${MAX_TEXT_INPUT_CODE_UNITS.toLocaleString('en-US')} UTF-16 code units to keep this browser tab responsive.`,
    });
    return;
  }

  try {
    const options: TextAnalysisOptions = {
      locale: request.locale || undefined,
      utf8Policy: 'reject-ill-formed',
      maxCodeUnits: MAX_TEXT_INPUT_CODE_UNITS,
    };
    const analysis = analyzeText(request.input, options);
    post({ type: 'result', jobId: request.jobId, ok: true, analysis });
  } catch (error) {
    post({
      type: 'result',
      jobId: request.jobId,
      ok: false,
      code: error instanceof TextAnalysisError ? error.code : 'ANALYSIS_FAILED',
      message: error instanceof Error && error.message
        ? error.message.slice(0, 400)
        : 'The local text analysis could not finish.',
    });
  }
});

worker.addEventListener('messageerror', () => {
  post({
    type: 'protocol-error',
    code: 'REQUEST_DESERIALIZATION_FAILED',
    message: 'The text counter worker could not read the local request.',
  });
});

post({ type: 'ready' });
