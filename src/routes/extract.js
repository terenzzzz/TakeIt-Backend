import { Router } from 'express'
import { detectPlatform, normalizeUrl } from '../services/detector.js'
import { extractUrlFromText, isValidUrl } from '../utils/url.js'
import { getExtractor } from '../extractors/index.js'
import { fetchStream, needsImpersonatedDownload, getRefererForUrl } from '../services/fetcher.js'
import { fetchBinaryImpersonated } from '../services/impersonatedHttp.js'
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
  const resolvedUrl = extractUrlFromText(url) || (typeof url === 'string' ? url.trim() : '')

  if (!resolvedUrl || !isValidUrl(resolvedUrl)) {
    return res.status(400).json({ error: 'INVALID_URL', message: ERROR_MESSAGES.INVALID_URL })
  }

  const platform = detectPlatform(resolvedUrl)
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
    const result = await extractor.extract(normalizeUrl(resolvedUrl), { password })
    return res.json(result)
  } catch (err) {
    const code = normalizeErrorCode(err)
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
    const streamed = await tryStreamDownload(decodedUrl, res, { filename, inline })
    if (streamed) return

    if (needsImpersonatedDownload(decodedUrl)) {
      const response = await fetchBinaryImpersonated(decodedUrl, {
        referer: getRefererForUrl(decodedUrl),
      })
      const contentType = response.headers['content-type']
      const safeName = buildSafeFilename(decodedUrl, filename, contentType)
      setDownloadHeaders(res, {
        contentType,
        contentLength: response.headers['content-length'],
        safeName,
        inline,
      })
      return res.end(response.data)
    }

    res.status(500).json({ error: 'DOWNLOAD_FAILED', message: '下载失败，请重试' })
  } catch (err) {
    console.error('Download error:', err.message)
    if (!res.headersSent) {
      res.status(500).json({ error: 'DOWNLOAD_FAILED', message: '下载失败，请重试' })
    }
  }
})

export default router

function normalizeErrorCode(err) {
  if (typeof err.code === 'string' && ERROR_MESSAGES[err.code]) return err.code
  if (/curl error/i.test(err.message || '')) return 'PARSE_FAILED'
  if (typeof err.code === 'number') return 'PARSE_FAILED'
  return err.code || 'PARSE_FAILED'
}

function inferMediaType(contentType = '') {
  const mime = contentType.split(';')[0].trim().toLowerCase()
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  return 'image'
}

function buildSafeFilename(decodedUrl, filename, contentType) {
  const fallbackName = buildMediaFilename(decodedUrl, inferMediaType(contentType), 0)
  return ensureFilenameExtension(sanitizeFilename(filename) || fallbackName, contentType)
}

function setDownloadHeaders(res, { contentType, contentLength, safeName, inline }) {
  const disposition = inline === '1' ? 'inline' : 'attachment'
  res.setHeader('Content-Disposition', `${disposition}; filename="${encodeURIComponent(safeName)}"`)
  res.setHeader('X-Accel-Buffering', 'no')
  if (contentType) res.setHeader('Content-Type', contentType)
  if (contentLength) res.setHeader('Content-Length', contentLength)
}

async function tryStreamDownload(decodedUrl, res, { filename, inline }) {
  let response
  try {
    response = await fetchStream(decodedUrl)
  } catch {
    return false
  }

  if (response.status < 200 || response.status >= 300) {
    response.data?.destroy?.()
    return false
  }

  const contentType = response.headers['content-type'] || ''
  if (contentType.includes('text/html')) {
    response.data.destroy()
    return false
  }

  const safeName = buildSafeFilename(decodedUrl, filename, contentType)
  setDownloadHeaders(res, {
    contentType,
    contentLength: response.headers['content-length'],
    safeName,
    inline,
  })

  await new Promise((resolve, reject) => {
    response.data.on('error', reject)
    res.on('error', reject)
    response.data.on('end', resolve)
    response.data.pipe(res)
  })

  return true
}
