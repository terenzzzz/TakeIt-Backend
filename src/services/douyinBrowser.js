import { chromium } from 'playwright-core'
import { spawn } from 'node:child_process'

const BROWSER_TIMEOUT_MS = 35000
const RESPONSE_TIMEOUT_MS = 12000
const HYDRATE_POLL_MS = 400
const NOTE_KINDS = new Set(['note', 'slides'])
const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1'
const CHROME_ARGS = [
  '--disable-dev-shm-usage',
  '--no-sandbox',
  '--disable-gpu',
  '--disable-extensions',
  '--disable-background-networking',
  '--mute-audio',
]

let browserPromise = null
let contextPromise = null
let mobileContextPromise = null
let browserRef = null
let contextRef = null
let mobileContextRef = null
let browserQueue = Promise.resolve()
let xvfbProcess = null
let xvfbDisplay = ''
let exitHooksInstalled = false

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function itemFromPayload(payload) {
  if (!payload || typeof payload !== 'object') return null
  return (
    payload.aweme_detail ||
    payload.aweme_details?.[0] ||
    payload.item_list?.[0] ||
    payload.data?.aweme_detail ||
    payload.data?.aweme_details?.[0] ||
    payload.data?.item_list?.[0] ||
    null
  )
}

function isClosedError(err) {
  const message = err?.message || ''
  return /has been closed|Target page, context or browser|Browser closed|page crashed|Connection closed/i.test(
    message
  )
}

function isXvfbAlive() {
  return Boolean(xvfbProcess?.pid && xvfbProcess.exitCode === null && !xvfbProcess.killed)
}

function installExitHooks() {
  if (exitHooksInstalled) return
  exitHooksInstalled = true
  process.once('exit', () => {
    try {
      if (xvfbProcess?.pid) process.kill(xvfbProcess.pid, 'SIGTERM')
    } catch {
      // The display process may already be gone.
    }
  })
}

function clearOwnedDisplay() {
  if (xvfbDisplay && process.env.DISPLAY === xvfbDisplay) {
    delete process.env.DISPLAY
  }
  xvfbDisplay = ''
}

function rememberBrowser(browser) {
  browserRef = browser
  browser.on('disconnected', () => {
    if (browserRef === browser) {
      browserRef = null
      browserPromise = null
      contextRef = null
      contextPromise = null
      mobileContextRef = null
      mobileContextPromise = null
    }
  })
  return browser
}

function rememberContext(context, kind = 'desktop') {
  const isMobile = kind === 'mobile'
  if (isMobile) mobileContextRef = context
  else contextRef = context
  context.on('close', () => {
    if (isMobile && mobileContextRef === context) {
      mobileContextRef = null
      mobileContextPromise = null
    }
    if (!isMobile && contextRef === context) {
      contextRef = null
      contextPromise = null
    }
  })
  return context
}

async function resetBrowserState() {
  const context = contextRef
  const mobileContext = mobileContextRef
  const browser = browserRef
  contextRef = null
  contextPromise = null
  mobileContextRef = null
  mobileContextPromise = null
  browserRef = null
  browserPromise = null
  await context?.close().catch(() => {})
  await mobileContext?.close().catch(() => {})
  await browser?.close().catch(() => {})
  xvfbProcess?.kill()
  xvfbProcess = null
  clearOwnedDisplay()
}

async function ensureDisplay() {
  if (isXvfbAlive()) return
  if (process.env.DISPLAY && !xvfbDisplay) return

  if (xvfbProcess && !isXvfbAlive()) {
    xvfbProcess = null
    clearOwnedDisplay()
  }

  installExitHooks()
  const display = `:${90 + (process.pid % 100)}`
  xvfbProcess = spawn(
    'Xvfb',
    [display, '-screen', '0', '1280x800x24', '-nolisten', 'tcp'],
    { stdio: 'ignore' }
  )
  xvfbDisplay = display
  process.env.DISPLAY = display

  let started = false
  await new Promise((resolve, reject) => {
    const fail = (err) => {
      if (started) return
      xvfbProcess = null
      clearOwnedDisplay()
      reject(err)
    }
    const timer = setTimeout(() => {
      started = true
      resolve()
    }, 350)
    xvfbProcess.once('error', (err) => {
      clearTimeout(timer)
      fail(err)
    })
    xvfbProcess.once('exit', (code) => {
      xvfbProcess = null
      clearOwnedDisplay()
      clearTimeout(timer)
      fail(new Error(`Xvfb 启动失败 (${code})`))
    })
  })
}

async function getBrowser() {
  if (browserRef?.isConnected()) return browserRef

  if (browserPromise) {
    try {
      const browser = await browserPromise
      if (browser?.isConnected()) return browser
    } catch {
      // Fall through and launch a new instance.
    }
    browserPromise = null
    browserRef = null
    contextPromise = null
    contextRef = null
    mobileContextPromise = null
    mobileContextRef = null
  }

  browserPromise = ensureDisplay()
    .then(() =>
      chromium.launch({
        headless: false,
        ...(process.env.CHROMIUM_EXECUTABLE_PATH
          ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH }
          : {}),
        args: CHROME_ARGS,
      })
    )
    .then(rememberBrowser)
    .catch((err) => {
      browserPromise = null
      browserRef = null
      throw err
    })

  return browserPromise
}

async function getContext() {
  if (contextRef && browserRef?.isConnected()) return contextRef

  if (contextPromise) {
    try {
      const context = await contextPromise
      if (context && browserRef?.isConnected()) return context
    } catch {
      // Fall through and create a new context.
    }
    contextPromise = null
    contextRef = null
  }

  contextPromise = getBrowser()
    .then(async (browser) => {
      const context = await browser.newContext({
        locale: 'zh-CN',
        timezoneId: 'Asia/Shanghai',
        viewport: { width: 1280, height: 800 },
        userAgent: DESKTOP_UA,
      })
      await context.addInitScript(() => {
        Object.defineProperty(navigator, 'platform', { get: () => 'Win32' })
      })
      return context
    })
    .then((context) => rememberContext(context, 'desktop'))
    .catch((err) => {
      contextPromise = null
      contextRef = null
      throw err
    })

  return contextPromise
}

async function getMobileContext() {
  if (mobileContextRef && browserRef?.isConnected()) return mobileContextRef

  if (mobileContextPromise) {
    try {
      const context = await mobileContextPromise
      if (context && browserRef?.isConnected()) return context
    } catch {
      // Fall through and create a new context.
    }
    mobileContextPromise = null
    mobileContextRef = null
  }

  mobileContextPromise = getBrowser()
    .then((browser) =>
      browser.newContext({
        locale: 'zh-CN',
        timezoneId: 'Asia/Shanghai',
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        userAgent: MOBILE_UA,
      })
    )
    .then((context) => rememberContext(context, 'mobile'))
    .catch((err) => {
      mobileContextPromise = null
      mobileContextRef = null
      throw err
    })

  return mobileContextPromise
}

function withBrowserLock(task) {
  const run = browserQueue.then(task, task)
  browserQueue = run.catch(() => {})
  return run
}

function responseMayContainMedia(url = '') {
  return /\/aweme\/(?:v1\/web\/)?(?:aweme\/detail|item\/detail|multi\/aweme\/detail)|\/web\/api\/v2\/aweme\/(?:iteminfo|slidesinfo)/i.test(
    url
  )
}

function errorFromFilter(payload) {
  const filter = payload?.filter_detail || payload?.filter_list?.[0]
  if (!filter) return null
  const code = String(filter.filter_reason || filter.reason || '')
  const message =
    code === '8'
      ? '抖音触发了访问限制，请稍后重试'
      : code === 'status_friend_see'
        ? '该抖音作品仅好友可见，无法解析'
        : /self_see|author_see|private|only_user/i.test(code)
          ? '该抖音作品为私密内容，无法解析'
          : filter.detail_msg || filter.notice || filter.filter_reason || '该抖音作品无法访问'
  const err = new Error(message)
  err.code = code === '8' ? 'BLOCKED' : 'EXPIRED'
  return err
}

async function parseResponse(response, awemeId) {
  if (!responseMayContainMedia(response.url())) return null
  try {
    const payload = await response.json()
    const filtered = errorFromFilter(payload)
    // slidesinfo 的 reason=8 经常是接口本身不可用，不代表作品真的被封
    if (filtered && filtered.code === 'EXPIRED') return { error: filtered }
    const item = itemFromPayload(payload)
    if (item && String(item.aweme_id || item.awemeId || '') === String(awemeId)) {
      return { item }
    }
  } catch {
    // Ignore non-JSON and blocked responses.
  }
  return null
}

async function extractHydratedItem(page, awemeId) {
  return page.evaluate((targetId) => {
    const seen = new WeakSet()
    const looksLikeItem = (value) => {
      const id = value.aweme_id || value.awemeId
      if (String(id || '') !== String(targetId)) return false
      return Boolean(value.video || value.images || value.image_post_info)
    }
    const find = (value, depth = 0) => {
      if (!value || typeof value !== 'object' || depth > 16 || seen.has(value)) return null
      seen.add(value)
      if (looksLikeItem(value)) return value
      for (const child of Object.values(value)) {
        const match = find(child, depth + 1)
        if (match) return match
      }
      return null
    }

    const candidates = [
      window.__UNIVERSAL_DATA_FOR_REHYDRATION__,
      window._ROUTER_DATA,
      window.__INITIAL_STATE__,
      window.__NEXT_DATA__,
      window.__SSR_DATA__,
    ]
    for (const candidate of candidates) {
      const match = find(candidate)
      if (match) return match
    }

    for (const script of document.scripts) {
      const text = script.textContent || ''
      if (!text.includes(String(targetId))) continue
      try {
        const decoded = script.id === 'RENDER_DATA' ? decodeURIComponent(text) : text
        const match = find(JSON.parse(decoded))
        if (match) return match
      } catch {
        // Continue checking other hydration scripts.
      }
    }
    return null
  }, awemeId)
}

function browseAttemptsFor(awemeId, kind = '') {
  const noteUrls = [
    `https://www.douyin.com/note/${awemeId}`,
    `https://m.douyin.com/share/note/${awemeId}`,
  ]
  const videoUrls = [
    `https://www.douyin.com/video/${awemeId}`,
    `https://www.iesdouyin.com/share/video/${awemeId}/`,
  ]
  if (NOTE_KINDS.has(kind)) {
    return [
      { mobile: true, urls: noteUrls },
      { mobile: false, urls: videoUrls },
    ]
  }
  return [
    { mobile: false, urls: videoUrls },
    { mobile: true, urls: noteUrls },
  ]
}

async function fetchInBrowser(awemeId, kind = '') {
  let lastError = null

  for (const attempt of browseAttemptsFor(awemeId, kind)) {
    const context = attempt.mobile ? await getMobileContext() : await getContext()
    const page = await context.newPage()
    let foundItem = null
    let fatalError = null

    const onResponse = async (response) => {
      const parsed = await parseResponse(response, awemeId)
      if (parsed?.item) foundItem = parsed.item
      if (parsed?.error) fatalError = parsed.error
    }
    page.on('response', onResponse)

    try {
      for (const url of attempt.urls) {
        foundItem = null
        await page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: BROWSER_TIMEOUT_MS,
        })

        const deadline = Date.now() + RESPONSE_TIMEOUT_MS
        while (Date.now() < deadline) {
          if (fatalError?.code === 'EXPIRED') throw fatalError
          if (foundItem) return foundItem
          const hydrated = await extractHydratedItem(page, awemeId).catch(() => null)
          if (hydrated) return hydrated
          await sleep(HYDRATE_POLL_MS)
        }

        if (fatalError?.code === 'EXPIRED') throw fatalError
        if (foundItem) return foundItem
        const hydrated = await extractHydratedItem(page, awemeId).catch(() => null)
        if (hydrated) return hydrated
        if (fatalError) lastError = fatalError
      }
    } finally {
      page.off('response', onResponse)
      await page.close().catch(() => {})
    }
  }

  if (lastError) throw lastError
  return null
}

function wrapBrowserError(cause) {
  const err = new Error(`抖音浏览器解析失败：${cause.message}`)
  err.code = 'BLOCKED'
  err.cause = cause
  return err
}

export async function fetchDouyinItemInBrowser(awemeId, kind = '') {
  return withBrowserLock(async () => {
    try {
      return await fetchInBrowser(awemeId, kind)
    } catch (cause) {
      if (cause.code === 'EXPIRED' || cause.code === 'NO_MEDIA') throw cause
      if (!isClosedError(cause)) throw wrapBrowserError(cause)
      console.warn('Douyin browser died, relaunching:', cause.message)
      await resetBrowserState()
      try {
        return await fetchInBrowser(awemeId, kind)
      } catch (retryCause) {
        if (retryCause.code === 'EXPIRED' || retryCause.code === 'NO_MEDIA') throw retryCause
        throw wrapBrowserError(retryCause)
      }
    }
  })
}

export async function closeDouyinBrowser() {
  await resetBrowserState()
}
