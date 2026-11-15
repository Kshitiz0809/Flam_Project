/** Full-panel error for a failed generation. `error` comes from describeError(). */
export default function ErrorState({ error, onRetry, onDismiss, dismissLabel }) {
  return (
    <div className="card error-card" role="alert">
      <div className="empty-icon" aria-hidden="true">⚠️</div>
      <h2>{error.title}</h2>
      {error.message && <p className="muted">{error.message}</p>}
      <div className="actions">
        <button type="button" className="btn btn-primary" onClick={onRetry} autoFocus>
          Try again
        </button>
        {onDismiss && (
          <button type="button" className="btn btn-ghost" onClick={onDismiss}>
            {dismissLabel || 'Dismiss'}
          </button>
        )}
      </div>
      <ErrorDetails error={error} />
    </div>
  );
}

export function ErrorDetails({ error }) {
  if (!error.detail) return null;
  return (
    <details className="details">
      <summary>Technical details</summary>
      <code>
        {error.code}: {error.detail}
      </code>
    </details>
  );
}
