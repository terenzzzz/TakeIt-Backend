import { getHostname, normalizeUrl } from '../utils/url.js'

const PLATFORMS = [
  { id: 'myppt', name: 'MyPPT', hosts: ['myppt.cc'] },
  { id: 'lurl', name: 'LURL', hosts: ['lurl.cc'] },
  { id: 'pptcc', name: 'PPT.cc', hosts: ['ppt.cc'] },
  { id: 'twitter', name: 'Twitter/X', hosts: ['twitter.com', 'x.com', 'mobile.twitter.com'] },
  { id: 'douyin', name: '抖音', hosts: ['douyin.com', 'iesdouyin.com'] },
  {
    id: 'xiaohongshu',
    name: '小红书',
    hosts: ['xiaohongshu.com', 'xhslink.com', 'xhslink.cn', 'rednote.com'],
  },
]

function hostMatches(hostname, hosts) {
  return hosts.some((host) => hostname === host || hostname.endsWith(`.${host}`))
}

export function detectPlatform(input) {
  if (!input) return null
  const hostname = getHostname(input)
  return PLATFORMS.find((p) => hostMatches(hostname, p.hosts)) || null
}

export function getPlatformId(input) {
  return detectPlatform(input)?.id || null
}

export { normalizeUrl, PLATFORMS }
