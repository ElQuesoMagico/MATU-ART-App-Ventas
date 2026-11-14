import { artisticAssets } from '../assets/artisticAssets'
type OrnamentKind = 'star' | 'starburst' | 'rosette' | 'divider' | 'bunting'

/** Ornamentos de marca, siempre decorativos y fuera del árbol accesible. */
export function Ornament({ kind = 'star', className = '', size = 24 }: { kind?: OrnamentKind; className?: string; size?: number }) {
  if (kind === 'rosette' || kind === 'starburst') return <span className={`ornament clown-icon ${className}`} style={{ width: size, height: size }} aria-hidden="true"><img src={artisticAssets.clownIcon} alt="" /></span>
  if (kind === 'bunting') return <img className={`ornament artist-tent-ornament ${className}`} src={artisticAssets.bunting} width={1080} height={1080} alt="" aria-hidden="true" />
  const wide = kind === 'divider'
  return <svg className={`ornament ${className}`} width={wide ? undefined : size} height={wide ? undefined : size} viewBox={wide ? '0 0 240 36' : '0 0 64 64'} fill="none" aria-hidden="true" focusable="false">
    {kind === 'star' && <path d="M32 3Q35 27 61 32 36 35 32 61 28 36 3 32 28 28 32 3Z" fill="currentColor" />}
    {kind === 'divider' && <><path d="M4 18h87m58 0h87M14 22h66m80 0h66" stroke="currentColor" strokeWidth="1" /><path d="m120 5 4 9 10 4-10 4-4 9-4-9-10-4 10-4Z" fill="currentColor" /><circle cx="97" cy="18" r="2" fill="currentColor" /><circle cx="143" cy="18" r="2" fill="currentColor" /></>}
  </svg>
}
