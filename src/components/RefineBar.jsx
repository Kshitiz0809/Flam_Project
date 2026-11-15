import { useState } from 'react';
import { useElapsed, loadingMessage } from './LoadingState.jsx';
import { ErrorDetails } from './ErrorState.jsx';

const SUGGESTIONS = ['Make it vegetarian', 'Make it spicier', 'Under 20 minutes', 'No oven', 'Fewer dishes to wash'];
const MAX = 500;

/**
 * Follow-up prompts that edit the current recipe instead of starting over.
 * Failures here are shown inline and never replace the recipe on screen.
 */
export default function RefineBar({ onRefine, refining, startedAt, error, refusal, onRetry, onCancel, onDismiss }) {
  const [text, setText] = useState('');
  const elapsed = useElapsed(refining ? startedAt : null);

  const submit = (value) => {
    const v = value.trim();
    if (!v || v.length > MAX || refining) return;
    onRefine(v);
    setText('');
  };

  return (
    <section className="card refine" aria-label="Tweak this recipe">
      <form
        className="refine-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit(text);
        }}
      >
        <label htmlFor="refine" className="sr-only">
          Tweak this recipe
        </label>
        <input
          id="refine"
          className="input"
          placeholder="Tweak it: “no garlic”, “make it for a kid”…"
          value={text}
          maxLength={MAX}
          onChange={(e) => setText(e.target.value)}
          disabled={refining}
        />
        <button type="submit" className="btn btn-primary" disabled={!text.trim() || refining}>
          Update
        </button>
      </form>

      {refining ? (
        <div className="refine-status" role="status">
          <span className="spinner spinner-sm" aria-hidden="true" />
          <span className="small">
            {loadingMessage(elapsed, 1)} {elapsed}s
          </span>
          <button type="button" className="btn btn-link small" onClick={onCancel}>
            Cancel
          </button>
        </div>
      ) : error ? (
        <div className="refine-status refine-error" role="alert">
          <span className="small">
            <strong>{error.title}.</strong> Your recipe is unchanged. {error.message}
          </span>
          <span className="refine-actions">
            <button type="button" className="btn btn-link small" onClick={onRetry}>
              Try again
            </button>
            <button type="button" className="btn btn-link small" onClick={onDismiss}>
              Dismiss
            </button>
          </span>
          <ErrorDetails error={error} />
        </div>
      ) : refusal ? (
        <div className="refine-status refine-error" role="status">
          <span className="small">
            <strong>Couldn't apply that.</strong> {refusal}
          </span>
          <button type="button" className="btn btn-link small" onClick={onDismiss}>
            Dismiss
          </button>
        </div>
      ) : (
        <div className="chips">
          {SUGGESTIONS.map((s) => (
            <button key={s} type="button" className="chip" onClick={() => submit(s)}>
              {s}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
