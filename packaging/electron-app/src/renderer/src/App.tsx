function App(): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        height: '100vh',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        background: '#09090b',
        color: '#71717a',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <div style={{ fontSize: 22, fontWeight: 700, color: '#ffffff', letterSpacing: '-0.02em' }}>
        Omnecor
      </div>
      <div style={{ fontSize: 13 }}>Starting workstation…</div>
    </div>
  )
}

export default App
