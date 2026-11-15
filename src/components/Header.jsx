const THEME_LABEL = { system: 'Theme: system', light: 'Theme: light', dark: 'Theme: dark' };
const THEME_ICON = { system: '◐', light: '☀', dark: '☾' };

export default function Header({ theme, onCycleTheme, savedCount, onOpenHistory }) {
  return (
    <header className="header">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">🍴</span>
        <div>
          <h1>Fridge to Fork</h1>
          <p className="tagline">Tell it what you've got. Get something to cook.</p>
        </div>
      </div>
      <div className="header-actions">
        <button type="button" className="btn btn-ghost" onClick={onOpenHistory}>
          Saved{savedCount ? <span className="count">{savedCount}</span> : null}
        </button>
        <button type="button" className="btn btn-ghost icon-btn" onClick={onCycleTheme} aria-label={THEME_LABEL[theme]} title={THEME_LABEL[theme]}>
          <span aria-hidden="true">{THEME_ICON[theme]}</span>
        </button>
      </div>
    </header>
  );
}
