import { Component } from 'react'

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error.message, info?.componentStack?.split('\n').slice(0, 4).join(' '))
  }

  render() {
    if (this.state.error) {
      const msg = this.state.error?.message || String(this.state.error)
      return (
        <div style={{ padding: '32px 20px', textAlign: 'center', maxWidth: 480, margin: '0 auto' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>⚠</div>
          <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--cream)', marginBottom: 8 }}>
            {this.props.label || 'Something went wrong'}
          </div>
          <div style={{
            fontSize: 11, color: '#999', background: '#111', border: '1px solid #333',
            borderRadius: 6, padding: '10px 14px', textAlign: 'left',
            wordBreak: 'break-all', fontFamily: 'monospace', marginBottom: 18, lineHeight: 1.6,
          }}>
            {msg}
          </div>
          <button
            style={{
              background: 'var(--green)', color: '#000', border: 'none', borderRadius: 6,
              padding: '8px 18px', fontWeight: 700, cursor: 'pointer', fontSize: 13,
            }}
            onClick={() => this.setState({ error: null })}
          >
            ↺ Try again
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
