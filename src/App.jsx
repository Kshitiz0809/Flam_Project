import { useCallback, useEffect, useReducer, useState } from 'react';
import { useRecipeGenerator } from './hooks/useRecipeGenerator.js';
import { useTheme } from './hooks/useTheme.js';
import { createSession, currentVersion, sessionReducer } from './lib/session.js';
import { loadSessions, saveSessions, upsertSession } from './lib/storage.js';
import { fetchHealth } from './lib/api.js';
import Header from './components/Header.jsx';
import IngredientForm from './components/IngredientForm.jsx';
import EmptyState from './components/EmptyState.jsx';
import LoadingState from './components/LoadingState.jsx';
import ErrorState from './components/ErrorState.jsx';
import RecipeView from './components/RecipeView.jsx';
import SessionDrawer from './components/SessionDrawer.jsx';
import DevFaultPanel from './components/DevFaultPanel.jsx';

const EMPTY_DRAFT = { ingredients: '', servings: 2, diet: [] };

export default function App() {
  const { theme, cycle: cycleTheme } = useTheme();
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [session, dispatch] = useReducer(sessionReducer, null);
  const [saved, setSaved] = useState(() => loadSessions());
  const [historyOpen, setHistoryOpen] = useState(false);
  const [health, setHealth] = useState(null);
  const [fault, setFault] = useState('');

  useEffect(() => {
    fetchHealth().then(setHealth);
  }, []);

  // Results only arrive here for the latest request (see useRecipeGenerator).
  const handleResult = useCallback(({ recipe, warnings }, payload) => {
    if (payload.mode === 'refine') {
      dispatch({ type: 'refined', recipe, warnings, instruction: payload.instruction });
    } else {
      const { ingredients, servings, diet } = payload;
      dispatch({ type: 'load', session: createSession({ ingredients, servings, diet }, { recipe, warnings }) });
    }
  }, []);

  const gen = useRecipeGenerator(handleResult);

  // Autosave the active session whenever it changes.
  useEffect(() => {
    if (!session) return;
    setSaved((prev) => {
      const next = upsertSession(prev, session);
      saveSessions(next);
      return next;
    });
  }, [session]);

  const generate = () => {
    const payload = { mode: 'generate', ...draft, ingredients: draft.ingredients.trim() };
    gen.run(payload, { fault });
  };

  const refine = (instruction) => {
    if (!session) return;
    const { recipe } = currentVersion(session);
    gen.run(
      {
        mode: 'refine',
        instruction,
        ...session.request,
        servings: session.progress.servings,
        recipe: stripIds(recipe),
      },
      { fault },
    );
  };

  const openSession = (s) => {
    gen.reset(); // a pending refine must not land on a different recipe
    dispatch({ type: 'load', session: s });
    setDraft(s.request);
    setHistoryOpen(false);
  };

  const deleteSession = (id) => {
    setSaved((prev) => {
      const next = prev.filter((s) => s.id !== id);
      saveSessions(next);
      return next;
    });
    if (session?.id === id) dispatch({ type: 'clear' });
  };

  const undo = () => {
    gen.reset();
    dispatch({ type: 'undo' });
  };

  const generating = gen.isLoading && gen.mode === 'generate';
  const refining = gen.isLoading && gen.mode === 'refine';

  let content;
  if (generating) {
    content = <LoadingState startedAt={gen.startedAt} attempt={gen.attempt} onCancel={gen.reset} />;
  } else if (gen.status === 'error' && gen.mode === 'generate') {
    content = (
      <ErrorState
        error={gen.error}
        onRetry={gen.retry}
        onDismiss={session ? gen.reset : undefined}
        dismissLabel={session ? `Back to “${currentVersion(session).recipe.title}”` : undefined}
      />
    );
  } else if (gen.status === 'refused' && gen.mode === 'generate') {
    content = <EmptyState refusal={gen.refusal} onPickExample={(ingredients) => { gen.reset(); setDraft((d) => ({ ...d, ingredients })); }} />;
  } else if (session) {
    content = (
      <RecipeView
        session={session}
        dispatch={dispatch}
        onRefine={refine}
        onUndo={undo}
        refining={refining}
        refineStartedAt={refining ? gen.startedAt : null}
        refineError={gen.mode === 'refine' && gen.status === 'error' ? gen.error : null}
        refineRefusal={gen.mode === 'refine' && gen.status === 'refused' ? gen.refusal : null}
        onRetryRefine={gen.retry}
        onCancelRefine={gen.reset}
        onDismissRefineError={gen.reset}
      />
    );
  } else {
    content = <EmptyState onPickExample={(ingredients) => setDraft((d) => ({ ...d, ingredients }))} />;
  }

  return (
    <div className="app">
      <Header theme={theme} onCycleTheme={cycleTheme} savedCount={saved.length} onOpenHistory={() => setHistoryOpen(true)} />

      <main className="layout">
        <aside className="input-panel">
          <IngredientForm draft={draft} onChange={setDraft} onSubmit={generate} busy={gen.isLoading} fault={fault} />
        </aside>
        <section className="result" aria-live="polite" aria-busy={gen.isLoading}>
          {content}
        </section>
      </main>

      <footer className="footer">
        {health === null ? (
          <span>API status unknown</span>
        ) : health.mock ? (
          <span>Mock mode — returning a canned recipe (MOCK_LLM=1)</span>
        ) : !health.keyConfigured ? (
          <span className="warn-text">Server has no API key (GROQ_API_KEY) — see README</span>
        ) : (
          <span>Recipes by {health.model}. AI can make mistakes — check allergens and cooking temperatures.</span>
        )}
      </footer>

      <SessionDrawer
        open={historyOpen}
        sessions={saved}
        activeId={session?.id}
        onClose={() => setHistoryOpen(false)}
        onOpen={openSession}
        onDelete={deleteSession}
      />

      {import.meta.env.DEV && health?.faults?.length > 0 && <DevFaultPanel faults={health.faults} value={fault} onChange={setFault} />}
    </div>
  );
}

/** The model doesn't need our positional ids; sending them only invites it to echo them. */
function stripIds(recipe) {
  return {
    ...recipe,
    ingredients: recipe.ingredients.map(({ id: _id, ...rest }) => rest),
    steps: recipe.steps.map(({ id: _id, ...rest }) => rest),
  };
}
