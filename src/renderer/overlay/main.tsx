import { createRoot } from 'react-dom/client'
import CapsuleOverlay from './CapsuleOverlay'
import './overlay.css'

console.log('[overlay] main.tsx loaded, attempting to mount React')

try {
  const root = document.getElementById('root')
  if (!root) {
    console.error('[overlay] #root element not found')
  } else {
    console.log('[overlay] mounting React to #root')
    createRoot(root).render(<CapsuleOverlay />)
    console.log('[overlay] React mounted')
  }
} catch (err) {
  console.error('[overlay] mount error:', err)
}
