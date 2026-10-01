import { useEffect, useState } from 'react'
import {
  Search, AlertTriangle, CheckCircle2, Lock, ExternalLink, Sparkles,
  ChevronDown, ChevronUp, PackageSearch, Loader2,
} from 'lucide-react'
import { analyzeLead, getSupplierSources, scanAsin } from '../api'
import Sparkline from './Sparkline'
import ScoreGauge from './ScoreGauge'
import SkeletonRows from './SkeletonRows'
import useCountUp from '../useCountUp'

const GRADE_COLOR = { A: 'var(--status-good)', B: 'var(--status-warning)', C: 'var(--status-serious)', D: 'var(--status-critical)' }
// Amazon ASINs: 10 characters, alphanumeric. Most (not all) start with "B0" — the pattern
// the user asked to match — so a query like "B0..." is treated as a direct ASIN lookup.
const ASIN_PATTERN = /^B0[A-Z0-9]{8}$/i

function fmt(v, pre = '') { return v != null ? `${pre}${v}` : '—' }

function roiBadge(roi) {
  if (roi == null) return null
  const num = parseFloat(roi)
  const color = num >= 50 ? 'var(--status-good)' : num >= 30 ? 'var(--status-warning)' : 'var(--status-critical)'
  return (
    <span className="font-mono" style={{
      display: 'inline-block', padding: '1px 7px', borderRadius: 'var(--radius-sm)',
      fontSize: 11, fontWeight: 700,
      background: `color-mix(in srgb, ${color} 14%, transparent)`, color,
      border: `1px solid color-mix(in srgb, ${color} 35%, transparent)`,
    }}>
      {num}%
    </span>
  )
}

function UngateLabel({ u }) {
  if (!u) return <span style={{ color: 'var(--text-faint)' }}>—</span>
  if (u.gated === false) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--status-good)', fontSize: 11, fontWeight: 500 }}>
        <CheckCircle2 size={12} /> Open
      </span>
    )
  }
  if (u.gated && u.autoUngatable) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--status-warning)', fontSize: 11 }}>
        <Lock size={12} /> Auto-ungate
      </span>
    )
  }
  if (u.gated && !u.autoUngatable) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--status-critical)', fontSize: 11 }}>
        <Lock size={12} /> Gated
      </span>
    )
  }
  return <span style={{ color: 'var(--text-faint)', fontSize: 11 }}>—</span>
}

function TierBadge({ tier }) {
  const map = {
    verified:   { label: 'Verified',   bg: 'rgba(0,230,118,0.1)',    color: 'var(--brand)', border: 'rgba(0,230,118,0.25)' },
    wholesale:  { label: 'Wholesale',  bg: 'rgba(96,165,250,0.1)',   color: '#60a5fa',       border: 'rgba(96,165,250,0.25)' },
    brand:      { label: 'Brand Direct', bg: 'rgba(144,133,233,0.12)', color: 'var(--ai)',  border: 'rgba(144,133,233,0.3)' },
    liquidation:{ label: 'Liquidation',bg: 'rgba(236,131,90,0.1)',   color: 'var(--status-serious)', border: 'rgba(236,131,90,0.3)' },
    unverified: { label: 'Unverified', bg: 'rgba(255,255,255,0.04)', color: 'var(--text-muted)', border: 'var(--border)' },
  }
  const t = map[tier] || map.unverified
  return (
    <span style={{
      fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 2,
      background: t.bg, color: t.color, border: `1px solid ${t.border}`,
      textTransform: 'uppercase', letterSpacing: '0.06em',
    }}>
      {t.label}
    </span>
  )
}

function ProductImage({ lead }) {
  const [errored, setErrored] = useState(false)
  const src = lead.imageUrl
  const letter = (lead.title || lead.asin || '?')[0].toUpperCase()

  if (!src || errored) {
    return (
      <div style={{
        width: 48, height: 48, background: 'var(--surface-4)', borderRadius: 'var(--radius-sm)', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        border: '1px solid var(--border-subtle)', boxShadow: 'var(--shadow-sm)',
      }}>
        <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-faint)', userSelect: 'none' }}>
          {letter}
        </span>
      </div>
    )
  }

  return (
    <img
      src={src}
      alt=""
      onError={() => setErrored(true)}
      style={{
        width: 48, height: 48, objectFit: 'contain', borderRadius: 'var(--radius-sm)', flexShrink: 0,
        background: 'var(--surface-3)', border: '1px solid var(--border-subtle)', display: 'block',
        boxShadow: 'var(--shadow-sm)',
      }}
    />
  )
}

function WhereToBuy({ lead }) {
  const [sources, setSources]   = useState(null)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState(null)

  const load = async () => {
    if (sources || loading) return
    setLoading(true)
    setError(null)
    try {
      const { data } = await getSupplierSources(lead)
      setSources(data.sources || [])
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to load sources')
    } finally {
      setLoading(false)
    }
  }

  const best = sources?.find(s => s.tier === 'verified' && s.estimatedPrice) || sources?.[0]

  return (
    <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 'var(--space-5)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-3)' }}>
        <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-faint)' }}>
          Where to Buy
        </span>
        {!sources && !loading && (
          <button
            onClick={load}
            className="press-feedback"
            style={{
              fontSize: 11, fontWeight: 600, padding: '4px 12px', borderRadius: 'var(--radius-sm)',
              background: 'transparent', border: '1px solid var(--border)',
              color: 'var(--text-secondary)', cursor: 'pointer', fontFamily: 'inherit',
              transition: 'border-color .15s, color .15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--brand)'; e.currentTarget.style.color = 'var(--brand)' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-secondary)' }}
          >
            Find Sources
          </button>
        )}
      </div>

      {loading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-faint)', fontSize: 12 }}>
          <Loader2 size={13} className="anim-spin" style={{ color: 'var(--brand)' }} />
          Searching for sources…
        </div>
      )}

      {error && <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{error}</p>}

      {sources && sources.length === 0 && (
        <p style={{ fontSize: 12, color: 'var(--text-faint)' }}>No off-Amazon sources found for this product.</p>
      )}

      {sources && sources.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {/* Best source highlight */}
          {best && (
            <div style={{
              padding: '12px 14px', marginBottom: 8,
              background: 'rgba(0,230,118,0.04)',
              border: '1px solid rgba(0,230,118,0.12)',
              borderRadius: 'var(--radius-sm)',
            }}>
              <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--brand)', marginBottom: 6 }}>
                Best Source
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <a
                    href={best.searchUrl} target="_blank" rel="noreferrer"
                    style={{ fontSize: 13, fontWeight: 600, color: '#fff', textDecoration: 'none' }}
                    onMouseEnter={e => e.currentTarget.style.color = 'var(--brand)'}
                    onMouseLeave={e => e.currentTarget.style.color = '#fff'}
                  >
                    {best.name}
                  </a>
                  <TierBadge tier={best.tier} />
                </div>
                {best.estimatedPrice && (
                  <span className="font-mono" style={{ fontSize: 15, fontWeight: 700, color: 'var(--brand)' }}>
                    ~${best.estimatedPrice.toFixed(2)}
                  </span>
                )}
              </div>
              {best.notes && <p style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 5 }}>{best.notes}</p>}
              {best.tier === 'unverified' && (
                <p style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--status-serious)', marginTop: 4 }}>
                  <AlertTriangle size={11} /> Unverified supplier — confirm legitimacy before purchasing
                </p>
              )}
            </div>
          )}

          {/* Ranked list */}
          {sources.map((s, i) => (
            <div
              key={i}
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '9px 12px',
                background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.015)',
                borderBottom: '1px solid var(--surface-3)',
              }}
            >
              <span className="font-mono" style={{ fontSize: 11, color: 'var(--text-disabled)', width: 16, flexShrink: 0, textAlign: 'right' }}>
                {i + 1}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <a
                    href={s.searchUrl} target="_blank" rel="noreferrer"
                    style={{ fontSize: 13, color: '#ccc', textDecoration: 'none', fontWeight: 500 }}
                    onMouseEnter={e => e.currentTarget.style.color = '#fff'}
                    onMouseLeave={e => e.currentTarget.style.color = '#ccc'}
                  >
                    {s.name}
                  </a>
                  <TierBadge tier={s.tier} />
                </div>
                {s.notes && <p style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>{s.notes}</p>}
                {s.tier === 'unverified' && (
                  <p style={{ fontSize: 10, color: 'var(--status-serious)', opacity: 0.7, marginTop: 2 }}>Unverified — verify before ordering</p>
                )}
              </div>
              <div style={{ flexShrink: 0, textAlign: 'right' }}>
                {s.estimatedPrice ? (
                  <span className="font-mono" style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)' }}>
                    ~${s.estimatedPrice.toFixed(2)}
                    <span style={{ fontSize: 10, color: 'var(--text-faint)', fontWeight: 400, marginLeft: 3 }}>est</span>
                  </span>
                ) : (
                  <span style={{ fontSize: 11, color: 'var(--text-disabled)' }}>Check price</span>
                )}
              </div>
            </div>
          ))}

          <p style={{ fontSize: 10, color: 'var(--text-disabled)', marginTop: 8 }}>
            Prices are estimates. Amazon and all Amazon-owned sources have been excluded.
          </p>
        </div>
      )}
    </div>
  )
}

const VERDICT_GOOD = ['Strong Buy', 'Buy']

function ExpandedRow({ lead, colSpan }) {
  const pd = lead.profitData || {}
  // Leads from a scan already carry an automatic AI verdict (scanner.js runs one on every
  // surviving candidate) — show that immediately instead of making the user click to fetch
  // a second one. The button still works as a manual re-run (e.g. for older saved scans
  // from before this existed, or if the automatic pass errored for this lead).
  const [aiResult, setAiResult]   = useState(lead.aiAnalysis || null)
  const [aiLoading, setAiLoading] = useState(false)

  const profitCount = useCountUp(pd.profit != null ? parseFloat(pd.profit) : null, 500)
  const roiCount = useCountUp(pd.roi != null ? parseFloat(pd.roi) : null, 500)

  const handleAI = async () => {
    if ((aiResult && !aiResult.error) || aiLoading) return
    setAiLoading(true)
    try {
      const { data } = await analyzeLead(lead)
      setAiResult(data.analysis)
    } catch (e) {
      setAiResult({ error: e.response?.data?.error || 'Analysis failed' })
    } finally {
      setAiLoading(false)
    }
  }

  const roiColor = pd.roi >= 50 ? 'var(--status-good)' : pd.roi >= 30 ? 'var(--status-warning)' : 'var(--status-critical)'

  return (
    <tr>
      <td colSpan={colSpan} style={{ padding: 0 }}>
        <div
          className="anim-expand"
          style={{
            background: 'var(--surface-1)',
            borderTop: '1px solid var(--border-subtle)',
            borderBottom: '1px solid var(--border-subtle)',
            boxShadow: 'var(--shadow-lg)',
            padding: '24px 28px',
          }}
        >
          {/* Header with image */}
          <div style={{ display: 'flex', gap: 16, marginBottom: 'var(--space-6)', alignItems: 'flex-start' }}>
            <ProductImage lead={lead} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <p className="font-mono" style={{ fontSize: 11, color: 'var(--text-disabled)', marginBottom: 4 }}>{lead.asin}</p>
              <p style={{ fontSize: 14, color: '#ccc', fontWeight: 500, lineHeight: 1.4 }}>{lead.title}</p>
              {lead.brand && <p style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 3 }}>{lead.brand}</p>}
            </div>
            <ScoreGauge score={lead.score ?? 0} grade={lead.grade} />
          </div>

          {/* Key financials — prominent */}
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1,
            marginBottom: 'var(--space-6)', background: 'var(--surface-3)', borderRadius: 'var(--radius-md)', overflow: 'hidden',
            boxShadow: 'var(--shadow-sm)',
          }}>
            <div style={{ padding: '16px 20px', background: 'var(--surface-2)' }}>
              <p style={{ fontSize: 10, color: 'var(--text-faint)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>Profit / Unit</p>
              <p className="font-mono" style={{ fontSize: 22, fontWeight: 700, color: 'var(--brand)' }}>
                {pd.profit != null ? `$${profitCount.toFixed(2)}` : '—'}
              </p>
            </div>
            <div style={{ padding: '16px 20px', background: 'var(--surface-2)' }}>
              <p style={{ fontSize: 10, color: 'var(--text-faint)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>ROI</p>
              <p className="font-mono" style={{ fontSize: 22, fontWeight: 700, color: roiColor }}>
                {pd.roi != null ? `${roiCount.toFixed(1)}%` : '—'}
              </p>
            </div>
            <div style={{ padding: '16px 20px', background: 'var(--surface-2)' }}>
              <p style={{ fontSize: 10, color: 'var(--text-faint)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>Sale Price</p>
              <p className="font-mono" style={{ fontSize: 22, fontWeight: 700, color: '#fff' }}>
                {lead.price != null ? `$${lead.price}` : '—'}
              </p>
            </div>
          </div>

          {/* Detail grid — 2 columns */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 40px', marginBottom: 'var(--space-6)' }}>
            {[
              { l: 'FBA Fee',      v: fmt(pd.fbaFee,      '$') },
              { l: 'Referral Fee', v: fmt(pd.referralFee, '$') },
              { l: 'Total Fees',   v: fmt(pd.totalFees,   '$') },
              { l: 'Buy Price',    v: fmt(pd.buyPrice,    '$') },
              { l: 'BSR',          v: lead.bsr?.toLocaleString() || '—' },
              {
                l: 'BSR Trend',
                v: (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Sparkline bsr90={lead.bsr90} bsr30={lead.bsr30} bsr={lead.bsr} trend={lead.bsrTrend} />
                    <span style={{ fontSize: 11, color: lead.bsrTrend === 'rising' ? 'var(--status-good)' : lead.bsrTrend === 'falling' ? 'var(--status-critical)' : 'var(--text-muted)' }}>
                      {lead.bsrTrend || '—'}
                    </span>
                  </span>
                ),
              },
              { l: 'Rating',       v: lead.rating != null ? `${lead.rating}★` : '—' },
              { l: 'Reviews',      v: lead.reviews?.toLocaleString() || '—' },
              { l: 'Price Stable', v: lead.priceStable === true ? 'Yes' : lead.priceStable === false ? 'No' : '—' },
              { l: 'New Sellers',  v: lead.newSellers30d ?? '—' },
              { l: 'Score',        v: lead.score != null ? `${lead.score}/100` : '—' },
              { l: 'Category',     v: lead.category || '—' },
            ].map(({ l, v }) => (
              <div key={l} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 8, borderBottom: '1px solid var(--surface-3)' }}>
                <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>{l}</span>
                <span className="font-mono" style={{ fontSize: 12, color: 'var(--text-muted)' }}>{v}</span>
              </div>
            ))}
          </div>

          {/* Ungating */}
          {lead.ungating && (
            <div style={{ marginBottom: 'var(--space-5)', paddingBottom: 'var(--space-5)', borderBottom: '1px solid var(--border-subtle)' }}>
              <p style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 8 }}>Ungating</p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <UngateLabel u={lead.ungating} />
                {lead.ungating.notes && <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>{lead.ungating.notes}</span>}
                {lead.ungating.approvalUrl && (
                  <a href={lead.ungating.approvalUrl} target="_blank" rel="noreferrer"
                    style={{ fontSize: 11, color: 'var(--brand)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    Request approval <ExternalLink size={10} />
                  </a>
                )}
              </div>
            </div>
          )}

          {/* Strengths / Flags */}
          {(lead.reasons?.length > 0 || lead.flags?.length > 0) && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 'var(--space-5)', paddingBottom: 'var(--space-5)', borderBottom: '1px solid var(--border-subtle)' }}>
              {lead.reasons?.length > 0 && (
                <div>
                  <p style={{ fontSize: 10, color: 'var(--text-faint)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>Strengths</p>
                  {lead.reasons.map((r, i) => (
                    <p key={i} style={{ display: 'flex', gap: 6, fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>
                      <CheckCircle2 size={13} style={{ color: 'var(--status-good)', flexShrink: 0, marginTop: 1 }} /> {r}
                    </p>
                  ))}
                </div>
              )}
              {lead.flags?.length > 0 && (
                <div>
                  <p style={{ fontSize: 10, color: 'var(--text-faint)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>Flags</p>
                  {lead.flags.map((f, i) => (
                    <p key={i} style={{ display: 'flex', gap: 6, fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>
                      <AlertTriangle size={13} style={{ color: 'var(--status-serious)', flexShrink: 0, marginTop: 1 }} /> {f}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Where to Buy */}
          <div style={{ marginBottom: 'var(--space-5)' }}>
            <WhereToBuy lead={lead} />
          </div>

          {/* AI Analysis — violet accent distinguishes AI-generated content from the rest */}
          <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 'var(--space-5)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-3)' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ai)' }}>
                <Sparkles size={12} /> AI Analysis
              </span>
              {(!aiResult || aiResult.error) && (
                <button
                  onClick={handleAI}
                  disabled={aiLoading}
                  className="press-feedback"
                  style={{
                    fontSize: 11, fontWeight: 600, padding: '4px 12px', borderRadius: 'var(--radius-sm)',
                    background: 'transparent', border: '1px solid var(--border)',
                    color: aiLoading ? 'var(--text-disabled)' : 'var(--text-secondary)', cursor: aiLoading ? 'default' : 'pointer',
                    fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 7,
                    transition: 'border-color .15s, color .15s',
                  }}
                  onMouseEnter={e => { if (!aiLoading) { e.currentTarget.style.borderColor = 'var(--ai)'; e.currentTarget.style.color = 'var(--ai)' } }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = aiLoading ? 'var(--text-disabled)' : 'var(--text-secondary)' }}
                >
                  {aiLoading && <Loader2 size={11} className="anim-spin" />}
                  {aiLoading ? 'Analyzing...' : 'Analyze with AI'}
                </button>
              )}
            </div>

            {!aiResult && !aiLoading && (
              <p style={{ fontSize: 12, color: 'var(--text-disabled)' }}>Get a buy / hold / skip verdict from Claude.</p>
            )}

            {aiResult?.error && <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{aiResult.error}</p>}

            {aiResult && !aiResult.error && (
              <div className="anim-fade" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{
                    fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 'var(--radius-sm)',
                    background: VERDICT_GOOD.includes(aiResult.verdict) ? 'rgba(0,230,118,0.1)' : 'rgba(144,133,233,0.1)',
                    color: VERDICT_GOOD.includes(aiResult.verdict) ? 'var(--brand)' : 'var(--ai)',
                    border: `1px solid ${VERDICT_GOOD.includes(aiResult.verdict) ? 'rgba(0,230,118,0.2)' : 'rgba(144,133,233,0.25)'}`,
                  }}>
                    {aiResult.verdict}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>{aiResult.confidence} confidence</span>
                  {aiResult.confidenceScore != null && (
                    <span className="font-mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>{aiResult.confidenceScore}/100</span>
                  )}
                </div>
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, maxWidth: 580 }}>{aiResult.summary}</p>
                {aiResult.recommendation && (
                  <p style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>{aiResult.recommendation}</p>
                )}
                {aiResult.watchOut && (
                  <p style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 12, color: 'var(--status-serious)' }}>
                    <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1 }} /> {aiResult.watchOut}
                  </p>
                )}
                <button
                  onClick={handleAI}
                  className="press-feedback"
                  style={{ fontSize: 11, color: 'var(--text-disabled)', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0, fontFamily: 'inherit', width: 'fit-content' }}
                  onMouseEnter={e => e.currentTarget.style.color = 'var(--text-secondary)'}
                  onMouseLeave={e => e.currentTarget.style.color = 'var(--text-disabled)'}
                >
                  Re-analyze
                </button>
              </div>
            )}
          </div>

          {/* Amazon link */}
          <div style={{ marginTop: 'var(--space-5)', paddingTop: 'var(--space-4)', borderTop: '1px solid var(--surface-3)' }}>
            <a
              href={lead.url} target="_blank" rel="noreferrer"
              style={{ fontSize: 12, color: 'var(--text-disabled)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6, transition: 'color .15s' }}
              onMouseEnter={e => e.currentTarget.style.color = '#fff'}
              onMouseLeave={e => e.currentTarget.style.color = 'var(--text-disabled)'}
            >
              View on Amazon <ExternalLink size={11} />
            </a>
          </div>
        </div>
      </td>
    </tr>
  )
}

const COL = [
  { label: '',        key: null,               w: 64,   align: 'left'   },  // image
  { label: 'Product', key: 'title',            flex: 1, align: 'left'   },
  { label: 'Price',   key: 'price',            w: 88,   align: 'right'  },
  { label: 'BSR',     key: 'bsr',              w: 96,   align: 'right'  },
  { label: 'ROI',     key: 'profitData.roi',   w: 100,  align: 'right'  },
  { label: 'Score',   key: 'score',            w: 90,   align: 'center' },
  { label: 'Grade',   key: 'grade',            w: 60,   align: 'center' },
  { label: 'Status',  key: null,               w: 110,  align: 'left'   },
]

function getVal(obj, path) {
  return path ? path.split('.').reduce((o, k) => o?.[k], obj) : null
}

export default function LeadTable({ leads, loading, error, warning, picks, totalMatched, scanOptions }) {
  const [expanded, setExpanded]     = useState(null)
  const [sortKey, setSortKey]       = useState('score')
  const [sortDir, setSortDir]       = useState(-1)
  const [search, setSearch]         = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [gradeFilter, setGrade]     = useState('All')
  const [asinLookup, setAsinLookup] = useState(null) // { asin, status: 'loading'|'done'|'error', lead, error }

  // Debounce what actually drives filtering/lookup — the input itself stays instant
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => clearTimeout(id)
  }, [search])

  // A query that looks like an ASIN but isn't among the currently loaded leads means the
  // user wants to check a specific product the current scan never covered — fetch it
  // directly rather than relying on the (empty) substring match. A keyword query, by
  // contrast, only ever narrows the leads already on screen — there's no backend capability
  // to run a fresh keyword-based scan against Amazon.
  useEffect(() => {
    const q = debouncedSearch
    if (!ASIN_PATTERN.test(q)) { setAsinLookup(null); return }

    const asin = q.toUpperCase()
    if (leads.some(l => l.asin?.toUpperCase() === asin)) { setAsinLookup(null); return }

    let cancelled = false
    setAsinLookup({ asin, status: 'loading' })
    scanAsin(asin, null, scanOptions)
      .then(({ data }) => { if (!cancelled) setAsinLookup({ asin, status: 'done', lead: data }) })
      .catch((e) => { if (!cancelled) setAsinLookup({ asin, status: 'error', error: e.response?.data?.error || 'ASIN not found' }) })
    return () => { cancelled = true }
  }, [debouncedSearch, leads, scanOptions])

  const toggleSort = (key) => {
    if (!key) return
    if (sortKey === key) setSortDir(d => -d)
    else { setSortKey(key); setSortDir(-1) }
  }

  const searchedLeads = asinLookup?.status === 'done' ? [...leads, asinLookup.lead] : leads

  const filtered = searchedLeads
    .filter(l => gradeFilter === 'All' || l.grade === gradeFilter)
    .filter(l => {
      if (!debouncedSearch) return true
      const q = debouncedSearch.toLowerCase()
      return l.asin?.toLowerCase().includes(q) || l.title?.toLowerCase().includes(q)
    })
    .slice()
    .sort((a, b) => {
      const av = getVal(a, sortKey) ?? 0
      const bv = getVal(b, sortKey) ?? 0
      return (av - bv) * sortDir
    })

  const TH = (col) => ({
    padding: '0 16px',
    height: 36,
    fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase',
    color: sortKey === col.key ? '#fff' : 'var(--text-faint)',
    textAlign: col.align,
    whiteSpace: 'nowrap',
    width: col.w || undefined,
    cursor: col.key ? 'pointer' : 'default',
    userSelect: 'none',
    background: 'var(--surface-1)',
    borderBottom: '1px solid var(--border-subtle)',
    position: 'sticky', top: 0, zIndex: 2,
    transition: 'color .12s',
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

      {/* Toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 14,
        padding: '12px 24px', borderBottom: '1px solid var(--border-subtle)',
        flexShrink: 0, background: 'var(--surface-0)',
      }}>
        <div style={{ position: 'relative', flex: 1, maxWidth: 300 }}>
          <Search size={14} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-faint)', pointerEvents: 'none' }} />
          <input
            type="text"
            placeholder="Search product or ASIN…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              width: '100%', background: 'var(--surface-2)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)', color: '#fff', fontSize: 13, padding: '10px 40px 10px 36px',
              outline: 'none', fontFamily: 'inherit', transition: 'border-color .15s',
            }}
            onFocus={e => { e.target.style.borderColor = 'var(--brand)' }}
            onBlur={e => { e.target.style.borderColor = 'var(--border)' }}
          />
          {asinLookup?.status === 'loading' && (
            <Loader2
              size={14} className="anim-spin"
              title={`Looking up ${asinLookup.asin}…`}
              style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--brand)' }}
            />
          )}
          {asinLookup?.status === 'error' && (
            <AlertTriangle
              size={14}
              title={asinLookup.error}
              style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--status-critical)' }}
            />
          )}
          {asinLookup?.status === 'done' && (
            <CheckCircle2
              size={14}
              title={`Found ${asinLookup.asin} — added below`}
              style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--brand)' }}
            />
          )}
        </div>

        <div style={{ display: 'flex', gap: 3, background: 'var(--surface-2)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', padding: 3 }}>
          {['All','A','B','C','D'].map(g => {
            const active = gradeFilter === g
            const color  = GRADE_COLOR[g]
            return (
              <button key={g} onClick={() => setGrade(g)} className="press-feedback" style={{
                padding: '5px 12px',
                background: active ? (g === 'All' ? 'var(--surface-5)' : `color-mix(in srgb, ${color} 16%, transparent)`) : 'transparent',
                border: active ? (g === 'All' ? '1px solid var(--border-emphasis)' : `1px solid color-mix(in srgb, ${color} 40%, transparent)`) : '1px solid transparent',
                borderRadius: 'var(--radius-sm)', color: active ? (g === 'All' ? '#ddd' : color) : 'var(--text-disabled)',
                fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                letterSpacing: '0.04em',
              }}
              onMouseEnter={e => { if (!active) e.currentTarget.style.color = 'var(--text-muted)' }}
              onMouseLeave={e => { if (!active) e.currentTarget.style.color = 'var(--text-disabled)' }}
              >
                {g}
              </button>
            )
          })}
        </div>

        {/* Always on — hard-gated server-side, not a toggle (see filterByUngating in scanner.js) */}
        <span
          title="Every scan drops leads that are gated with no auto-ungate path — this is always enforced, not optional"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '6px 12px',
            background: 'rgba(0,230,118,0.08)', border: '1px solid rgba(0,230,118,0.3)',
            borderRadius: 'var(--radius-md)', color: 'var(--brand)',
            fontSize: 11, fontWeight: 600, letterSpacing: '0.04em',
          }}
        >
          <CheckCircle2 size={12} /> Auto-ungate
        </span>

        <span className="font-mono" style={{ fontSize: 11, color: 'var(--text-disabled)', marginLeft: 'auto', letterSpacing: '0.04em' }}>
          {totalMatched != null && totalMatched > filtered.length
            ? `Top ${filtered.length} of ${totalMatched}`
            : `${filtered.length} ${filtered.length === 1 ? 'opportunity' : 'opportunities'}`}
        </span>
      </div>

      {/* Table area */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {!error && picks?.length > 0 && (
          <div style={{
            margin: '16px 24px 0', padding: '14px 16px',
            background: 'rgba(144,133,233,0.07)', border: '1px solid rgba(144,133,233,0.22)', borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-sm)',
          }}>
            <p style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ai)', marginBottom: 8 }}>
              <Sparkles size={12} /> AI picked today's categories
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {picks.map((p) => (
                <p key={p.category} style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                  <span style={{ color: '#fff', fontWeight: 600 }}>{p.category}</span>
                  {' — '}{p.reason}
                </p>
              ))}
            </div>
          </div>
        )}

        {!error && warning && (
          <div style={{
            margin: '16px 24px 0', padding: '12px 16px',
            background: 'rgba(236,131,90,0.1)', border: '1px solid rgba(236,131,90,0.3)', borderRadius: 'var(--radius-md)',
          }}>
            <p style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--status-serious)' }}>
              <AlertTriangle size={13} /> {warning}
            </p>
          </div>
        )}

        {error && (
          <div style={{ margin: '24px', padding: '16px 20px', background: 'rgba(208,59,59,0.1)', border: '1px solid rgba(208,59,59,0.3)', borderRadius: 'var(--radius-md)' }}>
            <p style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--status-critical)', fontWeight: 600, marginBottom: 6 }}>
              <AlertTriangle size={14} /> Scan failed
            </p>
            <p style={{ fontSize: 12, color: 'var(--status-critical)' }}>{error}</p>
          </div>
        )}

        {!error && !loading && filtered.length === 0 && leads.length === 0 && !debouncedSearch && (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            flex: 1, minHeight: 320, paddingTop: '8%', paddingBottom: '8%', overflow: 'hidden',
          }}>
            <div style={{
              width: 56, height: 56, borderRadius: 'var(--radius-xl)', background: 'var(--surface-3)',
              border: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'center',
              marginBottom: 20,
            }}>
              <PackageSearch size={24} style={{ color: 'var(--text-faint)' }} />
            </div>
            <div style={{ textAlign: 'center' }}>
              <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 8, fontWeight: 500 }}>No opportunities yet</p>
              <p style={{ fontSize: 12, color: 'var(--text-faint)' }}>Configure your filters and click Scan Now</p>
            </div>
            <span style={{
              marginTop: 'auto',
              fontSize: 'clamp(80px, 10vw, 130px)', fontWeight: 700,
              letterSpacing: '-0.04em', color: '#fff', opacity: 0.045,
              userSelect: 'none', pointerEvents: 'none', whiteSpace: 'nowrap', lineHeight: 1,
            }}>
              SOURCR.AI
            </span>
          </div>
        )}

        {!error && !loading && filtered.length === 0 && (leads.length > 0 || debouncedSearch) && asinLookup?.status !== 'loading' && (
          <div style={{ padding: '60px 24px', textAlign: 'center' }}>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6 }}>No matches</p>
            <p style={{ fontSize: 12, color: 'var(--text-faint)' }}>
              {asinLookup?.status === 'error' ? asinLookup.error : 'Try a different search or adjust your filters.'}
            </p>
          </div>
        )}

        {loading && (
          <>
            <div style={{ padding: '24px 24px 0', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
              <Loader2 size={18} className="anim-spin" style={{ color: 'var(--brand)' }} />
              <p style={{ fontSize: 12, color: 'var(--text-faint)' }}>Scanning markets…</p>
            </div>
            <SkeletonRows />
          </>
        )}

        {!loading && filtered.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: 64 }} />
              <col style={{ width: 'auto' }} />
              <col style={{ width: 88 }} />
              <col style={{ width: 96 }} />
              <col style={{ width: 100 }} />
              <col style={{ width: 90 }} />
              <col style={{ width: 60 }} />
              <col style={{ width: 110 }} />
            </colgroup>
            <thead>
              <tr>
                {COL.map((col, i) => (
                  <th key={i} onClick={() => toggleSort(col.key)} style={TH(col)}
                    onMouseEnter={e => { if (col.key && sortKey !== col.key) e.currentTarget.style.color = 'var(--text-muted)' }}
                    onMouseLeave={e => { if (col.key && sortKey !== col.key) e.currentTarget.style.color = 'var(--text-faint)' }}
                  >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                      {col.label}
                      {sortKey === col.key && (sortDir === -1 ? <ChevronDown size={11} style={{ opacity: 0.6 }} /> : <ChevronUp size={11} style={{ opacity: 0.6 }} />)}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((lead, i) => {
                const pd   = lead.profitData || {}
                const open = expanded === lead.asin
                const rowBg = open ? 'var(--surface-4)' : i % 2 === 0 ? 'var(--surface-0)' : 'var(--surface-1)'
                const gradeColor = GRADE_COLOR[lead.grade] || 'var(--text-faint)'

                return (
                  <>
                    <tr
                      key={lead.asin}
                      onClick={() => setExpanded(open ? null : lead.asin)}
                      style={{ background: rowBg, borderBottom: open ? 'none' : '1px solid var(--surface-5)', cursor: 'pointer', position: 'relative' }}
                      onMouseEnter={e => { if (!open) e.currentTarget.style.background = 'var(--surface-2)' }}
                      onMouseLeave={e => { e.currentTarget.style.background = rowBg }}
                    >
                      {/* Image */}
                      <td style={{ padding: '16px 8px 16px 16px', borderLeft: `2px solid ${open ? gradeColor : 'transparent'}`, transition: 'border-color .15s' }}>
                        <ProductImage lead={lead} />
                      </td>
                      {/* Product */}
                      <td style={{ padding: '0 16px', height: 80, overflow: 'hidden' }}>
                        <div style={{ overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                          <span style={{ fontSize: 13, color: '#ccc' }}>{lead.title || lead.asin}</span>
                        </div>
                        <span className="font-mono" style={{ fontSize: 10, color: 'var(--text-disabled)', letterSpacing: '0.05em' }}>
                          {lead.asin}
                        </span>
                      </td>
                      {/* Price */}
                      <td className="font-mono" style={{ padding: '0 16px', height: 80, textAlign: 'right', fontSize: 13, color: 'var(--text-muted)' }}>
                        {lead.price != null ? `$${lead.price}` : '—'}
                      </td>
                      {/* BSR */}
                      <td className="font-mono" style={{ padding: '0 16px', height: 80, textAlign: 'right', fontSize: 12, color: 'var(--text-secondary)' }}>
                        {lead.bsr?.toLocaleString() || '—'}
                      </td>
                      {/* ROI */}
                      <td style={{ padding: '0 16px', height: 80, textAlign: 'right' }}>
                        {roiBadge(pd.roi)}
                      </td>
                      {/* Score */}
                      <td style={{ padding: '0 16px', height: 80 }}>
                        <div style={{ display: 'flex', justifyContent: 'center' }}>
                          <ScoreGauge score={lead.score ?? 0} grade={lead.grade} width={56} height={5} />
                        </div>
                      </td>
                      {/* Grade */}
                      <td style={{ padding: '0 16px', height: 80, textAlign: 'center' }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: gradeColor }}>
                          {lead.grade || '—'}
                        </span>
                      </td>
                      {/* Status */}
                      <td style={{ padding: '0 16px', height: 80 }}>
                        <UngateLabel u={lead.ungating} />
                      </td>
                    </tr>
                    {open && <ExpandedRow key={`${lead.asin}-exp`} lead={lead} colSpan={8} />}
                  </>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
