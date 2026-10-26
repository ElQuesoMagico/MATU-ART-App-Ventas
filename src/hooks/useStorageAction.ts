import { useRef, useState } from 'react'
import { useCatalog } from './useCatalog'
import { storageError } from '../services/catalogValidation'
export function useStorageAction() {
  const { reload } = useCatalog()
  const lock = useRef(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  async function run<T>(operation: () => Promise<T>, onComplete?: (result: T) => void) {
    if (lock.current) return
    lock.current = true; setSaving(true); setError('')
    try {
      const result = await operation()
      // Un aviso entre pestañas no debe convertir un commit exitoso en un error.
      try { if (typeof BroadcastChannel !== 'undefined') { const channel = new BroadcastChannel('clown-ufo-catalog'); channel.postMessage('changed'); channel.close() } } catch { /* Refresco por foco disponible. */ }
      await reload()
      onComplete?.(result)
    } catch (error) { setError(storageError(error)) }
    finally { lock.current = false; setSaving(false) }
  }
  return { saving, error, setError, run }
}
