const MIME_EXT = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
}

const TYPE_EXT = {
  image: 'jpg',
  video: 'mp4',
  audio: 'mp3',
}

export function sanitizeFilename(name) {
  return (name || 'download')
    .replace(/[^\w\u4e00-\u9fa5.\-]/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120)
}

export function buildMediaFilename(url, type = 'image', index = 0) {
  try {
    const pathname = decodeURIComponent(new URL(url).pathname)
    const basename = pathname.split('/').filter(Boolean).pop() || ''
    if (/\.[a-z0-9]{2,5}$/i.test(basename)) {
      return sanitizeFilename(basename)
    }
  } catch {
    // ignore invalid URLs
  }

  const ext = TYPE_EXT[type] || 'bin'
  return `media-${index + 1}.${ext}`
}

export function ensureFilenameExtension(filename, contentType) {
  const safeName = sanitizeFilename(filename || 'download')
  if (/\.[a-z0-9]{2,5}$/i.test(safeName)) return safeName

  const mime = contentType?.split(';')[0]?.trim().toLowerCase()
  const ext = MIME_EXT[mime]
  if (ext) return `${safeName}.${ext}`

  return safeName
}
