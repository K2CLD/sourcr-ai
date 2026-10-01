// Shimmering placeholder rows shown while a scan is running, instead of the
// table just sitting on stale content until results replace it.
export default function SkeletonRows({ count = 6 }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1, padding: '0 24px' }}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} style={{
          display: 'flex', alignItems: 'center', gap: 16,
          padding: '14px 16px', background: 'var(--surface-2)', borderRadius: 'var(--radius-md)', marginTop: i === 0 ? 16 : 0,
        }}>
          <div className="skeleton" style={{ width: 40, height: 40, borderRadius: 'var(--radius-md)', flexShrink: 0 }} />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="skeleton" style={{ width: `${55 + (i % 3) * 10}%`, height: 12 }} />
            <div className="skeleton" style={{ width: '30%', height: 10 }} />
          </div>
          <div className="skeleton" style={{ width: 60, height: 20, flexShrink: 0 }} />
          <div className="skeleton" style={{ width: 72, height: 6, flexShrink: 0 }} />
        </div>
      ))}
    </div>
  )
}
