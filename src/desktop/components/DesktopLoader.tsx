export default function DesktopLoader() {
  return (
    <div style={{ width: '100%', padding: '80px 0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <span style={{
        fontSize: 36,
        color: 'var(--accent)',
        display: 'inline-block',
        animation: 'mmNoteDance 1.1s ease-in-out infinite',
        transformOrigin: 'bottom center',
      }}>♪</span>
    </div>
  );
}
