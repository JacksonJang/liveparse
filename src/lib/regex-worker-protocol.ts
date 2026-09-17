import type { RegexAnalysis } from './regex-tools';

export interface RegexWorkerRequest {
  readonly type: 'analyze';
  readonly jobId: number;
  readonly pattern: string;
  readonly flags: string;
  readonly text: string;
  readonly replacement: string | null;
}

export type RegexWorkerResponse =
  | { readonly type: 'ready' }
  | {
      readonly type: 'result';
      readonly jobId: number;
      readonly ok: true;
      readonly analysis: RegexAnalysis;
    }
  | {
      readonly type: 'result';
      readonly jobId: number;
      readonly ok: false;
      readonly code: string;
      readonly message: string;
    }
  | { readonly type: 'protocol-error'; readonly code: string; readonly message: string };
