import { useState } from 'react'
import StatusBar from './components/StatusBar'
import ScanControls from './components/ScanControls'
import LeadTable from './components/LeadTable'
import ApprovalPanel from './components/ApprovalPanel'
import { scanCategories, scanTrending, getScan } from './api'
import useTokenEstimate from './useTokenEstimate'

export default function App() {
  const [selected, setSelected]   = useState({ beauty: 'all', kitchen: 'all', health: 'all' })
  const [leads, setLeads]         = useState([])
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState(null)
  const [warning, setWarning]     = useState(null)
  const [picks, setPicks]         = useState(null) // AI category picks + reasoning, when applicable
  const [totalMatched, setTotalMatched] = useState(null) // full filtered count before the top-20 cut
  const [scanOptions, setScanOptions] = useState(null)
  const [approvalLeads, setApprovalLeads] = useState([]) // gated, but approval can be requested
  // AI-driven category discovery is the default per-session behavior — Claude picks which
  // categories are worth scanning today instead of requiring manual selection every time.
  const [aiMode, setAiMode]       = useState(true)
  const tokens = useTokenEstimate({ aiMode, categories: Object.keys(selected), scanning: loading })
  // Blocks only a confirmed shortfall — an unavailable estimate never blocks scanning,
  // and a scan too big for one bucket runs in batches instead.
  const tokenBlocked = !!tokens.estimate && !tokens.estimate.enough && !tokens.estimate.batched

  const handleScan = async ({ mode, categories, options }) => {
    setLoading(true)
    setError(null)
    setWarning(null)
    setPicks(null)
    setTotalMatched(null)
    setLeads([])
    setApprovalLeads([])
    setScanOptions(options)
    try {
      const res = mode === 'trending'
        ? await scanTrending(options)
        : await scanCategories(categories, options)
      setLeads(res.data.leads || [])
      setApprovalLeads(res.data.approvalRequired || [])
      setWarning(res.data.warning || null)
      setPicks(res.data.picks || null)
      setTotalMatched(res.data.totalMatched ?? null)
    } catch (e) {
      setError(e.response?.data?.error || e.message || 'Scan failed')
    } finally {
      setLoading(false)
    }
  }

  // Loads a previously saved scan from Supabase — served entirely from the
  // database, no Keepa/SP-API calls, so browsing old scans is free. Unlike a fresh
  // scan, history stores (and returns) the FULL filtered list, not just the top 20 —
  // "dig into everything that passed" — so there's no separate totalMatched here.
  const handleLoadScan = async (scanId) => {
    setLoading(true)
    setError(null)
    setWarning(null)
    setPicks(null)
    setTotalMatched(null)
    setLeads([])
    setApprovalLeads([]) // saved scans store sellable leads only
    try {
      const res = await getScan(scanId)
      setLeads(res.data.leads || [])
      setScanOptions(res.data.scan?.options || null)
      setWarning(res.data.scan?.warning || null)
      setPicks(res.data.scan?.options?.aiPicks || null)
    } catch (e) {
      setError(e.response?.data?.error || e.message || 'Failed to load saved scan')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100dvh', overflow: 'hidden', background: '#000' }}>
      <StatusBar onLoadScan={handleLoadScan} tokens={tokens} scanning={loading} />

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <ScanControls
          onScan={handleScan}
          loading={loading}
          aiMode={aiMode}
          setAiMode={setAiMode}
          tokenBlocked={tokenBlocked}
          selected={selected}
          setSelected={setSelected}
        />
        <main style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <ApprovalPanel leads={approvalLeads} />
          <LeadTable leads={leads} loading={loading} error={error} warning={warning} picks={picks} totalMatched={totalMatched} scanOptions={scanOptions} />
        </main>
      </div>
    </div>
  )
}
