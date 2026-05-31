import { Routes, Route, Navigate } from 'react-router-dom'
import { ColorModeProvider } from './context/color-mode'
import AppLayout from './components/AppLayout'
import Dashboard from './pages/Dashboard'
import History from './pages/History'
import Snippets from './pages/Snippets'
import Dictionary from './pages/Dictionary'
import Insights from './pages/Insights'

function App() {
  return (
    <ColorModeProvider>
      <Routes>
        <Route path="/" element={<Navigate to="/app" replace />} />
        <Route path="/app" element={<AppLayout />}>
          <Route index element={<Dashboard />} />
          <Route path="history" element={<History />} />
          <Route path="snippets" element={<Snippets />} />
          <Route path="dictionary" element={<Dictionary />} />
          <Route path="insights" element={<Insights />} />
        </Route>
        <Route path="*" element={<Navigate to="/app" replace />} />
      </Routes>
    </ColorModeProvider>
  )
}

export default App
