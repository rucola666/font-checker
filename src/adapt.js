// Adapts sample text to what a font actually contains, so previews and the
// specimen show what is there instead of what is missing.

export const LOWER = 'abcdefghijklmnopqrstuvwxyz'
export const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

const ratio = (chars, has) => [...chars].filter(has).length / chars.length

/** 'mixed' | 'upper' | 'lower' — which case setting shows the font best */
export function caseMode(has) {
  const lo = ratio(LOWER, has)
  const up = ratio(UPPER, has)
  if (lo === 1 && up > 0) return 'mixed'
  if (up === 1 && lo < 1) return 'upper'
  if (lo === 1 && up === 0) return 'lower'
  if (up === 0 && lo === 0) return 'mixed'
  return up > lo ? 'upper' : lo > up ? 'lower' : 'mixed'
}

export function applyCase(text, mode) {
  if (mode === 'upper') return text.toUpperCase()
  if (mode === 'lower') return text.toLowerCase()
  return text
}

/** Applies the case mode, then drops characters the font doesn't have. */
export function adaptText(text, has, mode = caseMode(has)) {
  return [...applyCase(text, mode)]
    .filter((c) => /\s/.test(c) || has(c))
    .join('')
    .replace(/ {2,}/g, ' ')
    .trim()
}

/** True if every non-space character of text (after case) is in the font. */
export function fullySupported(text, has, mode) {
  return [...applyCase(text, mode)].every((c) => /\s/.test(c) || has(c))
}
