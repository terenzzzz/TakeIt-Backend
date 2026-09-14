import axios from 'axios'
import { extractUrlFromText, sanitizeShareText } from './url.js'

const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'

const ALLOWED_HOSTS = ['instagram.com', 'instagr.am']
const SHORTCODE_RE = /\/(?:reel|reels|p|tv)\/([A-Za-z0-9_-]+)/i
const CONTEXT_JSON_RE = /"contextJSON":("(?:\\.|[^"\\])*")/

const client = axios.create({
  timeout: 20000,
  maxRedirects: 0,
  validateStatus: (status) => status < 500,
  proxy: false,
})

const pageClient = axios.create({
  timeout: 20000,
  maxRedirects: 5,
  validateStatus: (status) => status < 500,
  proxy: false,
})

function mobileHeaders(referer) {
  return {
    'User-Agent': MOBILE_UA,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    ...(referer ? { Referer: referer } : {}),
  }
}

function isInstagramHost(hostname = '') {
  const host = hostname.toLowerCase()
  return ALLOWED_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))
}

export function extractInstagramUrl(input = '') {
  const extracted = extractUrlFromText(input)
  if (extracted) return extracted
  return sanitizeShareText(input)
}

export function extractShortcode(url = '') {
  try {
    const parsed = new URL(url.includes('://') ? url : `https://${url}`)
    const match = parsed.pathname.match(SHORTCODE_RE)
    return match?.[1] || ''
  } catch {
    return ''
  }
}

async function redirectTarget(url) {
  const response = await client.get(url, {
    headers: mobileHeaders(),
    responseType: 'stream',
  })
  response.data?.destroy?.()
  const location = response.headers.location
  if (!location) return ''
  return new URL(location, url).href
}

export async function resolveInstagramShortcode(input) {
  let current = extractInstagramUrl(input)
  if (!current.includes('://')) current = `https://${current}`

  for (let i = 0; i < 6; i += 1) {
    let hostname = ''
    try {
      hostname = new URL(current).hostname.toLowerCase()
    } catch {
      break
    }

    if (!isInstagramHost(hostname)) {
      const err = new Error('链接不是有效的 Instagram 分享链接')
      err.code = 'PARSE_FAILED'
      throw err
    }

    const shortcode = extractShortcode(current)
    if (shortcode) return shortcode

    const next = await redirectTarget(current)
    if (!next) break
    current = next
  }

  const err = new Error('无法从链接中识别 Instagram 作品')
  err.code = 'PARSE_FAILED'
  throw err
}

function parseContextJson(html = '') {
  const match = html.match(CONTEXT_JSON_RE)
  if (!match) return null
  try {
    const parsed = JSON.parse(JSON.parse(match[1]))
    return parsed?.gql_data?.shortcode_media || null
  } catch {
    return null
  }
}

function isLoginPage(html = '') {
  const lower = html.toLowerCase()
  return (
    lower.includes('accounts/login') &&
    (lower.includes('not-logged-in') || lower.includes('log in')) &&
    !html.includes('shortcode_media')
  )
}

async function fetchEmbedMedia(shortcode) {
  const paths = [
    `https://www.instagram.com/p/${shortcode}/embed/captioned/`,
    `https://www.instagram.com/reel/${shortcode}/embed/captioned/`,
  ]

  let lastHtml = ''
  for (const url of paths) {
    const response = await pageClient.get(url, {
      headers: mobileHeaders('https://www.instagram.com/'),
      responseType: 'text',
      transformResponse: [(data) => data],
    })
    const html = typeof response.data === 'string' ? response.data : ''
    lastHtml = html
    const media = parseContextJson(html)
    if (media) return media
  }

  if (isLoginPage(lastHtml)) {
    const err = new Error('Instagram 触发了访问限制，请稍后重试')
    err.code = 'BLOCKED'
    throw err
  }

  const err = new Error('无法解析该 Instagram 作品，链接可能无效或已设为私密')
  err.code = 'PARSE_FAILED'
  throw err
}

function captionText(node) {
  const edges = node?.edge_media_to_caption?.edges || []
  return (edges[0]?.node?.text || '').trim()
}

function pickImageUrl(node) {
  const resources = [...(node?.display_resources || [])].sort(
    (a, b) => (b.config_width || 0) - (a.config_width || 0)
  )
  return resources[0]?.src || node?.display_url || node?.thumbnail_src || ''
}

function nodeToMedia(node, shortcode, index) {
  if (!node || typeof node !== 'object') return null
  const suffix = index == null ? '' : `-${index + 1}`

  if (node.is_video || node.__typename === 'GraphVideo') {
    if (!node.video_url) return null
    return {
      type: 'video',
      url: node.video_url,
      thumbnail: pickImageUrl(node),
      filename: `instagram-${shortcode}${suffix}.mp4`,
    }
  }

  const imageUrl = pickImageUrl(node)
  if (!imageUrl) return null
  return {
    type: 'image',
    url: imageUrl,
    thumbnail: imageUrl,
    filename: `instagram-${shortcode}${suffix}.jpg`,
  }
}

function collectMedia(root, shortcode) {
  const children = root?.edge_sidecar_to_children?.edges || []
  if (children.length > 0) {
    return children
      .map((edge, index) => nodeToMedia(edge?.node, shortcode, index))
      .filter(Boolean)
  }
  const item = nodeToMedia(root, shortcode)
  return item ? [item] : []
}

export async function parseInstagramShare(input) {
  const shortcode = await resolveInstagramShortcode(input)
  const root = await fetchEmbedMedia(shortcode)

  if (root.copyright_blocked) {
    const err = new Error('该 Instagram 作品因版权限制无法下载')
    err.code = 'EXPIRED'
    throw err
  }

  const media = collectMedia(root, shortcode)
  if (media.length === 0) {
    const err = new Error('该 Instagram 作品未包含可下载的图片或视频')
    err.code = 'NO_MEDIA'
    throw err
  }

  const owner = root.owner?.username || 'instagram'
  const caption = captionText(root)
  const title = caption || `@${owner} - Instagram 作品`

  return { shortcode, title, media }
}
