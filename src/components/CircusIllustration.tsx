import { artisticAssets } from '../assets/artisticAssets'

/** Replace the registered asset without touching event or sales logic. */
export function CircusIllustration({ className = '' }: { className?: string }) {
  return <img className={`circus-illustration ${className}`} src={artisticAssets.circusTent} width={1080} height={1080} alt="" aria-hidden="true" />
}
