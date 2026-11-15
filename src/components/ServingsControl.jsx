export default function ServingsControl({ value, base, onChange }) {
  return (
    <div className="servings" role="group" aria-label="Servings">
      <button type="button" className="btn btn-ghost icon-btn" onClick={() => onChange(value - 1)} disabled={value <= 1} aria-label="Fewer servings">
        −
      </button>
      <span className="servings-value" aria-live="polite">
        {value} serving{value === 1 ? '' : 's'}
      </span>
      <button type="button" className="btn btn-ghost icon-btn" onClick={() => onChange(value + 1)} disabled={value >= 24} aria-label="More servings">
        +
      </button>
      {value !== base && (
        <button type="button" className="btn btn-link small" onClick={() => onChange(base)} title={`The recipe was written for ${base}`}>
          reset to {base}
        </button>
      )}
    </div>
  );
}
