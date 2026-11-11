import { LOWER, UPPER, NUMBERS, PUNCTUATION } from './font-parser.js'

export const GROUPS = [
  { key: 'upper', label: 'Uppercase', chars: UPPER },
  { key: 'lower', label: 'Lowercase', chars: LOWER },
  { key: 'numbers', label: 'Figures', chars: NUMBERS },
  { key: 'punctuation', label: 'Punctuation', chars: PUNCTUATION },
]

export function hide(element) { element.classList.add('hidden') }
export function show(element) { element.classList.remove('hidden') }
export function setStatus(element, message) { element.textContent = message; show(element) }

function el(tag, className, text) {
  const e = document.createElement(tag)
  if (className) e.className = className
  if (text != null) e.textContent = text
  return e
}

/* ---------- Font info (sidebar drawer) ---------- */

const READONLY_FIELDS = [
  { key: 'manufacturer', label: 'Manufacturer' },
  { key: 'format', label: 'Format' },
  { key: 'glyphCount', label: 'Glyphs' },
]

export function renderFontInfo(table, metadata) {
  table.innerHTML = ''
  for (const field of READONLY_FIELDS) {
    const raw = metadata[field.key]
    const value = raw == null || raw === '' ? '' : String(raw)
    const tr = el('tr')
    tr.appendChild(el('td', 'info-key', field.label))
    tr.appendChild(el('td', value ? 'info-value' : 'info-value is-missing', value || 'Missing'))
    table.appendChild(tr)
  }
}

/** Count of empty info values (editable + read-only). */
export function countMissingInfo(values) {
  return values.filter((v) => v == null || String(v).trim() === '').length
}

/* ---------- Glyph coverage (sidebar drawer) — emphasises what is missing ---------- */

export function renderCoverage(container, coverage) {
  container.innerHTML = ''
  let present = 0
  let total = 0
  const groups = []
  for (const g of GROUPS) {
    const map = coverage[g.key] || {}
    const chars = [...g.chars]
    const missing = chars.filter((c) => !map[c])
    present += chars.length - missing.length
    total += chars.length
    groups.push({ ...g, chars, map, missing })
  }
  const missingTotal = total - present
  const summary = el('p', missingTotal ? 'cov-summary' : 'cov-summary is-ok',
    missingTotal ? `${missingTotal} of ${total} basic characters missing` : `All ${total} basic characters present`)
  container.appendChild(summary)

  for (const g of groups) {
    const wrap = el('div', 'cov-group')
    const head = el('div', 'cov-head')
    head.appendChild(el('span', 'cov-name', g.label))
    head.appendChild(el('span', g.missing.length ? 'cov-count has-missing' : 'cov-count',
      g.missing.length === g.chars.length ? 'none'
        : g.missing.length ? `${g.missing.length} missing` : `${g.chars.length}/${g.chars.length}`))
    wrap.appendChild(head)
    if (g.missing.length) {
      const row = el('div', 'cov-row')
      for (const c of g.chars) {
        const s = el('span', `cov-char ${g.map[c] ? 'present' : 'missing'}`, c)
        s.title = `${c} ${g.map[c] ? 'present' : 'missing'}`
        row.appendChild(s)
      }
      wrap.appendChild(row)
    }
    container.appendChild(wrap)
  }
  return { present, total, missing: missingTotal }
}

/* ---------- Variable axes ---------- */

export function renderFvarSliders(container, axes, onChange) {
  container.innerHTML = ''
  for (const axis of axes) {
    const group = el('div', 'fvar-group')
    const header = el('div', 'fvar-header')
    header.appendChild(el('span', null, axis.label))
    const value = el('span', 'fvar-value', String(axis.defaultValue))
    header.appendChild(value)

    const slider = document.createElement('input')
    slider.type = 'range'
    slider.className = 'fvar-slider'
    slider.id = `fvar-slider-${axis.tag}`
    slider.min = axis.min
    slider.max = axis.max
    slider.step = axis.tag === 'slnt' || axis.tag === 'opsz' ? 1 : Math.min(1, (axis.max - axis.min) / 100)
    slider.value = axis.defaultValue
    slider.addEventListener('input', () => {
      value.textContent = slider.value
      onChange()
    })

    group.appendChild(header)
    group.appendChild(slider)
    container.appendChild(group)
  }
}

export function getFvarSettings() {
  const settings = {}
  for (const slider of document.querySelectorAll('.fvar-slider')) {
    settings[slider.id.replace('fvar-slider-', '')] = parseFloat(slider.value)
  }
  return settings
}

/* ---------- Preview (main column) — shows what is there ---------- */

export function styleText(element, { family, size, lineHeight, tracking, fvar }) {
  element.style.fontFamily = `"${family}", sans-serif`
  element.style.fontSize = `${size}px`
  element.style.lineHeight = lineHeight
  element.style.letterSpacing = `${tracking / 1000}em`
  element.style.fontVariationSettings = fvar || ''
}

export function renderCharacters(container, coverage, style) {
  container.innerHTML = ''
  for (const g of GROUPS) {
    const map = coverage[g.key] || {}
    const present = [...g.chars].filter((c) => map[c]).join('')
    if (!present) continue
    const group = el('div', 'char-group')
    group.appendChild(el('div', 'char-group-label', g.label))
    const text = el('div', 'preview-text', present)
    styleText(text, style)
    group.appendChild(text)
    container.appendChild(group)
  }
}
