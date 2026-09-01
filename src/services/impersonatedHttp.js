import { brotliDecompressSync, gunzipSync, inflateSync } from 'zlib'

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

let session = null
let SessionClass = null

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
      headers: {
        'User-Agent': USER_AGENT,
        'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8',
      },
    })
  }
  return session
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

function decodeBody(response) {
  const encoding = response.headers.get('content-encoding')?.toLowerCase()
  const buffer = response.content

  try {
    if (encoding === 'br') return brotliDecompressSync(buffer).toString('utf8')
    if (encoding === 'gzip') return gunzipSync(buffer).toString('utf8')
    if (encoding === 'deflate') return inflateSync(buffer).toString('utf8')
  } catch {
    // fall through to plain text
  }

  return response.text()
}

export async function fetchHtmlImpersonated(url, options = {}) {
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
}

export async function postFormImpersonated(url, data, options = {}) {
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
}
