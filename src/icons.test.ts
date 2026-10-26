import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const asset = (name: string) => readFileSync(new URL(`../app/${name}`, import.meta.url))
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const PNG_RGBA = 6

function icoImages(ico: Buffer) {
  expect(ico.readUInt16LE(0)).toBe(0)
  expect(ico.readUInt16LE(2)).toBe(1)
  return Array.from({ length: ico.readUInt16LE(4) }, (_, index) => {
    const entry = 6 + index * 16
    const size = ico.readUInt32LE(entry + 8)
    const offset = ico.readUInt32LE(entry + 12)
    return ico.subarray(offset, offset + size)
  })
}

describe('browser and home screen icons', () => {
  it('embeds only RGBA PNGs in favicon.ico, the only format the Next.js build accepts', () => {
    const images = icoImages(asset('favicon.ico'))
    expect(images.length).toBeGreaterThan(0)
    for (const image of images) {
      expect(image.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true)
      expect(image[25], 'PNG colour type (6 = RGBA)').toBe(PNG_RGBA)
    }
  })

  it('keeps a 180x180 PNG for the iOS home screen', () => {
    const png = asset('apple-icon.png')
    expect(png.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true)
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([180, 180])
  })

  it('gives the SVG icon an accessible title', () => {
    expect(asset('icon.svg').toString()).toMatch(/<title>\s*Localfolio\s*<\/title>/)
  })
})
