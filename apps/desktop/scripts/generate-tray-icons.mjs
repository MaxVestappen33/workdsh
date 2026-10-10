/** Generate native tray bitmaps from the canonical application icon. */

import { writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const buildRoot = join(packageRoot, 'build')
const sourcePath = join(buildRoot, 'app-icon.png')

/**
 * Native pixel sizes and treatments for the tray bitmap set.
 * macOS template images must collapse to a single colour, so they are derived
 * from the artwork's dark mass; every other platform keeps the colour icon.
 */
const variants = [
  ['tray-iconTemplate.png', 'monochrome', 16],
  ['tray-iconTemplate@2x.png', 'monochrome', 32],
  ['tray-icon-blue.png', 'colour', 16],
  ['tray-icon-blue@1.25x.png', 'colour', 20],
  ['tray-icon-blue@1.5x.png', 'colour', 24],
  ['tray-icon-blue@2x.png', 'colour', 32],
]

/**
 * Derive a single-colour mark from the artwork's dark mass.
 * Flattening onto white first keeps the transparent margin out of the mask, and
 * the luminance inversion leaves the shaded interior as the recognizable shape.
 * @param {number} size - square output size in native pixels.
 * @returns {Promise<Buffer>} Encoded PNG holding black pixels with luminance alpha.
 */
async function renderMonochrome(size) {
  const { data } = await sharp(sourcePath)
    .resize(size, size, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .flatten({ background: '#FFFFFF' })
    .removeAlpha()
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const rgba = Buffer.alloc(size * size * 4)
  for (let index = 0; index < size * size; index += 1) {
    rgba[index * 4 + 3] = Math.max(0, Math.min(255, Math.round((255 - data[index]) * 1.5)))
  }
  return sharp(rgba, { raw: { width: size, height: size, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toBuffer()
}

/**
 * Render the shared artwork at one tray size, preserving transparency.
 * @param {number} size - square output size in native pixels.
 * @returns {Promise<Buffer>} Encoded PNG.
 */
async function renderColour(size) {
  return sharp(sourcePath)
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toBuffer()
}

await Promise.all(variants.map(async ([filename, treatment, size]) => {
  const png = treatment === 'monochrome' ? await renderMonochrome(size) : await renderColour(size)
  await writeFile(join(buildRoot, filename), png)
}))
