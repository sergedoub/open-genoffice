import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PNG } from 'pngjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MASTER_PATH = join(ROOT, 'assets/open-genoffice-icon-1024.png')
const masterBytes = readFileSync(MASTER_PATH)
const master = PNG.sync.read(masterBytes)

if (master.width !== 1024 || master.height !== 1024) {
  throw new Error('Open GenOffice icon master must be a 1024x1024 PNG')
}

function resizedPng(size) {
  if (size === 1024) return masterBytes

  const output = new PNG({ width: size, height: size })
  const scale = master.width / size

  // Area-average the premultiplied RGBA pixels so transparent outer corners
  // remain transparent and the approved artwork is only resized, not redrawn.
  for (let y = 0; y < size; y += 1) {
    const sourceTop = y * scale
    const sourceBottom = (y + 1) * scale
    const minY = Math.floor(sourceTop)
    const maxY = Math.ceil(sourceBottom)
    for (let x = 0; x < size; x += 1) {
      const sourceLeft = x * scale
      const sourceRight = (x + 1) * scale
      const minX = Math.floor(sourceLeft)
      const maxX = Math.ceil(sourceRight)
      let alphaWeight = 0
      let red = 0
      let green = 0
      let blue = 0
      let area = 0

      for (let sourceY = minY; sourceY < maxY; sourceY += 1) {
        if (sourceY < 0 || sourceY >= master.height) continue
        const height = Math.min(sourceBottom, sourceY + 1) - Math.max(sourceTop, sourceY)
        for (let sourceX = minX; sourceX < maxX; sourceX += 1) {
          if (sourceX < 0 || sourceX >= master.width) continue
          const width = Math.min(sourceRight, sourceX + 1) - Math.max(sourceLeft, sourceX)
          const weight = width * height
          const sourceOffset = (sourceY * master.width + sourceX) * 4
          const alpha = master.data[sourceOffset + 3] / 255
          const premultipliedWeight = weight * alpha
          red += master.data[sourceOffset] * premultipliedWeight
          green += master.data[sourceOffset + 1] * premultipliedWeight
          blue += master.data[sourceOffset + 2] * premultipliedWeight
          alphaWeight += premultipliedWeight
          area += weight
        }
      }

      const targetOffset = (y * size + x) * 4
      output.data[targetOffset] = alphaWeight ? Math.round(red / alphaWeight) : 0
      output.data[targetOffset + 1] = alphaWeight ? Math.round(green / alphaWeight) : 0
      output.data[targetOffset + 2] = alphaWeight ? Math.round(blue / alphaWeight) : 0
      output.data[targetOffset + 3] = area ? Math.round((alphaWeight / area) * 255) : 0
    }
  }

  return PNG.sync.write(output)
}

function writePng(path, size) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, resizedPng(size))
}

function createIco(path, sizes) {
  const images = sizes.map((size) => ({ size, bytes: resizedPng(size) }))
  const headerSize = 6 + images.length * 16
  const header = Buffer.alloc(headerSize)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)
  let offset = headerSize
  images.forEach(({ size, bytes }, index) => {
    const entry = 6 + index * 16
    header[entry] = size === 256 ? 0 : size
    header[entry + 1] = size === 256 ? 0 : size
    header.writeUInt16LE(1, entry + 4)
    header.writeUInt16LE(32, entry + 6)
    header.writeUInt32LE(bytes.length, entry + 8)
    header.writeUInt32LE(offset, entry + 12)
    offset += bytes.length
  })
  writeFileSync(path, Buffer.concat([header, ...images.map(({ bytes }) => bytes)]))
}

function createIcns(path) {
  const images = [
    ['icp4', 16],
    ['icp5', 32],
    ['icp6', 64],
    ['ic07', 128],
    ['ic08', 256],
    ['ic09', 512],
    ['ic10', 1024],
  ].map(([type, size]) => ({ type, bytes: resizedPng(size) }))
  const body = images.map(({ type, bytes }) => {
    const chunk = Buffer.alloc(8 + bytes.length)
    chunk.write(type, 0, 4, 'ascii')
    chunk.writeUInt32BE(chunk.length, 4)
    bytes.copy(chunk, 8)
    return chunk
  })
  const total = 8 + body.reduce((sum, chunk) => sum + chunk.length, 0)
  const header = Buffer.alloc(8)
  header.write('icns', 0, 4, 'ascii')
  header.writeUInt32BE(total, 4)
  writeFileSync(path, Buffer.concat([header, ...body]))
}

const primaryPng = join(ROOT, 'apps/shell/build/icon.png')
writePng(primaryPng, 1024)

for (const relative of [
  'apps/shell/src/renderer/src/assets/app-icon.png',
  'apps/docs/build/icon.png',
  'apps/docs/src/renderer/assets/app-icon.png',
  'apps/sheets/src/renderer/assets/app-icon.png',
  'apps/slides/src/renderer/assets/app-icon.png',
]) {
  cpSync(primaryPng, join(ROOT, relative))
}

for (const buildDir of ['apps/shell/build', 'apps/docs/build', 'apps/slides/build']) {
  const absoluteBuildDir = join(ROOT, buildDir)
  mkdirSync(absoluteBuildDir, { recursive: true })
  const buildPng = join(absoluteBuildDir, 'icon.png')
  if (buildPng !== primaryPng) cpSync(primaryPng, buildPng)
  createIcns(join(absoluteBuildDir, 'icon.icns'))
  createIco(join(absoluteBuildDir, 'icon.ico'), [16, 24, 32, 48, 64, 128, 256])
}

console.log('generated Open GenOffice PNG, ICNS, and ICO assets from the approved master')
