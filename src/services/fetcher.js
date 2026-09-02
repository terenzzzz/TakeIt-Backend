import axios from 'axios'

const DEFAULT_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8',
}

const client = axios.create({
  timeout: 20000,
  maxRedirects: 5,
  validateStatus: (status) => status < 500,
  // 避免继承 Cursor/系统代理环境变量导致外网请求失败
  proxy: false,
})

const downloadClient = axios.create({
  timeout: 300000,
  maxRedirects: 5,
  validateStatus: (status) => status < 500,
  proxy: false,
  maxContentLength: Infinity,
  maxBodyLength: Infinity,
  decompress: true,
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
  const referer = getRefererForUrl(url)
  const response = await downloadClient.get(url, {
    headers: {
      ...DEFAULT_HEADERS,
      Accept: '*/*',
      ...(referer ? { Referer: referer } : {}),
      ...options.headers,
    },
    responseType: 'stream',
    timeout: options.timeout || 300000,
    ...options,
  })
  return response
}

function getRefererForUrl(url) {
  try {
    const hostname = new URL(url).hostname.toLowerCase()
    if (hostname.includes('lurl.cc')) return 'https://lurl.cc/'
    if (hostname.includes('myppt.cc')) return 'https://myppt.cc/'
    if (hostname.includes('ppt.cc')) return 'https://ppt.cc/'
    if (
      hostname.includes('douyin') ||
      hostname.includes('douyinvod') ||
      hostname.includes('snssdk.com') ||
      hostname.includes('bytecdn') ||
      hostname.includes('ixigua.com')
    ) {
      return 'https://www.douyin.com/'
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
