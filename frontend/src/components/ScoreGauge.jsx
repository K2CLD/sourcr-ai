const GRADE_COLOR = {
  A: 'var(--status-good)',
  B: 'var(--status-warning)',
  C: 'var(--status-serious)',
  D: 'var(--status-critical)',
}

// Horizontal fill bar for the 0-100 score, colored by grade tier — makes
// relative quality scannable across a list without reading every number.
export default function ScoreGauge({ score, grade, width = 72, height = 6 }) {
  const color = GRADE_COLOR[grade] || 'var(--text-muted)'
  const pct = Math.max(0, Math.min(100, score))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, width }}>
      <div style={{ width, height, borderRadius: 'var(--radius-full)', background: 'var(--surface-5)', overflow: 'hidden' }}>
        <div style={{
          width: `${pct}%`, height: '100%', background: color, borderRadius: 'var(--radius-full)',
          transition: 'width .4s cubic-bezier(.4,0,.2,1)',
        }} />
      </div>
    </div>
  )
}
