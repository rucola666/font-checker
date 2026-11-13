import { parseFont } from './font-parser.js'
import {
  hide, show, setStatus,
  renderFontInfo, countMissingInfo, renderCoverage,
  renderFvarSliders, getFvarSettings,
  styleText, renderCharacters,
} from './renderer.js'
import { loadPreviewFont } from './preview.js'
import { adaptText } from './adapt.js'
import { rewriteFontNames, readFontNames } from './font-names.js'
import { buildIdml } from './idml.js'
import { setFavicon } from './favicon.js'
import { makeZip } from './zip.js'
import { buildSpecimen, renderPdfPreview, openFont } from './specimen.js'
import { buildSources } from './ufo.js'

const $ = (id) => document.getElementById(id)

setFavicon()

const dropZone = $('drop-zone')
const statusEl = $('status')
const workspace = $('workspace')
const loadBtn = $('load-btn')
const exportBtn = $('export-btn')
const idmlBtn = $('idml-btn')
const ufoBtn = $('ufo-btn')

const fontSize = $('font-size')
const lineSpacing = $('line-spacing')
const letterSpacing = $('letter-spacing')
const fvarPanel = $('fvar-panel')
const fvarControls = $('fvar-controls')

const editFamily = $('edit-family')
const editStyle = $('edit-style')
const editFullname = $('edit-fullname')
const editAuthor = $('edit-author')
const editLicense = $('edit-license')
const infoTable = $('info-table')
const infoBadge = $('info-badge')
const coverageBody = $('coverage-body')
const coverageBadge = $('coverage-badge')

const charsEl = $('chars')
const pangramText = $('pangram-text')
const previewInput = $('preview-input')
const previewText = $('preview-text')

const pdfModal = $('pdf-modal')
const pdfStatus = $('pdf-status')
const pdfPages = $('pdf-pages')
const pdfDownload = $('pdf-download')
const pdfClose = $('pdf-close')

const PANGRAM = 'The quick brown fox jumps over the lazy dog'
const PANGRAM_FIGURES = 'The quick brown fox jumps over the lazy dog at 7:45'

let state = null   // { file, buffer, ext, parsed, family, coverageMap }
let pdfBytes = null
let fullNameTouched = false   // font name follows family + style until edited

/* ---------- Loading ---------- */

function openFilePicker() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.otf,.ttf'
  input.addEventListener('change', () => { if (input.files[0]) handleFile(input.files[0]) })
  input.click()
}
dropZone.addEventListener('click', openFilePicker)
loadBtn.addEventListener('click', openFilePicker)

let dragDepth = 0
document.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; document.body.classList.add('dragover') })
document.addEventListener('dragover', (e) => e.preventDefault())
document.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragover') } })
document.addEventListener('drop', (e) => {
  e.preventDefault()
  dragDepth = 0
  document.body.classList.remove('dragover')
  const file = e.dataTransfer.files[0]
  if (file) handleFile(file)
})

function buildCoverageMap(coverage) {
  const map = {}
  for (const key of ['lower', 'upper', 'numbers', 'punctuation']) Object.assign(map, coverage[key])
  return map
}

async function handleFile(file) {
  const ext = file.name.split('.').pop().toLowerCase()
  if (ext !== 'otf' && ext !== 'ttf') {
    setStatus(statusEl, 'Unsupported format. Please use .otf or .ttf files.')
    return
  }
  setStatus(statusEl, 'Reading font…')
  try {
    const buffer = await file.arrayBuffer()
    const parsed = parseFont(buffer, file.name)
    const family = loadPreviewFont(buffer, file.name)
    state = { file, buffer, ext, parsed, family, coverageMap: buildCoverageMap(parsed.coverage) }

    hide(statusEl)
    hide(dropZone)
    show(workspace)
    show(loadBtn)
    show(exportBtn)
    show(idmlBtn)
    show(ufoBtn)

    // info
    const m = parsed.metadata
    const names = readFontNames(buffer)
    editFamily.value = names.family || m.name || ''
    editStyle.value = names.style || ''
    editFullname.value = names.fullName || ''
    fullNameTouched = !!names.fullName && names.fullName !== autoFullName()
    editAuthor.value = names.author || m.author || ''
    editLicense.value = names.license || m.license || ''
    renderFontInfo(infoTable, m)
    updateInfoBadge()

    // coverage
    const cov = renderCoverage(coverageBody, parsed.coverage)
    coverageBadge.textContent = cov.missing ? `${cov.missing} missing` : 'complete'
    coverageBadge.classList.toggle('is-ok', !cov.missing)

    // axes
    fvarControls.innerHTML = ''
    if (parsed.axes && parsed.axes.length) {
      renderFvarSliders(fvarControls, parsed.axes, updatePreview)
      show(fvarPanel)
    } else {
      hide(fvarPanel)
    }

    updatePreview()
  } catch (err) {
    console.error(err)
    setStatus(statusEl, 'Not a valid font file.')
  }
}

/* ---------- Info editing ---------- */

function autoFullName() {
  return `${editFamily.value.trim()} ${editStyle.value.trim()}`.trim()
}

function currentMetadata() {
  return {
    ...state.parsed.metadata,
    name: editFamily.value.trim(),
    style: editStyle.value.trim(),
    fullName: editFullname.value.trim() || autoFullName(),
    author: editAuthor.value.trim(),
    license: editLicense.value.trim(),
  }
}

function updateInfoBadge() {
  const m = currentMetadata()
  const missing = countMissingInfo([m.name, m.style, m.fullName, m.author, m.license, m.manufacturer, m.format, m.glyphCount])
  infoBadge.textContent = missing ? `${missing} missing` : 'complete'
  infoBadge.classList.toggle('is-ok', !missing)
}

for (const input of [editFamily, editStyle]) {
  input.addEventListener('input', () => { if (!fullNameTouched) editFullname.value = autoFullName() })
}
editFullname.addEventListener('input', () => { fullNameTouched = editFullname.value.trim() !== '' })
for (const input of [editFamily, editStyle, editFullname, editAuthor, editLicense]) input.addEventListener('input', updateInfoBadge)

function renamedFont() {
  const m = currentMetadata()
  return rewriteFontNames(state.buffer, {
    family: m.name, style: m.style, fullName: m.fullName, author: m.author, license: m.license,
  })
}

/* ---------- Preview ---------- */

function fvarCss() {
  const s = getFvarSettings()
  return Object.keys(s).map((k) => `"${k}" ${s[k]}`).join(', ')
}

function updatePreview() {
  if (!state) return
  const style = {
    family: state.family,
    size: parseInt(fontSize.value, 10),
    lineHeight: parseFloat(lineSpacing.value),
    tracking: parseInt(letterSpacing.value, 10),
    fvar: fvarCss(),
  }
  $('font-size-value').textContent = style.size
  $('line-spacing-value').textContent = style.lineHeight
  $('letter-spacing-value').textContent = style.tracking

  const has = (c) => state.coverageMap[c] !== false   // characters we don't check are assumed present
  renderCharacters(charsEl, state.parsed.coverage, style)
  const hasFigures = [...'0123456789'].every((c) => state.coverageMap[c])
  pangramText.textContent = adaptText(hasFigures ? PANGRAM_FIGURES : PANGRAM, has)
  styleText(pangramText, style)
  previewText.textContent = previewInput.value
  styleText(previewText, style)
}

for (const input of [fontSize, lineSpacing, letterSpacing, previewInput]) input.addEventListener('input', updatePreview)

/* ---------- Export: specimen PDF + renamed font, zipped as a folder ---------- */

function safeName(s) {
  return (s || 'font').replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim() || 'font'
}

function closeModal() {
  hide(pdfModal)
  pdfPages.innerHTML = ''
  document.body.style.overflow = ''
}

exportBtn.addEventListener('click', async () => {
  if (!state) return
  pdfBytes = null
  pdfDownload.disabled = true
  pdfPages.innerHTML = ''
  pdfStatus.textContent = 'Building specimen…'
  show(pdfModal)
  document.body.style.overflow = 'hidden'
  try {
    const result = await buildSpecimen({
      buffer: state.buffer,
      metadata: currentMetadata(),
      axisSettings: getFvarSettings(),
      tracking: parseInt(letterSpacing.value, 10),
    })
    pdfBytes = result.pdf
    pdfDownload.disabled = false
    pdfStatus.textContent = 'Rendering preview…'
    try {
      await renderPdfPreview(pdfBytes, pdfPages)
      pdfStatus.textContent = 'A4 specimen · 4 pages — the download also contains the font with your edited info'
    } catch (err) {
      console.error(err)
      pdfStatus.textContent = 'Specimen ready — preview unavailable (pdf.js could not load), you can still download it.'
    }
  } catch (err) {
    console.error(err)
    pdfStatus.textContent = 'Could not build the specimen. Check your internet connection and try again.'
  }
})

pdfDownload.addEventListener('click', () => {
  if (!pdfBytes) return
  const m = currentMetadata()
  const base = safeName(m.name || state.file.name.replace(/\.[^.]+$/, ''))
  let fontBytes
  try {
    fontBytes = renamedFont()
  } catch (err) {
    console.error(err)
    fontBytes = new Uint8Array(state.buffer)
    pdfStatus.textContent = 'Could not update the font info — the original font was included instead.'
  }
  // Read the saved font back so the student sees exactly what it now contains.
  try {
    const saved = readFontNames(fontBytes.buffer.slice(fontBytes.byteOffset, fontBytes.byteOffset + fontBytes.byteLength))
    pdfStatus.textContent = `Saved font: “${saved.fullName || saved.family || '—'}” (family “${saved.family}”, style “${saved.style}”)` +
      (saved.author ? ` · designer “${saved.author}”` : ' · no designer')
  } catch (err) {
    console.error(err)
  }
  const zip = makeZip([
    { path: `${base}/${base} - specimen A4.pdf`, data: pdfBytes },
    { path: `${base}/${base}.${state.ext}`, data: fontBytes },
  ])
  const url = URL.createObjectURL(zip)
  const a = document.createElement('a')
  a.href = url
  a.download = `${base}.zip`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
})

pdfClose.addEventListener('click', closeModal)
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !pdfModal.classList.contains('hidden')) closeModal()
})

function defaultAxisSettings() {
  const out = {}
  for (const a of state.parsed.axes || []) out[a.tag] = a.defaultValue
  return out
}

/* InDesign export: IDML + fonts in a "Document Fonts" folder, zipped as a folder */

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

idmlBtn.addEventListener('click', async () => {
  if (!state) return
  const label = idmlBtn.textContent
  idmlBtn.disabled = true
  idmlBtn.textContent = 'Building InDesign file…'
  try {
    const m = currentMetadata()
    const result = await buildSpecimen({
      buffer: state.buffer,
      metadata: m,
      // InDesign opens variable fonts at their default instance, so the
      // captions in the IDML describe the default axis values
      axisSettings: defaultAxisSettings(),
      tracking: parseInt(letterSpacing.value, 10),
    })
    const fontBytes = renamedFont()
    const names = readFontNames(fontBytes.buffer.slice(fontBytes.byteOffset, fontBytes.byteOffset + fontBytes.byteLength))
    const idml = await buildIdml(result.layout, {
      specimen: { family: names.family, style: names.style || 'Regular' },
      label: result.labelFont,
    })
    const base = safeName(m.name || state.file.name.replace(/\.[^.]+$/, ''))
    const folder = `${base} InDesign`
    const files = [
      { path: `${folder}/${base} specimen.idml`, data: idml },
      { path: `${folder}/Document Fonts/${base}.${state.ext}`, data: fontBytes },
    ]
    if (result.labelFont && result.labelFont.bytes) {
      files.push({ path: `${folder}/Document Fonts/${result.labelFont.file}`, data: result.labelFont.bytes })
    }
    downloadBlob(makeZip(files), `${folder}.zip`)
    idmlBtn.textContent = 'Downloaded ✓'
    setTimeout(() => { idmlBtn.textContent = label }, 2500)
  } catch (err) {
    console.error(err)
    idmlBtn.textContent = 'InDesign export failed — try again'
    setTimeout(() => { idmlBtn.textContent = label }, 3500)
  } finally {
    idmlBtn.disabled = false
  }
})

/* Sources export: .designspace + UFO masters (variable) or one UFO (static) */

ufoBtn.addEventListener('click', async () => {
  if (!state) return
  const label = ufoBtn.textContent
  ufoBtn.disabled = true
  ufoBtn.textContent = 'Rebuilding sources…'
  try {
    const m = currentMetadata()
    const font = await openFont(state.buffer)
    const { files, masters, incompatible } = buildSources(font, {
      family: m.name, style: m.style, author: m.author, license: m.license, manufacturer: m.manufacturer,
    })
    if (incompatible.length) console.warn('Glyphs with different structure between masters:', incompatible)
    const base = safeName(m.name || state.file.name.replace(/\.[^.]+$/, ''))
    const folder = `${base} sources`
    downloadBlob(makeZip(files.map((f) => ({ path: `${folder}/${f.path}`, data: f.data }))), `${folder}.zip`)
    ufoBtn.textContent = masters > 1 ? `Downloaded ✓ (${masters} masters)` : 'Downloaded ✓'
    setTimeout(() => { ufoBtn.textContent = label }, 3000)
  } catch (err) {
    console.error(err)
    ufoBtn.textContent = 'Sources export failed — try again'
    setTimeout(() => { ufoBtn.textContent = label }, 3500)
  } finally {
    ufoBtn.disabled = false
  }
})
