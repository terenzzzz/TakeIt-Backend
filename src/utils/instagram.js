import axios from 'axios'
import {
  fetchHtmlImpersonated,
  postFormImpersonated,
  getImpersonatedCookies,
} from '../services/impersonatedHttp.js'
import { extractUrlFromText, sanitizeShareText } from './url.js'

const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'

const ALLOWED_HOSTS = ['instagram.com', 'instagr.am']
const SHORTCODE_RE = /\/(?:reel|reels|p|tv)\/([A-Za-z0-9_-]+)/i
const CONTEXT_JSON_RE = /"contextJSON":("(?:\\.|[^"\\])*")/
const SHORTCODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
const IG_APP_ID = '936619743392459'
const POLARIS_DOC_ID = '27130156389949648'
const POLARIS_FRIENDLY_NAME = 'PolarisLoggedOutDesktopWWWPostRootContentQuery'
const AUTH_TTL_MS = 30 * 60 * 1000

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

let cachedAuth = { lsd: '', csrf: '', at: 0 }

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

  return null
}

function shortcodeToMediaId(shortcode = '') {
  let value = 0n
  for (const char of shortcode) {
    const index = SHORTCODE_ALPHABET.indexOf(char)
    if (index < 0) return ''
    value = value * 64n + BigInt(index)
  }
  return value.toString()
}

function extractLsd(html = '') {
  const eqmc = html.match(/<script[^>]*id="__eqmc"[^>]*>(\{.*?})<\/script>/s)
  if (eqmc) {
    try {
      const parsed = JSON.parse(eqmc[1])
      if (parsed?.l) return String(parsed.l)
    } catch {
      // fall through
    }
  }
  return html.match(/\["LSD",\[\],\{"token":"([^"]+)"/)?.[1] || ''
}

function invalidateInstagramAuth() {
  cachedAuth = { lsd: '', csrf: '', at: 0 }
}

async function ensureInstagramAuth() {
  if (cachedAuth.lsd && cachedAuth.csrf && Date.now() - cachedAuth.at < AUTH_TTL_MS) {
    return cachedAuth
  }

  const home = await fetchHtmlImpersonated('https://www.instagram.com/', {
    headers: { 'Accept-Language': 'en-US,en;q=0.9' },
  })
  const lsd = extractLsd(home.html)
  const csrf = (await getImpersonatedCookies()).csrftoken || ''
  if (!lsd || !csrf) {
    const err = new Error('Instagram 触发了访问限制，请稍后重试')
    err.code = 'BLOCKED'
    throw err
  }

  cachedAuth = { lsd, csrf, at: Date.now() }
  return cachedAuth
}

function polarisApiHeaders(csrf, lsd, referer) {
  return {
    Accept: '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    'X-IG-App-ID': IG_APP_ID,
    'X-ASBD-ID': '359341',
    'X-IG-WWW-Claim': '0',
    'X-FB-Friendly-Name': POLARIS_FRIENDLY_NAME,
    'X-CSRFToken': csrf,
    'X-FB-LSD': lsd,
    'X-Requested-With': 'XMLHttpRequest',
    Referer: referer || 'https://www.instagram.com/',
    Origin: 'https://www.instagram.com',
  }
}

async function fetchPolarisMedia(shortcode, referer) {
  const mediaId = shortcodeToMediaId(shortcode)
  if (!mediaId) return null

  const { lsd, csrf } = await ensureInstagramAuth()
  const response = await postFormImpersonated(
    'https://www.instagram.com/api/graphql',
    {
      lsd,
      fb_api_caller_class: 'RelayModern',
      fb_api_req_friendly_name: POLARIS_FRIENDLY_NAME,
      server_timestamps: 'true',
      variables: JSON.stringify({ media_id: mediaId }),
      doc_id: POLARIS_DOC_ID,
    },
    { headers: polarisApiHeaders(csrf, lsd, referer) }
  )

  const body = response.html || ''
  if (response.status === 401 || /require_login|Please wait a few minutes/i.test(body)) {
    invalidateInstagramAuth()
    const err = new Error('Instagram 触发了访问限制，请稍后重试')
    err.code = 'BLOCKED'
    throw err
  }

  try {
    const payload = JSON.parse(body)
    return payload?.data?.xig_polaris_media?.if_not_gated_logged_out || null
  } catch {
    return null
  }
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

function collectPolarisVideoQualities(item = {}) {
  return [...(item.video_versions || [])]
    .filter((version) => version?.url)
    .map((version) => ({
      url: version.url,
      width: version.width,
      height: version.height,
      label: version.height ? `${version.height}p` : '',
    }))
    .sort((a, b) => (b.height || 0) - (a.height || 0) || (b.width || 0) - (a.width || 0))
}

function pickPolarisImageUrl(item = {}) {
  const candidates = [...(item.image_versions2?.candidates || [])].sort(
    (a, b) => (b.width || 0) - (a.width || 0)
  )
  return candidates[0]?.url || item.display_uri || ''
}

function polarisNodeToMedia(item, shortcode, index) {
  if (!item || typeof item !== 'object') return null
  const suffix = index == null ? '' : `-${index + 1}`
  const qualities = collectPolarisVideoQualities(item)
  const videoUrl = qualities[0]?.url || ''
  if (item.media_type === 2 || videoUrl) {
    if (!videoUrl) return null
    return {
      type: 'video',
      url: videoUrl,
      thumbnail: pickPolarisImageUrl(item),
      filename: `instagram-${shortcode}${suffix}.mp4`,
      qualities,
    }
  }

  const imageUrl = pickPolarisImageUrl(item)
  if (!imageUrl) return null
  return {
    type: 'image',
    url: imageUrl,
    thumbnail: imageUrl,
    filename: `instagram-${shortcode}${suffix}.jpg`,
  }
}

function collectPolarisMedia(item, shortcode) {
  if (item?.carousel_media?.length) {
    return item.carousel_media
      .map((child, index) => polarisNodeToMedia(child, shortcode, index))
      .filter(Boolean)
  }
  const media = polarisNodeToMedia(item, shortcode)
  return media ? [media] : []
}

function unavailableError() {
  const err = new Error('该 Instagram 作品无法公开访问，可能已删除、设为私密或未开放分享')
  err.code = 'PARSE_FAILED'
  return err
}

export async function parseInstagramShare(input) {
  const sourceUrl = extractInstagramUrl(input)
  const shortcode = await resolveInstagramShortcode(input)

  const embedRoot = await fetchEmbedMedia(shortcode)
  if (embedRoot?.copyright_blocked) {
    const err = new Error('该 Instagram 作品因版权限制无法下载')
    err.code = 'EXPIRED'
    throw err
  }

  if (embedRoot) {
    const media = collectMedia(embedRoot, shortcode)
    if (media.length > 0) {
      const owner = embedRoot.owner?.username || 'instagram'
      const caption = captionText(embedRoot)
      return {
        shortcode,
        title: caption || `@${owner} - Instagram 作品`,
        media,
      }
    }
  }

  const polarisItem = await fetchPolarisMedia(shortcode, sourceUrl)
  if (polarisItem) {
    const media = collectPolarisMedia(polarisItem, shortcode)
    if (media.length > 0) {
      const owner = polarisItem.user?.username || 'instagram'
      const caption = (polarisItem.caption?.text || '').trim()
      return {
        shortcode,
        title: caption || `@${owner} - Instagram 作品`,
        media,
      }
    }
  }

  throw unavailableError()
}
