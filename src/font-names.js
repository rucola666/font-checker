// Rewrites the `name` table of an OTF/TTF binary without touching any other
// table, so variable and CFF2 fonts survive intact. Updates family name
// (IDs 1/16), style (2/17), full font name (4), PostScript name (6),
// unique ID (3), designer (ID 9) and license (ID 13).

function tag(dv, o) {
  return String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3))
}

function isUtf16(platformID) { return platformID === 0 || platformID === 3 }

function decode(bytes, platformID) {
  if (isUtf16(platformID)) {
    let s = ''
    for (let i = 0; i + 1 < bytes.length; i += 2) s += String.fromCharCode((bytes[i] << 8) | bytes[i + 1])
    return s
  }
  return String.fromCharCode(...bytes)
}

function encode(str, platformID) {
  if (isUtf16(platformID)) {
    const out = new Uint8Array(str.length * 2)
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i)
      out[i * 2] = c >> 8
      out[i * 2 + 1] = c & 0xff
    }
    return out
  }
  return Uint8Array.from(str, (ch) => { const c = ch.charCodeAt(0); return c < 128 ? c : 63 })
}

export function readNameRecords(buffer) {
  const dv = new DataView(buffer)
  const numTables = dv.getUint16(4)
  for (let i = 0; i < numTables; i++) {
    const r = 12 + i * 16
    if (tag(dv, r) !== 'name') continue
    const off = dv.getUint32(r + 8)
    const count = dv.getUint16(off + 2)
    const storage = off + dv.getUint16(off + 4)
    const records = []
    for (let j = 0; j < count; j++) {
      const p = off + 6 + j * 12
      const platformID = dv.getUint16(p)
      const length = dv.getUint16(p + 8)
      const start = storage + dv.getUint16(p + 10)
      const bytes = new Uint8Array(buffer, start, length)
      records.push({
        platformID,
        encodingID: dv.getUint16(p + 2),
        languageID: dv.getUint16(p + 4),
        nameID: dv.getUint16(p + 6),
        value: decode(bytes, platformID),
      })
    }
    return records
  }
  return []
}

function buildNameTable(records) {
  records.sort((a, b) =>
    a.platformID - b.platformID || a.encodingID - b.encodingID ||
    a.languageID - b.languageID || a.nameID - b.nameID)
  const encoded = records.map((r) => encode(r.value, r.platformID))
  const headerSize = 6 + records.length * 12
  const storageSize = encoded.reduce((s, b) => s + b.length, 0)
  const out = new Uint8Array(headerSize + storageSize)
  const dv = new DataView(out.buffer)
  dv.setUint16(0, 0)
  dv.setUint16(2, records.length)
  dv.setUint16(4, headerSize)
  let strOff = 0
  records.forEach((r, i) => {
    const p = 6 + i * 12
    dv.setUint16(p, r.platformID)
    dv.setUint16(p + 2, r.encodingID)
    dv.setUint16(p + 4, r.languageID)
    dv.setUint16(p + 6, r.nameID)
    dv.setUint16(p + 8, encoded[i].length)
    dv.setUint16(p + 10, strOff)
    out.set(encoded[i], headerSize + strOff)
    strOff += encoded[i].length
  })
  return out
}

function checksum(bytes) {
  const padded = new Uint8Array((bytes.length + 3) & ~3)
  padded.set(bytes)
  const dv = new DataView(padded.buffer)
  let sum = 0
  for (let i = 0; i < padded.length; i += 4) sum = (sum + dv.getUint32(i)) >>> 0
  return sum
}

/**
 * @param {ArrayBuffer} buffer original font
 * @param {{family?: string, style?: string, fullName?: string, author?: string, license?: string}} edits
 * @returns {Uint8Array} new font binary
 */
export function rewriteFontNames(buffer, edits) {
  const records = readNameRecords(buffer)
  const get = (id) => (records.find((r) => r.nameID === id && isUtf16(r.platformID)) || records.find((r) => r.nameID === id) || {}).value
  const subfamily = get(17) || get(2) || 'Regular'

  const changes = new Map()   // nameID -> string ('' = remove)
  const family = (edits.family || '').trim()
  const style = (edits.style || '').trim()
  const fullName = (edits.fullName || '').trim()
  if (family || style || fullName) {
    const fam = family || get(16) || get(1) || 'Untitled'
    const sub = style || subfamily || 'Regular'
    const psName = `${fam}-${sub}`.replace(/[^A-Za-z0-9-]/g, '').slice(0, 63) || 'Font-Regular'
    const version = ((get(5) || '').match(/\d+(\.\d+)?/) || ['1.000'])[0]
    changes.set(1, fam)               // family
    changes.set(16, fam)              // typographic family
    changes.set(2, sub)               // style
    changes.set(17, sub)              // typographic style
    changes.set(4, fullName || `${fam} ${sub}`)   // full font name
    changes.set(6, psName)            // PostScript name
    changes.set(3, `${version};${psName}`)        // unique ID — apps use it to tell fonts apart
    if (records.some((r) => r.nameID === 25)) changes.set(25, psName.split('-')[0])
  }
  if (edits.author != null) changes.set(9, edits.author.trim())
  if (edits.license != null) changes.set(13, edits.license.trim())

  let next = []
  for (const r of records) {
    if (!changes.has(r.nameID)) { next.push(r); continue }
    const v = changes.get(r.nameID)
    if (v) next.push({ ...r, value: v })
  }
  // Add any name that has no record yet, on every platform the font already uses.
  const hasMac = records.some((r) => r.platformID === 1)
  for (const [id, v] of changes) {
    if (!v) continue
    if (!next.some((r) => r.nameID === id && r.platformID === 3)) {
      next.push({ platformID: 3, encodingID: 1, languageID: 0x409, nameID: id, value: v })
    }
    if (hasMac && !next.some((r) => r.nameID === id && r.platformID === 1)) {
      next.push({ platformID: 1, encodingID: 0, languageID: 0, nameID: id, value: v })
    }
  }
  const nameBytes = buildNameTable(next)

  // Reassemble the font with the new name table.
  const src = new Uint8Array(buffer)
  const dv = new DataView(buffer)
  const numTables = dv.getUint16(4)
  const dir = []
  for (let i = 0; i < numTables; i++) {
    const r = 12 + i * 16
    dir.push({ tag: tag(dv, r), offset: dv.getUint32(r + 8), length: dv.getUint32(r + 12), rec: r })
  }
  const tables = dir.map((t) => ({
    ...t,
    data: t.tag === 'name' ? nameBytes : src.slice(t.offset, t.offset + t.length),
  }))
  // physical order as in the original file
  const physical = [...tables].sort((a, b) => a.offset - b.offset)
  let pos = 12 + numTables * 16
  for (const t of physical) { t.newOffset = pos; pos += (t.data.length + 3) & ~3 }

  const out = new Uint8Array(pos)
  const odv = new DataView(out.buffer)
  out.set(src.slice(0, 12), 0)
  for (const t of physical) {
    if (t.tag === 'head') new DataView(t.data.buffer, t.data.byteOffset).setUint32(8, 0)
    out.set(t.data, t.newOffset)
  }
  for (const t of tables) {
    odv.setUint32(t.rec + 4, checksum(t.data))
    odv.setUint32(t.rec + 8, t.newOffset)
    odv.setUint32(t.rec + 12, t.data.length)
    for (let k = 0; k < 4; k++) out[t.rec + k] = src[t.rec + k]
  }
  const head = tables.find((t) => t.tag === 'head')
  if (head) odv.setUint32(head.newOffset + 8, (0xB1B0AFBA - checksum(out)) >>> 0)
  return out
}

/** Current family / style / full name / designer / license, preferring Windows records. */
export function readFontNames(buffer) {
  const recs = readNameRecords(buffer)
  const val = (id) => (((recs.find((r) => r.nameID === id && r.platformID === 3) || recs.find((r) => r.nameID === id)) || {}).value || '').trim()
  return {
    family: val(16) || val(1),
    style: val(17) || val(2),
    fullName: val(4),
    postscript: val(6),
    author: val(9),
    license: val(13),
  }
}
