import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  DEFAULT_SQL_FORMAT_OPTIONS,
  isSqlDialectId,
  MAX_SQL_INPUT_CHARACTERS,
  SQL_LARGE_INPUT_WARNING_CHARACTERS,
  SQL_DIALECTS,
  textLineCount,
  type SqlDialectId,
  type SqlFormatOptions,
} from './lib/sql-config';
import type { SqlWorkerRequest, SqlWorkerResponse } from './lib/sql-worker-protocol';
import './styles.css';
import './sql.css';

const FORMAT_TIMEOUT_MILLISECONDS = 2_000;
const WORKER_LOAD_TIMEOUT_MILLISECONDS = 12_000;

const SQL_EXAMPLES: Record<SqlDialectId, string> = {
  sql: `with monthly_sales as (select customer_id,date_trunc('month',ordered_at) as month,sum(total_amount) as revenue from orders where status='paid' group by customer_id,date_trunc('month',ordered_at)) select c.name,m.month,m.revenue,rank() over(partition by m.month order by m.revenue desc) as revenue_rank from monthly_sales m join customers c on c.id=m.customer_id where m.revenue>=1000 order by m.month desc,revenue_rank;`,
  mysql: `select c.customer_id,c.display_name,count(o.order_id) as paid_orders,sum(o.total_amount) as lifetime_value from \`customers\` c left join \`orders\` o on o.customer_id=c.customer_id and o.status='paid' where c.created_at>=date_sub(current_date,interval 90 day) group by c.customer_id,c.display_name having sum(o.total_amount)>500 order by lifetime_value desc limit 25;`,
  mariadb: `select p.category,json_value(p.metadata,'$.brand') as brand,count(*) as item_count,avg(p.price) as average_price from products p where p.is_active=1 group by p.category,json_value(p.metadata,'$.brand') having count(*)>=5 order by item_count desc;`,
  postgresql: `with recent_orders as (select customer_id,total,status,created_at from orders where created_at>=current_date-interval '30 days') select c.id,c.email,count(*) filter (where r.status='paid') as paid_orders,coalesce(sum(r.total) filter (where r.status='paid'),0)::numeric(12,2) as revenue from customers c join recent_orders r on r.customer_id=c.id group by c.id,c.email having count(*) filter (where r.status='paid')>0 order by revenue desc nulls last;`,
  sqlite: `select strftime('%Y-%m',created_at) as month,count(*) as event_count,sum(case when event_type='purchase' then 1 else 0 end) as purchases from events where created_at>=datetime('now','-12 months') group by strftime('%Y-%m',created_at) order by month;`,
  transactsql: `with ranked_orders as (select o.CustomerID,o.OrderID,o.OrderDate,o.TotalDue,row_number() over(partition by o.CustomerID order by o.TotalDue desc) as AmountRank from Sales.Orders o where o.OrderDate>=dateadd(day,-90,getdate())) select top (50) c.CustomerID,c.DisplayName,r.OrderID,r.TotalDue from Sales.Customers c join ranked_orders r on r.CustomerID=c.CustomerID where r.AmountRank<=3 order by r.TotalDue desc;`,
  bigquery: `with sessions as (select user_pseudo_id,event_date,countif(event_name='purchase') as purchases,sum((select value.int_value from unnest(event_params) where key='engagement_time_msec')) as engagement_ms from \`analytics.events_*\` where _table_suffix between '20260701' and '20260731' group by user_pseudo_id,event_date) select user_pseudo_id,event_date,purchases,engagement_ms from sessions qualify row_number() over(partition by user_pseudo_id order by engagement_ms desc)=1 order by engagement_ms desc;`,
  snowflake: `select date_trunc('week',event_time) as event_week,account_id,count_if(event_name='login') as logins,count(distinct user_id) as active_users from analytics.events where event_time>=dateadd(month,-3,current_timestamp()) group by all qualify row_number() over(partition by account_id order by event_week desc)<=12 order by account_id,event_week desc;`,
  redshift: `select date_trunc('day',occurred_at) as event_day,account_id,count(*) as events,approximate count(distinct user_id) as users from fact_events where occurred_at>=dateadd(day,-30,getdate()) group by 1,2 having count(*)>100 order by event_day desc,events desc;`,
  plsql: `select department_id,employee_id,first_name,last_name,salary,dense_rank() over(partition by department_id order by salary desc) as salary_rank from employees where hire_date>=add_months(trunc(sysdate),-24) and status='ACTIVE' order by department_id,salary_rank;`,
  duckdb: `select date_trunc('month',order_date) as month,product_category,sum(quantity) as units,sum(quantity*unit_price) as gross_revenue from read_parquet('orders/*.parquet') where order_date>=current_date-interval 1 year group by all order by month desc,gross_revenue desc;`,
  clickhouse: `select toStartOfHour(event_time) as hour,service,count() as requests,countIf(status_code>=500) as errors,quantile(0.95)(duration_ms) as p95_ms from request_logs where event_time>=now()-interval 24 hour group by hour,service having requests>=100 order by hour desc,errors desc;`,
  spark: `select date_trunc('day',event_time) as event_day,source,count(*) as events,approx_count_distinct(user_id) as users from parquet.\`/data/events\` where event_time>=current_timestamp()-interval 30 days group by date_trunc('day',event_time),source order by event_day desc,events desc;`,
  trino: `select date_trunc('week',event_time) as week,region,count(*) as events,approx_distinct(user_id) as users from hive.analytics.events where event_time>=current_timestamp-interval '90' day group by 1,2 having count(*)>1000 order by week desc,events desc;`,
  db2: `select department,year(hire_date) as hire_year,count(*) as employee_count,decimal(avg(salary),12,2) as average_salary from employees where active=1 group by department,year(hire_date) having count(*)>=5 order by department,hire_year desc;`,
};

function defaultDialect(): SqlDialectId {
  const value = document.body.dataset.defaultDialect || 'sql';
  return isSqlDialectId(value) ? value : 'sql';
}

function dialectLabel(id: SqlDialectId): string {
  return SQL_DIALECTS.find((dialect) => dialect.id === id)?.label ?? id;
}

function downloadSql(value: string): void {
  const url = URL.createObjectURL(new Blob([value], { type: 'application/sql;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'formatted-query.sql';
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function SqlFormatterApp(): React.JSX.Element {
  const initialDialect = defaultDialect();
  const [input, setInput] = useState(SQL_EXAMPLES[initialDialect]);
  const [output, setOutput] = useState('');
  const [options, setOptions] = useState<SqlFormatOptions>({
    ...DEFAULT_SQL_FORMAT_OPTIONS,
    dialect: initialDialect,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState(`Ready to format the ${dialectLabel(initialDialect)} sample locally.`);
  const workerRef = useRef<Worker | null>(null);
  const formatTimeoutRef = useRef<number | null>(null);
  const loadTimeoutRef = useRef<number | null>(null);
  const requestIdRef = useRef(0);

  const stopWorker = () => {
    workerRef.current?.terminate();
    workerRef.current = null;
    if (formatTimeoutRef.current !== null) window.clearTimeout(formatTimeoutRef.current);
    if (loadTimeoutRef.current !== null) window.clearTimeout(loadTimeoutRef.current);
    formatTimeoutRef.current = null;
    loadTimeoutRef.current = null;
  };

  useEffect(() => () => stopWorker(), []);

  const invalidateOutput = (nextMessage: string) => {
    stopWorker();
    setBusy(false);
    setOutput('');
    setError(null);
    setMessage(nextMessage);
  };

  const changeInput = (value: string) => {
    const next = value.slice(0, MAX_SQL_INPUT_CHARACTERS);
    setInput(next);
    invalidateOutput(value.length > MAX_SQL_INPUT_CHARACTERS
      ? `Only the first ${MAX_SQL_INPUT_CHARACTERS.toLocaleString('en-US')} characters were kept.`
      : next.length >= SQL_LARGE_INPUT_WARNING_CHARACTERS
        ? `Large query loaded (${next.length.toLocaleString('en-US')} characters). Formatting can use substantial browser memory; split generated scripts when possible.`
      : 'Input changed. Format again to produce a matching result.');
  };

  const changeOptions = (changes: Partial<SqlFormatOptions>) => {
    const next = { ...options, ...changes };
    setOptions(next);
    invalidateOutput(`Formatting settings changed. Run the ${dialectLabel(next.dialect)} formatter again.`);
  };

  const formatInput = (event?: React.FormEvent) => {
    event?.preventDefault();
    stopWorker();
    setError(null);
    setOutput('');
    if (!input.trim()) {
      setError('Paste a SQL query before formatting.');
      setMessage('Nothing was formatted or sent anywhere.');
      return;
    }
    if (input.length > MAX_SQL_INPUT_CHARACTERS) {
      setError(`SQL input is limited to ${MAX_SQL_INPUT_CHARACTERS.toLocaleString('en-US')} characters.`);
      return;
    }

    const requestId = ++requestIdRef.current;
    const request: SqlWorkerRequest = { id: requestId, input, options };
    let worker: Worker;
    try {
      worker = new Worker(new URL('./sql.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      setBusy(false);
      setError('The local formatter worker could not start in this browser. Reload the page and try again.');
      setMessage('Formatting did not start, and no query was uploaded or executed.');
      return;
    }
    workerRef.current = worker;
    setBusy(true);
    setMessage(`Loading the ${dialectLabel(options.dialect)} formatter engine locally…`);

    let requestPosted = false;
    const isCurrentRequest = () => workerRef.current === worker && requestIdRef.current === requestId;
    const failCurrentRequest = (errorMessage: string, statusMessage: string) => {
      if (!isCurrentRequest()) return;
      stopWorker();
      setBusy(false);
      setError(errorMessage);
      setMessage(statusMessage);
    };

    worker.addEventListener('message', (workerEvent: MessageEvent<SqlWorkerResponse>) => {
      if (!isCurrentRequest()) return;

      if (workerEvent.data.type === 'ready') {
        if (requestPosted) return;
        if (loadTimeoutRef.current !== null) window.clearTimeout(loadTimeoutRef.current);
        loadTimeoutRef.current = null;
        try {
          worker.postMessage(request);
          requestPosted = true;
        } catch {
          failCurrentRequest(
            'The local formatter worker could not receive this query. Reload the page and try again.',
            'Formatting did not start, and no query was uploaded or executed.',
          );
          return;
        }
        setMessage(`Formatting as ${dialectLabel(options.dialect)} in a local browser worker…`);
        formatTimeoutRef.current = window.setTimeout(() => {
          if (!isCurrentRequest() || !requestPosted) return;
          failCurrentRequest(
            'Formatting exceeded 2 seconds and was stopped to keep this tab responsive. Split the query at safe statement boundaries and try a smaller part.',
            'The local formatter worker was stopped. No query was uploaded or executed.',
          );
        }, FORMAT_TIMEOUT_MILLISECONDS);
        return;
      }

      if (workerEvent.data.type === 'protocol-error') {
        failCurrentRequest(
          workerEvent.data.message,
          'Formatting stopped because the local worker could not read the request. No query was uploaded or executed.',
        );
        return;
      }

      if (workerEvent.data.id !== requestId || !requestPosted) return;
      stopWorker();
      setBusy(false);
      if (workerEvent.data.ok) {
        setOutput(workerEvent.data.output);
        setMessage(`Formatted locally as ${dialectLabel(options.dialect)}. Review the result before using it.`);
      } else {
        setError(workerEvent.data.message);
        setMessage('Formatting stopped locally. No query was uploaded or executed.');
      }
    });
    worker.addEventListener('error', () => {
      failCurrentRequest(
        requestPosted
          ? 'The local formatter worker could not finish. Try a smaller query or another dialect.'
          : 'The local formatter worker could not load. Reload the page and try again.',
        'Formatting stopped without uploading or executing the query.',
      );
    });
    worker.addEventListener('messageerror', () => {
      failCurrentRequest(
        'The browser could not read the local formatter response. Reload the page and try again.',
        'Formatting stopped without uploading or executing the query.',
      );
    });

    loadTimeoutRef.current = window.setTimeout(() => {
      if (!isCurrentRequest() || requestPosted) return;
      failCurrentRequest(
        'The local formatter engine took more than 12 seconds to load and was stopped. Reload the page and try again.',
        'Formatting did not start, and no query was uploaded or executed.',
      );
    }, WORKER_LOAD_TIMEOUT_MILLISECONDS);
  };

  const loadSample = () => {
    const sample = SQL_EXAMPLES[options.dialect];
    setInput(sample);
    invalidateOutput(`Loaded a synthetic ${dialectLabel(options.dialect)} sample. Format it when ready.`);
  };

  const copyOutput = async () => {
    if (!output) return;
    try {
      await navigator.clipboard.writeText(output);
      setMessage('Copied the complete formatted SQL result.');
    } catch {
      setMessage('Clipboard access failed. Select the output and copy it manually.');
    }
  };

  return (
    <form className="sql-app" onSubmit={formatInput} aria-busy={busy}>
      <div className="sql-app-bar">
        <div className="sql-local-badge"><span aria-hidden="true" /><div><strong>Private browser formatter</strong><small>Queries stay in this tab and are never executed</small></div></div>
        <a href="https://www.npmjs.com/package/sql-formatter" target="_blank" rel="noreferrer">Open-source engine</a>
      </div>

      <section className="sql-controls" aria-labelledby="sql-settings-heading">
        <div className="sql-controls-heading"><div><p>Formatting profile</p><h2 id="sql-settings-heading">Choose the SQL dialect and layout</h2></div><span>{SQL_DIALECTS.length} dialect profiles</span></div>
        <div className="sql-control-grid">
          <label><span>SQL dialect</span><select value={options.dialect} onChange={(event) => changeOptions({ dialect: event.target.value as SqlDialectId })}>{SQL_DIALECTS.map((dialect) => <option value={dialect.id} key={dialect.id}>{dialect.label}</option>)}</select></label>
          <label><span>Indentation</span><select value={options.useTabs ? 'tabs' : String(options.indentWidth)} onChange={(event) => changeOptions(event.target.value === 'tabs' ? { useTabs: true } : { useTabs: false, indentWidth: Number(event.target.value) })}><option value="2">2 spaces</option><option value="4">4 spaces</option><option value="tabs">Tabs</option></select></label>
          <label><span>Keyword case</span><select value={options.keywordCase} onChange={(event) => changeOptions({ keywordCase: event.target.value as SqlFormatOptions['keywordCase'] })}><option value="upper">UPPERCASE</option><option value="lower">lowercase</option><option value="preserve">Preserve input</option></select></label>
          <label><span>AND / OR line break</span><select value={options.logicalOperatorNewline} onChange={(event) => changeOptions({ logicalOperatorNewline: event.target.value as SqlFormatOptions['logicalOperatorNewline'] })}><option value="before">Before operator</option><option value="after">After operator</option></select></label>
          <label><span>Inline expression width</span><select value={options.expressionWidth} onChange={(event) => changeOptions({ expressionWidth: Number(event.target.value) })}><option value="40">40 characters</option><option value="80">80 characters</option><option value="120">120 characters</option><option value="160">160 characters</option></select></label>
          <label><span>Space between statements</span><select value={options.linesBetweenQueries} onChange={(event) => changeOptions({ linesBetweenQueries: Number(event.target.value) })}><option value="1">1 line</option><option value="2">2 lines</option><option value="3">3 lines</option></select></label>
        </div>
        <p className="sql-dialect-note"><strong>Selected profile:</strong> {SQL_DIALECTS.find((dialect) => dialect.id === options.dialect)?.note}. Dialect is never detected automatically.</p>
        <div className="sql-switches">
          <label><input type="checkbox" checked={options.denseOperators} onChange={(event) => changeOptions({ denseOperators: event.target.checked })} /><span>Compact operator spacing</span></label>
          <label><input type="checkbox" checked={options.newlineBeforeSemicolon} onChange={(event) => changeOptions({ newlineBeforeSemicolon: event.target.checked })} /><span>Semicolon on a new line</span></label>
        </div>
      </section>

      <div className="sql-editors">
        <section className="sql-editor-card" aria-labelledby="sql-input-heading">
          <header><div><p>Source</p><h3 id="sql-input-heading">SQL input</h3></div><span>{textLineCount(input).toLocaleString('en-US')} lines · {input.length.toLocaleString('en-US')} chars</span></header>
          <label className="sr-only" htmlFor="sql-input">SQL query to format</label>
          <textarea id="sql-input" value={input} onChange={(event) => changeInput(event.target.value)} maxLength={MAX_SQL_INPUT_CHARACTERS} spellCheck={false} autoCapitalize="off" autoComplete="off" rows={19} />
          <div className="sql-actions">
            <button className="sql-button primary" type="submit" disabled={busy}>{busy ? 'Formatting…' : 'Format SQL'}</button>
            <button className="sql-button" type="button" onClick={loadSample} disabled={busy}>Load safe sample</button>
            <button className="sql-button quiet" type="button" onClick={() => { setInput(''); invalidateOutput('Input and output cleared from this page.'); }} disabled={busy}>Clear</button>
          </div>
        </section>

        <section className="sql-editor-card output" aria-labelledby="sql-output-heading">
          <header><div><p>Result</p><h3 id="sql-output-heading">Formatted SQL</h3></div><span>{textLineCount(output).toLocaleString('en-US')} lines · {output.length.toLocaleString('en-US')} chars</span></header>
          <label className="sr-only" htmlFor="sql-output">Formatted SQL result</label>
          <textarea id="sql-output" value={output} readOnly spellCheck={false} rows={19} placeholder="Your formatted SQL will appear here. The tool changes layout; it does not execute or prove that a query is valid." />
          <div className="sql-actions">
            <button className="sql-button" type="button" onClick={copyOutput} disabled={!output || busy}>Copy result</button>
            <button className="sql-button" type="button" onClick={() => { if (output) { downloadSql(output); setMessage('Downloaded the complete formatted query as a local .sql file.'); } }} disabled={!output || busy}>Download .sql</button>
          </div>
        </section>
      </div>

      {error ? <p className="sql-error" role="alert"><strong>Could not format:</strong> {error}</p> : null}
      <div className="sql-disclaimer"><strong>Formatter, not a database validator.</strong><span>Formatting recognizes tokens and dialect rules but cannot confirm schemas, permissions, data types, query plans, or whether a database will accept or safely run the result.</span></div>
      <p className="sql-activity" aria-live="polite"><strong>Local status</strong><span>{message}</span></p>
    </form>
  );
}

const root = document.getElementById('sql-root');
if (root) createRoot(root).render(<SqlFormatterApp />);
