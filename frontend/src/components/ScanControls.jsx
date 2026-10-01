import { useEffect, useRef, useState } from 'react'
import { getCategoryTree } from '../api'

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
  // Local text mirrors the field while focused, so backspacing to empty (or typing
  // "-" or "1.") can show as genuinely empty/partial instead of snapping to 0 —
  // parseFloat('') is NaN, and the old `parseFloat(e.target.value) || 0` coerced
  // that straight to 0 on every keystroke. Only valid numbers get pushed to the
  // parent as you type; blurring with an empty/invalid value reverts the display
  // to the last valid number (parent state was never actually touched by the bad input).
  const [text, setText] = useState(String(value))

  const handleFocus = () => {
    setFocused(true)
    setText(String(value))
  }

  const handleChange = (e) => {
    const raw = e.target.value
    setText(raw)
    const parsed = parseFloat(raw)
    if (raw !== '' && raw !== '-' && !Number.isNaN(parsed)) onChange(parsed)
  }

  const handleBlur = () => setFocused(false)

  const displayValue = focused ? text : String(value)

  return (
    <div>
      <span style={s.label}>{label}</span>
      <div style={{ position: 'relative' }}>
        <input
          type="number"
          min={min} max={max} step={step}
          value={displayValue}
          onChange={handleChange}
          onFocus={handleFocus}
          onBlur={handleBlur}
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

function Toggle({ label, checked, onChange }) {
  return (
    <div
      onClick={() => onChange(!checked)}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        cursor: 'pointer',
      }}
    >
      <span style={{ ...s.label, marginBottom: 0 }}>{label}</span>
      <div
        style={{
          width: 36,
          height: 20,
          borderRadius: 10,
          background: checked ? '#00e676' : '#252525',
          position: 'relative',
          transition: 'background .15s',
          flexShrink: 0,
        }}
      >
        <div
          style={{
            width: 16,
            height: 16,
            borderRadius: '50%',
            background: '#000',
            position: 'absolute',
            top: 2,
            left: checked ? 18 : 2,
            transition: 'left .15s',
          }}
        />
      </div>
    </div>
  )
}

function Checkbox({ checked, indeterminate }) {
  return (
    <div style={{
      width: 15, height: 15, borderRadius: 3, flexShrink: 0,
      border: checked || indeterminate ? 'none' : '1px solid #333',
      background: checked || indeterminate ? '#00e676' : 'transparent',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      {checked && <span style={{ color: '#000', fontSize: 10, fontWeight: 700, lineHeight: 1 }}>✓</span>}
      {indeterminate && !checked && <span style={{ width: 7, height: 2, background: '#000', borderRadius: 1 }} />}
    </div>
  )
}

// ─── Nested category selection helpers ─────────────────────────────────────
// `selected` shape: { [parentKey]: 'all' | string[] } — 'all' means the whole parent
// (or, before the tree loads / if it has no known children, the parent with no
// subcategory restriction); an array holds specific child names.

function isParentSelected(selected, tree, key) {
  const val = selected[key]
  if (val === undefined) return false
  if (val === 'all') return true
  const children = tree?.[key]?.children
  return !!children?.length && val.length === children.length
}

function isParentIndeterminate(selected, tree, key) {
  const val = selected[key]
  if (val === undefined || val === 'all' || !Array.isArray(val)) return false
  return val.length > 0 && !isParentSelected(selected, tree, key)
}

function toggleParent(selected, tree, key) {
  const next = { ...selected }
  if (isParentSelected(selected, tree, key)) delete next[key]
  else next[key] = 'all'
  return next
}

function toggleChild(selected, tree, parentKey, childName) {
  const children = tree?.[parentKey]?.children || []
  const val = selected[parentKey]
  const set = new Set(
    val === 'all' ? children.map((c) => c.name) : Array.isArray(val) ? val : []
  )
  set.has(childName) ? set.delete(childName) : set.add(childName)

  const next = { ...selected }
  if (set.size === 0) delete next[parentKey]
  else if (children.length && set.size === children.length) next[parentKey] = 'all'
  else next[parentKey] = [...set]
  return next
}

function selectionCount(selected, tree) {
  let n = 0
  for (const [key, val] of Object.entries(selected)) {
    if (val === 'all') {
      const children = tree?.[key]?.children
      n += children?.length || 1
    } else {
      n += val.length
    }
  }
  return n
}

// Expand every selection into explicit leaf category names for the backend hard-gate filter.
// Returns undefined (no subcategory restriction) whenever any selected parent can't be fully
// expressed as real leaf names yet — e.g. tree still loading, fetch failed, or Keepa returned
// no children for that parent — so we never accidentally filter out an entire category.
function expandToLeafNames(selected, tree) {
  if (!tree) return undefined
  const names = []
  for (const [key, val] of Object.entries(selected)) {
    if (val === 'all') {
      const children = tree[key]?.children
      if (!children?.length) return undefined
      names.push(...children.map((c) => c.name))
    } else {
      names.push(...val)
    }
  }
  return names
}

function CategoryDropdown({ selected, onChange, tree, treeFailed }) {
  const [open, setOpen] = useState(false)
  const [expanded, setExpanded] = useState(() => new Set())
  const ref = useRef(null)

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const toggleExpand = (key) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  const count = selectionCount(selected, tree)
  const label = count === 0 ? 'None selected' : `${count} selected`
  const allSelected = ALL_CATEGORIES.every((k) => isParentSelected(selected, tree, k))

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <span style={s.label}>Categories</span>
      <button
        onClick={() => setOpen((v) => !v)}
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
        <span style={{ color: count === 0 ? '#444' : '#fff' }}>{label}</span>
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
            overflow: 'hidden', maxHeight: 360, overflowY: 'auto',
          }}
        >
          <div
            onClick={() => onChange(
              allSelected ? {} : Object.fromEntries(ALL_CATEGORIES.map((k) => [k, 'all']))
            )}
            style={{
              padding: '10px 14px',
              fontSize: 11, color: '#444',
              cursor: 'pointer',
              borderBottom: '1px solid #1a1a1a',
              display: 'flex', justifyContent: 'space-between',
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              transition: 'color .12s',
              position: 'sticky', top: 0, background: '#111', zIndex: 1,
            }}
            onMouseEnter={(e) => e.currentTarget.style.color = '#fff'}
            onMouseLeave={(e) => e.currentTarget.style.color = '#444'}
          >
            <span>{allSelected ? 'Deselect all' : 'Select all'}</span>
          </div>

          {ALL_CATEGORIES.map((key) => {
            const children = tree?.[key]?.children || []
            const parentChecked = isParentSelected(selected, tree, key)
            const parentIndeterminate = isParentIndeterminate(selected, tree, key)
            const isExpanded = expanded.has(key)
            const parentLabel = tree?.[key]?.name || key.charAt(0).toUpperCase() + key.slice(1)

            return (
              <div key={key}>
                <div
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px' }}
                  onMouseEnter={(e) => e.currentTarget.style.background = '#161616'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                >
                  <div onClick={() => onChange(toggleParent(selected, tree, key))} style={{ cursor: 'pointer', display: 'flex' }}>
                    <Checkbox checked={parentChecked} indeterminate={parentIndeterminate} />
                  </div>
                  <div
                    onClick={() => children.length && toggleExpand(key)}
                    style={{
                      flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      cursor: children.length ? 'pointer' : 'default',
                    }}
                  >
                    <span style={{ fontSize: 13, color: parentChecked || parentIndeterminate ? '#fff' : '#888' }}>
                      {parentLabel}
                    </span>
                    {children.length > 0 && (
                      <span style={{
                        fontSize: 10, color: '#444',
                        transform: isExpanded ? 'rotate(180deg)' : 'none',
                        transition: 'transform .15s',
                      }}>▾</span>
                    )}
                  </div>
                </div>

                {isExpanded && children.map((child) => {
                  const val = selected[key]
                  const childChecked = val === 'all' || (Array.isArray(val) && val.includes(child.name))
                  return (
                    <div
                      key={child.id}
                      onClick={() => onChange(toggleChild(selected, tree, key, child.name))}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px 8px 39px', cursor: 'pointer' }}
                      onMouseEnter={(e) => e.currentTarget.style.background = '#161616'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                    >
                      <Checkbox checked={childChecked} />
                      <span style={{ fontSize: 12.5, color: childChecked ? '#fff' : '#666' }}>{child.name}</span>
                    </div>
                  )
                })}
              </div>
            )
          })}

          {treeFailed && (
            <div style={{ padding: '10px 14px', fontSize: 11, color: '#665', lineHeight: 1.4 }}>
              Subcategories unavailable right now — selecting a category scans it whole.
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function ScanControls({ onScan, loading, selected, setSelected }) {
  // AI-driven category discovery is the default per-session behavior — Claude picks which
  // categories are worth scanning today (see backend/ai.js pickTrendingCategories) instead
  // of requiring manual selection every time. The manual dropdown below is still there as
  // an explicit override.
  const [aiMode, setAiMode]       = useState(true)
  const [minROI, setMinROI]       = useState(30)
  const [minPrice, setMinPrice]   = useState(10)
  const [maxPrice, setMaxPrice]   = useState(70)
  const [maxBSR, setMaxBSR]       = useState(50000)
  const [maxSellers, setMaxSellers]                 = useState(5)
  const [excludeAmazonSeller, setExcludeAmazonSeller] = useState(true)
  const [minMonthlyUnits, setMinMonthlyUnits]       = useState(100)
  const [excludeHazmat, setExcludeHazmat]           = useState(true)
  const [minReviews, setMinReviews]                 = useState(10)
  const [minRating, setMinRating]                   = useState(4.0)
  const [excludePrivateLabel, setExcludePrivateLabel] = useState(true)
  const [tree, setTree] = useState(null)
  const [treeFailed, setTreeFailed] = useState(false)

  useEffect(() => {
    getCategoryTree()
      .then((res) => setTree(res.data.tree))
      .catch(() => setTreeFailed(true))
  }, [])

  const categoryCount = selectionCount(selected, tree)
  const canScan = !loading && (aiMode || categoryCount > 0)

  const handleScan = () => {
    if (!canScan) return
    const options = {
      minROI, minPrice, maxPrice, maxBSR, minGrade: 'D', pages: 2,
      maxSellers, excludeAmazonSeller, minMonthlyUnits, excludeHazmat,
      minReviews, minRating, excludePrivateLabel,
    }

    if (aiMode) {
      onScan({ mode: 'trending', options })
      return
    }

    const subcategories = expandToLeafNames(selected, tree)
    onScan({
      mode: 'categories',
      categories: Object.keys(selected),
      options: { ...options, ...(subcategories ? { subcategories } : {}) },
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
          <Toggle
            label="AI picks categories"
            checked={aiMode}
            onChange={setAiMode}
          />
          <p style={{ fontSize: 11, color: '#3a3a3a', marginTop: 10, lineHeight: 1.5 }}>
            {aiMode
              ? 'Claude picks the categories worth sourcing from today — no manual selection needed.'
              : 'Pick categories manually below.'}
          </p>
        </div>

        {!aiMode && (
          <div style={s.section}>
            <CategoryDropdown selected={selected} onChange={setSelected} tree={tree} treeFailed={treeFailed} />
          </div>
        )}

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

        <div style={s.section}>
          <NumInput
            label="Max BSR"
            value={maxBSR}
            onChange={setMaxBSR}
            min={100} step={1000}
          />
        </div>

        <div style={s.section}>
          <NumInput
            label="Max Sellers"
            value={maxSellers}
            onChange={setMaxSellers}
            min={1}
          />
        </div>

        <div style={s.section}>
          <NumInput
            label="Min Monthly Units"
            value={minMonthlyUnits}
            onChange={setMinMonthlyUnits}
            min={0} step={10}
          />
        </div>

        <div style={s.section}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <NumInput
              label="Min Reviews"
              value={minReviews}
              onChange={setMinReviews}
              min={0}
            />
            <NumInput
              label="Min Rating"
              value={minRating}
              onChange={setMinRating}
              min={0} max={5} step={0.1}
            />
          </div>
        </div>

        <div style={{ ...s.section, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Toggle
            label="Exclude if Amazon sells it"
            checked={excludeAmazonSeller}
            onChange={setExcludeAmazonSeller}
          />
          <Toggle
            label="Exclude Hazmat/Battery"
            checked={excludeHazmat}
            onChange={setExcludeHazmat}
          />
          <Toggle
            label="Exclude Private Label"
            checked={excludePrivateLabel}
            onChange={setExcludePrivateLabel}
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
              {aiMode ? 'Picking categories...' : 'Scanning'}
            </>
          ) : aiMode ? 'Scan Trending' : 'Scan Now'}
        </button>
        {!aiMode && categoryCount === 0 && (
          <p style={{ fontSize: 11, color: '#2a2a2a', textAlign: 'center', marginTop: 10 }}>
            Select at least one category
          </p>
        )}
      </div>
    </div>
  )
}
