import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  decodeJwtCompact,
  evaluateJwtTimeClaims,
  jwtJsonValueText,
  JwtDecodeError,
  MAX_JWT_INPUT_CHARACTERS,
  type DecodedJwt,
  type JwtTemporalStatus,
  type JwtTimeEvaluation,
} from './lib/jwt';
import './styles.css';
import './jwt.css';

type PageMode = 'decoder' | 'expiration';

const SAMPLE_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJsaXZlcGFyc2UtZGVtbyIsIm5hbWUiOiJTYW1wbGUgVXNlciIsImlhdCI6MTc2NzIyNTYwMCwiZXhwIjoxODkzNDU2MDAwfQ.c2FtcGxlLXNpZ25hdHVyZS1ub3QtdmVyaWZpZWQ';
const MAX_VISIBLE_JSON_CHARACTERS = 60_000;
const MAX_VISIBLE_CLAIMS = 100;
const MAX_VISIBLE_ISSUES = 100;

function pageMode(): PageMode {
  return document.body.dataset.mode === 'expiration' ? 'expiration' : 'decoder';
}

function visibleText(value: string): { text: string; truncated: boolean } {
  if (value.length <= MAX_VISIBLE_JSON_CHARACTERS) return { text: value, truncated: false };
  return {
    text: `${value.slice(0, MAX_VISIBLE_JSON_CHARACTERS)}\n… display truncated for browser performance …`,
    truncated: true,
  };
}

function temporalLabel(status: JwtTemporalStatus): string {
  if (status === 'expired') return 'Expired by exp';
  if (status === 'not-yet-active') return 'Before nbf';
  if (status === 'active-by-time-claims') return 'Time claims pass';
  if (status === 'no-time-constraints') return 'No exp or nbf';
  return 'Time result indeterminate';
}

function temporalClass(status: JwtTemporalStatus): string {
  if (status === 'active-by-time-claims') return 'pass';
  if (status === 'expired' || status === 'not-yet-active') return 'fail';
  return 'neutral';
}

function signatureHex(decoded: DecodedJwt): string {
  const bytes = decoded.signature.bytes;
  const shown = bytes.subarray(0, 32);
  const hex = Array.from(shown, (byte) => byte.toString(16).padStart(2, '0')).join(' ');
  return bytes.length > shown.length ? `${hex} …` : hex || '(empty)';
}

function downloadText(value: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([value], { type: 'application/json;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function TimePanel({ evaluation, skew, onSkewChange, onRefresh, canEvaluate, timeError }: {
  evaluation: JwtTimeEvaluation | null;
  skew: string;
  onSkewChange: (value: string) => void;
  onRefresh: () => void;
  canEvaluate: boolean;
  timeError: string | null;
}): React.JSX.Element {
  return (
    <section className="jwt-card jwt-time-card" aria-labelledby="jwt-time-heading">
      <header className="jwt-card-heading">
        <div><p>NumericDate</p><h3 id="jwt-time-heading">exp, nbf, and iat timeline</h3></div>
        {evaluation ? <span className={`jwt-status-pill ${temporalClass(evaluation.status)}`}>{temporalLabel(evaluation.status)}</span> : null}
      </header>
      <div className="jwt-card-body">
        <div className="jwt-time-controls">
          <label><span>Clock skew / leeway (seconds)</span><input type="text" inputMode="decimal" value={skew} onChange={(event) => onSkewChange(event.target.value)} /></label>
          <button type="button" className="jwt-button" onClick={onRefresh} disabled={!canEvaluate}>Check current time</button>
        </div>
        {timeError ? <p className="jwt-error" role="alert">Time claims were not evaluated: {timeError}</p> : null}
        {!evaluation ? (
          <div className="jwt-empty"><strong>No time result yet</strong><span>Decode a token to inspect its time claims against the current clock.</span></div>
        ) : (
          <>
            <div className="jwt-time-summary">
              <div><span>Time-window result</span><strong>{temporalLabel(evaluation.status)}</strong></div>
              <div><span>Checked at UTC</span><strong>{evaluation.checkedAtIso}</strong></div>
              <div><span>Leeway</span><strong>{skew || '0'} seconds</strong></div>
              <div><span>Signature</span><strong>Not verified</strong></div>
            </div>
            <div className="jwt-time-table" role="table" aria-label="JWT time claims">
              <div className="jwt-time-row jwt-time-head" role="row"><span role="columnheader">Claim</span><span role="columnheader">State</span><span role="columnheader">Raw value</span><span role="columnheader">UTC instant</span></div>
              {(['exp', 'nbf', 'iat'] as const).map((name) => {
                const claim = evaluation.claims[name];
                return <div className="jwt-time-row" role="row" key={name}><code role="cell">{name}</code><span role="cell">{claim.state}</span><code role="cell">{claim.raw ?? '—'}</code><span role="cell">{claim.iso ?? '—'}</span></div>;
              })}
            </div>
            <ul className="jwt-reasons">
              {evaluation.reasons.map((reason) => <li key={reason}>{reason}</li>)}
            </ul>
          </>
        )}
        <p className="jwt-security-note"><strong>Time-only result:</strong> passing exp and nbf does not prove the signature, issuer, audience, identity, or authorization.</p>
      </div>
    </section>
  );
}

function DecodePanel({ decoded, onCopy, onDownload }: {
  decoded: DecodedJwt | null;
  onCopy: (value: string, label: string) => void;
  onDownload: () => void;
}): React.JSX.Element {
  if (!decoded) {
    return (
      <section className="jwt-card jwt-decode-card" aria-labelledby="jwt-decode-heading">
        <header className="jwt-card-heading"><div><p>Decoded JSON</p><h3 id="jwt-decode-heading">Header and payload</h3></div></header>
        <div className="jwt-card-body"><div className="jwt-empty"><strong>Ready to decode locally</strong><span>The decoded header and claims set will appear here. No signature verification is performed.</span></div></div>
      </section>
    );
  }

  const header = visibleText(decoded.header.formatted);
  const payload = visibleText(decoded.payload.formatted);
  const visibleClaims = decoded.payload.object.members.slice(0, MAX_VISIBLE_CLAIMS);
  return (
    <section className="jwt-card jwt-decode-card" aria-labelledby="jwt-decode-heading">
      <header className="jwt-card-heading">
        <div><p>Decoded JSON</p><h3 id="jwt-decode-heading">Header and payload</h3></div>
        <span className="jwt-status-pill neutral">Signature not verified</span>
      </header>
      <div className="jwt-card-body">
        <div className="jwt-fact-grid">
          <div><span>Algorithm label</span><strong>{decoded.algorithm ?? 'Missing or ambiguous'}</strong></div>
          <div><span>Token type</span><strong>{decoded.tokenType ?? 'Not declared'}</strong></div>
          <div><span>Signature bytes</span><strong>{decoded.signature.byteLength.toLocaleString('en-US')}</strong></div>
          <div><span>Decode status</span><strong>{decoded.structureStatus === 'decoded' ? 'Decoded' : 'Decoded with issues'}</strong></div>
        </div>

        <article className="jwt-json-block">
          <header><div><span>JOSE header</span><small>{decoded.header.byteLength.toLocaleString('en-US')} decoded bytes</small></div><button type="button" onClick={() => onCopy(decoded.header.formatted, 'header')}>Copy header</button></header>
          <pre>{header.text}</pre>
          {header.truncated ? <p>Only the first {MAX_VISIBLE_JSON_CHARACTERS.toLocaleString('en-US')} characters are rendered. Copy still uses the complete decoded header.</p> : null}
        </article>
        <article className="jwt-json-block">
          <header><div><span>JWT claims set</span><small>{decoded.payload.byteLength.toLocaleString('en-US')} decoded bytes</small></div><button type="button" onClick={() => onCopy(decoded.payload.formatted, 'payload')}>Copy payload</button></header>
          <pre>{payload.text}</pre>
          {payload.truncated ? <p>Only the first {MAX_VISIBLE_JSON_CHARACTERS.toLocaleString('en-US')} characters are rendered. Copy still uses the complete decoded payload.</p> : null}
        </article>

        <div className="jwt-claim-list" role="table" aria-label="Decoded JWT claims">
          <div className="jwt-claim-row jwt-claim-head" role="row"><span role="columnheader">Claim</span><span role="columnheader">JSON type</span><span role="columnheader">Value</span></div>
          {visibleClaims.map((member) => (
            <div className={`jwt-claim-row${member.duplicate ? ' duplicate' : ''}`} role="row" key={`${member.key.start}-${member.occurrence}`}>
              <code role="cell">{member.key.value}{member.occurrence > 1 ? ` #${member.occurrence}` : ''}</code>
              <span role="cell">{member.value.type}</span>
              <code role="cell">{jwtJsonValueText(member.value).slice(0, 1_000)}</code>
            </div>
          ))}
        </div>
        {decoded.payload.object.members.length > visibleClaims.length ? <p className="jwt-limit-note">Showing the first {MAX_VISIBLE_CLAIMS} claims to keep the page responsive.</p> : null}

        <div className="jwt-signature-box"><span>Signature bytes (first 32)</span><code>{signatureHex(decoded)}</code><p>These bytes are displayed only. They have not been checked with a secret, public key, certificate, JWKS, issuer, or audience policy.</p></div>
        <button type="button" className="jwt-button" onClick={onDownload}>Download decoded report</button>
      </div>
    </section>
  );
}

function JwtApp({ mode }: { mode: PageMode }): React.JSX.Element {
  const [input, setInput] = useState(SAMPLE_TOKEN);
  const [skew, setSkew] = useState('0');
  const [decoded, setDecoded] = useState<DecodedJwt | null>(null);
  const [evaluation, setEvaluation] = useState<JwtTimeEvaluation | null>(null);
  const [message, setMessage] = useState('Ready. Press Decode JWT to inspect the sample or replace it with your own token.');
  const [decodeError, setDecodeError] = useState<string | null>(null);
  const [timeError, setTimeError] = useState<string | null>(null);

  const evaluate = (value: DecodedJwt): JwtTimeEvaluation => evaluateJwtTimeClaims(value, {
    nowMilliseconds: Date.now(),
    clockSkewSeconds: skew.trim() || '0',
  });

  const runDecode = (event?: React.FormEvent) => {
    event?.preventDefault();
    setDecodeError(null);
    setTimeError(null);
    try {
      const nextDecoded = decodeJwtCompact(input);
      setDecoded(nextDecoded);
      try {
        const nextEvaluation = evaluate(nextDecoded);
        setEvaluation(nextEvaluation);
        setMessage(`Decoded locally. ${temporalLabel(nextEvaluation.status)}. Signature, issuer, and audience were not verified.`);
      } catch (caught) {
        setEvaluation(null);
        setTimeError(caught instanceof Error ? caught.message : 'The time claims could not be evaluated.');
        setMessage('JWT JSON decoded locally. Time claims need a valid leeway value; signature was not verified.');
      }
    } catch (caught) {
      setDecoded(null);
      setEvaluation(null);
      setDecodeError(caught instanceof JwtDecodeError || caught instanceof Error ? caught.message : 'The token could not be decoded.');
      setMessage('Decode failed. The token was not sent anywhere.');
    }
  };

  const refreshTime = () => {
    if (!decoded) return;
    setTimeError(null);
    try {
      const nextEvaluation = evaluate(decoded);
      setEvaluation(nextEvaluation);
      setMessage(`Time claims checked again at ${nextEvaluation.checkedAtIso}. Signature still not verified.`);
    } catch (caught) {
      setEvaluation(null);
      setTimeError(caught instanceof Error ? caught.message : 'The time claims could not be evaluated.');
      setMessage('JWT JSON remains decoded, but the time result was cleared because leeway is invalid.');
    }
  };

  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setMessage(`Copied the complete decoded ${label}.`);
    } catch {
      setMessage(`Clipboard access failed. Select the ${label} text and copy it manually.`);
    }
  };

  const download = () => {
    if (!decoded) return;
    const report = JSON.stringify({
      warning: 'Decoded only. Signature, issuer, audience, and authorization were not verified.',
      algorithmLabel: decoded.algorithm,
      tokenType: decoded.tokenType,
      signatureByteLength: decoded.signature.byteLength,
      headerJson: decoded.header.formatted,
      payloadJson: decoded.payload.formatted,
      timeStatus: evaluation?.status ?? 'not-evaluated',
      checkedAtUtc: evaluation?.checkedAtIso ?? null,
      clockSkewSeconds: evaluation ? skew : null,
      timeError,
      timeClaims: evaluation ? Object.fromEntries(Object.entries(evaluation.claims).map(([name, claim]) => [name, {
        state: claim.state,
        raw: claim.raw,
        utc: claim.iso,
      }])) : null,
      issueCount: decoded.issues.length,
      issuesTruncated: decoded.issues.length > MAX_VISIBLE_ISSUES,
      issues: decoded.issues.slice(0, MAX_VISIBLE_ISSUES),
    }, null, 2);
    downloadText(report, 'jwt-decoded-report.json');
    setMessage('Downloaded a decoded report without the original compact token.');
  };

  const changeInput = (value: string) => {
    setInput(value);
    setDecoded(null);
    setEvaluation(null);
    setDecodeError(null);
    setTimeError(null);
    setMessage('Input changed. Decode again to inspect this token.');
  };

  const changeSkew = (value: string) => {
    setSkew(value);
    setEvaluation(null);
    setTimeError(null);
    setMessage(decoded
      ? 'Clock skew changed. Check current time again before using the time result.'
      : 'Clock skew changed. Decode a token to evaluate its time claims.');
  };

  const timePanel = <TimePanel evaluation={evaluation} skew={skew} onSkewChange={changeSkew} onRefresh={refreshTime} canEvaluate={decoded !== null} timeError={timeError} />;
  const decodePanel = <DecodePanel decoded={decoded} onCopy={copy} onDownload={download} />;

  return (
    <div className="jwt-app">
      <div className="jwt-toolbar">
        <div className="jwt-local-badge"><span aria-hidden="true" /><div><strong>Browser-only decoding</strong><small>No token upload, storage, remote key lookup, or analytics payload</small></div></div>
        <a href="https://www.rfc-editor.org/rfc/rfc7519.html" target="_blank" rel="noreferrer">RFC 7519</a>
      </div>

      <form className="jwt-input-card" onSubmit={runDecode}>
        <div className="jwt-input-heading"><div><p>{mode === 'expiration' ? 'Expiration input' : 'Compact JWT input'}</p><h2>{mode === 'expiration' ? 'Check JWT time claims locally' : 'Decode a JWT locally'}</h2></div><span>{input.length.toLocaleString('en-US')} / {MAX_JWT_INPUT_CHARACTERS.toLocaleString('en-US')}</span></div>
        <label htmlFor="jwt-token-input">Compact JWT or <code>Bearer …</code> value</label>
        <textarea id="jwt-token-input" className="jwt-token-input" spellCheck={false} autoCapitalize="off" autoComplete="off" value={input} maxLength={MAX_JWT_INPUT_CHARACTERS} onChange={(event) => changeInput(event.target.value)} rows={7} />
        <div className="jwt-input-actions">
          <button className="jwt-button primary" type="submit">{mode === 'expiration' ? 'Decode & check expiration' : 'Decode JWT'}</button>
          <button className="jwt-button" type="button" onClick={() => { setInput(SAMPLE_TOKEN); setDecoded(null); setEvaluation(null); setDecodeError(null); setTimeError(null); setMessage('Loaded a synthetic demo token with a fake, unverified signature. Decode again to inspect it.'); }}>Load safe sample</button>
          <button className="jwt-button quiet" type="button" onClick={() => { setInput(''); setDecoded(null); setEvaluation(null); setDecodeError(null); setTimeError(null); setMessage('Input cleared from this page.'); }}>Clear</button>
        </div>
        <p className="jwt-security-note strong"><strong>Decoded ≠ verified.</strong> Treat claims as untrusted until your application verifies the signature with an allowed algorithm and trusted key, then checks issuer, audience, and policy.</p>
        {decodeError ? <p className="jwt-error" role="alert">{decodeError}</p> : null}
      </form>

      <div className={`jwt-results ${mode === 'expiration' ? 'time-first' : ''}`}>
        {mode === 'expiration' ? <>{timePanel}{decodePanel}</> : <>{decodePanel}{timePanel}</>}
      </div>

      {decoded ? (
        <section className="jwt-issues" aria-labelledby="jwt-issues-heading">
          <header><h3 id="jwt-issues-heading">Security and structure findings</h3><span>{decoded.issues.length.toLocaleString('en-US')}</span></header>
          <ul>{decoded.issues.slice(0, MAX_VISIBLE_ISSUES).map((issue, index) => <li className={issue.severity} key={`${issue.code}-${index}`}><strong>{issue.code.replace(/_/g, ' ')}</strong><span>{issue.message}{issue.path ? ` (${issue.path})` : ''}</span></li>)}</ul>
          {decoded.issues.length > MAX_VISIBLE_ISSUES ? <p className="jwt-issue-limit">Showing the first {MAX_VISIBLE_ISSUES.toLocaleString('en-US')} of {decoded.issues.length.toLocaleString('en-US')} findings to keep the page responsive. The downloaded report uses the same cap.</p> : null}
        </section>
      ) : null}

      <p className="jwt-activity" aria-live="polite"><strong>Local status</strong><span>{message}</span></p>
    </div>
  );
}

const rootElement = document.getElementById('jwt-root');
if (rootElement) createRoot(rootElement).render(<JwtApp mode={pageMode()} />);
