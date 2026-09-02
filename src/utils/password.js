import * as cheerio from 'cheerio'

export function extractDatePasswords(html) {
  const $ = cheerio.load(html)
  const text = $('body').text()
  const passwords = new Set()

  const patterns = [
    /(\d{4})[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})/g,
    /(\d{1,2})[\/\-.月](\d{1,2})[日号]?/g,
    /(\d{2})(\d{2})/g,
  ]

  for (const pattern of patterns) {
    let match
    while ((match = pattern.exec(text)) !== null) {
      if (match.length === 4) {
        const month = match[2].padStart(2, '0')
        const day = match[3].padStart(2, '0')
        addPasswordVariants(passwords, month, day)
      } else if (match.length === 3) {
        const month = match[1].padStart(2, '0')
        const day = match[2].padStart(2, '0')
        addPasswordVariants(passwords, month, day)
      }
    }
  }

  return [...passwords]
}

function addPasswordVariants(set, month, day) {
  const mm = parseInt(month, 10)
  const dd = parseInt(day, 10)
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return

  const base = `${month}${day}`
  set.add(base)

  const date = new Date(2000, mm - 1, dd)
  for (const offset of [-1, 1]) {
    const d = new Date(date)
    d.setDate(d.getDate() + offset)
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const dy = String(d.getDate()).padStart(2, '0')
    set.add(`${m}${dy}`)
  }
}

export function detectPageStatus(html) {
  const lower = html.toLowerCase()

  if (
    lower.includes('attention required! | cloudflare') ||
    lower.includes('sorry, you have been blocked') ||
    lower.includes('cf-error-details') ||
    lower.includes('you are unable to access')
  ) {
    return 'blocked'
  }

  if (
    lower.includes('連結已過期') ||
    lower.includes('链接已过期') ||
    lower.includes('連結失效') ||
    lower.includes('链接失效') ||
    /page\s+not\s+found/i.test(html) ||
    /<title[^>]*>\s*404\b/i.test(html)
  ) {
    return 'expired'
  }
  if (
    lower.includes('密碼錯誤') ||
    lower.includes('密码错误') ||
    lower.includes('password incorrect')
  ) {
    return 'passwordFailed'
  }
  if (
    cheerio.load(html)('input[type="password"], input[name="password"], input#password').length >
      0 ||
    lower.includes('請輸入密碼') ||
    lower.includes('请输入密码') ||
    lower.includes('password protected')
  ) {
    return 'needsPassword'
  }
  return 'normal'
}

export async function tryPasswords(fetchFn, url, passwords) {
  for (const password of passwords) {
    const result = await fetchFn(url, password)
    const status = detectPageStatus(result.html)
    if (status === 'normal' || hasMediaContent(result.html, result.mediaUrls)) {
      return { ...result, password }
    }
    if (status === 'passwordFailed') continue
  }
  return null
}

function hasMediaContent(html, mediaUrls = []) {
  if (mediaUrls.length > 0) return true
  const $ = cheerio.load(html)
  if ($('video, audio, canvas').length > 0) return true
  return $('img[src], link[rel="preload"][as="image"]').filter((_, el) => {
    const src = $(el).attr('src') || $(el).attr('href') || ''
    return src && !/logo|icon|18-plus|\/app\//i.test(src)
  }).length > 0
}

export function extractMediaFromHtml(html, baseUrl) {
  const $ = cheerio.load(html)
  const media = []
  const seen = new Set()

  const add = (type, url, extra = {}) => {
    if (!url || seen.has(url)) return
    if (url.startsWith('data:')) return
    seen.add(url)
    media.push({ type, url, ...extra })
  }

  $('video').each((_, el) => {
    const poster = $(el).attr('poster')
    const posterThumb = poster ? resolve(baseUrl, poster) : null
    const src = $(el).attr('src')
    if (src) {
      add('video', resolve(baseUrl, src), posterThumb ? { thumbnail: posterThumb } : {})
    }
    $(el)
      .find('source')
      .each((__, source) => {
        const s = $(source).attr('src')
        if (s) add('video', resolve(baseUrl, s), posterThumb ? { thumbnail: posterThumb } : {})
      })
  })

  $('audio').each((_, el) => {
    const src = $(el).attr('src')
    if (src) add('audio', resolve(baseUrl, src))
    $(el)
      .find('source')
      .each((__, source) => {
        const s = $(source).attr('src')
        if (s) add('audio', resolve(baseUrl, s))
      })
  })

  $('link[rel="preload"][as="image"]').each((_, el) => {
    const href = $(el).attr('href')
    if (href) add('image', resolve(baseUrl, href))
  })

  $('img').each((_, el) => {
    const src = $(el).attr('src') || $(el).attr('data-src')
    if (src && !/logo|icon|18-plus|\/app\//i.test(src)) {
      add('image', resolve(baseUrl, src), { thumbnail: resolve(baseUrl, src) })
    }
  })

  const embeddedUrls = html.match(/https?:\/\/[^'"\s>]+\.(?:jpe?g|png|gif|webp|mp4|m3u8|webm|mov)/gi) || []
  for (const embeddedUrl of embeddedUrls) {
    if (/logo|icon|18-plus|\/app\//i.test(embeddedUrl)) continue
    const type = /\.(mp4|m3u8|webm|mov)(\?|$)/i.test(embeddedUrl) ? 'video' : 'image'
    if (type === 'video') {
      add(type, embeddedUrl)
    } else {
      add(type, embeddedUrl, { thumbnail: embeddedUrl })
    }
  }

  const ogImage =
    $('meta[property="og:image"]').attr('content') ||
    $('meta[name="twitter:image"]').attr('content')
  if (ogImage) {
    const ogThumb = resolve(baseUrl, ogImage)
    for (const item of media) {
      if (item.type === 'video' && !item.thumbnail) {
        item.thumbnail = ogThumb
      }
    }
  }

  return media
}

export function mediaFromCapturedUrls(urls = []) {
  const media = []
  const seen = new Set()

  for (const url of urls) {
    if (!url || seen.has(url) || /logo|icon|18-plus|\/app\//i.test(url)) continue
    seen.add(url)
    const type = /\.(mp4|m3u8|webm|mov)(\?|$)/i.test(url) ? 'video' : 'image'
    media.push(type === 'video' ? { type, url } : { type, url, thumbnail: url })
  }

  return media
}

function resolve(base, relative) {
  try {
    return new URL(relative, base).href
  } catch {
    return relative
  }
}
