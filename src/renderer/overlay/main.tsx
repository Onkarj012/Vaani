import { createRoot } from 'react-dom/client'
import CapsuleOverlay from './CapsuleOverlay'
import './overlay.css'

try {
  const root = document.getElementById('root')
  if (!root) {
    console.error('[overlay] #root element not found')
  } else {
    createRoot(root).render(<CapsuleOverlay />)
  }
} catch (err) {
  console.error('[overlay] mount error:', err)
}
