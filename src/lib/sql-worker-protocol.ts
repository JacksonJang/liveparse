import type { SqlFormatOptions } from './sql-config';

export interface SqlWorkerRequest {
  id: number;
  input: string;
  options: SqlFormatOptions;
}

export type SqlWorkerResponse =
  | { type: 'ready' }
  | { type: 'result'; id: number; ok: true; output: string }
  | { type: 'result'; id: number; ok: false; code: string; message: string }
  | { type: 'protocol-error'; code: string; message: string };
