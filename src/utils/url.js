const URL_IN_TEXT_RE =
  /https?:\/\/(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}(?:\/[A-Za-z0-9_.?=&%/-]*)?[A-Za-z0-9_/-]/gi

export function normalizeUrl(input) {
  let url = input.trim()
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = `https://${url}`
  }
  return url
}

export function extractUrlFromText(input = '') {
  const text = input.trim()
  if (!text) return ''

  if (isValidUrl(text)) return normalizeUrl(text)

  const matches = text.match(URL_IN_TEXT_RE) || []
  for (const match of matches) {
    const cleaned = match.replace(/[.,;:!?)]+$/g, '')
    if (isValidUrl(cleaned)) return normalizeUrl(cleaned)
  }

  return ''
}

export function isValidUrl(input) {
  if (!input || !input.trim()) return false
  try {
    const url = new URL(normalizeUrl(input))
    if (!['http:', 'https:'].includes(url.protocol)) return false
    if (!url.hostname.includes('.')) return false
    return true
  } catch {
    return false
  }
}

export function getHostname(input) {
  return new URL(normalizeUrl(input)).hostname.replace(/^www\./, '')
}

export function resolveUrl(base, relative) {
  try {
    return new URL(relative, base).href
  } catch {
    return relative
  }
}
