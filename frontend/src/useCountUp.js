import { useEffect, useState } from 'react'

// Animates from 0 to `value` over `duration`ms using an eased requestAnimationFrame
// loop. Used on headline numbers (profit, ROI, score) so results populating after a
// scan feel considered rather than just appearing.
export default function useCountUp(value, duration = 600) {
  const [display, setDisplay] = useState(0)

  useEffect(() => {
    const target = (value == null || Number.isNaN(value)) ? 0 : value
    let frame
    const start = performance.now()
    const from = 0
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - t, 3) // ease-out cubic
      setDisplay(from + (target - from) * eased)
      if (t < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [value, duration])

  return display
}
