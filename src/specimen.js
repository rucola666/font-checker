// A4 specimen export.
// Builds a 4-page PDF with pdf-lib, drawing every glyph as vector outlines
// taken from fontkit (so variable-font axis settings are honoured), then
// previews the result with pdf.js (https://mozilla.github.io/pdf.js/).
// Libraries are loaded from jsDelivr on first use.

import { adaptText, caseMode, applyCase, fullySupported, LOWER, UPPER } from './adapt.js'

const PDFLIB_URL = 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm'
const FONTKIT_URL = 'https://cdn.jsdelivr.net/npm/fontkit@2.0.4/+esm'
const PDFJS_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs'
const PDFJS_WORKER_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs'
const LABEL_FONT_URL = 'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/spacegrotesk/SpaceGrotesk%5Bwght%5D.ttf'

// A4 in PostScript points
const W = 595.28
const H = 841.89
const M = 60                       // page margin
const CONTENT_TOP = H - M - 46     // below the running header
const CONTENT_BOTTOM = M + 42      // above the running footer
const MIN_TEXT_SIZE = 12           // nothing in the specimen goes below this

const PANGRAMS = [
  'The quick brown fox jumps over the lazy dog.',
  'Sphinx of black quartz, judge my vow.',
  'THE FIVE BOXING WIZARDS JUMP QUICKLY.',
  'Pack my box with five dozen liquor jugs.',
  'How vexingly quick daft zebras jump!',
]

const PARAGRAPHS = [
  'Type is the voice of written language. Every letter carries a decision about weight, rhythm and proportion, and together those decisions make a texture the reader feels before reading a single word.',
  'A good text face disappears into the reading. Counters stay open, spacing keeps an even colour across the line, and the letters work together so that words are recognised at a glance. Testing a font at real sizes, in real paragraphs, is the only way to see whether it holds together.',
  'Designing a typeface is a long conversation between the single glyph and the whole alphabet. A curve that looks right in isolation may feel heavy next to its neighbours; a detail that sparkles at display sizes may clog at text sizes. That is why designers print, look, adjust and print again. A specimen puts the font in front of the eye at several scales at once, from the single letter to the running paragraph, so that inconsistencies in weight, width and spacing become visible. Look for dark spots where letters collide, gaps where the rhythm breaks, and characters that seem to belong to another family. Then go back to the drawing and refine it.',
]

// While a specimen is being built, every text and rule drawn is also recorded
// here, so the same layout can be exported as an InDesign (IDML) document.
let REC = null
function makeRecorder() {
  const pages = []
  let paused = 0
  return {
    pages,
    newPage() { pages.push({ items: [] }) },
    add(item) { if (!paused && pages.length) pages[pages.length - 1].items.push(item) },
    pause() { paused++ },
    resume() { paused-- },
  }
}
function drawRule(page, o) {
  if (REC) REC.add({ type: 'line', x1: o.start.x, y1: o.start.y, x2: o.end.x, y2: o.end.y, thickness: o.thickness, grey: o.color.red > 0.2 })
  page.drawLine(o)
}

let libsPromise = null
function loadLibs() {
  if (!libsPromise) {
    libsPromise = Promise.all([
      import(/* @vite-ignore */ PDFLIB_URL),
      import(/* @vite-ignore */ FONTKIT_URL),
    ]).then(([pdfLib, fk]) => ({
      pdfLib,
      createFont: fk.create || (fk.default && fk.default.create),
    })).catch((err) => {
      libsPromise = null
      throw err
    })
  }
  return libsPromise
}

let pdfjsPromise = null
function loadPdfJs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import(/* @vite-ignore */ PDFJS_URL).then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL
      return pdfjs
    }).catch((err) => {
      pdfjsPromise = null
      throw err
    })
  }
  return pdfjsPromise
}

/* ---------- Faces: one interface for fontkit fonts and the Helvetica fallback ---------- */

class OutlineFace {
  constructor(font, tracking = 0, role = 'spec') {
    this.font = font
    this.role = role
    this.trackPM = tracking
    this.upm = font.unitsPerEm
    this.asc = font.ascent / this.upm
    this.desc = font.descent / this.upm   // negative
    this.track = (tracking / 1000) * this.upm   // letter spacing, font units per glyph
  }
  has(ch) { return this.font.hasGlyphForCodePoint(ch.codePointAt(0)) }
  width(text, size) {
    if (!text) return 0
    const run = this.font.layout(text)
    const n = run.glyphs.length
    return ((run.advanceWidth + this.track * Math.max(0, n - 1)) * size) / this.upm
  }
  lineHeight(size) { return (this.asc - this.desc) * size }
  glyphBox(ch) {
    const g = this.font.glyphForCodePoint(ch.codePointAt(0))
    const b = g.path.bbox
    return { minX: b.minX / this.upm, minY: b.minY / this.upm, maxX: b.maxX / this.upm, maxY: b.maxY / this.upm, adv: g.advanceWidth / this.upm }
  }
  // Draws text with its baseline at y. Returns the drawn width.
  draw(page, text, x, y, size, color) {
    if (!text) return 0
    const run = this.font.layout(text)
    let pen = 0
    let d = ''
    for (let i = 0; i < run.glyphs.length; i++) {
      const pos = run.positions[i]
      const glyph = run.glyphs[i]
      if (glyph.id !== 0 && glyph.path.commands.length) {
        d += glyph.path.scale(1, -1).translate(pen + pos.xOffset, -pos.yOffset).toSVG()
      }
      pen += pos.xAdvance + (i < run.glyphs.length - 1 ? this.track : 0)
    }
    if (d) page.drawSvgPath(d, { x, y, scale: size / this.upm, color })
    if (REC) REC.add({ type: 'text', role: this.role, text, x, y, size, grey: color.red > 0.2, tracking: this.trackPM })
    return (pen * size) / this.upm
  }
}

class StandardFace {
  constructor(pdfFont, role = 'label') { this.font = pdfFont; this.role = role; this.trackPM = 0 }
  clean(text) { return text.replace(/[^\x20-\x7e -ÿ–—’“”•…]/g, '?') }
  width(text, size) { return this.font.widthOfTextAtSize(this.clean(text), size) }
  draw(page, text, x, y, size, color) {
    const t = this.clean(text)
    page.drawText(t, { x, y, size, font: this.font, color })
    if (REC) REC.add({ type: 'text', role: this.role, text: t, x, y, size, grey: color.red > 0.2, tracking: 0 })
    return this.width(t, size)
  }
}

/* ---------- Layout helpers ---------- */

// Breaks a run of characters (no spaces) into lines that fit.
function wrapChars(face, text, size, maxWidth) {
  const lines = []
  let line = ''
  for (const c of text) {
    if (line && face.width(line + c, size) > maxWidth) { lines.push(line); line = c } else line += c
  }
  if (line) lines.push(line)
  return lines
}

function wrap(face, text, size, maxWidth) {
  const words = text.split(/\s+/).filter(Boolean)
  const lines = []
  let line = ''
  for (const word of words) {
    const test = line ? `${line} ${word}` : word
    if (!line || face.width(test, size) <= maxWidth) {
      line = test
    } else {
      lines.push(line)
      line = word
    }
  }
  if (line) lines.push(line)
  return lines
}

function fitSize(face, text, maxSize, maxWidth) {
  const w = face.width(text, maxSize)
  return w > maxWidth ? (maxSize * maxWidth) / w : maxSize
}

// Lays out a list of text blocks top-down inside the content area,
// shrinking all sizes together (never below MIN_TEXT_SIZE) until they fit.
function layoutFlow(face, blocks, top, bottom) {
  const width = W - 2 * M
  let k = 1
  let plan
  for (let attempt = 0; attempt < 40; attempt++) {
    plan = []
    let y = top
    const g = Math.max(0.6, k)          // spacing shrinks with the text, but less
    for (const b of blocks) {
      const size = Math.max(MIN_TEXT_SIZE, b.size * k)
      const leading = size * (b.leading || 1.2)
      if (b.columns) {
        const colW = (width - b.gutter) / 2
        const lines = wrap(face, b.text, size, colW)
        const half = Math.ceil(lines.length / 2)
        const cols = [lines.slice(0, half), lines.slice(half)]
        y -= (b.labelGap || 0) * g
        plan.push({ ...b, size, leading, y, cols, colW })
        y -= half * leading + (b.gapAfter || 0) * g
      } else {
        const lines = b.fit ? [b.text] : b.chars ? wrapChars(face, b.text, size, width) : wrap(face, b.text, size, width)
        const s = b.fit ? fitSize(face, b.text, size, width) : size
        const lead = b.fit ? s * (b.leading || 1.2) : leading
        y -= (b.labelGap || 0) * g
        plan.push({ ...b, size: s, leading: lead, y, lines })
        y -= lines.length * lead + (b.gapAfter || 0) * g
      }
    }
    if (y >= bottom) break
    k *= 0.97
  }
  return plan
}

function drawFlow(page, face, plan, labels, ink, grey) {
  for (const b of plan) {
    if (b.label) labels.draw(page, b.label, M, b.y + 6, 9, grey)
    // first baseline sits one ascent below the block top
    let y = b.y - face.asc * b.size
    if (REC) {
      REC.add({
        type: 'flow', role: face.role, style: b.style || 'Text', x: M, y, size: b.size, leading: b.leading,
        width: W - 2 * M, tracking: face.trackPM,
        lines: b.cols ? [...b.cols[0], ...b.cols[1]] : b.lines,
        wrapping: !(b.fit || b.chars), columns: b.cols ? 2 : 1, gutter: b.gutter || 0,
      })
      REC.pause()
    }
    if (b.cols) {
      b.cols.forEach((col, ci) => {
        let cy = y
        for (const line of col) {
          face.draw(page, line, M + ci * (b.colW + b.gutter), cy, b.size, ink)
          cy -= b.leading
        }
      })
    } else {
      for (const line of b.lines) {
        face.draw(page, line, M, y, b.size, ink)
        y -= b.leading
      }
    }
    if (REC) REC.resume()
  }
}

/* ---------- Build ---------- */

export async function buildSpecimen({ buffer, metadata, axisSettings, tracking = 0 }) {
  const { pdfLib, createFont } = await loadLibs()
  const { PDFDocument, StandardFonts, rgb } = pdfLib
  REC = makeRecorder()
  try {
  const ink = rgb(0, 0, 0)
  const grey = rgb(0.45, 0.48, 0.52)
  const rule = rgb(0.8, 0.83, 0.86)

  let font = createFont(new Uint8Array(buffer))
  if (font.fonts) font = font.fonts[0]                 // collections: first face
  const settings = axisSettings || {}
  if (font.variationAxes && Object.keys(font.variationAxes).length && Object.keys(settings).length) {
    try { font = font.getVariation(settings) } catch { /* fall back to default instance */ }
  }
  const face = new OutlineFace(font, tracking)        // specimen text, with letter spacing
  const plain = new OutlineFace(font, 0, 'glyph')     // single letters, no spacing

  // What the font contains drives every page.
  const has = (c) => face.has(c)
  const mode = caseMode(has)
  const adapt = (t) => adaptText(t, has, mode)
  const present = (chars) => [...chars].filter(has)
  const coverage = [
    ['Uppercase', present(UPPER)],
    ['Lowercase', present(LOWER)],
    ['Figures', present('0123456789')],
    ['Punctuation', present('.,:;!?\'"-–—()&@#%*/')],
  ].filter(([, chars]) => chars.length)

  const doc = await PDFDocument.create()
  const name = metadata.name || 'Untitled font'
  doc.setTitle(`${name} — A4 specimen`)
  if (metadata.author) doc.setAuthor(metadata.author)
  doc.setCreator('Font Checker')

  // Labels in Space Grotesk; Helvetica if it can't be fetched.
  let labels, labelsBold
  let labelFont = null    // { bytes, family, regular, bold } for the IDML export
  try {
    const res = await fetch(LABEL_FONT_URL)
    if (!res.ok) throw new Error('label font unavailable')
    const sgBytes = new Uint8Array(await res.arrayBuffer())
    const sg = createFont(sgBytes)
    labels = new OutlineFace(sg.getVariation({ wght: 400 }), 0, 'label')
    labelsBold = new OutlineFace(sg.getVariation({ wght: 600 }), 0, 'labelBold')
    labelFont = { bytes: sgBytes, file: 'SpaceGrotesk[wght].ttf', family: 'Space Grotesk', regular: 'Regular', bold: 'SemiBold' }
  } catch {
    labels = new StandardFace(await doc.embedFont(StandardFonts.Helvetica), 'label')
    labelsBold = new StandardFace(await doc.embedFont(StandardFonts.HelveticaBold), 'labelBold')
    labelFont = { bytes: null, family: 'Helvetica', regular: 'Regular', bold: 'Bold' }
  }

  const notes = []
  if (Object.keys(settings).length) notes.push(Object.entries(settings).map(([k, v]) => `${k} ${Math.round(v * 10) / 10}`).join(' · '))
  if (tracking) notes.push(`letter spacing ${tracking}`)
  const TOTAL = 4
  const contentW = W - 2 * M

  function newPage(n, title) {
    const page = doc.addPage([W, H])
    REC.newPage()
    const hy = H - M - 10
    labelsBold.draw(page, name, M, hy, 10, ink)
    const right = `${String(n).padStart(2, '0')}  ${title}`
    labels.draw(page, right, W - M - labels.width(right, 10), hy, 10, grey)
    drawRule(page, { start: { x: M, y: hy - 10 }, end: { x: W - M, y: hy - 10 }, thickness: 0.6, color: ink })
    const fy = M
    drawRule(page, { start: { x: M, y: fy + 16 }, end: { x: W - M, y: fy + 16 }, thickness: 0.4, color: rule })
    const left = ['A4 specimen', ...notes].join('  ·  ')
    labels.draw(page, left, M, fy, 9, grey)
    const pn = `${n} / ${TOTAL}`
    labels.draw(page, pn, W - M - labels.width(pn, 9), fy, 9, grey)
    return page
  }

  /* Page 1 — name, one giant letter, font info and what the font contains */
  {
    const page = newPage(1, 'Letter')
    const nameText = adapt(name) || name
    const nameSize = fitSize(face, nameText, 54, contentW)
    const nameBase = CONTENT_TOP - face.asc * nameSize
    face.draw(page, nameText, M, nameBase, nameSize, ink)

    // info block, built bottom-up so it hugs the footer
    const colW = (contentW - 32) / 2
    const keyW = 84
    const valSize = 11.5
    const lead = 16
    const info = [
      ['Designer', metadata.author],
      ['Manufacturer', metadata.manufacturer],
      ['License', metadata.license],
      ['Format', metadata.format],
    ].filter(([, v]) => v && String(v).trim())
      .map(([k, v]) => {
        let lines = wrap(labels, String(v).replace(/\s+/g, ' '), valSize, colW - keyW)
        if (lines.length > 4) { lines = lines.slice(0, 4); lines[3] = `${lines[3].replace(/\s*\S+$/, '')} …` }
        return [k, lines]
      })
    const glyphRows = []
    if (metadata.glyphCount) glyphRows.push(['Total', [`${metadata.glyphCount} glyphs`]])
    for (const [label, chars] of coverage) glyphRows.push([label, [String(chars.length)]])

    const colHeight = (rows) => 22 + rows.reduce((h, [, lines]) => h + lines.length * lead + 6, 0)
    const blockH = Math.max(info.length ? colHeight(info) : 0, colHeight(glyphRows))
    const infoTop = CONTENT_BOTTOM + blockH
    drawRule(page, { start: { x: M, y: infoTop + 14 }, end: { x: W - M, y: infoTop + 14 }, thickness: 0.4, color: rule })
    const drawCol = (x, title, rows) => {
      let y = infoTop - 10
      labelsBold.draw(page, title, x, y, 9.5, ink)
      y -= 22
      for (const [k, lines] of rows) {
        labels.draw(page, k, x, y, 9.5, grey)
        for (const line of lines) { labels.draw(page, line, x + keyW, y, valSize, ink); y -= lead }
        y -= 6
      }
    }
    if (info.length) drawCol(M, 'Font info', info)
    drawCol(info.length ? M + colW + 32 : M, 'Contains', glyphRows)

    const heroPool = mode === 'upper' ? 'AGRQ' : mode === 'lower' ? 'agre' : 'aAgR'
    const hero = present(heroPool)[0] || present(UPPER + LOWER + '0123456789')[0]
    if (hero) {
      const box = plain.glyphBox(hero)
      const areaTop = nameBase + face.desc * nameSize - 48
      const areaBottom = infoTop + 54
      const areaH = areaTop - areaBottom
      const bw = Math.max(box.maxX - box.minX, 0.01)
      const bh = Math.max(box.maxY - box.minY, 0.01)
      const s = Math.min(contentW / bw, areaH / bh) * 0.9
      const x = M + (contentW - bw * s) / 2 - box.minX * s
      const y = areaBottom + (areaH - bh * s) / 2 - box.minY * s
      plain.draw(page, hero, x, y, s, ink)
    }
  }

  /* Page 2 — single letters and the full character set (only what exists) */
  {
    const page = newPage(2, 'Characters')
    const pool = mode === 'upper' ? 'AGRQESKW&' : mode === 'lower' ? 'agreksyt&' : 'AagRQek&y'
    let letters = present(pool).slice(0, 3)
    if (letters.length < 3) letters = [...letters, ...present('0123456789&')].slice(0, 3)
    const cols = 3
    const cellW = contentW / cols
    let top = CONTENT_TOP
    if (letters.length) {
      const maxAdv = Math.max(...letters.map((c) => plain.glyphBox(c).adv), 0.3)
      const size = Math.min(96, (cellW * 0.72) / maxAdv)
      const rowH = plain.lineHeight(size) * 0.92 + 22
      letters.forEach((c, i) => {
        const base = top - plain.asc * size
        const adv = plain.glyphBox(c).adv * size
        plain.draw(page, c, M + i * cellW + (cellW - adv) / 2, base, size, ink)
        const code = `U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`
        labels.draw(page, code, M + i * cellW, top - rowH + 16, 9, grey)
      })
      top -= rowH + 14
      drawRule(page, { start: { x: M, y: top }, end: { x: W - M, y: top }, thickness: 0.4, color: rule })
      top -= 30
    }
    // character sets get extra letter spacing (+150/1000 em) and open line spacing
    const spaced = new OutlineFace(font, tracking + 150)
    const sizes = { Uppercase: 38, Lowercase: 38, Figures: 38, Punctuation: 30 }
    const blocks = coverage.map(([label, chars]) => ({
      text: chars.join(''), chars: true, size: sizes[label], leading: 1.6, style: label,
      gapAfter: 26, label, labelGap: 22,
    }))
    drawFlow(page, spaced, layoutFlow(spaced, blocks, top, CONTENT_BOTTOM + 16), labels, ink, grey)
  }

  /* Page 3 — words and pangrams */
  {
    const page = newPage(3, 'Words & Pangrams')
    const candidates = ['Rhythm', 'Hamburgefonstiv', 'Typeface', 'quixotic', 'Glyph', 'Specimen', 'Jazz', 'Kerning']
      .map((w) => applyCase(w, mode))
    let words = [...new Set(candidates)].filter((w) => fullySupported(w, has, mode)).slice(0, 3)
    if (!words.length) words = [adapt('Hamburgefonstiv')].filter(Boolean)
    const wordSizes = [80, 56, 44]
    const blocks = words.map((w, i) => ({ text: w, size: wordSizes[i], fit: true, style: 'Word', leading: 1.15, gapAfter: i === words.length - 1 ? 34 : 14 }))
    const pangrams = [...new Set(PANGRAMS.map(adapt))].filter(Boolean).slice(0, 4)
    const pSizes = [32, 26, 22, 18]
    pangrams.forEach((p, i) => blocks.push({
      text: p, size: pSizes[i], leading: 1.2, gapAfter: 22, label: 'pt', labelGap: 20, style: 'Pangram',
    }))
    const plan = layoutFlow(face, blocks, CONTENT_TOP, CONTENT_BOTTOM + 16)
    plan.forEach((b) => { if (b.label === 'pt') b.label = `${Math.round(b.size)} pt` })
    drawFlow(page, face, plan, labels, ink, grey)
  }

  /* Page 4 — paragraphs */
  {
    const page = newPage(4, 'Paragraphs')
    const blocks = [
      { text: adapt(PARAGRAPHS[0]), size: 22, leading: 1.35, gapAfter: 38, label: 'pt', labelGap: 20, style: 'Paragraph' },
      { text: adapt(PARAGRAPHS[1]), size: 16, leading: 1.45, gapAfter: 38, label: 'pt', labelGap: 20, style: 'Paragraph' },
      { text: adapt(PARAGRAPHS[2]), size: 13, leading: 1.5, gapAfter: 0, label: 'pt · two columns', labelGap: 20, columns: true, gutter: 28, style: 'Paragraph' },
    ].filter((b) => b.text)
    const plan = layoutFlow(face, blocks, CONTENT_TOP, CONTENT_BOTTOM + 16)
    plan.forEach((b) => { b.label = `${Math.round(b.size)} ${b.label}` })
    drawFlow(page, face, plan, labels, ink, grey)
  }

  const pdf = await doc.save()
  return { pdf, layout: { width: W, height: H, margin: M, pages: REC.pages }, labelFont }
  } finally {
    REC = null
  }
}

/* ---------- Preview with pdf.js ---------- */

export async function renderPdfPreview(bytes, container) {
  const pdfjs = await loadPdfJs()
  const pdf = await pdfjs.getDocument({ data: bytes.slice() }).promise
  container.innerHTML = ''
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const viewport = page.getViewport({ scale: 2 })
    const canvas = document.createElement('canvas')
    canvas.width = viewport.width
    canvas.height = viewport.height
    canvas.setAttribute('aria-label', `Specimen page ${i}`)
    container.appendChild(canvas)
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
  }
}
