export default function StepList({ headingId, steps, done, onToggle, onReset }) {
  const doneCount = steps.filter((s) => done[s.id]).length;
  const currentId = steps.find((s) => !done[s.id])?.id;
  const pct = Math.round((doneCount / steps.length) * 100);
  const finished = doneCount === steps.length;

  return (
    <>
      <div className="section-head">
        <h3 id={headingId}>Method</h3>
        <span className="muted small">
          {doneCount}/{steps.length} done
          {doneCount > 0 && (
            <>
              {' · '}
              <button type="button" className="btn btn-link small" onClick={onReset}>
                reset
              </button>
            </>
          )}
        </span>
      </div>
      <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Cooking progress">
        <div className="progress-bar" style={{ width: `${pct}%` }} />
      </div>
      {finished && <p className="done-banner">All done — enjoy your meal!</p>}
      <ol className="steps">
        {steps.map((step, i) => {
          const isDone = Boolean(done[step.id]);
          return (
            <li key={step.id} className={`step ${isDone ? 'is-done' : ''} ${step.id === currentId ? 'is-current' : ''}`}>
              <label className="check-row">
                <input type="checkbox" checked={isDone} onChange={() => onToggle(step.id)} />
                <span className="step-num" aria-hidden="true">
                  {i + 1}
                </span>
                <span className="step-text">
                  {step.text}
                  {step.minutes != null && <span className="tag tag-time">{step.minutes} min</span>}
                </span>
              </label>
            </li>
          );
        })}
      </ol>
    </>
  );
}
