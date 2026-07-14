import { useState } from 'react'
import StatusBar from './components/StatusBar'
import ScanControls from './components/ScanControls'
import LeadTable from './components/LeadTable'
import { scanCategories } from './api'

export default function App() {
  const [selected, setSelected]   = useState(['beauty', 'kitchen', 'health'])
  const [leads, setLeads]         = useState([])
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState(null)

  const handleScan = async ({ categories, options }) => {
    setLoading(true)
    setError(null)
    setLeads([])
    try {
      const res = await scanCategories(categories, options)
      setLeads(res.data.leads || [])
    } catch (e) {
      setError(e.response?.data?.error || e.message || 'Scan failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100dvh', overflow: 'hidden', background: '#000' }}>
      <StatusBar />

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <ScanControls
          onScan={handleScan}
          loading={loading}
          selected={selected}
          setSelected={setSelected}
        />
        <main style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <LeadTable leads={leads} loading={loading} error={error} />
        </main>
      </div>
    </div>
  )
}
