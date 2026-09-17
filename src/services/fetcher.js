import axios from 'axios'
import http from 'http'
import https from 'https'

const DEFAULT_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8',
}

const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 32 })
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 32 })

const client = axios.create({
  timeout: 20000,
  maxRedirects: 5,
  validateStatus: (status) => status < 500,
  // 避免继承 Cursor/系统代理环境变量导致外网请求失败
  proxy: false,
  httpAgent,
  httpsAgent,
})

const downloadClient = axios.create({
  timeout: 300000,
  maxRedirects: 5,
  validateStatus: (status) => status < 500,
  proxy: false,
  maxContentLength: Infinity,
  maxBodyLength: Infinity,
  decompress: false,
  httpAgent,
  httpsAgent,
})

export async function fetchHtml(url, options = {}) {
  const response = await client.get(url, {
    headers: { ...DEFAULT_HEADERS, ...options.headers },
    responseType: 'text',
    ...options,
  })
  return { html: response.data, finalUrl: response.request?.res?.responseUrl || url, status: response.status }
}

export async function fetchJson(url, options = {}) {
  const response = await client.get(url, {
    headers: { ...DEFAULT_HEADERS, Accept: 'application/json', ...options.headers },
    ...options,
  })
  return response.data
}

export async function postForm(url, data, options = {}) {
  const body = new URLSearchParams(data)
  const response = await client.post(url, body.toString(), {
    headers: {
      ...DEFAULT_HEADERS,
      'Content-Type': 'application/x-www-form-urlencoded',
      ...options.headers,
    },
    responseType: 'text',
    maxRedirects: 5,
    ...options,
  })
  return { html: response.data, finalUrl: response.request?.res?.responseUrl || url, status: response.status }
}

export async function fetchStream(url, options = {}) {
  const referer = options.referer || getRefererForUrl(url)
  const extraHeaders = { ...options.headers }
  const timeout = options.timeout || 300000
  const signal = options.signal

  const requestOptions = {
    headers: {
      'User-Agent': DEFAULT_HEADERS['User-Agent'],
      'Accept-Language': DEFAULT_HEADERS['Accept-Language'],
      Accept: '*/*',
      'Accept-Encoding': 'identity',
      ...(referer ? { Referer: referer } : {}),
      ...extraHeaders,
    },
    responseType: 'stream',
    timeout,
    decompress: false,
    ...(signal ? { signal } : {}),
  }

  let response = await downloadClient.get(url, requestOptions)

  // 部分 CDN 带 Referer 会 403，去掉后再试一次
  if (response.status === 403 && referer && !extraHeaders.Referer) {
    response.data?.destroy?.()
    const { Referer: _ignored, ...headersWithoutReferer } = requestOptions.headers
    response = await downloadClient.get(url, {
      ...requestOptions,
      headers: headersWithoutReferer,
    })
  }

  return response
}

function getRefererForUrl(url) {
  try {
    const hostname = new URL(url).hostname.toLowerCase()
    if (hostname.includes('lurl.cc')) return 'https://lurl.cc/'
    if (hostname.includes('myppt.cc')) return 'https://myppt.cc/'
    if (hostname.includes('ppt.cc')) return 'https://ppt.cc/'
    if (
      hostname === 'x.com' ||
      hostname.endsWith('.x.com') ||
      hostname.includes('twimg.com') ||
      hostname.includes('twitter.com') ||
      hostname.includes('pscp.tv') ||
      hostname.includes('periscope.tv')
    ) {
      return 'https://x.com/'
    }
    if (
      hostname.includes('douyin') ||
      hostname.includes('douyinvod') ||
      hostname.includes('snssdk.com') ||
      hostname.includes('bytecdn') ||
      hostname.includes('ixigua.com')
    ) {
      return 'https://www.douyin.com/'
    }
    if (
      hostname.includes('xiaohongshu.com') ||
      hostname.includes('xhscdn.com') ||
      hostname.includes('xhslink.')
    ) {
      return 'https://www.xiaohongshu.com/'
    }
    if (
      hostname.includes('instagram.com') ||
      hostname.includes('cdninstagram.com') ||
      hostname.includes('fbcdn.net')
    ) {
      return 'https://www.instagram.com/'
    }
  } catch {
    return undefined
  }
  return undefined
}

export function needsImpersonatedDownload(url) {
  try {
    const hostname = new URL(url).hostname.toLowerCase()
    return (
      hostname.includes('lurl.cc') ||
      hostname.includes('myppt.cc') ||
      hostname.includes('r2limit')
    )
  } catch {
    return false
  }
}

export { DEFAULT_HEADERS, getRefererForUrl }
