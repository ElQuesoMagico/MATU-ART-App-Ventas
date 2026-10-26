import { artisticAssets } from '../assets/artisticAssets'

/** Replace the registered asset without touching event or sales logic. */
export function CircusIllustration({ className = '' }: { className?: string }) {
  return <svg className={`circus-illustration ${className}`} viewBox="0 0 320 300" fill="none" aria-hidden="true" focusable="false"><use href={artisticAssets.circusTent} /></svg>
}
