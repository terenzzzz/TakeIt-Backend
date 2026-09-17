import { buildMediaFilename } from '../utils/filename.js'
import { jsonSafeText } from '../utils/text.js'

export class BaseExtractor {
  constructor(platform) {
    this.platform = platform
  }

  async extract(_url, _options = {}) {
    throw new Error('extract() must be implemented')
  }

  buildResult({ title = '', needsPassword = false, media = [], passwordRequired = false }) {
    return {
      platform: this.platform,
      title: jsonSafeText(title),
      needsPassword: needsPassword || passwordRequired,
      media: media.map((item, index) => ({
        type: item.type,
        url: item.url,
        thumbnail: item.type === 'video' ? item.thumbnail : (item.thumbnail || item.url),
        filename: item.filename || buildMediaFilename(item.url, item.type, index),
        ...(item.type === 'video' && item.qualities?.length
          ? { qualities: normalizeQualities(item.qualities, item.url) }
          : {}),
      })),
    }
  }
}

function normalizeQualities(qualities, fallbackUrl) {
  const seen = new Set()
  const normalized = qualities
    .filter((item) => {
      if (!item?.url || seen.has(item.url)) return false
      seen.add(item.url)
      return true
    })
    .map((item) => ({
      url: item.url,
      label: item.label || qualityLabel(item),
      ...(item.width ? { width: Number(item.width) } : {}),
      ...(item.height ? { height: Number(item.height) } : {}),
      ...(item.bitrate ? { bitrate: Number(item.bitrate) } : {}),
    }))
    .sort((a, b) => qualityScore(b) - qualityScore(a))

  if (fallbackUrl && !seen.has(fallbackUrl)) {
    normalized.push({ url: fallbackUrl, label: '默认' })
  }
  return normalized
}

function qualityLabel(item) {
  if (item.height) return `${item.height}p`
  if (item.bitrate) return `${Math.round(item.bitrate / 1000)} kbps`
  return '默认'
}

function qualityScore(item) {
  return (Number(item.height) || 0) * 1e9 +
    (Number(item.width) || 0) * 1e6 +
    (Number(item.bitrate) || 0)
}
