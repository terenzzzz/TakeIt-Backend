import { chromium } from 'playwright-core'
import { spawn } from 'node:child_process'

const BROWSER_TIMEOUT_MS = 35000
const RESPONSE_TIMEOUT_MS = 18000

let browserPromise = null
let contextPromise = null
let browserQueue = Promise.resolve()
let xvfbProcess = null

function itemFromPayload(payload) {
  if (!payload || typeof payload !== 'object') return null
  return (
    payload.aweme_detail ||
    payload.aweme_details?.[0] ||
    payload.item_list?.[0] ||
    payload.data?.aweme_detail ||
    null
  )
}

async function getBrowser() {
  if (!browserPromise) {
    browserPromise = ensureDisplay()
      .then(() => chromium.launch({
        headless: false,
        ...(process.env.CHROMIUM_EXECUTABLE_PATH
          ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH }
          : {}),
        args: ['--disable-dev-shm-usage', '--no-sandbox'],
      }))
      .catch((err) => {
        browserPromise = null
        throw err
      })
  }
  return browserPromise
}

async function getContext() {
  if (!contextPromise) {
    contextPromise = getBrowser()
      .then((browser) =>
        browser.newContext({
          locale: 'zh-CN',
          timezoneId: 'Asia/Shanghai',
          viewport: { width: 1280, height: 800 },
        })
      )
      .catch((err) => {
        contextPromise = null
        throw err
      })
  }
  return contextPromise
}

async function ensureDisplay() {
  if (process.env.DISPLAY || xvfbProcess) return

  const display = `:${90 + (process.pid % 100)}`
  xvfbProcess = spawn(
    'Xvfb',
    [display, '-screen', '0', '1280x800x24', '-nolisten', 'tcp', '-terminate'],
    { stdio: 'ignore' }
  )
  process.env.DISPLAY = display

  await new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, 350)
    xvfbProcess.once('error', (err) => {
      clearTimeout(timer)
      xvfbProcess = null
      delete process.env.DISPLAY
      reject(err)
    })
    xvfbProcess.once('exit', (code) => {
      if (code === 0) return
      clearTimeout(timer)
      xvfbProcess = null
      delete process.env.DISPLAY
      reject(new Error(`Xvfb 启动失败 (${code})`))
    })
  })
}

function withBrowserLock(task) {
  const run = browserQueue.then(task, task)
  browserQueue = run.catch(() => {})
  return run
}

function responseMayContainMedia(url = '') {
  return (
    url.includes('/aweme/v1/web/aweme/detail') ||
    url.includes('/web/api/v2/aweme/iteminfo') ||
    url.includes('/web/api/v2/aweme/slidesinfo')
  )
}

async function parseResponse(response, awemeId) {
  if (!responseMayContainMedia(response.url())) return null
  try {
    const payload = await response.json()
    const item = itemFromPayload(payload)
    if (item && String(item.aweme_id || item.awemeId || '') === String(awemeId)) return item
  } catch {
    // Ignore non-JSON and blocked responses.
  }
  return null
}

async function extractHydratedItem(page, awemeId) {
  return page.evaluate((targetId) => {
    const seen = new WeakSet()
    const find = (value, depth = 0) => {
      if (!value || typeof value !== 'object' || depth > 12 || seen.has(value)) return null
      seen.add(value)
      const id = value.aweme_id || value.awemeId
      if (String(id || '') === String(targetId) && (value.video || value.images)) return value
      for (const child of Object.values(value)) {
        const match = find(child, depth + 1)
        if (match) return match
      }
      return null
    }

    const candidates = [
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

async function fetchInBrowser(awemeId) {
  const context = await getContext()
  const page = await context.newPage()
  let resolveMedia
  const mediaResponse = new Promise((resolve) => {
    resolveMedia = resolve
  })

  const onResponse = async (response) => {
    const item = await parseResponse(response, awemeId)
    if (item) resolveMedia(item)
  }
  page.on('response', onResponse)

  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await page.goto(`https://www.douyin.com/video/${awemeId}`, {
        waitUntil: 'domcontentloaded',
        timeout: BROWSER_TIMEOUT_MS,
      })

      const hydrated = await extractHydratedItem(page, awemeId)
      if (hydrated) return hydrated

      const item = await new Promise((resolve) => {
        const timer = setTimeout(() => resolve(null), RESPONSE_TIMEOUT_MS)
        mediaResponse.then((value) => {
          clearTimeout(timer)
          resolve(value)
        })
      })
      if (item) return item
    }

    return await extractHydratedItem(page, awemeId)
  } finally {
    page.off('response', onResponse)
    await page.close().catch(() => {})
  }
}

export async function fetchDouyinItemInBrowser(awemeId) {
  try {
    return await withBrowserLock(() => fetchInBrowser(awemeId))
  } catch (cause) {
    const err = new Error(`抖音浏览器解析失败：${cause.message}`)
    err.code = 'BLOCKED'
    err.cause = cause
    throw err
  }
}

export async function closeDouyinBrowser() {
  const context = await contextPromise?.catch(() => null)
  contextPromise = null
  await context?.close().catch(() => {})
  const browser = await browserPromise?.catch(() => null)
  browserPromise = null
  await browser?.close().catch(() => {})
  xvfbProcess?.kill()
  xvfbProcess = null
}
