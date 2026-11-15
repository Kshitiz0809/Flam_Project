import { Component } from 'react';

/**
 * Last line of defence: if a render bug slips through, show a recovery screen
 * instead of a blank page. (Error boundaries still require a class component.)
 */
export default class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('Render error', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="app">
        <div className="card error-card" role="alert" style={{ margin: '2rem auto', maxWidth: 520 }}>
          <h2>Something broke while showing this page</h2>
          <p className="muted">Your saved recipes are safe. Reloading usually fixes it.</p>
          <div className="actions">
            <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
              Reload
            </button>
          </div>
        </div>
      </div>
    );
  }
}
