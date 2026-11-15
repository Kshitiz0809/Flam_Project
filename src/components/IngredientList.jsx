/**
 * `items` are ingredients already resolved for the active swap + servings
 * (see RecipeView). Checking one marks it as "gathered".
 */
export default function IngredientList({ items, gathered, onToggle, onSwap }) {
  return (
    <ul className="ingredients">
      {items.map((ing) => {
        const checked = Boolean(gathered[ing.id]);
        return (
          <li key={ing.id} className={`ingredient ${checked ? 'is-done' : ''}`}>
            <label className="check-row">
              <input type="checkbox" checked={checked} onChange={() => onToggle(ing.id)} />
              <span className="ing-text">
                <span className="ing-amount">{ing.amount || 'to taste'}</span>{' '}
                <span className="ing-name">{ing.displayName}</span>
                {!ing.fromPantry && ing.swapIndex == null && <span className="tag">need</span>}
                {ing.displayNote && <span className="ing-note">{ing.displayNote}</span>}
                {ing.swapIndex != null && <span className="ing-note">swapped for {ing.name}</span>}
              </span>
            </label>
            {ing.swaps.length > 0 && (
              <select
                className="select select-sm"
                aria-label={`Swap ${ing.name}`}
                value={ing.swapIndex ?? ''}
                onChange={(e) => onSwap(ing.id, e.target.value === '' ? null : Number(e.target.value))}
              >
                <option value="">{ing.swapIndex == null ? 'Swap…' : `↩ ${ing.name}`}</option>
                {ing.swaps.map((s, i) => (
                  <option key={i} value={i}>
                    {s.name}
                    {s.note ? ` — ${s.note}` : ''}
                  </option>
                ))}
              </select>
            )}
          </li>
        );
      })}
    </ul>
  );
}
