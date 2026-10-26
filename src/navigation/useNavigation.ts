import { useEffect, useState } from 'react'
import type { Page } from '../types'
const pages: Page[] = ['inicio', 'venta', 'inventario', 'historial', 'eventos', 'promociones', 'estadisticas']
function readPage(): Page { const hash = window.location.hash.slice(1); return pages.includes(hash as Page) ? hash as Page : 'inicio' }
export function useNavigation() {
  const [page, setPage] = useState<Page>(readPage)
  useEffect(() => {
    const update = () => { const next = readPage(); if (next !== page && !window.dispatchEvent(new CustomEvent('clown-before-navigation', { cancelable: true, detail: next }))) { window.history.replaceState(null, '', `#${page}`); return } setPage(next); document.getElementById('main')?.focus(); window.scrollTo(0, 0) }
    window.addEventListener('hashchange', update)
    return () => window.removeEventListener('hashchange', update)
  }, [page])
  const navigate = (next: Page) => { window.location.hash = next }
  return { page, navigate }
}
