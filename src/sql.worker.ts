/// <reference lib="webworker" />

import { formatSqlText, SqlFormatError } from './lib/sql';
import type { SqlWorkerRequest, SqlWorkerResponse } from './lib/sql-worker-protocol';

const worker = self as DedicatedWorkerGlobalScope;

worker.addEventListener('message', (event: MessageEvent<SqlWorkerRequest>) => {
  const request = event.data;
  let response: SqlWorkerResponse;
  try {
    response = { type: 'result', id: request.id, ok: true, output: formatSqlText(request.input, request.options) };
  } catch (error) {
    response = {
      type: 'result',
      id: request.id,
      ok: false,
      code: error instanceof SqlFormatError ? error.code : 'FORMAT_FAILED',
      message: error instanceof Error ? error.message : 'The SQL formatter failed.',
    };
  }
  worker.postMessage(response);
});

worker.addEventListener('messageerror', () => {
  const response: SqlWorkerResponse = {
    type: 'protocol-error',
    code: 'REQUEST_DESERIALIZATION_FAILED',
    message: 'The formatter worker could not read the local request.',
  };
  worker.postMessage(response);
});

const ready: SqlWorkerResponse = { type: 'ready' };
worker.postMessage(ready);
