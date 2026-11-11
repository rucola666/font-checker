import { describe, it, expect, vi } from 'vitest'

vi.mock('opentype.js', () => ({
  default: {
    parse: vi.fn(),
  },
}))

import { parseFont, checkGlyphCoverage, getFvarAxes } from './font-parser'

describe('checkGlyphCoverage', () => {
  it('returns true for characters that have glyphs', () => {
    const mockFont = {
      charToGlyph: vi.fn((c) => {
        return { name: c === 'x' ? 'x' : '.notdef' }
      }),
    }
    const result = checkGlyphCoverage(mockFont, 'x')
    expect(result).toEqual({ x: true })
  })

  it('returns false for characters mapped to .notdef', () => {
    const mockFont = {
      charToGlyph: vi.fn(() => ({ name: '.notdef' })),
    }
    const result = checkGlyphCoverage(mockFont, 'x')
    expect(result).toEqual({ x: false })
  })

  it('checks every character in the input string', () => {
    const mockFont = {
      charToGlyph: vi.fn((c) => {
        const has = { a: true, b: true, c: false }
        return { name: has[c] ? c : '.notdef' }
      }),
    }
    const result = checkGlyphCoverage(mockFont, 'abc')
    expect(result).toEqual({ a: true, b: true, c: false })
  })
})

describe('getFvarAxes', () => {
  it('returns null when font has no fvar table', () => {
    const font = { tables: {} }
    expect(getFvarAxes(font)).toBeNull()
  })

  it('returns null when font has no tables', () => {
    const font = {}
    expect(getFvarAxes(font)).toBeNull()
  })

  it('extracts axis data from fvar table', () => {
    const font = {
      tables: {
        fvar: {
          axes: [
            { tag: 'wght', minValue: 100, maxValue: 900, defaultValue: 400, name: { en: 'Weight' } },
            { tag: 'wdth', minValue: 75, maxValue: 100, defaultValue: 100, name: {} },
          ],
        },
      },
    }
    const axes = getFvarAxes(font)
    expect(axes).toHaveLength(2)
    expect(axes[0]).toEqual({ tag: 'wght', label: 'Weight', min: 100, max: 900, defaultValue: 400 })
    expect(axes[1]).toEqual({ tag: 'wdth', label: 'Width', min: 75, max: 100, defaultValue: 100 })
  })
})

describe('parseFont', () => {
  it('returns structured result from a valid font buffer', async () => {
    const opentype = await import('opentype.js')
    opentype.default.parse.mockReturnValue({
      names: {
        fontFamily: { en: 'TestFont' },
        designer: { en: 'Test Designer' },
        license: { en: 'SIL' },
        manufacturer: { en: 'Test Corp' },
      },
      glyphs: { length: 250 },
      tables: { 'CFF ': true, 'OS/2': true },
      charToGlyph: vi.fn(() => ({ name: 'someglyph' })),
    })

    const buffer = new ArrayBuffer(0)
    const result = parseFont(buffer, 'otf')

    expect(result.metadata.name).toBe('TestFont')
    expect(result.metadata.author).toBe('Test Designer')
    expect(result.metadata.license).toBe('SIL')
    expect(result.metadata.format).toBe('OTF')
    expect(result.metadata.glyphCount).toBe(250)
    expect(result.metadata.manufacturer).toBe('Test Corp')
    expect(result.coverage.lower).toBeDefined()
    expect(result.coverage.upper).toBeDefined()
    expect(result.coverage.numbers).toBeDefined()
    expect(result.coverage.allPresent).toBe(true)
  })

  it('detects variable fonts and returns axes', async () => {
    const opentype = await import('opentype.js')
    opentype.default.parse.mockReturnValue({
      names: { fontFamily: { en: 'VariableFont' } },
      glyphs: { length: 500 },
      tables: {
        'CFF ': true,
        'OS/2': true,
        'fvar': {
          axes: [
            { tag: 'wght', minValue: 100, maxValue: 900, defaultValue: 400, name: { en: 'Weight' } },
          ],
        },
      },
      charToGlyph: vi.fn(() => ({ name: 'someglyph' })),
    })

    const buffer = new ArrayBuffer(0)
    const result = parseFont(buffer, 'otf')

    expect(result.metadata.format).toBe('OTF (variable)')
    expect(result.axes).toHaveLength(1)
    expect(result.axes[0].tag).toBe('wght')
  })

  it('throws for invalid font data', async () => {
    const opentype = await import('opentype.js')
    opentype.default.parse.mockImplementation(() => {
      throw new Error('Not a valid font')
    })

    const buffer = new ArrayBuffer(4)
    expect(() => parseFont(buffer, 'otf')).toThrow('Not a valid font')
  })

  it('handles fonts with missing metadata fields', async () => {
    const opentype = await import('opentype.js')
    opentype.default.parse.mockReturnValue({
      names: {
        fontFamily: { en: 'MinimalFont' },
      },
      glyphs: { length: 100 },
      tables: {},
      charToGlyph: vi.fn(() => ({ name: 'someglyph' })),
    })

    const buffer = new ArrayBuffer(0)
    const result = parseFont(buffer, 'otf')

    expect(result.metadata.name).toBe('MinimalFont')
    expect(result.metadata.author).toBe('')
    expect(result.metadata.license).toBe('')
    expect(result.metadata.manufacturer).toBe('')
    expect(result.metadata.format).toBe('OTF')
  })

  it('returns allPresent = false when a glyph is missing', async () => {
    const opentype = await import('opentype.js')
    opentype.default.parse.mockReturnValue({
      names: { fontFamily: { en: 'Test' } },
      glyphs: { length: 100 },
      tables: {},
      charToGlyph: vi.fn(() => ({ name: '.notdef' })),
    })

    const buffer = new ArrayBuffer(0)
    const result = parseFont(buffer, 'otf')

    expect(result.coverage.allPresent).toBe(false)
  })
})
