import { Router } from 'express'
import { detectPlatform, normalizeUrl } from '../services/detector.js'
import { isValidUrl } from '../utils/url.js'
import { getExtractor } from '../extractors/index.js'
import { fetchStream } from '../services/fetcher.js'
import { buildMediaFilename, ensureFilenameExtension, sanitizeFilename } from '../utils/filename.js'

const router = Router()

const ERROR_MESSAGES = {
  INVALID_URL: '请输入有效的分享链接',
  UNSUPPORTED_PLATFORM: '暂不支持该平台，敬请期待',
  EXPIRED: '该链接可能已过期或失效',
  BLOCKED: '目标网站启用了防护，暂时无法解析',
  PASSWORD_FAILED: '密码不正确，请重试',
  NO_MEDIA: '未找到可下载的媒体资源',
  PARSE_FAILED: '解析失败，请检查链接是否正确',
  RATE_LIMIT: '请求过于频繁，请稍后重试',
}

router.post('/extract', async (req, res) => {
  const { url, password } = req.body || {}

  if (!url || !isValidUrl(url)) {
    return res.status(400).json({ error: 'INVALID_URL', message: ERROR_MESSAGES.INVALID_URL })
  }

  const platform = detectPlatform(url)
  if (!platform) {
    return res.status(400).json({
      error: 'UNSUPPORTED_PLATFORM',
      message: ERROR_MESSAGES.UNSUPPORTED_PLATFORM,
    })
  }

  const extractor = getExtractor(platform.id)
  if (!extractor) {
    return res.status(400).json({
      error: 'UNSUPPORTED_PLATFORM',
      message: ERROR_MESSAGES.UNSUPPORTED_PLATFORM,
    })
  }

  try {
    const result = await extractor.extract(normalizeUrl(url), { password })
    return res.json(result)
  } catch (err) {
    const code = err.code || 'PARSE_FAILED'
    const status = code === 'PASSWORD_FAILED' ? 401 : code === 'EXPIRED' ? 410 : 422
    return res.status(status).json({
      error: code,
      message: ERROR_MESSAGES[code] || err.message || ERROR_MESSAGES.PARSE_FAILED,
    })
  }
})

router.get('/download', async (req, res) => {
  const { url, filename, inline } = req.query

  if (!url) {
    return res.status(400).json({ error: 'INVALID_URL', message: '缺少下载地址' })
  }

  try {
    const decodedUrl = decodeURIComponent(url)
    const response = await fetchStream(decodedUrl)
    const contentType = response.headers['content-type']
    const fallbackName = buildMediaFilename(decodedUrl, inferMediaType(contentType), 0)
    const safeName = ensureFilenameExtension(
      sanitizeFilename(filename) || fallbackName,
      contentType
    )
    const disposition = inline === '1' ? 'inline' : 'attachment'

    res.setHeader('Content-Disposition', `${disposition}; filename="${encodeURIComponent(safeName)}"`)
    if (response.headers['content-type']) {
      res.setHeader('Content-Type', response.headers['content-type'])
    }
    if (response.headers['content-length']) {
      res.setHeader('Content-Length', response.headers['content-length'])
    }

    response.data.pipe(res)
  } catch (err) {
    console.error('Download error:', err.message)
    res.status(500).json({ error: 'DOWNLOAD_FAILED', message: '下载失败，请重试' })
  }
})

export default router

function inferMediaType(contentType = '') {
  const mime = contentType.split(';')[0].trim().toLowerCase()
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  return 'image'
}
