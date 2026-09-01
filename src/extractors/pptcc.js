import * as cheerio from 'cheerio'
import { BaseExtractor } from './base.js'
import { fetchHtml } from '../services/fetcher.js'
import { resolveUrl } from '../utils/url.js'

export class PptccExtractor extends BaseExtractor {
  constructor() {
    super('pptcc')
  }

  async extract(url) {
    const { html, finalUrl } = await fetchHtml(url)
    const $ = cheerio.load(html)
    const title = $('title').text().trim() || 'PPT.cc Media'
    const media = []

    $('video').each((_, el) => {
      const src = $(el).attr('src')
      if (src) {
        media.push({
          type: 'video',
          url: resolveUrl(finalUrl, src),
          filename: `${title}.mp4`,
        })
      }
      $(el)
        .find('source')
        .each((__, source) => {
          const s = $(source).attr('src')
          if (s) {
            media.push({
              type: 'video',
              url: resolveUrl(finalUrl, s),
              filename: `${title}.mp4`,
            })
          }
        })
    })

    $('img').each((_, el) => {
      const src = $(el).attr('src') || $(el).attr('data-src')
      if (src && !src.includes('logo') && !src.includes('icon') && !src.startsWith('data:')) {
        media.push({
          type: 'image',
          url: resolveUrl(finalUrl, src),
          thumbnail: resolveUrl(finalUrl, src),
          filename: `${title}.jpg`,
        })
      }
    })

    const scriptContent = $('script')
      .map((_, el) => $(el).html())
      .get()
      .join('\n')

    const videoMatch = scriptContent.match(/https?:\/\/[^"'\s]+\.(?:mp4|m3u8|webm)/i)
    if (videoMatch && !media.some((m) => m.url === videoMatch[0])) {
      media.push({
        type: 'video',
        url: videoMatch[0],
        filename: `${title}.mp4`,
      })
    }

    if (media.length === 0) {
      const err = new Error('未找到可下载的媒体资源')
      err.code = 'NO_MEDIA'
      throw err
    }

    return this.buildResult({ title, media: dedupe(media) })
  }
}

function dedupe(items) {
  const seen = new Set()
  return items.filter((item) => {
    if (seen.has(item.url)) return false
    seen.add(item.url)
    return true
  })
}
