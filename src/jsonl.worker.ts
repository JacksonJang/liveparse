/// <reference lib="webworker" />

import {
  createJsonlTableRows,
  discoverJsonlColumns,
  filterJsonlRecords,
  jsonlRecordsToCsv,
  parseJsonl,
  serializeJsonlRecords,
  type JsonlParseResult,
  type JsonlRecord,
  type JsonlWorkerRequest,
  type JsonlWorkerResponse,
} from './lib/jsonl';

const TABLE_COLUMN_LIMIT = 32;
const PAGE_SIZE_LIMIT = 160;
const DIAGNOSTIC_SAMPLE_LIMIT = 250;

let datasetId = 0;
let dataset: JsonlParseResult | null = null;
let filteredRecords: JsonlRecord[] = [];

function post(message: JsonlWorkerResponse): void {
  self.postMessage(message);
}

function currentDataset(request: { requestId: number; datasetId: number }): JsonlParseResult | null {
  if (!dataset || request.datasetId !== datasetId) return null;
  return dataset;
}

self.addEventListener('message', (event: MessageEvent<JsonlWorkerRequest>) => {
  const request = event.data;
  try {
    if (request.type === 'parse') {
      datasetId = request.requestId;
      dataset = parseJsonl(request.source);
      filteredRecords = dataset.records;
      const discovery = discoverJsonlColumns(dataset.records, TABLE_COLUMN_LIMIT);
      post({
        type: 'parsed',
        requestId: request.requestId,
        datasetId,
        summary: dataset.summary,
        columns: discovery.columns,
        totalColumns: discovery.totalColumns,
        columnsTruncated: discovery.truncated,
        errors: dataset.errors.slice(0, DIAGNOSTIC_SAMPLE_LIMIT),
        errorsTruncated: dataset.errors.length > DIAGNOSTIC_SAMPLE_LIMIT,
        warnings: dataset.warnings.slice(0, DIAGNOSTIC_SAMPLE_LIMIT),
        warningsTruncated: dataset.warnings.length > DIAGNOSTIC_SAMPLE_LIMIT,
      });
      return;
    }

    const active = currentDataset(request);
    if (!active) return;

    if (request.type === 'filter') {
      filteredRecords = filterJsonlRecords(active.records, request.query);
      post({
        type: 'filtered',
        requestId: request.requestId,
        datasetId,
        query: request.query,
        totalRecords: filteredRecords.length,
      });
      return;
    }

    if (request.type === 'page') {
      const discovery = discoverJsonlColumns(active.records, TABLE_COLUMN_LIMIT);
      const start = Math.max(0, Math.min(filteredRecords.length, Math.floor(request.start)));
      const count = Math.min(PAGE_SIZE_LIMIT, Math.max(0, Math.floor(request.count)));
      post({
        type: 'page',
        requestId: request.requestId,
        datasetId,
        start,
        totalRecords: filteredRecords.length,
        rows: createJsonlTableRows(filteredRecords, discovery.columns, start, count),
      });
      return;
    }

    // Export from the query carried by this request. The table filter is
    // debounced, so relying on the worker's last paged result could otherwise
    // export records for the previous query when a user clicks immediately.
    const records = request.scope === 'filtered'
      ? filterJsonlRecords(active.records, request.query)
      : active.records;
    const content = request.format === 'csv'
      ? jsonlRecordsToCsv(records)
      : serializeJsonlRecords(records);
    post({
      type: 'exported',
      requestId: request.requestId,
      datasetId,
      format: request.format,
      scope: request.scope,
      content,
      recordCount: records.length,
    });
  } catch (error) {
    post({
      type: 'failed',
      requestId: request.requestId,
      datasetId: request.type === 'parse' ? request.requestId : request.datasetId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

export {};
