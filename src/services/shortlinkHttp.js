import * as cheerio from 'cheerio'
import {
  fetchHtmlImpersonated,
  isCloudflareBlocked,
  postFormImpersonated,
} from './impersonatedHttp.js'
import { detectPageStatus, extractDatePasswords, extractMediaFromHtml } from '../utils/password.js'

const MEDIA_URL_PATTERN =
  /https?:\/\/[^'"\s>]*(?:r2limit|lurl\d*\.lurl\.cc|myppt)[^'"\s>]*\.(?:jpe?g|png|webp|gif|mp4|m3u8|webm|mov)/gi

function extractMediaUrls(html) {
  const matches = html.match(MEDIA_URL_PATTERN) || []
  return [...new Set(matches)]
}

function collectPageMedia(html, baseUrl) {
  const urls = new Set(extractMediaUrls(html))
  for (const item of extractMediaFromHtml(html, baseUrl)) {
    if (item.url) urls.add(item.url)
  }
  return [...urls]
}

function pageHasMedia(html, baseUrl) {
  return collectPageMedia(html, baseUrl).length > 0
}

function parseUnlockForm(html) {
  const $ = cheerio.load(html)
  const encryptPass = $('input[name="encrypt_pass"]').attr('value')
  const getDomin = $('input[name="GETdomin"]').attr('value')

  if (!encryptPass || !getDomin) return null

  return { encryptPass, getDomin }
}

function buildPasswordCandidates(html, password) {
  if (password) return [password]
  return extractDatePasswords(html).slice(0, 6)
}

async function unlockWithPassword(pageUrl, form, password) {
  const sessionUrl = new URL('/session.php', pageUrl).href
  const payload = new URLSearchParams({
    GETdomin: form.getDomin,
    encrypt_pass: form.encryptPass,
    password,
  })

  const unlockResponse = await postFormImpersonated(sessionUrl, payload, {
    headers: {
      Referer: pageUrl,
      'X-Requested-With': 'XMLHttpRequest',
    },
  })

  let result
  try {
    result = JSON.parse(unlockResponse.html)
  } catch {
    return { ok: false, html: unlockResponse.html }
  }

  if (result.type === 'ERROR') {
    return { ok: false, error: result.text, passwordFailed: /密碼|密码/.test(result.text || '') }
  }

  const reloaded = await fetchHtmlImpersonated(pageUrl, {
    headers: { Referer: pageUrl },
  })

  return {
    ok: true,
    ...reloaded,
    mediaUrls: collectPageMedia(reloaded.html, reloaded.finalUrl || pageUrl),
  }
}

export async function extractShortLinkPage(url, { password } = {}) {
  const initial = await fetchHtmlImpersonated(url, { headers: { Referer: url } })

  if (isCloudflareBlocked(initial.html, initial.status)) {
    const err = new Error('目标网站启用了防护，暂时无法解析')
    err.code = 'BLOCKED'
    throw err
  }

  const pageStatus = detectPageStatus(initial.html)
  if (pageStatus === 'expired') {
    const err = new Error('该链接可能已过期或失效')
    err.code = 'EXPIRED'
    throw err
  }

  const initialMedia = collectPageMedia(initial.html, initial.finalUrl || url)
  if (initialMedia.length > 0) {
    return {
      html: initial.html,
      finalUrl: initial.finalUrl,
      status: initial.status,
      mediaUrls: initialMedia,
      needsPassword: false,
    }
  }

  const form = parseUnlockForm(initial.html)
  if (!form) {
    return {
      html: initial.html,
      finalUrl: initial.finalUrl,
      status: initial.status,
      mediaUrls: [],
      needsPassword: pageStatus === 'needsPassword',
    }
  }

  const candidates = buildPasswordCandidates(initial.html, password)
  for (const candidate of candidates) {
    const unlocked = await unlockWithPassword(url, form, candidate)
    if (!unlocked.ok) {
      if (unlocked.passwordFailed) continue
      continue
    }

    if (pageHasMedia(unlocked.html, unlocked.finalUrl || url)) {
      return {
        html: unlocked.html,
        finalUrl: unlocked.finalUrl,
        status: unlocked.status,
        mediaUrls: unlocked.mediaUrls,
        needsPassword: false,
      }
    }
  }

  if (password) {
    const err = new Error('密码不正确，请重试')
    err.code = 'PASSWORD_FAILED'
    throw err
  }

  return {
    html: initial.html,
    finalUrl: initial.finalUrl,
    status: initial.status,
    mediaUrls: [],
    needsPassword: true,
  }
}
