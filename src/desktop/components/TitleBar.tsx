export default function TitleBar() {
  return (
    <div className="titlebar">
      <div style={{ display: 'flex', gap: 6 }}>
        {(['#ff5f57', '#ffbd2e', '#28c840'] as const).map((c, i) => (
          <div key={i} className="traffic-light" style={{ background: c }} />
        ))}
      </div>
      <div className="titlebar-title">MELOMANIAC | The Git-Style Music Library | v1.2</div>
      <div style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
        {['–', '⊡', '×'].map((s, i) => (
          <div key={i} style={{ fontSize: 11, color: 'var(--text-2)', cursor: 'pointer', userSelect: 'none' }}>{s}</div>
        ))}
      </div>
    </div>
  );
}
