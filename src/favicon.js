// Favicon: the "C" of Space Grotesk, black on cold white.
// Drawn on a canvas once the web font has loaded; /favicon.svg is the fallback.
export async function setFavicon() {
  try { await document.fonts.load('700 56px "Space Grotesk"') } catch { /* fallback font */ }
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#f3f6f9'
  ctx.beginPath()
  if (ctx.roundRect) ctx.roundRect(0, 0, size, size, 14)
  else ctx.rect(0, 0, size, size)
  ctx.fill()
  ctx.fillStyle = '#000'
  ctx.font = '700 58px "Space Grotesk", system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  const m = ctx.measureText('C')
  const glyphH = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent
  ctx.fillText('C', size / 2 + (m.actualBoundingBoxLeft - m.actualBoundingBoxRight) / 2 + 0.5,
    size / 2 + glyphH / 2 - m.actualBoundingBoxDescent)
  let link = document.querySelector('link[rel="icon"]')
  if (!link) {
    link = document.createElement('link')
    link.rel = 'icon'
    document.head.appendChild(link)
  }
  link.type = 'image/png'
  link.href = canvas.toDataURL('image/png')
}
