import { BaseExtractor } from './base.js'
import { fetchJson } from '../services/fetcher.js'
import { jsonSafeText } from '../utils/text.js'
import { normalizeUrl } from '../utils/url.js'

const TWEET_ID_RE = /\/(?:status|statuses)\/(\d+)/i

export function extractTweetId(input) {
  try {
    const url = new URL(normalizeUrl(input))
    return (
      url.pathname.match(TWEET_ID_RE)?.[1] ||
      url.searchParams.get('tweet_id') ||
      url.searchParams.get('id') ||
      ''
    )
  } catch {
    return ''
  }
}

function collectVideoQualities(video = {}) {
  const candidates = [...(video.variants || []), ...(video.formats || [])]
  const seen = new Set()
  const qualities = candidates
    .filter((v) => {
      const mime = String(v.type || v.content_type || v.container || '').toLowerCase()
      if (!v.url || (!mime.includes('mp4') && !v.url.includes('.mp4')) || seen.has(v.url)) {
        return false
      }
      seen.add(v.url)
      return true
    })
    .map((variant) => {
      const pathSize = variant.url.match(/\/(\d+)x(\d+)\//)
      const width = Number(variant.width || pathSize?.[1] || video.width) || undefined
      const height = Number(variant.height || pathSize?.[2] || video.height) || undefined
      const resolution = width && height ? Math.min(width, height) : height
      return {
        url: variant.url,
        width,
        height,
        bitrate: variant.bitrate,
        label: resolution
          ? `${resolution}p`
          : variant.bitrate
            ? `${Math.round(variant.bitrate / 1000)} kbps`
            : '',
      }
    })
    .sort(
      (a, b) => (b.height || 0) - (a.height || 0) || (b.bitrate || 0) - (a.bitrate || 0)
    )

  if (qualities.length === 0 && video.url) {
    qualities.push({
      url: video.url,
      width: video.width,
      height: video.height,
      label: video.height ? `${video.height}p` : '默认',
    })
  }
  return qualities
}

export class TwitterExtractor extends BaseExtractor {
  constructor() {
    super('twitter')
  }

  async extract(url) {
    const tweetId = extractTweetId(url)
    if (!tweetId) {
      const err = new Error('无法识别该推文链接')
      err.code = 'PARSE_FAILED'
      throw err
    }

    const data = await fetchJson(`https://api.fxtwitter.com/status/${tweetId}`)

    if (!data || data.code !== 200) {
      const err = new Error('无法解析该推文，链接可能无效或已删除')
      err.code = 'PARSE_FAILED'
      throw err
    }

    const tweet = data.tweet || data.status || data
    const title = tweet.author?.name
      ? `@${tweet.author.screen_name} - ${jsonSafeText(tweet.text, 50) || 'Tweet'}`
      : 'Twitter Media'

    const media = []

    if (tweet.media?.photos?.length) {
      tweet.media.photos.forEach((photo, i) => {
        const imgUrl = photo.url || photo
        media.push({
          type: 'image',
          url: typeof imgUrl === 'string' ? imgUrl : imgUrl.url,
          thumbnail: typeof imgUrl === 'string' ? imgUrl : imgUrl.url,
          filename: `twitter-${i + 1}.jpg`,
        })
      })
    }

    if (tweet.media?.videos?.length) {
      tweet.media.videos.forEach((video, i) => {
        const qualities = collectVideoQualities(video)
        const videoUrl = qualities[0]?.url
        if (videoUrl) {
          media.push({
            type: 'video',
            url: videoUrl,
            thumbnail: video.thumbnail_url || tweet.media?.photos?.[0]?.url,
            filename: `twitter-video-${i + 1}.mp4`,
            qualities,
          })
        }
      })
    }

    if (tweet.media?.all?.length) {
      tweet.media.all.forEach((item, i) => {
        if (item.type === 'photo' && item.url) {
          if (!media.some((m) => m.url === item.url)) {
            media.push({
              type: 'image',
              url: item.url,
              thumbnail: item.url,
              filename: `twitter-${i + 1}.jpg`,
            })
          }
        }
        if (item.type === 'video') {
          const qualities = collectVideoQualities(item)
          const videoUrl = qualities[0]?.url
          if (videoUrl && !media.some((m) => m.url === videoUrl)) {
            media.push({
              type: 'video',
              url: videoUrl,
              thumbnail: item.thumbnail_url,
              filename: `twitter-video-${i + 1}.mp4`,
              qualities,
            })
          }
        }
      })
    }

    if (media.length === 0) {
      const err = new Error('该推文未包含可下载的媒体资源')
      err.code = 'NO_MEDIA'
      throw err
    }

    return this.buildResult({ title, media })
  }
}
