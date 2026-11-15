import { useEffect, useState } from 'react';

const SLOW_AFTER_S = 8;

/** Elapsed seconds since `startedAt`, ticking once a second. */
export function useElapsed(startedAt) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!startedAt) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [startedAt]);
  return startedAt ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0;
}

export function loadingMessage(elapsed, attempt) {
  if (attempt > 1) return 'The first answer was unusable — asking again…';
  if (elapsed >= SLOW_AFTER_S) return 'Taking longer than usual. Hang tight, or cancel and try again.';
  return 'Reading your fridge and writing a recipe…';
}

export default function LoadingState({ startedAt, attempt, onCancel }) {
  const elapsed = useElapsed(startedAt);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div className="card loading" role="status">
      <div className="loading-head">
        <span className="spinner" aria-hidden="true" />
        <div>
          <p className="loading-msg">{loadingMessage(elapsed, attempt)}</p>
          <p className="muted small">{elapsed}s · Esc to cancel</p>
        </div>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
      <div className="skeleton" aria-hidden="true">
        <div className="sk sk-title" />
        <div className="sk sk-line" />
        <div className="sk-grid">
          <div>
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="sk sk-line short" />
            ))}
          </div>
          <div>
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="sk sk-block" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
