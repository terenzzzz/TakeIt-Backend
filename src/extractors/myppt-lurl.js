import * as cheerio from 'cheerio'
import { BaseExtractor } from './base.js'
import { fetchHtml, postForm } from '../services/fetcher.js'
import { extractShortLinkPage } from '../services/shortlinkHttp.js'
import {
  detectPageStatus,
  extractDatePasswords,
  extractMediaFromHtml,
  mediaFromCapturedUrls,
  tryPasswords,
} from '../utils/password.js'
import { resolveUrl } from '../utils/url.js'
import { buildMediaFilename } from '../utils/filename.js'

const HTTP_PLATFORMS = new Set(['lurl', 'myppt'])

class ShortLinkExtractor extends BaseExtractor {
  constructor(platform) {
    super(platform)
    this.useHttpClient = HTTP_PLATFORMS.has(platform)
  }

  async fetchWithPassword(url, password) {
    if (this.useHttpClient) {
      return extractShortLinkPage(url, { password })
    }

    const { html, finalUrl, status } = await fetchHtml(url)
    const pageStatus = detectPageStatus(html)

    if (pageStatus === 'normal' || this.hasMedia(html)) {
      return { html, finalUrl, status }
    }

    if (!password) {
      return { html, finalUrl, status, pageStatus }
    }

    const $ = cheerio.load(html)
    const form = $('form').first()
    const action = form.attr('action') || url
    const formUrl = resolveUrl(finalUrl, action)

    const fields = {}
    form.find('input').each((_, el) => {
      const name = $(el).attr('name')
      const type = $(el).attr('type') || 'text'
      if (!name) return
      if (type === 'password') {
        fields[name] = password
      } else {
        fields[name] = $(el).attr('value') || ''
      }
    })

    if (Object.keys(fields).length === 0) {
      fields.password = password
      fields.pwd = password
    }

    return postForm(formUrl, fields)
  }

  hasMedia(html, mediaUrls = []) {
    if (mediaUrls.length > 0) return true
    const $ = cheerio.load(html)
    return (
      $('video, audio, canvas').length > 0 ||
      $('img[src], link[rel="preload"][as="image"]').filter((_, el) => {
        const src = $(el).attr('src') || $(el).attr('href') || ''
        return src && !/logo|icon|18-plus|\/app\//i.test(src)
      }).length > 0
    )
  }

  collectMedia(result) {
    const media = [
      ...extractMediaFromHtml(result.html, result.finalUrl),
      ...mediaFromCapturedUrls(result.mediaUrls),
    ]
    const seen = new Set()
    return media.filter((item) => {
      if (!item.url || seen.has(item.url)) return false
      seen.add(item.url)
      return true
    })
  }

  buildExtractResult(result) {
    if (result.needsPassword) {
      const $ = cheerio.load(result.html)
      return this.buildResult({
        title: $('title').text().trim() || this.platform,
        needsPassword: true,
        media: [],
      })
    }

    const $ = cheerio.load(result.html)
    const title = $('title').text().trim() || this.platform
    const media = this.collectMedia(result)

    if (media.length === 0) {
      const err = new Error('未找到可下载的媒体资源')
      err.code = 'NO_MEDIA'
      throw err
    }

    return this.buildResult({
      title,
      media: media.map((m, i) => ({
        ...m,
        filename: m.filename || buildMediaFilename(m.url, m.type, i),
      })),
    })
  }

  async extract(url, options = {}) {
    if (this.useHttpClient) {
      const result = await extractShortLinkPage(url, { password: options.password })
      return this.buildExtractResult(result)
    }

    let result

    if (options.password) {
      result = await this.fetchWithPassword(url, options.password)
      const status = detectPageStatus(result.html)
      if (status === 'passwordFailed') {
        const err = new Error('密码不正确，请重试')
        err.code = 'PASSWORD_FAILED'
        throw err
      }
    } else {
      const initial = await this.fetchWithPassword(url)
      const pageStatus = initial.pageStatus || detectPageStatus(initial.html)

      if (pageStatus === 'blocked') {
        const err = new Error('目标网站启用了防护，暂时无法解析')
        err.code = 'BLOCKED'
        throw err
      }

      if (pageStatus === 'expired') {
        const err = new Error('该链接可能已过期或失效')
        err.code = 'EXPIRED'
        throw err
      }

      if (pageStatus === 'needsPassword' || !this.hasMedia(initial.html, initial.mediaUrls)) {
        const passwords = extractDatePasswords(initial.html)
        if (passwords.length > 0) {
          result = await tryPasswords(
            (u, pwd) => this.fetchWithPassword(u, pwd),
            url,
            passwords
          )
        }
        if (!result || !this.hasMedia(result.html, result.mediaUrls)) {
          return this.buildResult({
            title: cheerio.load(initial.html)('title').text().trim() || this.platform,
            needsPassword: true,
            media: [],
          })
        }
      } else {
        result = initial
      }
    }

    return this.buildExtractResult(result)
  }
}

export class MypptExtractor extends ShortLinkExtractor {
  constructor() {
    super('myppt')
  }
}

export class LurlExtractor extends ShortLinkExtractor {
  constructor() {
    super('lurl')
  }
}
