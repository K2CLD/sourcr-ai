import { useEffect, useRef, useState } from 'react'
import { estimateTokens, getTokens } from './api'

const TRENDING_COUNT = 4 // matches the backend's default AI pick count

// Keepa token estimate for the current scan target. Re-estimates 300ms after the category
// selection settles, refreshes every 30s while idle (tokens refill), and during a scan
// polls the live balance the backend captures from each Keepa response.
export default function useTokenEstimate({ aiMode, categories, scanning }) {
  const [estimate, setEstimate] = useState(null)
  const [failed, setFailed] = useState(false)
  const [liveTokens, setLiveTokens] = useState(null)
  const categoriesKey = [...categories].sort().join(',')
  const requestId = useRef(0)

  useEffect(() => {
    if (scanning) return
    const scope = aiMode ? { trendingCount: TRENDING_COUNT } : { categories: categoriesKey ? categoriesKey.split(',') : [] }

    const run = async () => {
      const id = ++requestId.current
      try {
        const res = await estimateTokens(scope)
        if (id !== requestId.current) return // a newer selection superseded this one
        setEstimate(res.data)
        setFailed(false)
      } catch {
        if (id === requestId.current) setFailed(true)
      }
    }

    const debounce = setTimeout(run, 300)
    const refresh = setInterval(run, 30000)
    return () => { clearTimeout(debounce); clearInterval(refresh) }
  }, [aiMode, categoriesKey, scanning])

  useEffect(() => {
    if (!scanning) { setLiveTokens(null); return }
    const poll = async () => {
      try { setLiveTokens((await getTokens()).data.tokensLeft) } catch { /* keep last value */ }
    }
    poll()
    const id = setInterval(poll, 2000)
    return () => clearInterval(id)
  }, [scanning])

  // Nothing selected in manual mode — no scan to price, and nothing to block.
  const empty = !aiMode && !categoriesKey
  return { estimate: empty ? null : estimate, failed, liveTokens, empty }
}
