const DESCRIPTIONS = {
  'flaky-json': 'Bad JSON once, then OK (auto-retry)',
  malformed: 'Unparseable text every time',
  'fenced-prose': 'Valid JSON wrapped in ``` and prose',
  'wrong-shape': 'Valid JSON, wrong fields',
  partial: 'Some broken ingredients/steps',
  empty: 'Empty response',
  refusal: 'Model says input is not food',
  truncated: 'Cut off at token limit',
  slow: '12s delay, then real answer',
  timeout: 'Server times out (3s)',
  'rate-limit': '429 from provider',
  'server-error': '500 from provider',
};

/** Dev-only: pick a failure the server should simulate on the next requests. */
export default function DevFaultPanel({ faults, value, onChange }) {
  return (
    <details className="dev-panel">
      <summary>
        Simulate failure{value ? <span className="tag tag-warn">{value}</span> : null}
      </summary>
      <label className="small" htmlFor="fault">
        Applies to every request until turned off
      </label>
      <select id="fault" className="select" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Off (real model)</option>
        {faults.map((f) => (
          <option key={f} value={f}>
            {f} — {DESCRIPTIONS[f] ?? ''}
          </option>
        ))}
      </select>
    </details>
  );
}
