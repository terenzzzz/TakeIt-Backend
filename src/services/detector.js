import { getHostname, normalizeUrl } from '../utils/url.js'

const PLATFORMS = [
  { id: 'myppt', name: 'MyPPT', hosts: ['myppt.cc'] },
  { id: 'lurl', name: 'LURL', hosts: ['lurl.cc'] },
  { id: 'pptcc', name: 'PPT.cc', hosts: ['ppt.cc'] },
  { id: 'twitter', name: 'Twitter/X', hosts: ['twitter.com', 'x.com', 'mobile.twitter.com'] },
]

export function detectPlatform(input) {
  if (!input) return null
  const hostname = getHostname(input)
  return PLATFORMS.find((p) => p.hosts.includes(hostname)) || null
}

export function getPlatformId(input) {
  return detectPlatform(input)?.id || null
}

export { normalizeUrl, PLATFORMS }
