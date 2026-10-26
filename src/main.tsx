import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { CatalogProvider } from './hooks/CatalogProvider'
import { startOfflineCache } from './services/offlineStatus'
startOfflineCache()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <CatalogProvider><App /></CatalogProvider>
  </StrictMode>,
)
