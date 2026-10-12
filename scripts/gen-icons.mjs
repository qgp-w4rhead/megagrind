// Generates the PWA icon set in public/ — pure Node, no image dependencies.
// Pixel art: a clock-disc glyph (ring + hands) on the brand page color.
// Run: node scripts/gen-icons.mjs
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
mkdirSync(OUT, { recursive: true })

const BG = [0x11, 0x1b, 0x2c] // --color-page (dark)
const FG = [0xa9, 0xc6, 0xff] // --color-primary (dark)
const ACCENT = [0x8a, 0xee, 0xc0]

const crcTable = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
const crc32 = (buf) => {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function encodePng(w, h, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  const raw = Buffer.alloc(h * (w * 4 + 1))
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0 // filter: none
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function draw(size, { maskable = false, rounded = true } = {}) {
  const px = Buffer.alloc(size * size * 4)
  const set = (x, y, [r, g, b], a = 255) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return
    const i = (y * size + x) * 4
    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a
  }
  const radius = rounded ? size * 0.18 : 0
  const inCorner = (x, y) => {
    const c = [[radius, radius], [size - radius, radius], [radius, size - radius], [size - radius, size - radius]]
    return c.some(([cx, cy]) => (x < radius || x >= size - radius) && (y < radius || y >= size - radius)
      && Math.hypot(x - cx + 0.5, y - cy + 0.5) > radius)
  }
  const cx = size / 2, cy = size / 2
  const ringR = size * (maskable ? 0.30 : 0.34)
  const ringW = Math.max(2, size * 0.045)
  const handLen1 = ringR * 0.82, handLen2 = ringR * 0.55
  const handW = Math.max(2, size * 0.045)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (rounded && !maskable && inCorner(x, y)) { set(x, y, [0, 0, 0], 0); continue }
      set(x, y, BG)
      const d = Math.hypot(x - cx, y - cy)
      if (Math.abs(d - ringR) <= ringW) { set(x, y, FG); continue }
      // hour hand up, minute hand to ~4:20 position, accent center dot
      const dx = x - cx, dy = y - cy
      const onHand = (ang, len, wdt) => {
        const ux = Math.cos(ang), uy = Math.sin(ang)
        const t = dx * ux + dy * uy
        if (t < 0 || t > len) return false
        return Math.abs(dx * uy - dy * ux) <= wdt
      }
      if (onHand(-Math.PI / 2, handLen1, handW)) { set(x, y, FG); continue }
      if (onHand(Math.PI * 0.28, handLen2, handW * 0.85)) { set(x, y, FG); continue }
      if (d <= size * 0.03) set(x, y, ACCENT)
    }
  }
  return encodePng(size, size, px)
}

writeFileSync(join(OUT, 'icon-192.png'), draw(192))
writeFileSync(join(OUT, 'icon-512.png'), draw(512))
// Maskable: opaque background to all edges, glyph inside the safe zone.
writeFileSync(join(OUT, 'icon-maskable-512.png'), draw(512, { maskable: true, rounded: false }))
writeFileSync(join(OUT, 'apple-touch-icon.png'), draw(180, { rounded: false }))
console.log('icons written to public/')
