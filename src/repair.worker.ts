/// <reference lib="webworker" />

import { repairJson } from './lib/json-repair';
import type {
  JsonRepairWorkerError,
  JsonRepairWorkerRequest,
  JsonRepairWorkerResponse,
} from './lib/json-repair-worker-protocol';

function countLines(source: string): number {
  if (!source) return 0;
  let count = 1;
  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index);
    if (code === 10) count += 1;
    else if (code === 13) {
      count += 1;
      if (source.charCodeAt(index + 1) === 10) index += 1;
    }
  }
  return count;
}

self.addEventListener('message', (event: MessageEvent<JsonRepairWorkerRequest>) => {
  const request = event.data;
  if (request.type !== 'repair') return;
  try {
    const response: JsonRepairWorkerResponse = {
      type: 'repaired',
      requestId: request.requestId,
      result: repairJson(request.input),
      lineCount: countLines(request.input),
    };
    self.postMessage(response);
  } catch (error) {
    const response: JsonRepairWorkerError = {
      type: 'worker-error',
      requestId: request.requestId,
      message: error instanceof Error ? error.message : String(error),
    };
    self.postMessage(response);
  }
});

export {};
