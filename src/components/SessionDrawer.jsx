import { useEffect, useRef } from 'react';
import { currentVersion } from '../lib/session.js';

const fmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** Saved recipes. Uses <dialog> for free focus trapping + Esc to close. */
export default function SessionDrawer({ open, sessions, activeId, onClose, onOpen, onDelete }) {
  const ref = useRef(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="drawer"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose(); // click on backdrop
      }}
      aria-labelledby="drawer-title"
    >
      <div className="drawer-inner">
        <div className="section-head">
          <h2 id="drawer-title">Saved recipes</h2>
          <button type="button" className="btn btn-ghost icon-btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <p className="muted small">Recipes and your progress are saved in this browser automatically.</p>
        {sessions.length === 0 ? (
          <p className="muted">Nothing saved yet.</p>
        ) : (
          <ul className="session-list">
            {sessions.map((s) => {
              const v = currentVersion(s);
              const done = Object.keys(s.progress.doneSteps).length;
              return (
                <li key={s.id} className={`session-item ${s.id === activeId ? 'is-active' : ''}`}>
                  <button type="button" className="session-open" onClick={() => onOpen(s)}>
                    <span className="session-title">{v.recipe.title}</span>
                    <span className="muted small">
                      {fmt.format(s.updatedAt)} · {done}/{v.recipe.steps.length} steps
                      {s.versions.length > 1 ? ` · ${s.versions.length} versions` : ''}
                    </span>
                    <span className="muted small ellipsis">{s.request.ingredients}</span>
                  </button>
                  <button type="button" className="btn btn-ghost icon-btn" onClick={() => onDelete(s.id)} aria-label={`Delete ${v.recipe.title}`}>
                    🗑
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </dialog>
  );
}
