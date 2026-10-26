import clownIcon from './branding/clown-icon.png'
import brandLogo from './branding/matu-art-official.png'
import circusTent from './placeholders/illustrations/circus-tent.svg?no-inline'
import productSamples from './placeholders/illustrations/product-samples.svg?no-inline'

/** URLs for active external artwork. Keep IDs and manifest.json in sync. */
export const artisticAssets = {
  circusTent: `${circusTent}#circus-tent`,
  productSamples,
  clownIcon,
  brandLogo,
  brandFavicon: brandLogo,
} as const
