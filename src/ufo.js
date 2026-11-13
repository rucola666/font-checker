// Rebuilds editable sources from a compiled font:
// - a static font becomes one UFO
// - a variable font becomes a .designspace plus one UFO per master: the
//   default location and each axis minimum / maximum (other axes at default).
// Outlines and advance widths are taken from the font at each master's
// location, so masters are compatible. Not recovered: OpenType features,
// kerning, hinting, components (outlines are decomposed) and any
// intermediate masters the original source had.

const MAC_GLYPH_NAMES = `.notdef .null nonmarkingreturn space exclam quotedbl numbersign dollar percent ampersand quotesingle parenleft parenright asterisk plus comma hyphen period slash zero one two three four five six seven eight nine colon semicolon less equal greater question at A B C D E F G H I J K L M N O P Q R S T U V W X Y Z bracketleft backslash bracketright asciicircum underscore grave a b c d e f g h i j k l m n o p q r s t u v w x y z braceleft bar braceright asciitilde Adieresis Aring Ccedilla Eacute Ntilde Odieresis Udieresis aacute agrave acircumflex adieresis atilde aring ccedilla eacute egrave ecircumflex edieresis iacute igrave icircumflex idieresis ntilde oacute ograve ocircumflex odieresis otilde uacute ugrave ucircumflex udieresis dagger degree cent sterling section bullet paragraph germandbls registered copyright trademark acute dieresis notequal AE Oslash infinity plusminus lessequal greaterequal yen mu partialdiff summation product pi integral ordfeminine ordmasculine Omega ae oslash questiondown exclamdown logicalnot radical florin approxequal Delta guillemotleft guillemotright ellipsis nonbreakingspace Agrave Atilde Otilde OE oe endash emdash quotedblleft quotedblright quoteleft quoteright divide lozenge ydieresis Ydieresis fraction currency guilsinglleft guilsinglright fi fl daggerdbl periodcentered quotesinglbase quotedblbase perthousand Acircumflex Ecircumflex Aacute Edieresis Egrave Iacute Icircumflex Idieresis Igrave Oacute Ocircumflex apple Ograve Uacute Ucircumflex Ugrave dotlessi circumflex tilde macron breve dotaccent ring cedilla hungarumlaut ogonek caron Lslash lslash Scaron scaron Zcaron zcaron brokenbar Eth eth Yacute yacute Thorn thorn minus multiply onesuperior twosuperior threesuperior onehalf onequarter threequarters franc Gbreve gbreve Idotaccent Scedilla scedilla Cacute cacute Ccaron ccaron dcroat`.split(' ')

const XML = '<?xml version="1.0" encoding="UTF-8"?>\n'
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const num = (v) => { const r = Math.round(v * 100) / 100; return Object.is(r, -0) ? '0' : String(r) }

/* ---------- plist ---------- */

function plistValue(v, ind) {
  const pad = '  '.repeat(ind)
  if (Array.isArray(v)) {
    if (!v.length) return `${pad}<array/>`
    return `${pad}<array>\n${v.map((x) => plistValue(x, ind + 1)).join('\n')}\n${pad}</array>`
  }
  if (v && typeof v === 'object') {
    const keys = Object.keys(v)
    if (!keys.length) return `${pad}<dict/>`
    return `${pad}<dict>\n${keys.map((k) => `${pad}  <key>${esc(k)}</key>\n${plistValue(v[k], ind + 1)}`).join('\n')}\n${pad}</dict>`
  }
  if (typeof v === 'boolean') return `${pad}<${v}/>`
  if (typeof v === 'number') return Number.isInteger(v) ? `${pad}<integer>${v}</integer>` : `${pad}<real>${v}</real>`
  return `${pad}<string>${esc(v)}</string>`
}

function plist(obj) {
  return `${XML}<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n${plistValue(obj, 0)}\n</plist>\n`
}

/* ---------- glyph names and file names ---------- */

function postName(font, id) {
  try {
    const post = font.post
    if (post && post.version === 2 && post.glyphNameIndex) {
      const idx = post.glyphNameIndex[id]
      if (idx < 258) return MAC_GLYPH_NAMES[idx]
      return post.names && post.names[idx - 258]
    }
  } catch { /* no usable post table */ }
  return null
}

function glyphNames(font, unicodesById) {
  const names = []
  const used = new Set()
  for (let id = 0; id < font.numGlyphs; id++) {
    let name = null
    try { name = font.getGlyph(id).name } catch { /* ignore */ }
    name = name || postName(font, id)
    if (!name) {
      const cp = (unicodesById.get(id) || [])[0]
      name = id === 0 ? '.notdef' : cp != null ? (cp > 0xffff ? 'u' : 'uni') + cp.toString(16).toUpperCase().padStart(4, '0') : `glyph${id}`
    }
    name = name.replace(/[\s\u0000-\u001f]/g, '') || `glyph${id}`
    let unique = name
    for (let k = 1; used.has(unique); k++) unique = `${name}.${k}`
    used.add(unique)
    names.push(unique)
  }
  return names
}

const ILLEGAL = new Set('"*+/:<>?[\\]|'.split(''))
const RESERVED = new Set('con prn aux clock$ nul com1 com2 com3 com4 com5 com6 com7 com8 com9 lpt1 lpt2 lpt3 lpt4 lpt5 lpt6 lpt7 lpt8 lpt9'.split(' '))

// UFO 3 "user name to file name" convention
function glifFileName(name, taken) {
  let out = ''
  for (const ch of name) {
    if (ILLEGAL.has(ch) || ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 0x7f) out += '_'
    else if (ch !== ch.toLowerCase()) out += `${ch}_`
    else out += ch
  }
  if (out.startsWith('.')) out = `_${out.slice(1)}`
  out = out.split('.').map((part) => (RESERVED.has(part.toLowerCase()) ? `_${part}` : part)).join('.')
  out = out.slice(0, 250)
  let file = `${out}.glif`
  for (let k = 1; taken.has(file.toLowerCase()); k++) file = `${out}${String(k).padStart(15, '0')}.glif`
  taken.add(file.toLowerCase())
  return file
}

/* ---------- outlines ---------- */

// Splits fontkit path commands into contours. Each contour keeps its start
// point and whether its last segment already ends on it.
function rawContours(commands) {
  const contours = []
  let cur = null
  const flush = () => { if (cur && cur.points.length) contours.push(cur); cur = null }
  for (const c of commands) {
    const a = c.args
    switch (c.command) {
      case 'moveTo': flush(); cur = { start: [a[0], a[1]], points: [] }; break
      case 'lineTo': cur.points.push({ x: a[0], y: a[1], type: 'line' }); break
      case 'quadraticCurveTo': cur.points.push({ x: a[0], y: a[1] }, { x: a[2], y: a[3], type: 'qcurve' }); break
      case 'bezierCurveTo': cur.points.push({ x: a[0], y: a[1] }, { x: a[2], y: a[3] }, { x: a[4], y: a[5], type: 'curve' }); break
      case 'closePath': flush(); break
      default: break
    }
  }
  flush()
  for (const c of contours) {
    const last = c.points[c.points.length - 1]
    c.endsOnStart = last.x === c.start[0] && last.y === c.start[1]
  }
  return contours
}

// UFO contours are cyclic: the start point is written as a closing line
// point unless the last segment already ends on it. The choice must be the
// same in every master, so `needsClose[i]` is decided across all masters.
function toContours(raw, needsClose) {
  return raw.map((c, i) => (needsClose[i] ? [...c.points, { x: c.start[0], y: c.start[1], type: 'line' }] : c.points))
}

function glif(name, unicodes, advance, contours) {
  const lines = [`${XML}<glyph name="${esc(name)}" format="2">`, `  <advance width="${num(advance)}"/>`]
  for (const u of unicodes) lines.push(`  <unicode hex="${u.toString(16).toUpperCase().padStart(4, '0')}"/>`)
  if (contours.length) {
    lines.push('  <outline>')
    for (const c of contours) {
      lines.push('    <contour>')
      for (const p of c) lines.push(`      <point x="${num(p.x)}" y="${num(p.y)}"${p.type ? ` type="${p.type}"` : ''}/>`)
      lines.push('    </contour>')
    }
    lines.push('  </outline>')
  }
  lines.push('</glyph>\n')
  return lines.join('\n')
}

const signature = (contours) => contours.map((c) => c.map((p) => p.type || 'o').join(',')).join('|')

/* ---------- build ---------- */

const safe = (s) => s.replace(/[^A-Za-z0-9]+/g, '') || 'Font'

/**
 * @param font  fontkit font (default instance)
 * @param info  { family, style, author, license, manufacturer }
 * @returns {{ files: {path, data}[], masters: number, incompatible: string[] }}
 *          paths are relative to the export folder
 */
export function buildSources(font, info) {
  const enc = new TextEncoder()
  const files = []
  const add = (path, text) => files.push({ path, data: enc.encode(text) })

  const family = info.family || 'Untitled'
  const style = info.style || 'Regular'
  const axes = font.variationAxes || {}
  const tags = Object.keys(axes)
  const axisName = (t) => (axes[t].name || t).trim() || t

  // unicode map and names from the default instance
  const unicodesById = new Map()
  for (const cp of font.characterSet || []) {
    const g = font.glyphForCodePoint(cp)
    if (!g || !g.id) continue
    if (!unicodesById.has(g.id)) unicodesById.set(g.id, [])
    unicodesById.get(g.id).push(cp)
  }
  const names = glyphNames(font, unicodesById)

  // masters: default + every axis extreme that differs from the default
  const defaults = Object.fromEntries(tags.map((t) => [t, axes[t].default]))
  const masters = [{ loc: defaults, style }]
  for (const t of tags) {
    for (const v of [axes[t].min, axes[t].max]) {
      if (v !== axes[t].default) masters.push({ loc: { ...defaults, [t]: v }, style: `${axisName(t)} ${num(v)}` })
    }
  }

  let version = 1
  try { version = font.head.fontRevision || 1 } catch { /* ignore */ }
  const versionMajor = Math.max(0, Math.floor(version))
  const versionMinor = Math.max(0, Math.round((version - versionMajor) * 1000))

  // Outlines for every master first, so contour closing can be decided across masters.
  const outlines = masters.map((m) => {
    const inst = tags.length ? font.getVariation(m.loc) : font
    const glyphs = []
    for (let id = 0; id < font.numGlyphs; id++) {
      const g = inst.getGlyph(id)
      glyphs.push({ raw: rawContours(g.path.commands), advance: g.advanceWidth })
    }
    return glyphs
  })
  const needsClose = []
  for (let id = 0; id < font.numGlyphs; id++) {
    const count = Math.max(...outlines.map((o) => o[id].raw.length))
    needsClose.push(Array.from({ length: count }, (_, i) => outlines.some((o) => o[id].raw[i] && !o[id].raw[i].endsOnStart)))
  }

  const signatures = []
  masters.forEach((m, mi) => {
    const psName = `${safe(family)}-${safe(m.style)}`
    m.dir = `${psName}.ufo`
    const fontinfo = {
      familyName: family,
      styleName: m.style,
      unitsPerEm: font.unitsPerEm,
      ascender: font.ascent,
      descender: font.descent,
      versionMajor,
      versionMinor,
      postscriptFontName: psName,
    }
    if (font.capHeight) fontinfo.capHeight = font.capHeight
    if (font.xHeight) fontinfo.xHeight = font.xHeight
    if (font.italicAngle) fontinfo.italicAngle = font.italicAngle
    if (info.author) fontinfo.openTypeNameDesigner = info.author
    if (info.license) fontinfo.openTypeNameLicense = info.license
    if (info.manufacturer && info.manufacturer.trim()) fontinfo.openTypeNameManufacturer = info.manufacturer.trim()

    add(`${m.dir}/metainfo.plist`, plist({ creator: 'io.github.rucola666.font-checker', formatVersion: 3, formatVersionMinor: 0 }))
    add(`${m.dir}/fontinfo.plist`, plist(fontinfo))
    add(`${m.dir}/layercontents.plist`, plist([['public.default', 'glyphs']]))
    add(`${m.dir}/lib.plist`, plist({ 'public.glyphOrder': names }))

    const contents = {}
    const taken = new Set()
    const sig = []
    for (let id = 0; id < font.numGlyphs; id++) {
      const { raw, advance } = outlines[mi][id]
      const contours = toContours(raw, needsClose[id])
      sig.push(signature(contours))
      const file = glifFileName(names[id], taken)
      contents[names[id]] = file
      add(`${m.dir}/glyphs/${file}`, glif(names[id], unicodesById.get(id) || [], advance, contours))
    }
    add(`${m.dir}/glyphs/contents.plist`, plist(contents))
    signatures.push(sig)
  })

  // glyphs whose point structure still differs between masters (should not happen)
  const incompatible = []
  for (let id = 0; id < names.length; id++) {
    if (signatures.some((sg) => sg[id] !== signatures[0][id])) incompatible.push(names[id])
  }

  if (tags.length) {
    const loc = (l) => `      <location>\n${tags.map((t) => `        <dimension name="${esc(axisName(t))}" xvalue="${num(l[t])}"/>`).join('\n')}\n      </location>`
    const axesXml = tags.map((t) => `    <axis tag="${esc(t)}" name="${esc(axisName(t))}" minimum="${num(axes[t].min)}" maximum="${num(axes[t].max)}" default="${num(axes[t].default)}"/>`).join('\n')
    const sources = masters.map((m) => `    <source filename="${esc(m.dir)}" name="${esc(`${family} ${m.style}`)}" familyname="${esc(family)}" stylename="${esc(m.style)}">\n${loc(m.loc)}\n    </source>`).join('\n')
    let instances = ''
    try {
      const named = font.namedVariations || {}
      instances = Object.entries(named).map(([name, coords]) => {
        const l = { ...defaults, ...coords }
        return `    <instance name="${esc(`${family} ${name}`)}" familyname="${esc(family)}" stylename="${esc(name)}" postscriptfontname="${esc(`${safe(family)}-${safe(name)}`)}">\n${loc(l)}\n    </instance>`
      }).join('\n')
    } catch { /* no named instances */ }
    add(`${safe(family)}.designspace`, `${XML}<designspace format="5.0">\n  <axes>\n${axesXml}\n  </axes>\n  <sources>\n${sources}\n  </sources>\n` +
      (instances ? `  <instances>\n${instances}\n  </instances>\n` : '') + '</designspace>\n')
  }

  add('About these sources.txt', [
    `${family} — sources rebuilt by Font Checker from the compiled font.`,
    '',
    tags.length
      ? `Open ${safe(family)}.designspace in Glyphs, Fontra or FontLab. It has ${masters.length} masters:\n${masters.map((m) => `  - ${m.style} (${m.dir})`).join('\n')}`
      : `Open ${masters[0].dir} in Glyphs, Fontra or FontLab.`,
    '',
    'Recovered: outlines, advance widths, glyph names and Unicode values, vertical metrics, family/style/designer/license.',
    'Not recovered: OpenType features, kerning, hinting and components (shapes come out as plain outlines).',
    tags.length ? 'Masters are taken at the default and at each end of every axis. If the original source had intermediate masters, their shapes are only approximated.' : '',
    '',
  ].join('\n'))

  return { files, masters: masters.length, incompatible }
}
