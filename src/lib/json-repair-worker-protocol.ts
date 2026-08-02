import type { RepairResult } from './json-repair';

export type JsonRepairWorkerRequest = {
  type: 'repair';
  requestId: number;
  input: string;
};

export type JsonRepairWorkerResponse = {
  type: 'repaired';
  requestId: number;
  result: RepairResult;
  lineCount: number;
};

export type JsonRepairWorkerError = {
  type: 'worker-error';
  requestId: number;
  message: string;
};
