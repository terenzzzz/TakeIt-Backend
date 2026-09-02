import axios from 'axios'

const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1'

const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'

const DOUYIN_URL_RE =
  /https?:\/\/(?:[A-Za-z0-9-]+\.)*(?:douyin|iesdouyin)\.com\/[A-Za-z0-9_.?=&%/-]*[A-Za-z0-9_/-]/i

const PATH_ID_RE = /\/(?:video|note|slides)\/(\d+)/
const DETAIL_API =
  'https://www.douyin.com/aweme/v1/web/aweme/detail/?device_platform=webapp&aid=6383&channel=channel_pc_web'
const TTWID_REGISTER_URL = 'https://ttwid.bytedance.com/ttwid/union/register/'
const PHOTO_AWEME_TYPES = new Set([2, 68])
const ALLOWED_HOSTS = ['douyin.com', 'iesdouyin.com']
const TTWID_TTL_MS = 60 * 60 * 1000

const client = axios.create({
  timeout: 20000,
  maxRedirects: 0,
  validateStatus: (status) => status < 500,
  proxy: false,
})

const shareClient = axios.create({
  timeout: 20000,
  maxRedirects: 5,
  validateStatus: (status) => status < 500,
  proxy: false,
})

let cachedTtwid = ''
let cachedTtwidAt = 0

function mobileHeaders(referer) {
  return {
    'User-Agent': MOBILE_UA,
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    ...(referer ? { Referer: referer } : {}),
  }
}

function desktopHeaders(cookie, referer) {
  return {
    'User-Agent': DESKTOP_UA,
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'sec-ch-ua': '"Google Chrome";v="123", "Not:A-Brand";v="8", "Chromium";v="123"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'Sec-Fetch-Site': 'same-origin',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Dest': 'empty',
    ...(cookie ? { Cookie: cookie } : {}),
    ...(referer ? { Referer: referer } : {}),
  }
}

function parseSetCookie(setCookie = []) {
  return setCookie.map((entry) => entry.split(';')[0]).filter(Boolean)
}

function mergeCookies(...parts) {
  const jar = new Map()
  for (const part of parts) {
    for (const piece of part) {
      const eq = piece.indexOf('=')
      if (eq > 0) jar.set(piece.slice(0, eq), piece.slice(eq + 1))
    }
  }
  return [...jar.entries()].map(([key, value]) => `${key}=${value}`).join('; ')
}

function videoPageUrl(awemeId) {
  return `https://www.douyin.com/video/${awemeId}`
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function invalidateTtwidCache() {
  cachedTtwid = ''
  cachedTtwidAt = 0
}

async function registerTtwid(force = false) {
  if (!force && cachedTtwid && Date.now() - cachedTtwidAt < TTWID_TTL_MS) {
    return cachedTtwid
  }

  const response = await shareClient.post(
    TTWID_REGISTER_URL,
    {
      region: 'cn',
      aid: 1768,
      needFid: false,
      service: 'www.douyin.com',
      migrate_info: { ticket: '', source: 'node' },
      cbUrlProtocol: 'https',
      union: true,
    },
    {
      headers: {
        'User-Agent': DESKTOP_UA,
        'Content-Type': 'application/json',
      },
      responseType: 'json',
    }
  )

  const cookies = parseSetCookie(response.headers['set-cookie'])
  const ttwidPair = cookies.find((entry) => entry.startsWith('ttwid='))
  if (!ttwidPair) {
    const err = new Error('无法获取抖音访问凭证')
    err.code = 'PARSE_FAILED'
    throw err
  }

  cachedTtwid = ttwidPair.slice('ttwid='.length)
  cachedTtwidAt = Date.now()
  return cachedTtwid
}

async function buildDouyinSession(awemeId, forceTtwid = false) {
  const ttwid = await registerTtwid(forceTtwid)
  const referer = videoPageUrl(awemeId)
  const ttwidCookie = [`ttwid=${ttwid}`]

  const pageResponse = await shareClient.get(referer, {
    headers: desktopHeaders(mergeCookies(ttwidCookie), referer),
    responseType: 'text',
    transformResponse: [(data) => data],
  })

  const cookie = mergeCookies(ttwidCookie, parseSetCookie(pageResponse.headers['set-cookie']))
  return { referer, cookie }
}

export function extractDouyinUrl(input = '') {
  const text = input.trim()
  const match = text.match(DOUYIN_URL_RE)
  if (match) return match[0]
  return text
}

function isDouyinHost(hostname = '') {
  const host = hostname.toLowerCase()
  return ALLOWED_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))
}

function extractPostId(url = '') {
  try {
    const parsed = new URL(url.includes('://') ? url : `https://${url}`)
    const modalIds = new URLSearchParams(parsed.search).getAll('modal_id')
    if (modalIds[0] && /^\d+$/.test(modalIds[0])) return modalIds[0]

    const match = parsed.pathname.match(PATH_ID_RE)
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

export async function resolveDouyinAwemeId(input) {
  let current = extractDouyinUrl(input)
  if (!current.includes('://')) current = `https://${current}`

  for (let i = 0; i < 6; i += 1) {
    let hostname = ''
    try {
      hostname = new URL(current).hostname.toLowerCase()
    } catch {
      break
    }

    if (!isDouyinHost(hostname)) {
      const err = new Error('链接不是有效的抖音作品分享链接')
      err.code = 'PARSE_FAILED'
      throw err
    }

    const awemeId = extractPostId(current)
    if (awemeId) return awemeId

    if (hostname.startsWith('live.')) {
      const err = new Error('暂不支持抖音直播链接')
      err.code = 'PARSE_FAILED'
      throw err
    }

    const next = await redirectTarget(current)
    if (!next) break
    current = next
  }

  const err = new Error('无法从链接中识别抖音作品 ID')
  err.code = 'PARSE_FAILED'
  throw err
}

function itemFromDetailPayload(payload, awemeId) {
  if (!payload || typeof payload !== 'object') return null

  if (payload.status_code && payload.status_code !== 0) {
    const filterList = payload.filter_list || []
    if (filterList.length > 0) {
      const entry = filterList[0]
      const reason = entry.detail_msg || entry.notice || entry.filter_reason || '作品不可用'
      const err = new Error(`抖音作品无法访问：${reason}`)
      err.code = 'EXPIRED'
      throw err
    }

    const err = new Error(payload.status_msg || '抖音接口暂时无法返回作品数据')
    err.code = 'PARSE_FAILED'
    throw err
  }

  if (payload.aweme_detail && typeof payload.aweme_detail === 'object') {
    return payload.aweme_detail
  }

  if (payload.item_list?.length) {
    return payload.item_list[0]
  }

  const err = new Error(`未找到抖音作品 ${awemeId}，可能已删除或设为私密`)
  err.code = 'NO_MEDIA'
  throw err
}

function parseDetailResponse(raw, awemeId) {
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (!trimmed) {
      const err = new Error('抖音接口返回空响应')
      err.code = 'PARSE_FAILED'
      throw err
    }
    if (trimmed.includes('ArgusSecurityPlugin') || trimmed.startsWith('Blocked by Argus')) {
      const err = new Error('抖音触发了访问限制，请稍后重试')
      err.code = 'BLOCKED'
      throw err
    }
    try {
      return itemFromDetailPayload(JSON.parse(trimmed), awemeId)
    } catch (err) {
      if (err.code) throw err
      const parseErr = new Error('抖音接口返回的数据格式异常')
      parseErr.code = 'PARSE_FAILED'
      throw parseErr
    }
  }

  return itemFromDetailPayload(raw, awemeId)
}

async function fetchDouyinDetailItem(awemeId) {
  let lastError = null

  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (attempt > 0) await sleep(700 * attempt)

    try {
      const { referer, cookie } = await buildDouyinSession(awemeId, attempt > 0)
      const params = new URLSearchParams({ aweme_id: awemeId })
      const response = await shareClient.get(`${DETAIL_API}&${params.toString()}`, {
        headers: desktopHeaders(cookie, referer),
        transformResponse: [(data) => data],
      })

      return parseDetailResponse(response.data, awemeId)
    } catch (err) {
      if (err.code === 'EXPIRED' || err.code === 'NO_MEDIA') throw err
      if (err.code === 'BLOCKED') {
        invalidateTtwidCache()
        lastError = err
        continue
      }
      lastError = err
    }
  }

  const err = new Error(lastError?.message || '抖音接口暂时无法返回作品数据')
  err.code = lastError?.code === 'BLOCKED' ? 'BLOCKED' : 'PARSE_FAILED'
  throw err
}

export async function fetchDouyinShareItem(awemeId) {
  return fetchDouyinDetailItem(awemeId)
}

function buildPlayUrl(videoId, ratio = '1080p') {
  return `https://aweme.snssdk.com/aweme/v1/play/?video_id=${encodeURIComponent(videoId)}&ratio=${ratio}&line=0`
}

function pickVideoUrl(item) {
  const video = item?.video || {}
  const uri = video?.play_addr?.uri
  if (uri) return buildPlayUrl(uri)

  const bitRates = [...(video.bit_rate || [])].sort(
    (a, b) => (b.bit_rate || 0) - (a.bit_rate || 0)
  )
  for (const entry of bitRates) {
    const url = entry?.play_addr?.url_list?.[0]
    if (url) return url.replace(/playwm/g, 'play')
  }

  const direct = video?.play_addr?.url_list?.[0]
  if (direct) return direct.replace(/playwm/g, 'play')

  return null
}

function pickImageUrls(images = []) {
  const urls = []
  for (const image of images) {
    const list = image?.url_list?.filter(Boolean) || []
    if (list.length > 0) urls.push(list[list.length - 1])
  }
  return urls
}

export function douyinItemToMedia(item, awemeId) {
  const media = []
  const title = (item.desc || '').trim()
  const author = item.author?.nickname || 'douyin'
  const images = item.images || []
  const isPhoto = PHOTO_AWEME_TYPES.has(item.aweme_type) || images.length > 0

  if (isPhoto) {
    pickImageUrls(images).forEach((url, index) => {
      media.push({
        type: 'image',
        url,
        thumbnail: url,
        filename: `douyin-${awemeId}-${index + 1}.jpg`,
      })
    })
  } else {
    const videoUrl = pickVideoUrl(item)
    if (videoUrl) {
      media.push({
        type: 'video',
        url: videoUrl,
        thumbnail: item.video?.cover?.url_list?.[0] || item.video?.origin_cover?.url_list?.[0],
        filename: `douyin-${awemeId}.mp4`,
      })
    }
  }

  return {
    title: title || `${author} - 抖音作品`,
    media,
  }
}

export async function parseDouyinShare(input) {
  const awemeId = await resolveDouyinAwemeId(input)
  const item = await fetchDouyinShareItem(awemeId)
  const { title, media } = douyinItemToMedia(item, awemeId)

  if (media.length === 0) {
    const err = new Error('该抖音作品未包含可下载的图片或视频')
    err.code = 'NO_MEDIA'
    throw err
  }

  return { awemeId, title, media }
}
