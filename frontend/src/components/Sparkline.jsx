// A 3-point BSR trend line (90d avg -> 30d avg -> current — the only real data
// points Keepa gives us; no interpolated/fabricated points in between).
// Plotted as inverted rank: BSR numerically lower = better, so the line is
// drawn with lower-BSR points higher up, matching "up = selling better."
export default function Sparkline({ bsr90, bsr30, bsr, trend, width = 64, height = 22 }) {
  const points = [bsr90, bsr30, bsr].filter((v) => v != null && v > 0)
  if (points.length < 2) return null

  const max = Math.max(...points)
  const min = Math.min(...points)
  const range = max - min || 1
  const pad = 3
  const step = (width - pad * 2) / (points.length - 1)

  const coords = points.map((v, i) => {
    const x = pad + i * step
    // Inverted: higher BSR (worse) -> lower on the chart
    const y = pad + ((v - min) / range) * (height - pad * 2)
    return [x, y]
  })

  const path = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const color = trend === 'rising' ? 'var(--status-good)' : trend === 'falling' ? 'var(--status-critical)' : 'var(--text-muted)'
  const [lastX, lastY] = coords[coords.length - 1]

  return (
    <svg width={width} height={height} style={{ display: 'block', flexShrink: 0 }}>
      <path d={path} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity={0.9} />
      <circle cx={lastX} cy={lastY} r="2.5" fill={color} />
    </svg>
  )
}
