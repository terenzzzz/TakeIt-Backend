import zlib, { brotliDecompressSync, gunzipSync, inflateSync } from 'zlib'

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

let session = null
let SessionClass = null
let sessionQueue = Promise.resolve()

async function getSession() {
  if (!SessionClass) {
    try {
      const mod = await import('curl-cffi-node')
      SessionClass = mod.Session
    } catch (err) {
      const error = new Error(
        'curl-cffi-node 原生模块加载失败，MyPPT/LURL 解析不可用。' +
          '请确认系统 glibc >= 2.38 或从源码编译 curl-cffi-node。'
      )
      error.code = 'NATIVE_MODULE_UNAVAILABLE'
      throw error
    }
  }
  if (!session) {
    session = new SessionClass({
      impersonate: 'chrome131',
      timeout: 20,
      headers: {
        'User-Agent': USER_AGENT,
        'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8',
      },
    })
  }
  return session
}

function resetSession() {
  session = null
}

async function withSession(fn) {
  const run = sessionQueue.then(fn, fn)
  sessionQueue = run.then(
    () => {},
    () => {},
  )
  try {
    return await run
  } catch (err) {
    resetSession()
    throw err
  }
}

export function isCloudflareBlocked(html, status) {
  if (status === 403) return true
  const lower = html.toLowerCase()
  return (
    lower.includes('attention required! | cloudflare') ||
    lower.includes('sorry, you have been blocked') ||
    lower.includes('cf-error-details') ||
    lower.includes('you are unable to access')
  )
}

const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

function looksLikeZstd(buffer) {
  return buffer?.length >= 4 && buffer.subarray(0, 4).equals(ZSTD_MAGIC)
}

function decompressZstd(buffer) {
  if (typeof zlib.zstdDecompressSync !== 'function') {
    throw new Error('zstd is not supported by this Node.js runtime')
  }
  return zlib.zstdDecompressSync(buffer).toString('utf8')
}

function decodeBody(response) {
  const encoding = response.headers.get('content-encoding')?.toLowerCase()
  const buffer = response.content

  try {
    if (encoding === 'br') return brotliDecompressSync(buffer).toString('utf8')
    if (encoding === 'gzip') return gunzipSync(buffer).toString('utf8')
    if (encoding === 'deflate') return inflateSync(buffer).toString('utf8')
    if (encoding === 'zstd' || encoding === 'zst' || looksLikeZstd(buffer)) {
      return decompressZstd(buffer)
    }
  } catch {
    // fall through to plain text
  }

  return response.text()
}

export async function getImpersonatedCookies() {
  return withSession(async () => {
    const client = await getSession()
    const jar = {}
    for (const line of client.cookies || []) {
      if (!line || line.startsWith('#')) continue
      const parts = line.split('\t')
      if (parts.length >= 7) jar[parts[5]] = parts[6]
    }
    return jar
  })
}

export async function fetchHtmlImpersonated(url, options = {}) {
  return withSession(async () => {
    const client = await getSession()
    const response = await client.get(url, {
      headers: options.headers,
      timeout: options.timeout || 20,
    })
    const html = decodeBody(response)

    return {
      html,
      finalUrl: response.url || url,
      status: response.status,
    }
  })
}

export async function postFormImpersonated(url, data, options = {}) {
  return withSession(async () => {
    const client = await getSession()
    const body =
      data instanceof URLSearchParams ? data.toString() : new URLSearchParams(data).toString()

    const response = await client.post(url, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        ...options.headers,
      },
      data: body,
      timeout: options.timeout || 20,
    })

    return {
      html: decodeBody(response),
      finalUrl: response.url || url,
      status: response.status,
    }
  })
}

export async function fetchBinaryImpersonated(url, options = {}) {
  return withSession(async () => {
  const client = await getSession()
  const response = await client.get(url, {
    headers: {
      Accept: 'video/mp4,video/*;q=0.9,application/octet-stream;q=0.8,image/*,*/*;q=0.7',
      Referer: options.referer,
      ...options.headers,
    },
    timeout: options.timeout || 60,
  })

  if (!response.ok) {
    const err = new Error(`下载失败 (${response.status})`)
    err.code = 'DOWNLOAD_FAILED'
    throw err
  }

  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('text/html')) {
    const err = new Error('下载失败，目标站点拒绝了请求')
    err.code = 'DOWNLOAD_FAILED'
    throw err
  }

  return {
    data: response.content,
    headers: {
      'content-type': contentType,
      'content-length': response.headers.get('content-length'),
    },
    status: response.status,
  }
  })
}
