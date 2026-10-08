import { Component, type ErrorInfo, type ReactNode } from 'react'

// Любая ошибка отрисовки — не белый экран, а понятное сообщение с выходом
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: unknown, info: ErrorInfo) { console.error('UI error', error, info.componentStack) }
  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="login">
        <div className="card login-card">
          <h1>Что-то пошло не так</h1>
          <p>Данные не потерялись. Обновите страницу — работа продолжится с того же места.</p>
          <button className="btn btn-primary btn-xl" onClick={() => window.location.reload()}>Обновить</button>
          <button className="btn btn-xl" onClick={() => window.location.assign('/')}>На главную</button>
        </div>
      </div>
    )
  }
}
