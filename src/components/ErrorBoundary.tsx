import { Component, type ReactNode } from 'react'
import type { Strings } from '../app/i18n'

interface Props {
  t: Strings
  children: ReactNode
}

/** Keeps a render error on one page from blanking the whole app. */
export class ErrorBoundary extends Component<Props, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error) {
    console.error('[kikitori]', error)
  }

  render() {
    const { t } = this.props
    if (!this.state.error) return this.props.children
    return (
      <div className="round-done" role="alert">
        <h2>{t.crashTitle}</h2>
        <p className="muted">{t.crashBody}</p>
        <pre className="muted small">{this.state.error.message}</pre>
        <button className="btn primary" onClick={() => location.reload()}>
          {t.reload}
        </button>
      </div>
    )
  }
}
