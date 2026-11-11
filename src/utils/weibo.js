import { fetchJson } from '../services/fetcher.js'
import { extractUrlFromText, sanitizeShareText } from './url.js'

const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1'

const ALLOWED_HOSTS = ['weibo.com', 'weibo.cn']
const STATUS_ID_RE =
  /\/(?:status|detail|statuses\/show)\/([A-Za-z0-9]+)(?:[/?#]|$)/i
const UID_STATUS_RE = /\/(\d{5,})\/([A-Za-z0-9]+)(?:[/?#]|$)/i
const HTML_TAG_RE = /<[^>]+>/g
const VIDEO_URL_KEYS = [
  { key: 'mp4_1080p_mp4', label: '1080p' },
  { key: 'mp4_720p_mp4', label: '720p' },
  { key: 'mp4_hd_mp4', label: 'HD' },
  { key: 'mp4_ld_mp4', label: 'LD' },
  { key: 'mp4_hd_url', label: 'HD' },
  { key: 'mp4_sd_url', label: 'SD' },
  { key: 'stream_url_hd', label: 'HD' },
  { key: 'stream_url', label: '默认' },
]

export function isWeiboHost(hostname = '') {
  const host = hostname.toLowerCase()
  return ALLOWED_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))
}

export function extractWeiboStatusId(url = '') {
  try {
    const parsed = new URL(url.includes('://') ? url : `https://${url}`)
    const fromPath =
      parsed.pathname.match(STATUS_ID_RE)?.[1] ||
      parsed.pathname.match(UID_STATUS_RE)?.[2] ||
      ''
    if (fromPath) return fromPath

    const fromQuery = parsed.searchParams.get('id') || parsed.searchParams.get('mid') || ''
    return fromQuery
  } catch {
    return ''
  }
}

function upgradeToHttps(url) {
  if (!url || typeof url !== 'string') return ''
  return url.startsWith('http://') ? `https://${url.slice('http://'.length)}` : url
}

function stripHtml(text = '') {
  return String(text)
    .replace(HTML_TAG_RE, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

function pickImageUrl(pic = {}) {
  return upgradeToHttps(
    pic.largest?.url ||
      pic.large?.url ||
      pic.mw2000?.url ||
      pic.original?.url ||
      pic.url ||
      ''
  )
}

function pickImageThumbnail(pic = {}) {
  return upgradeToHttps(pic.url || pic.large?.url || '')
}

function addQuality(qualities, seen, url, metadata = {}) {
  const resolved = upgradeToHttps(url)
  if (!resolved || seen.has(resolved)) return
  seen.add(resolved)
  qualities.push({
    url: resolved,
    width: metadata.width,
    height: metadata.height,
    bitrate: metadata.bitrate,
    label: metadata.label || (metadata.height ? `${metadata.height}p` : ''),
  })
}

function collectVideoQualities(pageInfo = {}) {
  const qualities = []
  const seen = new Set()
  const urls = pageInfo.urls && typeof pageInfo.urls === 'object' ? pageInfo.urls : {}
  const mediaInfo =
    pageInfo.media_info && typeof pageInfo.media_info === 'object' ? pageInfo.media_info : {}

  for (const { key, label } of VIDEO_URL_KEYS) {
    addQuality(qualities, seen, urls[key] || mediaInfo[key], { label })
  }

  if (Array.isArray(pageInfo.urls)) {
    for (const entry of pageInfo.urls) {
      addQuality(qualities, seen, entry?.url || entry, {
        label: entry?.label || '',
        width: entry?.width,
        height: entry?.height,
        bitrate: entry?.bitrate,
      })
    }
  }

  return qualities.sort(
    (a, b) => (b.height || 0) - (a.height || 0) || (b.bitrate || 0) - (a.bitrate || 0)
  )
}

function pickVideoThumbnail(pageInfo = {}, status = {}) {
  return upgradeToHttps(
    pageInfo.page_pic?.url ||
      pageInfo.page_pic ||
      status.thumbnail_pic ||
      status.bmiddle_pic ||
      status.original_pic ||
      ''
  )
}

function pushVideo(media, statusId, pageInfo, status) {
  const qualities = collectVideoQualities(pageInfo)
  const videoUrl = qualities[0]?.url
  if (!videoUrl) return

  media.push({
    type: 'video',
    url: videoUrl,
    thumbnail: pickVideoThumbnail(pageInfo, status),
    filename: `weibo-${statusId}.mp4`,
    qualities,
  })
}

function pushImages(media, statusId, pics = []) {
  pics.forEach((pic, index) => {
    const imageUrl = pickImageUrl(pic)
    if (!imageUrl) return

    media.push({
      type: 'image',
      url: imageUrl,
      thumbnail: pickImageThumbnail(pic) || imageUrl,
      filename: `weibo-${statusId}-${index + 1}.jpg`,
    })

    const liveUrl = upgradeToHttps(pic.videoSrc || pic.live_photo?.url || '')
    if (liveUrl) {
      media.push({
        type: 'video',
        url: liveUrl,
        thumbnail: imageUrl,
        filename: `weibo-${statusId}-${index + 1}-live.mp4`,
      })
    }
  })
}

function pushMixMedia(media, statusId, items = []) {
  let imageIndex = 0
  let videoIndex = 0

  for (const item of items) {
    const type = item?.type || item?.data?.type || ''
    const data = item?.data || item || {}

    if (type === 'video' || data.media_info || data.urls) {
      videoIndex += 1
      const qualities = collectVideoQualities(data)
      const videoUrl = qualities[0]?.url
      if (!videoUrl) continue
      media.push({
        type: 'video',
        url: videoUrl,
        thumbnail: pickVideoThumbnail(data),
        filename: `weibo-${statusId}-mix-${videoIndex}.mp4`,
        qualities,
      })
      continue
    }

    const imageUrl = pickImageUrl(data) || upgradeToHttps(data.original_pic || data.url || '')
    if (!imageUrl) continue
    imageIndex += 1
    media.push({
      type: 'image',
      url: imageUrl,
      thumbnail: upgradeToHttps(data.bmiddle_pic || data.thumbnail_pic || imageUrl),
      filename: `weibo-${statusId}-mix-${imageIndex}.jpg`,
    })
  }
}

export function weiboStatusToMedia(status, statusId) {
  const media = []
  const author = status.user?.screen_name || 'weibo'
  const titleText = stripHtml(status.status_title || status.text || '')
  const resolvedId = status.bid || status.mid || status.id || statusId || 'status'
  const pageInfo = status.page_info || {}
  const pics = Array.isArray(status.pics) ? status.pics : []
  const mixItems = status.mix_media_info?.items

  if (Array.isArray(mixItems) && mixItems.length > 0) {
    pushMixMedia(media, resolvedId, mixItems)
  } else {
    if (pageInfo.type === 'video' || pageInfo.object_type === 'video' || pageInfo.media_info) {
      pushVideo(media, resolvedId, pageInfo, status)
    }
    if (pics.length > 0) {
      pushImages(media, resolvedId, pics)
    } else if (!media.length && status.original_pic) {
      media.push({
        type: 'image',
        url: upgradeToHttps(status.original_pic),
        thumbnail: upgradeToHttps(status.bmiddle_pic || status.thumbnail_pic || status.original_pic),
        filename: `weibo-${resolvedId}-1.jpg`,
      })
    }
  }

  return {
    title: titleText || `${author} - 微博`,
    media,
  }
}

function pickStatusPayload(data) {
  if (!data || typeof data !== 'object') return null
  if (data.retweeted_status && typeof data.retweeted_status === 'object') {
    const ownPics = Array.isArray(data.pics) ? data.pics.length : 0
    const ownVideo = Boolean(data.page_info?.media_info || data.page_info?.urls)
    const ownMix = Array.isArray(data.mix_media_info?.items) ? data.mix_media_info.items.length : 0
    if (!ownPics && !ownVideo && !ownMix) {
      return data.retweeted_status
    }
  }
  return data
}

async function fetchWeiboStatus(statusId) {
  const url = `https://m.weibo.cn/statuses/show?id=${encodeURIComponent(statusId)}`
  let data
  try {
    data = await fetchJson(url, {
      headers: {
        'User-Agent': MOBILE_UA,
        Referer: 'https://m.weibo.cn/',
        'X-Requested-With': 'XMLHttpRequest',
        Accept: 'application/json, text/plain, */*',
      },
    })
  } catch {
    const err = new Error('无法访问该微博链接')
    err.code = 'PARSE_FAILED'
    throw err
  }

  if (!data || data.ok !== 1 || !data.data) {
    const err = new Error('未找到微博内容，链接可能已失效或设为私密')
    err.code = 'EXPIRED'
    throw err
  }

  return data.data
}

export async function parseWeiboShare(input) {
  let current = extractUrlFromText(input) || sanitizeShareText(input)
  if (!current) {
    const err = new Error('未找到有效的微博链接')
    err.code = 'PARSE_FAILED'
    throw err
  }
  if (!current.includes('://')) current = `https://${current}`

  const statusId = extractWeiboStatusId(current)
  if (!statusId) {
    const err = new Error('无法识别微博链接中的博文 ID')
    err.code = 'PARSE_FAILED'
    throw err
  }

  const rawStatus = await fetchWeiboStatus(statusId)
  const status = pickStatusPayload(rawStatus)
  const resolvedId = status?.bid || status?.mid || status?.id || statusId
  const { title, media } = weiboStatusToMedia(status || {}, resolvedId)

  if (media.length === 0) {
    const err = new Error('该微博未包含可下载的图片或视频')
    err.code = 'NO_MEDIA'
    throw err
  }

  return { statusId: resolvedId, title, media }
}
