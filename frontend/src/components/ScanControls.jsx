import { useEffect, useRef, useState } from 'react'

const ALL_CATEGORIES = [
  'beauty','kitchen','health','toys','pets',
  'sports','office','baby','tools','electronics',
]

const s = {
  label: {
    display: 'block',
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    color: '#555',
    marginBottom: 10,
  },
  input: {
    width: '100%',
    background: '#0d0d0d',
    border: '1px solid #252525',
    borderRadius: 4,
    color: '#fff',
    fontSize: 14,
    fontWeight: 400,
    padding: '12px 14px',
    outline: 'none',
    transition: 'border-color .15s, background .15s',
    fontFamily: 'inherit',
  },
  section: {
    borderBottom: '1px solid #141414',
    paddingBottom: 24,
    marginBottom: 24,
  },
}

function NumInput({ label, value, onChange, unit, min, max, step = 1 }) {
  const [focused, setFocused] = useState(false)
  return (
    <div>
      <span style={s.label}>{label}</span>
      <div style={{ position: 'relative' }}>
        <input
          type="number"
          min={min} max={max} step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={{ ...s.input, paddingRight: unit ? 32 : 12, borderColor: focused ? '#00e676' : '#222' }}
        />
        {unit && (
          <span style={{
            position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)',
            fontSize: 12, color: '#3a3a3a', pointerEvents: 'none',
          }}>
            {unit}
          </span>
        )}
      </div>
    </div>
  )
}

function CategoryDropdown({ selected, onChange }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const toggle = (cat) =>
    onChange(selected.includes(cat) ? selected.filter(c => c !== cat) : [...selected, cat])

  const label = selected.length === 0
    ? 'None selected'
    : selected.length === ALL_CATEGORIES.length
    ? 'All categories'
    : `${selected.length} selected`

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <span style={s.label}>Categories</span>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          ...s.input,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'pointer',
          borderColor: open ? '#00e676' : '#222',
          textAlign: 'left',
          width: '100%',
        }}
      >
        <span style={{ color: selected.length === 0 ? '#444' : '#fff' }}>{label}</span>
        <span style={{
          fontSize: 10, color: '#444',
          transform: open ? 'rotate(180deg)' : 'none',
          transition: 'transform .15s',
          display: 'inline-block',
        }}>▾</span>
      </button>

      {open && (
        <div
          className="anim-expand"
          style={{
            position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 100,
            background: '#111', border: '1px solid #222', borderRadius: 4,
            overflow: 'hidden',
          }}
        >
          <div
            onClick={() => onChange(selected.length === ALL_CATEGORIES.length ? [] : [...ALL_CATEGORIES])}
            style={{
              padding: '10px 14px',
              fontSize: 11, color: '#444',
              cursor: 'pointer',
              borderBottom: '1px solid #1a1a1a',
              display: 'flex', justifyContent: 'space-between',
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              transition: 'color .12s',
            }}
            onMouseEnter={e => e.currentTarget.style.color = '#fff'}
            onMouseLeave={e => e.currentTarget.style.color = '#444'}
          >
            <span>{selected.length === ALL_CATEGORIES.length ? 'Deselect all' : 'Select all'}</span>
          </div>
          {ALL_CATEGORIES.map(cat => {
            const active = selected.includes(cat)
            return (
              <div
                key={cat}
                onClick={() => toggle(cat)}
                style={{
                  padding: '10px 14px',
                  fontSize: 13,
                  cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  color: active ? '#fff' : '#555',
                  background: 'transparent',
                  transition: 'background .1s, color .1s',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = '#161616'; e.currentTarget.style.color = '#fff' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = active ? '#fff' : '#555' }}
              >
                <span style={{ textTransform: 'capitalize' }}>{cat}</span>
                {active && (
                  <span style={{ color: '#00e676', fontSize: 12, fontWeight: 700 }}>✓</span>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default function ScanControls({ onScan, loading, selected, setSelected }) {
  const [minROI, setMinROI]       = useState(30)
  const [minPrice, setMinPrice]   = useState(10)
  const [maxPrice, setMaxPrice]   = useState(70)
  const [maxBSR, setMaxBSR]       = useState(50000)

  const canScan = !loading && selected.length > 0

  const handleScan = () => {
    if (!canScan) return
    onScan({
      mode: 'categories',
      categories: selected,
      options: { minROI, minPrice, maxPrice, maxBSR, minGrade: 'D', pages: 2 },
    })
  }

  return (
    <div style={{
      width: 300,
      flexShrink: 0,
      /* Thin green separator line */
      borderRight: '1px solid #00e676',
      boxShadow: '1px 0 12px rgba(0,230,118,0.06)',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}>
      <div style={{ flex: 1, overflowY: 'auto', padding: '28px 26px 0' }}>

        <div style={s.section}>
          <CategoryDropdown selected={selected} onChange={setSelected} />
        </div>

        <div style={s.section}>
          <NumInput
            label="Min ROI"
            value={minROI}
            onChange={setMinROI}
            unit="%" min={0} max={999}
          />
        </div>

        <div style={s.section}>
          <span style={s.label}>Price Range</span>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 8, alignItems: 'center' }}>
            <NumInput
              label=""
              value={minPrice}
              onChange={setMinPrice}
              unit="$" min={0}
            />
            <span style={{ color: '#333', fontSize: 16, marginTop: -2 }}>–</span>
            <NumInput
              label=""
              value={maxPrice}
              onChange={setMaxPrice}
              unit="$" min={0}
            />
          </div>
        </div>

        <div style={{ marginBottom: 24 }}>
          <NumInput
            label="Max BSR"
            value={maxBSR}
            onChange={setMaxBSR}
            min={100} step={1000}
          />
        </div>
      </div>

      <div style={{ padding: '20px 26px 28px', borderTop: '1px solid #141414' }}>
        <button
          onClick={handleScan}
          disabled={!canScan}
          className={canScan && !loading ? 'anim-btn-glow' : ''}
          style={{
            width: '100%',
            padding: '15px 0',
            background: canScan ? '#00e676' : '#0d0d0d',
            color: canScan ? '#000' : '#2a2a2a',
            border: canScan ? 'none' : '1px solid #1a1a1a',
            borderRadius: 4,
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            cursor: canScan ? 'pointer' : 'not-allowed',
            fontFamily: 'inherit',
            transition: 'background .15s, transform .1s',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
          }}
          onMouseEnter={e => { if (canScan) e.currentTarget.style.background = '#14ffaa' }}
          onMouseLeave={e => { if (canScan) e.currentTarget.style.background = '#00e676' }}
          onMouseDown={e => { if (canScan) e.currentTarget.style.transform = 'scale(0.985)' }}
          onMouseUp={e => { e.currentTarget.style.transform = 'scale(1)' }}
        >
          {loading ? (
            <>
              <span
                className="anim-spin"
                style={{
                  width: 13, height: 13, borderRadius: '50%',
                  border: '2px solid rgba(0,0,0,0.25)',
                  borderTopColor: '#000',
                  display: 'inline-block',
                }}
              />
              Scanning
            </>
          ) : 'Scan Now'}
        </button>
        {selected.length === 0 && (
          <p style={{ fontSize: 11, color: '#2a2a2a', textAlign: 'center', marginTop: 10 }}>
            Select at least one category
          </p>
        )}
      </div>
    </div>
  )
}
