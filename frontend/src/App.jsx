import { useState } from 'react'
import StatusBar from './components/StatusBar'
import ScanControls from './components/ScanControls'
import LeadTable from './components/LeadTable'
import { scanCategories, getScan } from './api'

export default function App() {
  const [selected, setSelected]   = useState({ beauty: 'all', kitchen: 'all', health: 'all' })
  const [leads, setLeads]         = useState([])
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState(null)
  const [warning, setWarning]     = useState(null)
  const [scanOptions, setScanOptions] = useState(null)

  const handleScan = async ({ categories, options }) => {
    setLoading(true)
    setError(null)
    setWarning(null)
    setLeads([])
    setScanOptions(options)
    try {
      const res = await scanCategories(categories, options)
      setLeads(res.data.leads || [])
      setWarning(res.data.warning || null)
    } catch (e) {
      setError(e.response?.data?.error || e.message || 'Scan failed')
    } finally {
      setLoading(false)
    }
  }

  // Loads a previously saved scan from Supabase — served entirely from the
  // database, no Keepa/SP-API calls, so browsing old scans is free.
  const handleLoadScan = async (scanId) => {
    setLoading(true)
    setError(null)
    setWarning(null)
    setLeads([])
    try {
      const res = await getScan(scanId)
      setLeads(res.data.leads || [])
      setScanOptions(res.data.scan?.options || null)
      setWarning(res.data.scan?.warning || null)
    } catch (e) {
      setError(e.response?.data?.error || e.message || 'Failed to load saved scan')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100dvh', overflow: 'hidden', background: '#000' }}>
      <StatusBar onLoadScan={handleLoadScan} />

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <ScanControls
          onScan={handleScan}
          loading={loading}
          selected={selected}
          setSelected={setSelected}
        />
        <main style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <LeadTable leads={leads} loading={loading} error={error} warning={warning} scanOptions={scanOptions} />
        </main>
      </div>
    </div>
  )
}
