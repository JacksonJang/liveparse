import { parseLosslessJson, serializeLosslessJson } from './lib/lossless-json';
import type {
  JsonWorkerProtocolError,
  JsonWorkerRequest,
  JsonWorkerResponse,
} from './lib/json-worker-protocol';

type WorkerScope = {
  onmessage: ((event: MessageEvent<JsonWorkerRequest>) => void) | null;
  postMessage: (message: JsonWorkerResponse | JsonWorkerProtocolError) => void;
};

const workerScope = self as unknown as WorkerScope;

function countLines(source: string): number {
  if (!source) return 0;
  let lines = 1;
  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index);
    if (code === 10) lines += 1;
    else if (code === 13) {
      lines += 1;
      if (source.charCodeAt(index + 1) === 10) index += 1;
    }
  }
  return lines;
}

workerScope.onmessage = (event) => {
  const request = event.data;
  if (request.type !== 'parse') return;

  const startedAt = performance.now();
  try {
    const result = parseLosslessJson(request.source);
    const response: JsonWorkerResponse = {
      type: 'parsed',
      requestId: request.requestId,
      result,
      lineCount: countLines(request.source),
      durationMs: performance.now() - startedAt,
    };
    if (result.ok) {
      const serializationOptions = { sortKeys: request.sortKeys === true };
      response.minified = serializeLosslessJson(result.document, { ...serializationOptions, indent: 0 });
      response.formatted2 = serializeLosslessJson(result.document, { ...serializationOptions, indent: 2 });
      response.formatted4 = serializeLosslessJson(result.document, { ...serializationOptions, indent: 4 });
    }
    response.durationMs = performance.now() - startedAt;
    workerScope.postMessage(response);
  } catch (error) {
    workerScope.postMessage({
      type: 'worker-error',
      requestId: request.requestId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
