const URL_IN_TEXT_RE =
  /https?:\/\/(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}(?:\/[A-Za-z0-9_.?=&%/-]*)?[A-Za-z0-9_/-]/gi

const BARE_SHORT_LINK_RE =
  /(?:^|[\s"'<(【])((?:[A-Za-z0-9-]+\.)+(?:douyin|iesdouyin|xiaohongshu|xhslink|instagram|instagr)\.[A-Za-z]{2,}\/[A-Za-z0-9_/-]+)/i

const UNICODE_SPACE_RE = /[\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]/g
const INVISIBLE_CHARS_RE =
  /[\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180B-\u180E\u200B-\u200F\u202A-\u202E\u2060-\u206F\u2800\u3164\uFE00-\uFE0F\uFEFF\uFFA0]/g

export function sanitizeShareText(input = '') {
  return String(input)
    .replace(UNICODE_SPACE_RE, ' ')
    .replace(INVISIBLE_CHARS_RE, '')
    .replace(/[ \t]+/g, ' ')
    .trim()
}

export function normalizeUrl(input) {
  let url = sanitizeShareText(input)
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = `https://${url}`
  }
  return url
}

function cleanExtractedUrl(match = '') {
  return match.replace(/[.,;:!?）】]+$/g, '')
}

function isCleanUrlCandidate(input = '') {
  const text = sanitizeShareText(input)
  if (!text || /\s/.test(text)) return false
  return isValidUrl(text)
}

export function extractUrlFromText(input = '') {
  const text = sanitizeShareText(input)
  if (!text) return ''

  const matches = text.match(URL_IN_TEXT_RE) || []
  for (const match of matches) {
    const cleaned = cleanExtractedUrl(match)
    if (isValidUrl(cleaned)) return normalizeUrl(cleaned)
  }

  const bare = text.match(BARE_SHORT_LINK_RE)
  if (bare?.[1] && isValidUrl(bare[1])) return normalizeUrl(bare[1])

  if (isCleanUrlCandidate(text)) return normalizeUrl(text)
  return ''
}

export function isValidUrl(input) {
  if (!input || !sanitizeShareText(input)) return false
  if (/\s/.test(sanitizeShareText(input))) return false
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
