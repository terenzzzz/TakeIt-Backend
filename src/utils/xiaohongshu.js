import { fetchHtmlImpersonated } from '../services/impersonatedHttp.js'
import { extractUrlFromText } from './url.js'

const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1'

const ALLOWED_HOSTS = ['xiaohongshu.com', 'xhslink.com', 'xhslink.cn', 'rednote.com']
const NOTE_ID_RE = /\/(?:explore|discovery\/item|user\/profile\/[^/]+)\/([a-f0-9]{24})/i
const INITIAL_STATE_RE = /window\.__INITIAL_STATE__=({.+?})<\/script>/s

export function isXiaohongshuHost(hostname = '') {
  const host = hostname.toLowerCase()
  return ALLOWED_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))
}

export function extractNoteId(url = '') {
  try {
    const parsed = new URL(url.includes('://') ? url : `https://${url}`)
    const match = parsed.pathname.match(NOTE_ID_RE)
    return match?.[1] || ''
  } catch {
    return ''
  }
}

function parseInitialState(html) {
  const match = html.match(INITIAL_STATE_RE)
  if (!match) return null

  try {
    return JSON.parse(match[1].replace(/undefined/g, 'null'))
  } catch {
    return null
  }
}

function pickNoteFromState(state, noteId) {
  if (!state || typeof state !== 'object') return null

  const mobileNote = state.noteData?.data?.noteData
  if (mobileNote && (!noteId || mobileNote.noteId === noteId)) {
    return mobileNote
  }

  const detailMap = state.note?.noteDetailMap
  if (detailMap && typeof detailMap === 'object') {
    const key = noteId && detailMap[noteId] ? noteId : Object.keys(detailMap)[0]
    const entry = detailMap[key]
    const note = entry?.note || entry
    if (note && typeof note === 'object') return note
  }

  return null
}

function upgradeToHttps(url) {
  if (!url || typeof url !== 'string') return ''
  return url.startsWith('http://') ? `https://${url.slice('http://'.length)}` : url
}

function pickImageUrl(image = {}) {
  if (image.urlDefault) return upgradeToHttps(image.urlDefault)

  const infoList = image.infoList || []
  const preferred =
    infoList.find((item) => item.imageScene === 'WB_DFT') ||
    infoList.find((item) => item.imageScene === 'H5_DTL') ||
    infoList[infoList.length - 1]
  if (preferred?.url) return upgradeToHttps(preferred.url)

  if (image.url) return upgradeToHttps(image.url)
  return ''
}

function pickStreamUrl(stream = {}) {
  const candidates = [
    ...(Array.isArray(stream.h264) ? stream.h264 : []),
    ...(Array.isArray(stream.h265) ? stream.h265 : []),
  ]

  for (const entry of candidates) {
    const url = entry?.masterUrl || entry?.backupUrls?.[0]
    if (url) return upgradeToHttps(url)
  }

  return ''
}

function pickVideoUrl(note = {}, html = '') {
  const video = note.video || {}
  const originKey = video.consumer?.originVideoKey
  if (originKey) {
    return upgradeToHttps(`https://sns-video-bd.xhscdn.com/${originKey}`)
  }

  const streamUrl = pickStreamUrl(video.media?.stream || {})
  if (streamUrl) return streamUrl

  const ogMatch = html.match(/<meta[^>]+property=["']og:video(?::url)?["'][^>]+content=["']([^"']+)["']/i)
  if (ogMatch?.[1]) return upgradeToHttps(ogMatch[1])

  return ''
}

function pickVideoThumbnail(note = {}) {
  const video = note.video || {}
  return (
    video.image?.thumbnail ||
    video.cover?.urlDefault ||
    video.cover?.url ||
    note.cover?.url ||
    ''
  )
}

export function xiaohongshuNoteToMedia(note, noteId, html = '') {
  const media = []
  const title = (note.title || note.desc || '').trim()
  const author = note.user?.nickname || note.user?.nickName || 'xiaohongshu'
  const type = note.type || 'normal'

  if (type === 'video') {
    const videoUrl = pickVideoUrl(note, html)
    if (videoUrl) {
      media.push({
        type: 'video',
        url: videoUrl,
        thumbnail: upgradeToHttps(pickVideoThumbnail(note)),
        filename: `xiaohongshu-${noteId}.mp4`,
      })
    }
  }

  const images = note.imageList || []
  if (images.length > 0) {
    images.forEach((image, index) => {
      const imageUrl = pickImageUrl(image)
      if (!imageUrl) return
      media.push({
        type: 'image',
        url: imageUrl,
        thumbnail: imageUrl,
        filename: `xiaohongshu-${noteId}-${index + 1}.jpg`,
      })
    })
  }

  return {
    title: title || `${author} - 小红书笔记`,
    media,
  }
}

async function fetchNotePage(input) {
  const response = await fetchHtmlImpersonated(input, {
    headers: {
      'User-Agent': MOBILE_UA,
      Referer: 'https://www.xiaohongshu.com/',
    },
    timeout: 30,
  })

  if (!response.html || response.status >= 400) {
    const err = new Error('无法访问该小红书链接')
    err.code = 'PARSE_FAILED'
    throw err
  }

  return response
}

export async function parseXiaohongshuShare(input) {
  let current = extractUrlFromText(input) || input.trim()
  if (!current.includes('://')) current = `https://${current}`

  const response = await fetchNotePage(current)
  const finalUrl = response.finalUrl || current
  const noteId = extractNoteId(finalUrl) || extractNoteId(current)

  const state = parseInitialState(response.html)
  if (!state) {
    const err = new Error('无法解析小红书页面数据')
    err.code = 'PARSE_FAILED'
    throw err
  }

  const note = pickNoteFromState(state, noteId)
  if (!note) {
    const err = new Error('未找到小红书笔记内容，链接可能已失效')
    err.code = 'EXPIRED'
    throw err
  }

  const resolvedNoteId = note.noteId || noteId || 'note'
  const { title, media } = xiaohongshuNoteToMedia(note, resolvedNoteId, response.html)

  if (media.length === 0) {
    const err = new Error('该小红书笔记未包含可下载的图片或视频')
    err.code = 'NO_MEDIA'
    throw err
  }

  return { noteId: resolvedNoteId, title, media }
}
