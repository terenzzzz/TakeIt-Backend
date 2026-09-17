export function jsonSafeText(value, maxLength) {
  let text = String(value || '')
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '')
    .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '')

  if (Number.isFinite(maxLength) && maxLength >= 0) {
    text = Array.from(text).slice(0, maxLength).join('')
  }

  return text
}
