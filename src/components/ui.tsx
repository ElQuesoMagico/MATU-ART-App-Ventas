import type { ReactNode } from 'react'
import { Icon } from './Icon'
export function PageHeading({ title, action }: { title: string; action?: ReactNode }) {
  return <div className="page-heading"><h1>{title}</h1>{action}</div>
}
export function SearchField({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return <label className="search-field"><Icon name="search" /><input type="search" value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} aria-label={placeholder} /></label>
}
export function EmptyState({ title, description }: { title: string; description: string }) {
  return <div className="empty-state"><Icon name="sparkle" size={32} /><h3>{title}</h3><p>{description}</p></div>
}
export function DemoNotice() { return <p className="demo-notice">Datos de ejemplo. Las ventas y el stock no se guardan.</p> }
