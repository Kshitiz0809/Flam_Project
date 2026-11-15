import { useMemo, useState } from 'react';
import { currentVersion } from '../lib/session.js';
import { formatAmount, scaleQuantity } from '../lib/scale.js';
import ServingsControl from './ServingsControl.jsx';
import IngredientList from './IngredientList.jsx';
import StepList from './StepList.jsx';
import RefineBar from './RefineBar.jsx';

export default function RecipeView({
  session,
  dispatch,
  onRefine,
  onUndo,
  refining,
  refineStartedAt,
  refineError,
  refineRefusal,
  onRetryRefine,
  onCancelRefine,
  onDismissRefineError,
}) {
  const { recipe, warnings, instruction } = currentVersion(session);
  const { progress } = session;
  const versionCount = session.versions.length;

  // Resolve swaps + scaling once per render for both the list and the shopping callout.
  const items = useMemo(
    () =>
      recipe.ingredients.map((ing) => {
        const swapIndex = progress.swaps[ing.id];
        const swap = swapIndex != null ? ing.swaps[swapIndex] ?? null : null;
        const quantity = swap?.quantity ?? ing.quantity;
        const unit = swap?.quantity != null ? swap.unit : ing.unit;
        return {
          ...ing,
          swapIndex: swap ? swapIndex : null,
          displayName: swap ? swap.name : ing.name,
          displayNote: swap ? swap.note : ing.note,
          amount: formatAmount(scaleQuantity(quantity, recipe.servings, progress.servings), unit),
        };
      }),
    [recipe, progress.swaps, progress.servings],
  );

  const toBuy = items.filter((i) => !i.fromPantry && i.swapIndex == null);
  const activeSwaps = items.filter((i) => i.swapIndex != null);
  const totalMinutes = (recipe.prepMinutes ?? 0) + (recipe.cookMinutes ?? 0);

  const rewriteForSwaps = () =>
    onRefine(`Update the recipe to use these substitutions (adjust quantities, steps and timings): ${activeSwaps.map((i) => `${i.name} → ${i.displayName}`).join('; ')}.`);

  return (
    <article className="recipe">
      <header className="card recipe-head">
        <h2 className="recipe-title">{recipe.title}</h2>
        {recipe.description && <p className="muted">{recipe.description}</p>}
        <ul className="meta">
          {recipe.prepMinutes != null && <li>Prep {recipe.prepMinutes} min</li>}
          {recipe.cookMinutes != null && <li>Cook {recipe.cookMinutes} min</li>}
          {totalMinutes > 0 && <li>Total {totalMinutes} min</li>}
          {session.request.diet.map((d) => (
            <li key={d} className="meta-diet">{d}</li>
          ))}
        </ul>
        {versionCount > 1 && (
          <div className="version-row">
            <span className="muted small">
              Version {versionCount} · <q>{instruction}</q>
            </span>
            <button type="button" className="btn btn-link" onClick={onUndo} disabled={refining}>
              Undo change
            </button>
          </div>
        )}
      </header>

      <RefineBar
        key={session.id}
        onRefine={onRefine}
        refining={refining}
        startedAt={refineStartedAt}
        error={refineError}
        refusal={refineRefusal}
        onRetry={onRetryRefine}
        onCancel={onCancelRefine}
        onDismiss={onDismissRefineError}
      />

      <Warnings key={`${session.id}-${versionCount}`} warnings={warnings} />

      <div className={`recipe-body ${refining ? 'is-refining' : ''}`} inert={refining ? true : undefined}>
        {toBuy.length > 0 && (
          <div className="callout">
            <strong>You'll also need:</strong> {toBuy.map((i) => i.displayName).join(', ')}.
            <span className="muted"> Or pick a swap below.</span>
          </div>
        )}

        <div className="recipe-grid">
          <section className="card" aria-labelledby="ing-h">
            <div className="section-head">
              <h3 id="ing-h">Ingredients</h3>
              <ServingsControl
                value={progress.servings}
                base={recipe.servings}
                onChange={(servings) => dispatch({ type: 'setServings', servings })}
              />
            </div>
            <IngredientList
              items={items}
              gathered={progress.gathered}
              onToggle={(id) => dispatch({ type: 'toggleGathered', id })}
              onSwap={(id, index) => dispatch({ type: 'chooseSwap', id, index })}
            />
          </section>

          <section className="card" aria-labelledby="steps-h">
            <StepList
              headingId="steps-h"
              steps={recipe.steps}
              done={progress.doneSteps}
              onToggle={(id) => dispatch({ type: 'toggleStep', id })}
              onReset={() => dispatch({ type: 'resetProgress' })}
            />
            {activeSwaps.length > 0 && (
              <div className="callout callout-info">
                The method still mentions the original ingredient{activeSwaps.length > 1 ? 's' : ''}.{' '}
                <button type="button" className="btn btn-link" onClick={rewriteForSwaps} disabled={refining}>
                  Rewrite the recipe for my swaps
                </button>
              </div>
            )}
          </section>
        </div>

        {recipe.tips.length > 0 && (
          <section className="card tips">
            <h3>Tips</h3>
            <ul>
              {recipe.tips.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </article>
  );
}

/** Non-fatal problems found while validating the model's output. */
function Warnings({ warnings }) {
  const [dismissed, setDismissed] = useState(false);
  if (!warnings?.length || dismissed) return null;
  return (
    <div className="callout callout-warn" role="status">
      <div>
        <strong>Heads up — parts of the AI's answer were unreadable.</strong>
        <ul>
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      </div>
      <button type="button" className="btn btn-ghost icon-btn" onClick={() => setDismissed(true)} aria-label="Dismiss warning">
        ×
      </button>
    </div>
  );
}
