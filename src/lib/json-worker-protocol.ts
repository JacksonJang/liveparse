import type { JsonParseResult } from './lossless-json';

export type JsonWorkerRequest = {
  type: 'parse';
  requestId: number;
  source: string;
  sortKeys?: boolean;
};

export type JsonWorkerResponse = {
  type: 'parsed';
  requestId: number;
  result: JsonParseResult;
  minified?: string;
  formatted2?: string;
  formatted4?: string;
  lineCount: number;
  durationMs: number;
};

export type JsonWorkerProtocolError = {
  type: 'worker-error';
  requestId: number;
  message: string;
};
