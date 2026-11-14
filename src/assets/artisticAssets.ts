import clownIcon from './branding/clown-icon.png'
import brandLogo from './branding/matu-art-official.png'
import circusTent from './illustrations/circus-tent-artist.svg?no-inline'
import productSamples from './placeholders/illustrations/product-samples.svg?no-inline'

/** URLs for active external artwork. Keep IDs and manifest.json in sync. */
export const artisticAssets = {
  circusTent, // ILU-001: temporary use of the artist’s ORN-003 resource.
  bunting: circusTent, // ORN-003: same file, independent semantic role.
  productSamples,
  clownIcon,
  brandLogo,
  brandFavicon: brandLogo,
} as const
