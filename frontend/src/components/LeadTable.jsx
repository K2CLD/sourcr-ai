import { useState } from 'react'
import { analyzeLead, getSupplierSources } from '../api'

const GRADE_COLOR = { A: '#00e676', B: '#aaa', C: '#666', D: '#444' }

function fmt(v, pre = '') { return v != null ? `${pre}${v}` : '—' }

function roiBadge(roi) {
  if (roi == null) return null
  const num = parseFloat(roi)
  const [bg, color] =
    num >= 50 ? ['rgba(0,230,118,0.12)', '#00e676'] :
    num >= 30 ? ['rgba(234,179,8,0.12)',  '#ca8a04'] :
                ['rgba(239,68,68,0.12)',   '#ef4444']
  return (
    <span style={{
      display: 'inline-block', padding: '1px 7px', borderRadius: 3,
      fontSize: 11, fontWeight: 700,
      background: bg, color,
      border: `1px solid ${color}33`,
    }}>
      {num}%
    </span>
  )
}

function UngateLabel({ u }) {
  if (!u) return <span style={{ color: '#333' }}>—</span>
  if (u.gated === false)           return <span style={{ color: '#00e676', fontSize: 11 }}>Open</span>
  if (u.gated && u.autoUngatable)  return <span style={{ color: '#888',    fontSize: 11 }}>Auto-ungate</span>
  if (u.gated && !u.autoUngatable) return <span style={{ color: '#444',    fontSize: 11 }}>Gated</span>
  return <span style={{ color: '#333', fontSize: 11 }}>—</span>
}

function TierBadge({ tier }) {
  const map = {
    verified:   { label: 'Verified',   bg: 'rgba(0,230,118,0.1)', color: '#00e676', border: 'rgba(0,230,118,0.25)' },
    wholesale:  { label: 'Wholesale',  bg: 'rgba(96,165,250,0.1)', color: '#60a5fa', border: 'rgba(96,165,250,0.25)' },
    brand:      { label: 'Brand Direct', bg: 'rgba(167,139,250,0.1)', color: '#a78bfa', border: 'rgba(167,139,250,0.25)' },
    liquidation:{ label: 'Liquidation',bg: 'rgba(251,146,60,0.1)', color: '#fb923c', border: 'rgba(251,146,60,0.25)' },
    unverified: { label: 'Unverified', bg: 'rgba(255,255,255,0.04)', color: '#555',   border: '#222' },
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
        width: 48, height: 48, background: '#141414', borderRadius: 3, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        border: '1px solid #1e1e1e',
      }}>
        <span style={{ fontSize: 16, fontWeight: 700, color: '#2a2a2a', userSelect: 'none' }}>
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
        width: 48, height: 48, objectFit: 'contain', borderRadius: 3, flexShrink: 0,
        background: '#111', border: '1px solid #1a1a1a', display: 'block',
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
    <div style={{ borderTop: '1px solid #1a1a1a', paddingTop: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#444' }}>
          Where to Buy
        </span>
        {!sources && !loading && (
          <button
            onClick={load}
            style={{
              fontSize: 11, fontWeight: 600, padding: '4px 12px', borderRadius: 3,
              background: 'transparent', border: '1px solid #222',
              color: '#555', cursor: 'pointer', fontFamily: 'inherit',
              transition: 'border-color .15s, color .15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = '#00e676'; e.currentTarget.style.color = '#00e676' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = '#222';    e.currentTarget.style.color = '#555' }}
          >
            Find Sources
          </button>
        )}
      </div>

      {loading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#444', fontSize: 12 }}>
          <span className="anim-spin" style={{
            width: 12, height: 12, borderRadius: '50%',
            border: '1.5px solid #222', borderTopColor: '#00e676', display: 'inline-block',
          }} />
          Searching for sources…
        </div>
      )}

      {error && <p style={{ fontSize: 12, color: '#555' }}>{error}</p>}

      {sources && sources.length === 0 && (
        <p style={{ fontSize: 12, color: '#333' }}>No off-Amazon sources found for this product.</p>
      )}

      {sources && sources.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {/* Best source highlight */}
          {best && (
            <div style={{
              padding: '12px 14px', marginBottom: 8,
              background: 'rgba(0,230,118,0.04)',
              border: '1px solid rgba(0,230,118,0.12)',
              borderRadius: 3,
            }}>
              <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#00e676', marginBottom: 6 }}>
                Best Source
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <a
                    href={best.searchUrl} target="_blank" rel="noreferrer"
                    style={{ fontSize: 13, fontWeight: 600, color: '#fff', textDecoration: 'none' }}
                    onMouseEnter={e => e.currentTarget.style.color = '#00e676'}
                    onMouseLeave={e => e.currentTarget.style.color = '#fff'}
                  >
                    {best.name}
                  </a>
                  <TierBadge tier={best.tier} />
                </div>
                {best.estimatedPrice && (
                  <span style={{ fontSize: 15, fontWeight: 700, color: '#00e676', fontVariantNumeric: 'tabular-nums' }}>
                    ~${best.estimatedPrice.toFixed(2)}
                  </span>
                )}
              </div>
              {best.notes && <p style={{ fontSize: 11, color: '#555', marginTop: 5 }}>{best.notes}</p>}
              {best.tier === 'unverified' && (
                <p style={{ fontSize: 11, color: '#fb923c', marginTop: 4 }}>
                  ⚠ Unverified supplier — confirm legitimacy before purchasing
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
                borderBottom: '1px solid #111',
              }}
            >
              <span style={{ fontSize: 11, color: '#333', width: 16, flexShrink: 0, textAlign: 'right' }}>
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
                {s.notes && <p style={{ fontSize: 11, color: '#444', marginTop: 2 }}>{s.notes}</p>}
                {s.tier === 'unverified' && (
                  <p style={{ fontSize: 10, color: '#fb923c55', marginTop: 2 }}>Unverified — verify before ordering</p>
                )}
              </div>
              <div style={{ flexShrink: 0, textAlign: 'right' }}>
                {s.estimatedPrice ? (
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#888', fontVariantNumeric: 'tabular-nums' }}>
                    ~${s.estimatedPrice.toFixed(2)}
                    <span style={{ fontSize: 10, color: '#444', fontWeight: 400, marginLeft: 3 }}>est</span>
                  </span>
                ) : (
                  <span style={{ fontSize: 11, color: '#333' }}>Check price</span>
                )}
              </div>
            </div>
          ))}

          <p style={{ fontSize: 10, color: '#2a2a2a', marginTop: 8 }}>
            Prices are estimates. Amazon and all Amazon-owned sources have been excluded.
          </p>
        </div>
      )}
    </div>
  )
}

function ExpandedRow({ lead, colSpan }) {
  const pd = lead.profitData || {}
  const [aiResult, setAiResult]   = useState(null)
  const [aiLoading, setAiLoading] = useState(false)

  const handleAI = async () => {
    if (aiResult || aiLoading) return
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

  return (
    <tr>
      <td colSpan={colSpan} style={{ padding: 0 }}>
        <div
          className="anim-expand"
          style={{
            background: '#080808',
            borderTop: '1px solid #1a1a1a',
            borderBottom: '1px solid #1a1a1a',
            padding: '24px 28px',
          }}
        >
          {/* Header with image */}
          <div style={{ display: 'flex', gap: 16, marginBottom: 24, alignItems: 'flex-start' }}>
            <ProductImage lead={lead} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 11, color: '#333', fontFamily: 'monospace', marginBottom: 4 }}>{lead.asin}</p>
              <p style={{ fontSize: 14, color: '#ccc', fontWeight: 500, lineHeight: 1.4 }}>{lead.title}</p>
              {lead.brand && <p style={{ fontSize: 11, color: '#444', marginTop: 3 }}>{lead.brand}</p>}
            </div>
          </div>

          {/* Key financials — prominent */}
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1,
            marginBottom: 24, background: '#111', borderRadius: 4, overflow: 'hidden',
          }}>
            {[
              { l: 'Profit / Unit', v: pd.profit != null ? `$${pd.profit}` : '—', big: true, color: '#00e676' },
              { l: 'ROI',           v: pd.roi    != null ? `${pd.roi}%`    : '—', big: true, color: pd.roi >= 50 ? '#00e676' : pd.roi >= 30 ? '#ca8a04' : '#ef4444' },
              { l: 'Sale Price',    v: lead.price != null ? `$${lead.price}` : '—', big: true, color: '#fff' },
            ].map(({ l, v, big, color }) => (
              <div key={l} style={{ padding: '16px 20px', background: '#0a0a0a' }}>
                <p style={{ fontSize: 10, color: '#444', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>{l}</p>
                <p style={{ fontSize: big ? 22 : 14, fontWeight: 700, color, fontVariantNumeric: 'tabular-nums' }}>{v}</p>
              </div>
            ))}
          </div>

          {/* Detail grid — 2 columns */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 40px', marginBottom: 24 }}>
            {[
              { l: 'FBA Fee',      v: fmt(pd.fbaFee,      '$') },
              { l: 'Referral Fee', v: fmt(pd.referralFee, '$') },
              { l: 'Total Fees',   v: fmt(pd.totalFees,   '$') },
              { l: 'Buy Price',    v: fmt(pd.buyPrice,    '$') },
              { l: 'BSR',          v: lead.bsr?.toLocaleString() || '—' },
              { l: 'BSR Trend',    v: lead.bsrTrend || '—' },
              { l: 'Rating',       v: lead.rating != null ? `${lead.rating}★` : '—' },
              { l: 'Reviews',      v: lead.reviews?.toLocaleString() || '—' },
              { l: 'Price Stable', v: lead.priceStable === true ? 'Yes' : lead.priceStable === false ? 'No' : '—' },
              { l: 'New Sellers',  v: lead.newSellers30d ?? '—' },
              { l: 'Score',        v: lead.score != null ? `${lead.score}/100` : '—' },
              { l: 'Category',     v: lead.category || '—' },
            ].map(({ l, v }) => (
              <div key={l} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', paddingBottom: 8, borderBottom: '1px solid #111' }}>
                <span style={{ fontSize: 11, color: '#444' }}>{l}</span>
                <span style={{ fontSize: 12, color: '#888', fontVariantNumeric: 'tabular-nums' }}>{v}</span>
              </div>
            ))}
          </div>

          {/* Ungating */}
          {lead.ungating && (
            <div style={{ marginBottom: 20, paddingBottom: 20, borderBottom: '1px solid #1a1a1a' }}>
              <p style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#444', marginBottom: 8 }}>Ungating</p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <UngateLabel u={lead.ungating} />
                {lead.ungating.notes && <span style={{ fontSize: 11, color: '#444' }}>{lead.ungating.notes}</span>}
                {lead.ungating.approvalUrl && (
                  <a href={lead.ungating.approvalUrl} target="_blank" rel="noreferrer"
                    style={{ fontSize: 11, color: '#00e676', textDecoration: 'none' }}>
                    Request approval →
                  </a>
                )}
              </div>
            </div>
          )}

          {/* Strengths / Flags */}
          {(lead.reasons?.length > 0 || lead.flags?.length > 0) && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20, paddingBottom: 20, borderBottom: '1px solid #1a1a1a' }}>
              {lead.reasons?.length > 0 && (
                <div>
                  <p style={{ fontSize: 10, color: '#444', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>Strengths</p>
                  {lead.reasons.map((r, i) => <p key={i} style={{ fontSize: 12, color: '#555', marginBottom: 3 }}>+ {r}</p>)}
                </div>
              )}
              {lead.flags?.length > 0 && (
                <div>
                  <p style={{ fontSize: 10, color: '#444', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>Flags</p>
                  {lead.flags.map((f, i) => <p key={i} style={{ fontSize: 12, color: '#555', marginBottom: 3 }}>! {f}</p>)}
                </div>
              )}
            </div>
          )}

          {/* Where to Buy */}
          <div style={{ marginBottom: 20 }}>
            <WhereToBuy lead={lead} />
          </div>

          {/* AI Analysis */}
          <div style={{ borderTop: '1px solid #1a1a1a', paddingTop: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#444' }}>
                AI Analysis
              </span>
              {!aiResult && (
                <button
                  onClick={handleAI}
                  disabled={aiLoading}
                  style={{
                    fontSize: 11, fontWeight: 600, padding: '4px 12px', borderRadius: 3,
                    background: 'transparent', border: '1px solid #222',
                    color: aiLoading ? '#333' : '#555', cursor: aiLoading ? 'default' : 'pointer',
                    fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 7,
                    transition: 'border-color .15s, color .15s',
                  }}
                  onMouseEnter={e => { if (!aiLoading) { e.currentTarget.style.borderColor = '#00e676'; e.currentTarget.style.color = '#00e676' } }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = '#222'; e.currentTarget.style.color = aiLoading ? '#333' : '#555' }}
                >
                  {aiLoading && (
                    <span className="anim-spin" style={{
                      width: 11, height: 11, borderRadius: '50%',
                      border: '1.5px solid #333', borderTopColor: '#888', display: 'inline-block',
                    }} />
                  )}
                  {aiLoading ? 'Analyzing...' : 'Analyze with AI'}
                </button>
              )}
            </div>

            {!aiResult && !aiLoading && (
              <p style={{ fontSize: 12, color: '#2a2a2a' }}>Get a buy / hold / skip verdict from Claude.</p>
            )}

            {aiResult?.error && <p style={{ fontSize: 12, color: '#555' }}>{aiResult.error}</p>}

            {aiResult && !aiResult.error && (
              <div className="anim-fade" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{
                    fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 3,
                    background: ['Strong Buy','Buy'].includes(aiResult.verdict) ? 'rgba(0,230,118,0.1)' : 'rgba(255,255,255,0.05)',
                    color: ['Strong Buy','Buy'].includes(aiResult.verdict) ? '#00e676' : '#888',
                    border: `1px solid ${['Strong Buy','Buy'].includes(aiResult.verdict) ? 'rgba(0,230,118,0.2)' : '#1a1a1a'}`,
                  }}>
                    {aiResult.verdict}
                  </span>
                  <span style={{ fontSize: 11, color: '#444' }}>{aiResult.confidence} confidence</span>
                </div>
                <p style={{ fontSize: 13, color: '#aaa', lineHeight: 1.6, maxWidth: 580 }}>{aiResult.summary}</p>
                {aiResult.recommendation && (
                  <p style={{ fontSize: 12, color: '#555', fontStyle: 'italic' }}>{aiResult.recommendation}</p>
                )}
                {aiResult.watchOut && (
                  <p style={{ fontSize: 12, color: '#fb923c' }}>⚠ {aiResult.watchOut}</p>
                )}
                <button
                  onClick={handleAI}
                  style={{ fontSize: 11, color: '#2a2a2a', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0, fontFamily: 'inherit' }}
                  onMouseEnter={e => e.currentTarget.style.color = '#555'}
                  onMouseLeave={e => e.currentTarget.style.color = '#2a2a2a'}
                >
                  Re-analyze
                </button>
              </div>
            )}
          </div>

          {/* Amazon link */}
          <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid #111' }}>
            <a
              href={lead.url} target="_blank" rel="noreferrer"
              style={{ fontSize: 12, color: '#333', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6, transition: 'color .15s' }}
              onMouseEnter={e => e.currentTarget.style.color = '#fff'}
              onMouseLeave={e => e.currentTarget.style.color = '#333'}
            >
              View on Amazon ↗
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
  { label: 'Grade',   key: 'grade',            w: 60,   align: 'center' },
  { label: 'Status',  key: null,               w: 110,  align: 'left'   },
]

function getVal(obj, path) {
  return path ? path.split('.').reduce((o, k) => o?.[k], obj) : null
}

export default function LeadTable({ leads, loading, error }) {
  const [expanded, setExpanded]     = useState(null)
  const [sortKey, setSortKey]       = useState('score')
  const [sortDir, setSortDir]       = useState(-1)
  const [search, setSearch]         = useState('')
  const [gradeFilter, setGrade]     = useState('All')
  const [ungateOnly, setUngateOnly] = useState(false)

  const toggleSort = (key) => {
    if (!key) return
    if (sortKey === key) setSortDir(d => -d)
    else { setSortKey(key); setSortDir(-1) }
  }

  const filtered = leads
    .filter(l => gradeFilter === 'All' || l.grade === gradeFilter)
    .filter(l => !ungateOnly || l.ungating?.gated === false || l.ungating?.autoUngatable)
    .filter(l => {
      if (!search) return true
      const q = search.toLowerCase()
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
    color: sortKey === col.key ? '#fff' : '#444',
    textAlign: col.align,
    whiteSpace: 'nowrap',
    width: col.w || undefined,
    cursor: col.key ? 'pointer' : 'default',
    userSelect: 'none',
    background: '#080808',
    borderBottom: '1px solid #1a1a1a',
    position: 'sticky', top: 0, zIndex: 2,
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

      {/* Toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 14,
        padding: '12px 24px', borderBottom: '1px solid #1a1a1a',
        flexShrink: 0, background: '#000',
      }}>
        <div style={{ position: 'relative', flex: 1, maxWidth: 300 }}>
          <input
            type="text"
            placeholder="Search product or ASIN…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              width: '100%', background: '#0a0a0a', border: '1px solid #222',
              borderRadius: 4, color: '#fff', fontSize: 13, padding: '10px 14px',
              outline: 'none', fontFamily: 'inherit', transition: 'border-color .15s',
            }}
            onFocus={e => { e.target.style.borderColor = '#00e676' }}
            onBlur={e => { e.target.style.borderColor = '#222' }}
          />
        </div>

        <div style={{ display: 'flex', gap: 3, background: '#0a0a0a', border: '1px solid #1a1a1a', borderRadius: 5, padding: 3 }}>
          {['All','A','B','C','D'].map(g => {
            const active = gradeFilter === g
            const color  = GRADE_COLOR[g]
            return (
              <button key={g} onClick={() => setGrade(g)} style={{
                padding: '5px 12px',
                background: active ? (g === 'All' ? '#1e1e1e' : `${color}1a`) : 'transparent',
                border: active ? (g === 'All' ? '1px solid #333' : `1px solid ${color}40`) : '1px solid transparent',
                borderRadius: 3, color: active ? (g === 'All' ? '#ddd' : color) : '#383838',
                fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                letterSpacing: '0.04em', transition: 'all .12s',
              }}
              onMouseEnter={e => { if (!active) e.currentTarget.style.color = '#666' }}
              onMouseLeave={e => { if (!active) e.currentTarget.style.color = '#383838' }}
              >
                {g}
              </button>
            )
          })}
        </div>

        <button onClick={() => setUngateOnly(v => !v)} style={{
          padding: '6px 12px',
          background: ungateOnly ? 'rgba(0,230,118,0.08)' : 'transparent',
          border: ungateOnly ? '1px solid rgba(0,230,118,0.3)' : '1px solid #1a1a1a',
          borderRadius: 4, color: ungateOnly ? '#00e676' : '#383838',
          fontSize: 11, fontWeight: 600, letterSpacing: '0.04em',
          cursor: 'pointer', fontFamily: 'inherit', transition: 'all .12s',
        }}
        onMouseEnter={e => { if (!ungateOnly) e.currentTarget.style.borderColor = '#333' }}
        onMouseLeave={e => { if (!ungateOnly) e.currentTarget.style.borderColor = '#1a1a1a' }}
        >
          Auto-ungate
        </button>

        <span style={{ fontSize: 11, color: '#2a2a2a', marginLeft: 'auto', letterSpacing: '0.04em' }}>
          {filtered.length} {filtered.length === 1 ? 'lead' : 'leads'}
        </span>
      </div>

      {/* Table area */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {error && (
          <div style={{ padding: '40px 24px', textAlign: 'center' }}>
            <p style={{ fontSize: 13, color: '#555', marginBottom: 6 }}>Scan failed</p>
            <p style={{ fontSize: 12, color: '#333' }}>{error}</p>
          </div>
        )}

        {!error && !loading && leads.length === 0 && (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            flex: 1, minHeight: 320, paddingTop: '10%', paddingBottom: '8%', overflow: 'hidden',
          }}>
            <div style={{ textAlign: 'center' }}>
              <p style={{ fontSize: 14, color: '#333', marginBottom: 8, fontWeight: 500 }}>No leads yet</p>
              <p style={{ fontSize: 12, color: '#222' }}>Configure your filters and click Scan Now</p>
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

        {loading && (
          <div style={{ padding: '80px 24px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
            <span className="anim-spin" style={{
              width: 20, height: 20, borderRadius: '50%',
              border: '2px solid #1a1a1a', borderTopColor: '#00e676', display: 'block',
            }} />
            <p style={{ fontSize: 12, color: '#333' }}>Scanning markets…</p>
          </div>
        )}

        {!loading && leads.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: 64 }} />
              <col style={{ width: 'auto' }} />
              <col style={{ width: 88 }} />
              <col style={{ width: 96 }} />
              <col style={{ width: 100 }} />
              <col style={{ width: 60 }} />
              <col style={{ width: 110 }} />
            </colgroup>
            <thead>
              <tr>
                {COL.map((col, i) => (
                  <th key={i} onClick={() => toggleSort(col.key)} style={TH(col)}>
                    {col.label}
                    {sortKey === col.key && (
                      <span style={{ marginLeft: 4, opacity: 0.5 }}>{sortDir === -1 ? '↓' : '↑'}</span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((lead, i) => {
                const pd   = lead.profitData || {}
                const open = expanded === lead.asin
                const rowBg = open ? '#0d0d0d' : i % 2 === 0 ? '#000' : '#050505'

                return (
                  <>
                    <tr
                      key={lead.asin}
                      onClick={() => setExpanded(open ? null : lead.asin)}
                      style={{ background: rowBg, borderBottom: open ? 'none' : '1px solid #1e1e1e', cursor: 'pointer', transition: 'background .1s' }}
                      onMouseEnter={e => { if (!open) e.currentTarget.style.background = '#0a0a0a' }}
                      onMouseLeave={e => { e.currentTarget.style.background = rowBg }}
                    >
                      {/* Image */}
                      <td style={{ padding: '16px 8px 16px 16px' }}>
                        <ProductImage lead={lead} />
                      </td>
                      {/* Product */}
                      <td style={{ padding: '0 16px', height: 80, overflow: 'hidden' }}>
                        <div style={{ overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                          <span style={{ fontSize: 13, color: '#ccc' }}>{lead.title || lead.asin}</span>
                        </div>
                        <span style={{ fontSize: 10, color: '#2a2a2a', fontFamily: 'monospace', letterSpacing: '0.05em' }}>
                          {lead.asin}
                        </span>
                      </td>
                      {/* Price */}
                      <td style={{ padding: '0 16px', height: 80, textAlign: 'right', fontSize: 13, color: '#888', fontVariantNumeric: 'tabular-nums' }}>
                        {lead.price != null ? `$${lead.price}` : '—'}
                      </td>
                      {/* BSR */}
                      <td style={{ padding: '0 16px', height: 80, textAlign: 'right', fontSize: 12, color: '#555', fontVariantNumeric: 'tabular-nums', fontFamily: 'monospace' }}>
                        {lead.bsr?.toLocaleString() || '—'}
                      </td>
                      {/* ROI */}
                      <td style={{ padding: '0 16px', height: 80, textAlign: 'right' }}>
                        {roiBadge(pd.roi)}
                      </td>
                      {/* Grade */}
                      <td style={{ padding: '0 16px', height: 80, textAlign: 'center' }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: GRADE_COLOR[lead.grade] || '#444' }}>
                          {lead.grade || '—'}
                        </span>
                      </td>
                      {/* Status */}
                      <td style={{ padding: '0 16px', height: 80 }}>
                        <UngateLabel u={lead.ungating} />
                      </td>
                    </tr>
                    {open && <ExpandedRow key={`${lead.asin}-exp`} lead={lead} colSpan={7} />}
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
