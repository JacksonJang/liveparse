import { useEffect, useRef, useState } from 'react';
import type { RepairResult } from './lib/json-repair';
import type {
  JsonRepairWorkerError,
  JsonRepairWorkerResponse,
} from './lib/json-repair-worker-protocol';

export type JsonRepairWorkerState =
  | { status: 'pending'; source: string }
  | { status: 'ready'; source: string; result: RepairResult; lineCount: number }
  | { status: 'failed'; source: string; message: string };

const REPAIR_DEBOUNCE_MS = 180;

export function useJsonRepairWorker(source: string): JsonRepairWorkerState {
  const requestIdRef = useRef(0);
  const [state, setState] = useState<JsonRepairWorkerState>({ status: 'pending', source });

  useEffect(() => {
    const requestId = ++requestIdRef.current;
    setState({ status: 'pending', source });
    let worker: Worker | null = null;
    const timer = window.setTimeout(() => {
      try {
        worker = new Worker(new URL('./repair.worker.ts', import.meta.url), { type: 'module' });
        worker.onmessage = (event: MessageEvent<JsonRepairWorkerResponse | JsonRepairWorkerError>) => {
          if (event.data.requestId !== requestId || requestIdRef.current !== requestId) return;
          if (event.data.type === 'worker-error') {
            setState({ status: 'failed', source, message: event.data.message });
          } else {
            setState({
              status: 'ready',
              source,
              result: event.data.result,
              lineCount: event.data.lineCount,
            });
          }
          worker?.terminate();
          worker = null;
        };
        worker.onerror = (event) => {
          if (requestIdRef.current === requestId) {
            setState({ status: 'failed', source, message: event.message || 'The repair worker could not start.' });
          }
          worker?.terminate();
          worker = null;
        };
        worker.postMessage({ type: 'repair', requestId, input: source });
      } catch (error) {
        if (requestIdRef.current === requestId) {
          setState({
            status: 'failed',
            source,
            message: error instanceof Error ? error.message : 'The repair worker could not start.',
          });
        }
        worker?.terminate();
        worker = null;
      }
    }, REPAIR_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
      worker?.terminate();
    };
  }, [source]);

  return state;
}
