import { useState } from 'react';

export interface PendingChange {
  message: string;
  execute: () => Promise<void>;
}

interface Props {
  changes:   PendingChange[];
  onCommit:  (editedMessages: string[]) => Promise<void>;
  onDiscard: () => void;
}

export default function CommitBar({ changes, onCommit, onDiscard }: Props) {
  const [messages, setMessages] = useState<string[]>(() => changes.map(c => c.message));
  const [busy, setBusy] = useState(false);

  const handleCommit = async () => {
    setBusy(true);
    try {
      await onCommit(messages);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{
      position: 'absolute', bottom: 24, left: '50%', transform: 'translateX(-50%)',
      background: 'var(--bg-2)',
      border: '1px solid var(--border-2)',
      borderRadius: 8,
      padding: '10px 14px',
      boxShadow: '0 8px 32px rgba(0,0,0,0.45)',
      zIndex: 50,
      minWidth: 380, maxWidth: 560,
      display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-2)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          {changes.length} pending change{changes.length !== 1 ? 's' : ''}
        </span>
        <button
          onClick={onDiscard}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', fontSize: 12 }}
        >
          Discard all
        </button>
      </div>

      {changes.map((_, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="text"
            value={messages[i] ?? ''}
            onChange={e => setMessages(prev => { const next = [...prev]; next[i] = e.target.value; return next; })}
            style={{
              flex: 1, background: 'var(--bg-3)', border: '1px solid var(--border-1)',
              borderRadius: 5, padding: '5px 9px', fontSize: 12,
              color: 'var(--text-0)', fontFamily: "'Outfit', sans-serif", outline: 'none',
            }}
          />
        </div>
      ))}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 2 }}>
        <button
          onClick={handleCommit}
          disabled={busy || messages.some(m => !m.trim())}
          style={{
            padding: '6px 16px', borderRadius: 5,
            background: 'var(--accent-dim)', border: '1px solid var(--accent)',
            color: 'var(--accent-light)', fontSize: 12, fontWeight: 600,
            cursor: busy ? 'not-allowed' : 'pointer',
            opacity: busy ? 0.6 : 1,
            fontFamily: "'Outfit', sans-serif",
          }}
        >
          {busy ? 'Committing…' : 'Commit'}
        </button>
      </div>
    </div>
  );
}
