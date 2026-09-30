import { useEffect, useState } from 'react'
import { getHealth } from '../api'
import ScanHistory from './ScanHistory'

export default function StatusBar({ onLoadScan }) {
  const [ok, setOk] = useState(null)

  useEffect(() => {
    const check = async () => {
      try { await getHealth(); setOk(true) }
      catch { setOk(false) }
    }
    check()
    const id = setInterval(check, 15000)
    return () => clearInterval(id)
  }, [])

  return (
    <header style={{
      height: 64,
      borderBottom: '1px solid #1a1a1a',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 32px',
      flexShrink: 0,
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <span style={{
          fontSize: 20,
          fontWeight: 700,
          letterSpacing: '-0.03em',
          color: '#fff',
          lineHeight: 1,
          position: 'relative',
          display: 'inline-block',
          paddingBottom: 5,
        }}>
          SOURCR.AI
          {/* Green underline glow */}
          <span style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            width: '100%',
            height: 2,
            background: '#00e676',
            borderRadius: 1,
            boxShadow: '0 0 8px rgba(0,230,118,0.7), 0 0 20px rgba(0,230,118,0.3)',
          }} />
        </span>
        <span style={{
          fontSize: 10,
          fontWeight: 400,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: '#3a3a3a',
          lineHeight: 1,
        }}>
          AI-Powered Amazon Sourcing
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <ScanHistory onLoad={onLoadScan} />

        <span
          className={ok ? 'anim-pulse' : ''}
          style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: ok === null ? '#333' : ok ? '#00e676' : '#ff4444',
            display: 'block',
            flexShrink: 0,
            ...(ok ? { boxShadow: '0 0 6px rgba(0,230,118,0.6)' } : {}),
          }}
        />
        <span style={{ fontSize: 11, color: '#444', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          {ok === null ? 'Connecting' : ok ? 'Live' : 'Offline'}
        </span>
      </div>
    </header>
  )
}
