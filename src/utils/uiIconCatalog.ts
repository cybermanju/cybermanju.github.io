// CyberManju OS — on-demand UI icon catalog and local image decoding.
// Role: load the full offline Solar catalog only during icon customization.
// Exports: ensureUiIconCatalog and readUiIconImage.
// Default app artwork and the small startup icon registry remain unchanged.
import { addCollection } from '@iconify/vue/offline'
let pending: Promise<string[]> | undefined
export function ensureUiIconCatalog(): Promise<string[]> {
  return pending ??= import('@iconify-json/solar/icons.json').then(({ default: collection }) => {
    addCollection(collection)
    return Object.keys(collection.icons).map(name => `${collection.prefix}:${name}`).sort()
  }).catch(error => { pending = undefined; throw error })
}

/** Decode local raster uploads only, keeping their proportions and transparency. */
export async function readUiIconImage(file: File): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'].includes(file.type)) {
    throw new Error('Choose a PNG, JPEG, WebP, GIF or AVIF image.')
  }
  if (file.size > 8 * 1024 * 1024) throw new Error('Choose an image smaller than 8 MB.')
  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 40_000_000) {
      throw new Error('This image is too large. Choose a smaller image.')
    }
    const ratio = Math.min(1, 192 / Math.max(image.naturalWidth, image.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Image conversion is unavailable on this device.')
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    const data = canvas.toDataURL('image/png')
    if (data.length > 200_000) throw new Error('This image is too detailed. Choose a simpler image.')
    return data
  } finally { URL.revokeObjectURL(url) }
}
