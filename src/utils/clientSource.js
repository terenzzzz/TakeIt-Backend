const CLIENTS = ['web', 'ios', 'macos', 'unknown']

export function detectClient(userAgent) {
  const ua = typeof userAgent === 'string' ? userAgent.trim() : ''
  if (/^TakeIt\/iOS\b/i.test(ua)) return 'ios'
  if (/^TakeIt\/macOS\b/i.test(ua)) return 'macos'
  if (/mozilla|applewebkit/i.test(ua)) return 'web'
  return 'unknown'
}

export function emptyClientCounts() {
  return Object.fromEntries(CLIENTS.map((client) => [client, 0]))
}
