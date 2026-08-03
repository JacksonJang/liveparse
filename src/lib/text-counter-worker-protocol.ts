import type { TextAnalysis } from './text-analysis';

export interface TextCounterWorkerRequest {
  type: 'analyze';
  jobId: number;
  input: string;
  locale: string;
}

export type TextCounterWorkerResponse =
  | { type: 'ready' }
  | { type: 'result'; jobId: number; ok: true; analysis: TextAnalysis }
  | { type: 'result'; jobId: number; ok: false; code: string; message: string }
  | { type: 'protocol-error'; code: string; message: string };
