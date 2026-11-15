const MAX_CHARS = 2000;
const DIETS = ['vegetarian', 'vegan', 'gluten-free', 'dairy-free', 'nut-free'];

export default function IngredientForm({ draft, onChange, onSubmit, busy }) {
  const trimmed = draft.ingredients.trim();
  const tooLong = draft.ingredients.length > MAX_CHARS;
  const canSubmit = trimmed.length > 0 && !tooLong;

  const update = (patch) => onChange({ ...draft, ...patch });
  const toggleDiet = (d) => update({ diet: draft.diet.includes(d) ? draft.diet.filter((x) => x !== d) : [...draft.diet, d] });

  const submit = (e) => {
    e.preventDefault();
    if (canSubmit) onSubmit();
  };

  return (
    <form className="card form" onSubmit={submit}>
      <label htmlFor="ingredients" className="label">
        What's in your fridge?
      </label>
      <textarea
        id="ingredients"
        className="textarea"
        rows={6}
        placeholder={'e.g. 3 eggs, half a bag of spinach, feta, an onion, some leftover rice'}
        value={draft.ingredients}
        onChange={(e) => update({ ingredients: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(e);
        }}
        aria-describedby="ingredients-help"
        aria-invalid={tooLong}
      />
      <div id="ingredients-help" className={`help ${tooLong ? 'error-text' : ''}`}>
        {tooLong ? `Too long — ${draft.ingredients.length}/${MAX_CHARS} characters` : 'Any format works: a list, a sentence, quantities optional.'}
      </div>

      <div className="form-row">
        <label htmlFor="servings" className="label-inline">
          Servings
        </label>
        <select id="servings" className="select" value={draft.servings} onChange={(e) => update({ servings: Number(e.target.value) })}>
          {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>

      <fieldset className="diet">
        <legend className="label-inline">Dietary needs</legend>
        <div className="chips">
          {DIETS.map((d) => (
            <label key={d} className={`chip ${draft.diet.includes(d) ? 'chip-on' : ''}`}>
              <input type="checkbox" checked={draft.diet.includes(d)} onChange={() => toggleDiet(d)} />
              {d}
            </label>
          ))}
        </div>
      </fieldset>

      <button type="submit" className="btn btn-primary btn-block" disabled={!canSubmit}>
        {busy ? 'Restart with these' : 'Get a recipe'}
      </button>
      <p className="help center">
        <kbd>Ctrl</kbd> + <kbd>Enter</kbd> to submit
      </p>
    </form>
  );
}
