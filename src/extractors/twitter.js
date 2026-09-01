import { BaseExtractor } from './base.js'
import { fetchJson } from '../services/fetcher.js'
import { normalizeUrl } from '../utils/url.js'

export class TwitterExtractor extends BaseExtractor {
  constructor() {
    super('twitter')
  }

  async extract(url) {
    const tweetUrl = this.normalizeTweetUrl(url)
    const path = new URL(tweetUrl).pathname + new URL(tweetUrl).search
    const data = await fetchJson(`https://api.fxtwitter.com${path}`)

    if (!data || data.code !== 200) {
      const err = new Error('无法解析该推文，链接可能无效或已删除')
      err.code = 'PARSE_FAILED'
      throw err
    }

    const tweet = data.tweet || data
    const title = tweet.author?.name
      ? `@${tweet.author.screen_name} - ${tweet.text?.slice(0, 50) || 'Tweet'}`
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
        const variants = video.variants || []
        const mp4s = variants
          .filter((v) => v.type === 'video/mp4' || v.url?.includes('.mp4'))
          .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))
        const best = mp4s[0] || video
        const videoUrl = best.url || video.url
        if (videoUrl) {
          media.push({
            type: 'video',
            url: videoUrl,
            thumbnail: video.thumbnail_url || tweet.media?.photos?.[0]?.url,
            filename: `twitter-video-${i + 1}.mp4`,
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
        if (item.type === 'video' && item.url) {
          if (!media.some((m) => m.url === item.url)) {
            media.push({
              type: 'video',
              url: item.url,
              thumbnail: item.thumbnail_url,
              filename: `twitter-video-${i + 1}.mp4`,
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

  normalizeTweetUrl(input) {
    const url = new URL(normalizeUrl(input))
    url.hostname = 'twitter.com'
    return url.href
  }
}
