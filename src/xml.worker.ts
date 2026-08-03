/// <reference lib="webworker" />

import { isXmlMode, type XmlFormatOptions } from './lib/xml-config';
import { processXmlText, XmlProcessError } from './lib/xml';
import type { XmlWorkerRequest, XmlWorkerResponse } from './lib/xml-worker-protocol';

const worker = self as DedicatedWorkerGlobalScope;

function isWorkerRequest(value: unknown): value is XmlWorkerRequest {
  if (typeof value !== 'object' || value === null) return false;
  const request = value as Partial<XmlWorkerRequest>;
  return Number.isSafeInteger(request.id)
    && typeof request.mode === 'string'
    && isXmlMode(request.mode)
    && typeof request.input === 'string'
    && typeof request.options === 'object'
    && request.options !== null;
}

worker.addEventListener('message', (event: MessageEvent<unknown>) => {
  const request = event.data;
  if (!isWorkerRequest(request)) {
    const response: XmlWorkerResponse = {
      type: 'protocol-error',
      code: 'INVALID_REQUEST',
      message: 'The XML worker received an invalid local request.',
    };
    worker.postMessage(response);
    return;
  }

  let response: XmlWorkerResponse;
  try {
    const options = request.options as XmlFormatOptions;
    response = {
      type: 'result',
      id: request.id,
      ok: true,
      result: processXmlText(request.input, request.mode, options),
    };
  } catch (error) {
    response = {
      type: 'result',
      id: request.id,
      ok: false,
      code: error instanceof XmlProcessError ? error.code : 'PROCESS_FAILED',
      message: error instanceof Error && error.message
        ? error.message.slice(0, 300)
        : 'The local XML worker could not process this document.',
      ...(error instanceof XmlProcessError && error.line !== undefined ? { line: error.line } : {}),
      ...(error instanceof XmlProcessError && error.column !== undefined ? { column: error.column } : {}),
    };
  }
  worker.postMessage(response);
});

worker.addEventListener('messageerror', () => {
  const response: XmlWorkerResponse = {
    type: 'protocol-error',
    code: 'REQUEST_DESERIALIZATION_FAILED',
    message: 'The XML worker could not read the local request.',
  };
  worker.postMessage(response);
});

const ready: XmlWorkerResponse = { type: 'ready' };
worker.postMessage(ready);
