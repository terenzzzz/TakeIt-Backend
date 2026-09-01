export function normalizeUrl(input) {
  let url = input.trim()
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = `https://${url}`
  }
  return url
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
