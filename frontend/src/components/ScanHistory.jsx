import { useEffect, useRef, useState } from 'react'
import { getScans, deleteScan as deleteScanApi } from '../api'

function formatWhen(iso) {
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' · ' +
    d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

export default function ScanHistory({ onLoad }) {
  const [open, setOpen]     = useState(false)
  const [scans, setScans]   = useState([])
  const [loading, setLoading] = useState(false)
  const ref = useRef(null)

  const load = async () => {
    setLoading(true)
    try {
      const { data } = await getScans(50)
      setScans(data.scans || [])
    } catch {
      setScans([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const onClickOutside = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  const handleDelete = async (e, id) => {
    e.stopPropagation()
    setScans((prev) => prev.filter((s) => s.id !== id))
    try { await deleteScanApi(id) } catch { load() }
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((o) => { const next = !o; if (next) load(); return next })}
        style={{
          fontSize: 11, color: '#666', letterSpacing: '0.06em', textTransform: 'uppercase',
          background: 'transparent', border: '1px solid #222', borderRadius: 4,
          padding: '6px 12px', cursor: 'pointer',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.color = '#fff'; e.currentTarget.style.borderColor = '#333' }}
        onMouseLeave={(e) => { e.currentTarget.style.color = '#666'; e.currentTarget.style.borderColor = '#222' }}
      >
        History
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: '100%', right: 0, marginTop: 8,
          width: 340, maxHeight: 400, overflowY: 'auto',
          background: '#0a0a0a', border: '1px solid #222', borderRadius: 6,
          boxShadow: '0 8px 24px rgba(0,0,0,0.5)', zIndex: 50,
        }}>
          {loading && (
            <p style={{ padding: 16, fontSize: 12, color: '#444' }}>Loading...</p>
          )}

          {!loading && scans.length === 0 && (
            <p style={{ padding: 16, fontSize: 12, color: '#444' }}>No saved scans yet — run a scan and it'll show up here.</p>
          )}

          {!loading && scans.map((scan) => (
            <div
              key={scan.id}
              onClick={() => { onLoad(scan.id); setOpen(false) }}
              style={{
                padding: '12px 16px', borderBottom: '1px solid #161616',
                cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = '#111'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
            >
              <div style={{ minWidth: 0 }}>
                <p style={{ fontSize: 12, color: '#fff', marginBottom: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {(scan.categories || []).join(', ') || 'Scan'}
                </p>
                <p style={{ fontSize: 11, color: '#555' }}>
                  {formatWhen(scan.created_at)} · {scan.lead_count} lead{scan.lead_count === 1 ? '' : 's'}
                  {scan.warning ? ' · ⚠ partial' : ''}
                </p>
              </div>
              <button
                onClick={(e) => handleDelete(e, scan.id)}
                title="Delete this saved scan"
                style={{
                  fontSize: 14, color: '#444', background: 'none', border: 'none',
                  cursor: 'pointer', flexShrink: 0, padding: 4,
                }}
                onMouseEnter={(e) => e.currentTarget.style.color = '#ef4444'}
                onMouseLeave={(e) => e.currentTarget.style.color = '#444'}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
