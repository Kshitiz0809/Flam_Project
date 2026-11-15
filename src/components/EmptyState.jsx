const EXAMPLES = [
  'eggs, spinach, feta, half an onion, stale bread',
  'chicken thighs, rice, frozen peas, soy sauce, ginger',
  'a can of chickpeas, tomatoes, cumin, yoghurt, lemon',
  'leftover pasta, cheddar, milk, broccoli',
];

/** Shown before the first recipe, and when the model says the input isn't food. */
export default function EmptyState({ refusal, onPickExample }) {
  return (
    <div className="card empty">
      {refusal ? (
        <>
          <div className="empty-icon" aria-hidden="true">🤔</div>
          <h2>No recipe for that one</h2>
          <p className="muted">{refusal}</p>
        </>
      ) : (
        <>
          <div className="empty-icon" aria-hidden="true">🥕</div>
          <h2>Nothing cooking yet</h2>
          <p className="muted">List what you have on the left. You'll get a recipe with steps to check off, adjustable servings, and swaps for anything you're missing.</p>
        </>
      )}
      <p className="label-inline">Try one of these:</p>
      <div className="examples">
        {EXAMPLES.map((ex) => (
          <button key={ex} type="button" className="example" onClick={() => onPickExample(ex)}>
            {ex}
          </button>
        ))}
      </div>
    </div>
  );
}
