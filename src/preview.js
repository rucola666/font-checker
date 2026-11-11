const STYLE_ID = 'fontchecker-fontface'
let currentBlobUrl = null

export function loadPreviewFont(buffer, filename) {
  const existing = document.getElementById(STYLE_ID)
  if (existing) existing.remove()

  if (currentBlobUrl) {
    URL.revokeObjectURL(currentBlobUrl)
    currentBlobUrl = null
  }

  const blob = new Blob([buffer], { type: 'application/octet-stream' })
  const url = URL.createObjectURL(blob)
  currentBlobUrl = url

  const ext = filename.toLowerCase().split('.').pop()
  const formatHint = ext === 'ttf' ? 'truetype' : 'opentype'

  const style = document.createElement('style')
  style.id = STYLE_ID
  const fontFamily = `fc-preview-${Date.now()}`
  style.textContent = `
    @font-face {
      font-family: "${fontFamily}";
      src: url("${url}") format("${formatHint}");
      font-display: block;
    }
  `
  document.head.appendChild(style)
  return fontFamily
}

export function cleanupPreviewFont() {
  const style = document.getElementById(STYLE_ID)
  if (style) style.remove()
  if (currentBlobUrl) {
    URL.revokeObjectURL(currentBlobUrl)
    currentBlobUrl = null
  }
}
