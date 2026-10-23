import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** Необязательный обработчик (например, для логирования) */
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface State {
  error: Error | null;
}

/**
 * Глобальная граница ошибок: предотвращает «белый экран» при
 * рантайм-исключениях в дереве рендеринга (в т.ч. ошибках хуков React).
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]Unhandled error:', error, info.componentStack);
    this.props.onError?.(error, info);
  }

  private handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '60vh',
            padding: '2rem',
            textAlign: 'center',
            gap: '1rem',
          }}
        >
          <h2>Что-то пошло не так</h2>
          <p style={{ opacity: 0.7, maxWidth: '40rem' }}>
            Произошла непредвиденная ошибка в интерфейсе. Попробуйте обновить страницу —
            если проблема повторяется, подробности видны в консоли браузера (F12).
          </p>
          <pre
            style={{
              maxWidth: '90%',
              overflowX: 'auto',
              fontSize: '0.75rem',
              opacity: 0.6,
              whiteSpace: 'pre-wrap',
            }}
          >
            {String(this.state.error.message ?? this.state.error)}
          </pre>
          <button
            type="button"
            onClick={this.handleReload}
            style={{
              padding: '0.5rem 1.5rem',
              borderRadius: 8,
              border: '1px solid currentColor',
              background: 'transparent',
              color: 'inherit',
              cursor: 'pointer',
            }}
          >
            Обновить страницу
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
