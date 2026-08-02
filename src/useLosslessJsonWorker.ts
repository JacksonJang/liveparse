import { useEffect, useRef, useState } from 'react';
import type { JsonWorkerProtocolError, JsonWorkerResponse } from './lib/json-worker-protocol';

export type LosslessWorkerState =
  | { status: 'empty'; source: string }
  | { status: 'pending'; source: string }
  | { status: 'ready'; source: string; response: JsonWorkerResponse }
  | { status: 'failed'; source: string; message: string };

const INPUT_DEBOUNCE_MS = 180;

export function useLosslessJsonWorker(source: string): LosslessWorkerState {
  const requestIdRef = useRef(0);
  const [state, setState] = useState<LosslessWorkerState>(() => (
    source.trim() ? { status: 'pending', source } : { status: 'empty', source }
  ));

  useEffect(() => {
    const requestId = ++requestIdRef.current;
    if (!source.trim()) {
      setState({ status: 'empty', source });
      return undefined;
    }

    setState({ status: 'pending', source });
    let worker: Worker | null = null;
    const timer = window.setTimeout(() => {
      try {
        worker = new Worker(new URL('./json.worker.ts', import.meta.url), { type: 'module' });
        worker.onmessage = (event: MessageEvent<JsonWorkerResponse | JsonWorkerProtocolError>) => {
          if (event.data.requestId !== requestId || requestIdRef.current !== requestId) return;
          if (event.data.type === 'worker-error') {
            setState({ status: 'failed', source, message: event.data.message });
          } else {
            setState({ status: 'ready', source, response: event.data });
          }
          worker?.terminate();
          worker = null;
        };
        worker.onerror = (event) => {
          if (requestIdRef.current === requestId) {
            setState({ status: 'failed', source, message: event.message || 'The parser worker could not start.' });
          }
          worker?.terminate();
          worker = null;
        };
        worker.postMessage({ type: 'parse', requestId, source });
      } catch (error) {
        if (requestIdRef.current === requestId) {
          setState({
            status: 'failed',
            source,
            message: error instanceof Error ? error.message : 'The parser worker could not start.',
          });
        }
        worker?.terminate();
        worker = null;
      }
    }, INPUT_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
      worker?.terminate();
    };
  }, [source]);

  return state;
}
