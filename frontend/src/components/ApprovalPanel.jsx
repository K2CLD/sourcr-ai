import { useState } from 'react'
import { Lock, ChevronDown, ExternalLink } from 'lucide-react'

// Leads that passed every filter except ungating, where Amazon says approval can be
// requested (APPROVAL_REQUIRED + a request link) rather than a hard block. Not sellable
// today and not AI-scored — listed so the user can decide which brands to apply for.
export default function ApprovalPanel({ leads }) {
  const [open, setOpen] = useState(false)
  if (!leads?.length) return null

  return (
    <div style={{ borderBottom: '1px solid var(--border-subtle)', background: 'var(--surface-1)', flexShrink: 0 }}>
      <button
        onClick={() => setOpen(o => !o)}
        className="press-feedback"
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 24px',
          background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
          color: 'var(--status-warning)',
        }}
      >
        <Lock size={13} />
        <span style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0 }}>
          {leads.length} approval-required lead{leads.length === 1 ? '' : 's'}
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-faint)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          Passed every filter but need brand approval — not sellable today, not AI-scored
        </span>
        <ChevronDown size={14} style={{ marginLeft: 'auto', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s', color: 'var(--text-faint)' }} />
      </button>

      {open && (
        <div style={{ maxHeight: '38vh', overflowY: 'auto', padding: '0 24px 12px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, tableLayout: 'fixed' }}>
            <colgroup>
              <col />
              <col style={{ width: 72 }} />
              <col style={{ width: 72 }} />
              <col style={{ width: 48 }} />
              <col style={{ width: 68 }} />
              <col style={{ width: 84 }} />
            </colgroup>
            <thead>
              <tr style={{ color: 'var(--text-faint)', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', textAlign: 'left' }}>
                <th style={th}>Product</th>
                <th style={{ ...th, textAlign: 'right' }}>Buy Box</th>
                <th style={{ ...th, textAlign: 'right' }}>Sales/mo</th>
                <th style={{ ...th, textAlign: 'right' }} title="FBA sellers">FBA</th>
                <th style={{ ...th, textAlign: 'right' }} title="Buy cost assumed at 40% of the Buy Box — real fees">Profit*</th>
                <th style={th} />
              </tr>
            </thead>
            <tbody>
              {leads.map(l => (
                <tr key={l.asin} style={{ borderTop: '1px solid var(--surface-3)' }}>
                  <td style={{ ...td, overflow: 'hidden' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      {l.imageUrl && <img src={l.imageUrl} alt="" width={28} height={28} style={{ borderRadius: 4, objectFit: 'cover', flexShrink: 0 }} />}
                      <div style={{ minWidth: 0 }}>
                        <a href={l.url} target="_blank" rel="noreferrer" style={{ color: 'var(--text-secondary)', textDecoration: 'none', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {l.title}
                        </a>
                        <span className="font-mono" style={{ fontSize: 10, color: 'var(--text-faint)', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.brand ? `${l.brand} · ` : ''}{l.asin}</span>
                      </div>
                    </div>
                  </td>
                  <td className="font-mono" style={{ ...td, textAlign: 'right' }}>{l.price != null ? `$${l.price.toFixed(2)}` : '—'}</td>
                  <td className="font-mono" style={{ ...td, textAlign: 'right' }}>{l.monthlySold ?? '—'}</td>
                  <td className="font-mono" style={{ ...td, textAlign: 'right' }}>{l.fbaSellerCount ?? '—'}</td>
                  <td className="font-mono" style={{ ...td, textAlign: 'right' }}>{l.profitData?.profit != null ? `$${l.profitData.profit.toFixed(2)}` : '—'}</td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    <a
                      href={l.ungating?.approvalUrl} target="_blank" rel="noreferrer"
                      title={l.ungating?.notes ? `Amazon: ${l.ungating.notes}` : undefined}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--status-warning)', textDecoration: 'none', fontWeight: 600, whiteSpace: 'nowrap' }}
                    >
                      Request <ExternalLink size={11} />
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ fontSize: 10, color: 'var(--text-disabled)', marginTop: 8 }}>
            * Profit uses real Amazon fees but an assumed buy cost (40% of the Buy Box).
          </p>
        </div>
      )}
    </div>
  )
}

const th = { padding: '6px 8px', fontWeight: 600 }
const td = { padding: '7px 8px', color: 'var(--text-secondary)', verticalAlign: 'middle' }
