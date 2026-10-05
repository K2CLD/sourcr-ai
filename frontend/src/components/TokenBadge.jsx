import { Coins } from 'lucide-react'

// Keepa token status for the current scan target — see useTokenEstimate.
export default function TokenBadge({ estimate, failed, liveTokens, scanning, empty }) {
  let tone = 'neutral'
  let text = 'Keepa · checking…'
  let title = ''

  if (scanning) {
    text = liveTokens != null ? `Scanning · ${liveTokens} tokens left` : 'Scanning…'
  } else if (empty) {
    text = 'Keepa · select categories'
  } else if (failed && !estimate) {
    text = 'Keepa · unavailable'
  } else if (estimate) {
    const { tokensLeft, needed, enough, batched, waitMinutes, totalMinutes } = estimate
    const costs = estimate.costs
    title = `Estimate: ${costs.categoryQuery.value.toFixed(0)} tokens/category query (${costs.categoryQuery.source}), `
      + `${costs.perAsin.value.toFixed(2)}/ASIN (${costs.perAsin.source}). Refill ${estimate.refillRate}/min.`
    if (batched) {
      tone = 'warning'
      text = `Runs in batches · ~${totalMinutes} min total`
    } else if (enough) {
      tone = 'good'
      text = `Ready · ${tokensLeft} / ${needed} needed`
    } else {
      tone = 'critical'
      text = `Low · ${tokensLeft} / ${needed} needed · ~${waitMinutes} min wait`
    }
  }

  const color = {
    good: 'var(--status-good)',
    warning: 'var(--status-warning)',
    critical: 'var(--status-critical)',
    neutral: 'var(--text-faint)',
  }[tone]

  return (
    <span
      className="font-mono"
      title={title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '5px 10px',
        borderRadius: 'var(--radius-md)',
        border: `1px solid ${tone === 'neutral' ? 'var(--border-subtle)' : color}`,
        background: 'var(--surface-2)',
        color,
        fontSize: 11,
        letterSpacing: '0.04em',
        whiteSpace: 'nowrap',
      }}
    >
      <Coins size={12} />
      {text}
    </span>
  )
}
