import opentype from 'opentype.js'

export const LOWER = 'abcdefghijklmnopqrstuvwxyz'
export const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
export const NUMBERS = '0123456789'
export const PUNCTUATION = '.?!,:;"\'-'

export function checkGlyphCoverage(font, chars) {
  const result = {}
  for (const c of chars) {
    const glyph = font.charToGlyph(c)
    result[c] = glyph.name !== '.notdef'
  }
  return result
}

function getFirst(names, key) {
  const entry = names[key]
  if (!entry) return ''
  if (typeof entry === 'string') return entry
  return Object.values(entry)[0] || ''
}

function detectFormat(filename) {
  const lower = filename.toLowerCase()
  if (lower.endsWith('.otf') || lower === 'otf') return 'OTF'
  if (lower.endsWith('.ttf') || lower === 'ttf') return 'TTF'
  return 'Unknown'
}

function isVariableFont(font) {
  return font.tables && font.tables['fvar'] != null
}

export function allPresent(coverage) {
  return Object.values(coverage).every(Boolean)
}

export function getFvarAxes(font) {
  if (!font.tables || !font.tables.fvar || !font.tables.fvar.axes) return null
  const TAG_LABELS = {
    wght: 'Weight',
    wdth: 'Width',
    slnt: 'Slant',
    ital: 'Italic',
    opsz: 'Optical Size',
  }
  return font.tables.fvar.axes.map((axis) => ({
    tag: axis.tag,
    label: TAG_LABELS[axis.tag] || (axis.name && Object.values(axis.name)[0]) || axis.tag,
    min: axis.minValue,
    max: axis.maxValue,
    defaultValue: axis.defaultValue,
  }))
}

function getTableEntries(data) {
  const numTables = data.getUint16(4, false)
  const entries = {}
  for (let i = 0; i < numTables; i++) {
    const p = 12 + i * 16
    const tag = String.fromCharCode(
      data.getUint8(p), data.getUint8(p + 1),
      data.getUint8(p + 2), data.getUint8(p + 3)
    )
    entries[tag] = {
      offset: data.getUint32(p + 8, false),
      length: data.getUint32(p + 12, false),
    }
  }
  return entries
}

function parseNameTable(data, offset) {
  const version = data.getUint16(offset, false)
  const count = data.getUint16(offset + 2, false)
  const stringOffset = offset + data.getUint16(offset + 4, false)
  const NAMES = {
    1: 'fontFamily',
    9: 'designer',
    13: 'license',
    8: 'manufacturer',
  }
  const result = {}
  for (let i = 0; i < count; i++) {
    const rec = offset + 6 + i * 12
    const platformID = data.getUint16(rec, false)
    const encodingID = data.getUint16(rec + 2, false)
    const languageID = data.getUint16(rec + 4, false)
    const nameID = data.getUint16(rec + 6, false)
    const length = data.getUint16(rec + 8, false)
    const strOffset = data.getUint16(rec + 10, false)
    const label = NAMES[nameID]
    if (!label) continue
    let text = ''
    if (platformID === 0 || (platformID === 3 && (encodingID === 1 || encodingID === 10))) {
      text = decodeUTF16(data, stringOffset + strOffset, length)
    }
    if (text && !result[label]) {
      result[label] = text
    }
  }
  return result
}

function decodeUTF16(data, offset, length) {
  const chars = []
  for (let i = 0; i < length; i += 2) {
    chars.push(data.getUint16(offset + i, false))
  }
  return String.fromCharCode(...chars)
}

function parseMaxpNumGlyphs(data, offset) {
  return data.getUint16(offset + 4, false)
}

function parseFvarTable(data, offset) {
  const axisCount = data.getUint16(offset + 8, false)
  const axisSize = data.getUint16(offset + 10, false)
  const instanceCount = data.getUint16(offset + 12, false)
  const instanceSize = data.getUint16(offset + 14, false)
  const offsetToData = data.getUint16(offset + 4, false)
  const TAG_LABELS = {
    wght: 'Weight', wdth: 'Width', slnt: 'Slant',
    ital: 'Italic', opsz: 'Optical Size',
  }
  const axes = []
  for (let i = 0; i < axisCount; i++) {
    const ap = offset + offsetToData + i * axisSize
    const tag = String.fromCharCode(
      data.getUint8(ap), data.getUint8(ap + 1),
      data.getUint8(ap + 2), data.getUint8(ap + 3)
    )
    const minValue = data.getInt32(ap + 4, false) / 65536
    const defaultValue = data.getInt32(ap + 8, false) / 65536
    const maxValue = data.getInt32(ap + 12, false) / 65536
    axes.push({ tag, label: TAG_LABELS[tag] || tag, min: minValue, max: maxValue, defaultValue })
  }
  return axes
}

function parseCmapCoverage(data, offset, chars) {
  const numTables = data.getUint16(offset + 2, false)
  let coverage = {}
  for (const c of chars) coverage[c] = false

  for (let i = 0; i < numTables; i++) {
    const encRec = offset + 4 + i * 8
    const platformID = data.getUint16(encRec, false)
    const encodingID = data.getUint16(encRec + 2, false)
    const subOffset = offset + data.getUint32(encRec + 4, false)
    const format = data.getUint16(subOffset, false)

    if (format === 4) {
      coverage = parseCmapFormat4(data, subOffset, chars, coverage)
    } else if (format === 12) {
      coverage = parseCmapFormat12(data, subOffset, chars, coverage)
    }

    if (Object.values(coverage).every(Boolean)) break
  }

  return coverage
}

function parseCmapFormat4(data, offset, chars, coverage) {
  const segCountX2 = data.getUint16(offset + 6, false)
  const segCount = segCountX2 / 2
  const endCodes = offset + 14
  const startCodes = endCodes + segCountX2 + 2
  const idDeltas = startCodes + segCountX2
  const idRangeOffsets = idDeltas + segCountX2
  const glyphIdArray = idRangeOffsets + segCountX2

  for (const c of chars) {
    const code = c.charCodeAt(0)
    if (code > 0xFFFF) continue
    if (coverage[c]) continue

    for (let seg = 0; seg < segCount; seg++) {
      const end = data.getUint16(endCodes + seg * 2, false)
      const start = data.getUint16(startCodes + seg * 2, false)
      if (code >= start && code <= end) {
        const idDelta = data.getUint16(idDeltas + seg * 2, false)
        const idRangeOffset = data.getUint16(idRangeOffsets + seg * 2, false)
        let glyphId
        if (idRangeOffset === 0) {
          glyphId = (code + idDelta) & 0xFFFF
        } else {
          const offsetInArray = idRangeOffsets + seg * 2 + idRangeOffset + (code - start) * 2
          glyphId = (data.getUint16(offsetInArray, false) + idDelta) & 0xFFFF
        }
        if (glyphId !== 0) coverage[c] = true
        break
      }
    }
  }

  return coverage
}

function parseCmapFormat12(data, offset, chars, coverage) {
  const numGroups = data.getUint32(offset + 12, false)

  for (const c of chars) {
    const code = c.charCodeAt(0)
    if (coverage[c]) continue

    for (let g = 0; g < numGroups; g++) {
      const gp = offset + 16 + g * 12
      const start = data.getUint32(gp, false)
      const end = data.getUint32(gp + 4, false)
      const startGlyph = data.getUint32(gp + 8, false)
      if (code >= start && code <= end) {
        const glyphId = startGlyph + (code - start)
        if (glyphId !== 0) coverage[c] = true
        break
      }
    }
  }

  return coverage
}

function hasValidVariation(entries, data) {
  if (!entries['fvar']) return false

  const axisCount = data.getUint16(entries['fvar'].offset + 8, false)
  if (axisCount === 0) return false

  if (entries['MVAR']) return true

  if (entries['HVAR']) {
    const varStoreOff = data.getUint16(entries['HVAR'].offset + 4, false)
    if (varStoreOff > 0 && varStoreOff < entries['HVAR'].length) {
      const vsAbs = entries['HVAR'].offset + varStoreOff
      if (vsAbs + 10 < data.byteLength) {
        const axisCountInVar = data.getUint16(vsAbs + 6, false)
        if (axisCountInVar > 0) return true
      }
    }
  }

  if (entries['CFF2']) {
    const cff2Off = entries['CFF2'].offset
    const hdrSize = data.getUint8(cff2Off + 2)
    const topDictSize = data.getUint16(cff2Off + 3, false)
    const topStart = cff2Off + hdrSize
    let i = 0, stack = []
    while (i < topDictSize) {
      const b = data.getUint8(topStart + i)
      if (b === 0x0c) {
        const op2 = data.getUint8(topStart + i + 1)
        i += 2
        if (op2 === 36) {
          const vstoreOff = stack.pop()
          const vsAbs = cff2Off + vstoreOff
          if (vsAbs + 10 < data.byteLength) {
            const fmt = data.getUint16(vsAbs, false)
            const regionListOff = data.getUint32(vsAbs + 2, false)
            const axisCountInVar = data.getUint16(vsAbs + 6, false)
            const regionCount = data.getUint16(vsAbs + 8, false)
            if (
              (fmt === 0 || fmt === 1) &&
              vsAbs + regionListOff + 4 < data.byteLength &&
              axisCountInVar > 0 &&
              regionCount > 0
            ) {
              return true
            }
          }
        }
        stack = []
      } else if (b <= 21) {
        i++
        stack = []
      } else if (b >= 22 && b <= 27) { stack.push(b - 22); i++ }
      else if (b === 28) { stack.push(data.getInt16(topStart + i + 1, false)); i += 3 }
      else if (b === 29) { stack.push(data.getInt32(topStart + i + 1, false)); i += 5 }
      else if (b >= 32 && b <= 246) { stack.push(b - 139); i++ }
      else if (b >= 247 && b <= 250) { stack.push((b - 247) * 256 + data.getUint8(topStart + i + 1) + 108); i += 2 }
      else if (b >= 251 && b <= 254) { stack.push(-(b - 251) * 256 - data.getUint8(topStart + i + 1) - 108); i += 2 }
      else i++
    }
  }

  return false
}

function parseCff2Font(buffer, filename) {
  const data = new DataView(buffer)
  const entries = getTableEntries(data)

  let nameData = {}
  if (entries['name']) {
    nameData = parseNameTable(data, entries['name'].offset)
  }

  const baseFormat = detectFormat(filename)
  const isVar = hasValidVariation(entries, data)
  const format = isVar ? `${baseFormat} (variable)` : baseFormat

  let glyphCount = 0
  if (entries['maxp']) {
    glyphCount = parseMaxpNumGlyphs(data, entries['maxp'].offset)
  }

  let axes = null
  if (entries['fvar']) {
    axes = parseFvarTable(data, entries['fvar'].offset)
  }

  const allChars = LOWER + UPPER + NUMBERS + PUNCTUATION
  let coverageRaw = {}
  if (entries['cmap']) {
    coverageRaw = parseCmapCoverage(data, entries['cmap'].offset, allChars)
  } else {
    for (const c of allChars) coverageRaw[c] = false
  }

  const group = (chars) => {
    const result = {}
    for (const c of chars) result[c] = !!coverageRaw[c]
    return result
  }

  const coverage = {
    lower: group(LOWER),
    upper: group(UPPER),
    numbers: group(NUMBERS),
    punctuation: group(PUNCTUATION),
  }

  return {
    metadata: {
      name: nameData.fontFamily || '',
      author: nameData.designer || '',
      license: nameData.license || '',
      manufacturer: nameData.manufacturer || '',
      format,
      glyphCount,
    },
    coverage: {
      ...coverage,
      allPresent:
        allPresent(coverage.lower) &&
        allPresent(coverage.upper) &&
        allPresent(coverage.numbers) &&
        allPresent(coverage.punctuation),
    },
    axes,
    font: null,
  }
}

export function parseFont(buffer, filename) {
  let font
  try {
    font = opentype.parse(buffer)
  } catch (err) {
    if (err.message && err.message.includes("doesn't contain TrueType or CFF outlines")) {
      return parseCff2Font(buffer, filename)
    }
    throw err
  }

  const baseFormat = detectFormat(filename)
  const variable = isVariableFont(font)
  const format = variable ? `${baseFormat} (variable)` : baseFormat
  const metadata = {
    name: getFirst(font.names, 'fontFamily'),
    author: getFirst(font.names, 'designer'),
    license: getFirst(font.names, 'license'),
    manufacturer: getFirst(font.names, 'manufacturer'),
    format,
    glyphCount: font.glyphs.length,
  }

  const coverage = {
    lower: checkGlyphCoverage(font, LOWER),
    upper: checkGlyphCoverage(font, UPPER),
    numbers: checkGlyphCoverage(font, NUMBERS),
    punctuation: checkGlyphCoverage(font, PUNCTUATION),
  }

  return {
    metadata,
    coverage: {
      ...coverage,
      allPresent:
        allPresent(coverage.lower) &&
        allPresent(coverage.upper) &&
        allPresent(coverage.numbers) &&
        allPresent(coverage.punctuation),
    },
    axes: getFvarAxes(font),
    font,
  }
}
