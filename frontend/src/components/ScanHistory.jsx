import { useEffect, useRef, useState } from 'react'
import { History, Trash2, AlertTriangle, Loader2 } from 'lucide-react'
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
        className="press-feedback"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          fontSize: 11, color: open ? '#fff' : 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase',
          background: open ? 'var(--surface-3)' : 'transparent', border: `1px solid ${open ? 'var(--border-emphasis)' : 'var(--border)'}`, borderRadius: 'var(--radius-md)',
          padding: '6px 12px', cursor: 'pointer', fontFamily: 'inherit',
          transition: 'color .15s, border-color .15s, background .15s',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.color = '#fff'; e.currentTarget.style.borderColor = 'var(--border-emphasis)' }}
        onMouseLeave={(e) => { e.currentTarget.style.color = open ? '#fff' : 'var(--text-muted)'; e.currentTarget.style.borderColor = open ? 'var(--border-emphasis)' : 'var(--border)' }}
      >
        <History size={13} /> History
      </button>

      {open && (
        <div className="anim-expand" style={{
          position: 'absolute', top: '100%', right: 0, marginTop: 8,
          width: 340, maxHeight: 400, overflowY: 'auto',
          background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-lg)', zIndex: 50,
        }}>
          {loading && (
            <p style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 16, fontSize: 12, color: 'var(--text-faint)' }}>
              <Loader2 size={13} className="anim-spin" /> Loading...
            </p>
          )}

          {!loading && scans.length === 0 && (
            <p style={{ padding: 16, fontSize: 12, color: 'var(--text-faint)' }}>No saved scans yet — run a scan and it'll show up here.</p>
          )}

          {!loading && scans.map((scan) => (
            <div
              key={scan.id}
              onClick={() => { onLoad(scan.id); setOpen(false) }}
              style={{
                padding: '12px 16px', borderBottom: '1px solid var(--surface-4)',
                cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
                transition: 'background .12s',
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'var(--surface-3)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
            >
              <div style={{ minWidth: 0 }}>
                <p style={{ fontSize: 12, color: '#fff', marginBottom: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {(scan.categories || []).join(', ') || 'Scan'}
                </p>
                <p className="font-mono" style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text-secondary)' }}>
                  {formatWhen(scan.created_at)} · {scan.lead_count} lead{scan.lead_count === 1 ? '' : 's'}
                  {scan.warning && <AlertTriangle size={10} style={{ color: 'var(--status-serious)' }} />}
                </p>
              </div>
              <button
                onClick={(e) => handleDelete(e, scan.id)}
                title="Delete this saved scan"
                className="press-feedback"
                style={{
                  color: 'var(--text-faint)', background: 'none', border: 'none',
                  cursor: 'pointer', flexShrink: 0, padding: 4, display: 'flex',
                }}
                onMouseEnter={(e) => e.currentTarget.style.color = 'var(--status-critical)'}
                onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-faint)'}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
