import { checkDatabase, getExtractRecords } from '../db/client.js'
import { emptyClientCounts } from '../utils/clientSource.js'
import { PLATFORMS } from './detector.js'

const DEFAULT_HOURS = 24
const MAX_HOURS = 24 * 30
const TIMEZONE = 'Asia/Shanghai'

const KNOWN_PLATFORMS = PLATFORMS.map((platform) => ({
  platform: platform.id,
  name: platform.name,
}))

export function parseRecentWindowHours(value) {
  if (value === undefined || value === null || value === '') return DEFAULT_HOURS
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_HOURS) return null
  return parsed
}

export function parseRecentWindowDays(value) {
  if (value === undefined || value === null || value === '') return null
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 31) return null
  return parsed
}

function windowForDays(dayCount, now) {
  const end = shanghaiDateKey(now)
  const startKey = shiftDateKey(end, -(dayCount - 1))
  const since = new Date(`${startKey}T00:00:00+08:00`)
  const keys = []
  let cursor = startKey
  while (cursor <= end && keys.length <= 31) {
    keys.push(cursor)
    cursor = shiftDateKey(cursor, 1)
  }
  const hours = Math.max(1, Math.round((now.getTime() - since.getTime()) / (60 * 60 * 1000)))
  return { since, keys, hours }
}

function shanghaiDateKey(date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

function shiftDateKey(dateKey, days) {
  const [year, month, day] = dateKey.split('-').map(Number)
  const shifted = new Date(Date.UTC(year, month - 1, day + days))
  const nextYear = shifted.getUTCFullYear()
  const nextMonth = String(shifted.getUTCMonth() + 1).padStart(2, '0')
  const nextDay = String(shifted.getUTCDate()).padStart(2, '0')
  return `${nextYear}-${nextMonth}-${nextDay}`
}

function calendarDays(since, now) {
  const start = shanghaiDateKey(since)
  const end = shanghaiDateKey(now)
  const keys = []
  let cursor = start
  while (cursor <= end && keys.length <= 31) {
    keys.push(cursor)
    cursor = shiftDateKey(cursor, 1)
  }
  return keys.length ? keys : [end]
}

function emptyDays(dayKeys) {
  return dayKeys.map((date) => ({ date, success: 0, failed: 0, needsPassword: 0 }))
}

function emptyPlatform(platform, dayKeys) {
  return {
    platform: platform.platform,
    name: platform.name,
    success: 0,
    failed: 0,
    needsPassword: 0,
    recentSuccess: 0,
    recentFailed: 0,
    lastSuccessAt: null,
    lastFailedAt: null,
    days: emptyDays(dayKeys),
  }
}

function emptyStats(hours, database, now = new Date(), dayKeys = null) {
  const since = new Date(now.getTime() - hours * 60 * 60 * 1000)
  const keys = dayKeys || calendarDays(since, now)
  return {
    database,
    generatedAt: now.toISOString(),
    timezone: TIMEZONE,
    recentWindowHours: hours,
    total: 0,
    success: 0,
    failed: 0,
    needsPassword: 0,
    clients: emptyClientCounts(),
    platforms: KNOWN_PLATFORMS.map((platform) => emptyPlatform(platform, keys)),
  }
}

function statusBucket(status) {
  if (status === 'success') return 'success'
  if (status === 'needs_password') return 'needsPassword'
  return 'failed'
}

function toIso(value) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function laterIso(current, next) {
  if (!next) return current
  if (!current || next > current) return next
  return current
}

export async function getExtractStats({ hours = DEFAULT_HOURS, days = null } = {}) {
  const now = new Date()
  const calendarWindow = days ? windowForDays(days, now) : null
  const since = calendarWindow?.since || new Date(now.getTime() - hours * 60 * 60 * 1000)
  const dayKeys = calendarWindow?.keys || calendarDays(since, now)
  const recentWindowHours = calendarWindow?.hours || hours
  const database = await checkDatabase()
  if (database !== 'ok') return emptyStats(recentWindowHours, database, now, dayKeys)
  const collection = getExtractRecords()
  const [rows, dayRows, clientRows] = await Promise.all([
    collection.aggregate([
      {
        $group: {
          _id: {
            platform: { $ifNull: ['$platform', 'unknown'] },
            status: { $ifNull: ['$status', 'error'] },
          },
          count: { $sum: 1 },
          recent: {
            $sum: {
              $cond: [{ $gte: ['$createdAt', since] }, 1, 0],
            },
          },
          lastAt: { $max: '$createdAt' },
        },
      },
    ]).toArray(),
    collection.aggregate([
      { $match: { createdAt: { $gte: since } } },
      {
        $group: {
          _id: {
            platform: { $ifNull: ['$platform', 'unknown'] },
            status: { $ifNull: ['$status', 'error'] },
            day: {
              $dateToString: {
                format: '%Y-%m-%d',
                date: '$createdAt',
                timezone: TIMEZONE,
              },
            },
          },
          count: { $sum: 1 },
        },
      },
    ]).toArray(),
    collection.aggregate([
      {
        $group: {
          _id: { $ifNull: ['$client', 'unknown'] },
          count: { $sum: 1 },
        },
      },
    ]).toArray(),
  ])

  const byPlatform = new Map(KNOWN_PLATFORMS.map((platform) => [platform.platform, emptyPlatform(platform, dayKeys)]))
  const totals = { total: 0, success: 0, failed: 0, needsPassword: 0 }

  for (const row of rows) {
    const platformId = row._id?.platform || 'unknown'
    const bucket = statusBucket(row._id?.status)
    const count = row.count || 0
    const recent = row.recent || 0
    totals.total += count
    totals[bucket] += count

    if (!byPlatform.has(platformId)) {
      byPlatform.set(platformId, emptyPlatform({
        platform: platformId,
        name: platformId === 'unknown' ? '未识别' : platformId,
      }, dayKeys))
    }

    const entry = byPlatform.get(platformId)
    entry[bucket] += count
    if (bucket === 'success') {
      entry.recentSuccess += recent
      entry.lastSuccessAt = laterIso(entry.lastSuccessAt, toIso(row.lastAt))
    } else if (bucket === 'failed') {
      entry.recentFailed += recent
      entry.lastFailedAt = laterIso(entry.lastFailedAt, toIso(row.lastAt))
    }
  }

  for (const row of dayRows) {
    const entry = byPlatform.get(row._id?.platform || 'unknown')
    const day = entry?.days.find((item) => item.date === row._id?.day)
    if (!day) continue
    day[statusBucket(row._id?.status)] += row.count || 0
  }

  const clients = emptyClientCounts()
  for (const row of clientRows) {
    const client = clients[row._id] === undefined ? 'unknown' : row._id
    clients[client] += row.count || 0
  }

  const knownIds = new Set(KNOWN_PLATFORMS.map((platform) => platform.platform))
  const platforms = [...byPlatform.values()]
    .filter((entry) => knownIds.has(entry.platform) || entry.success + entry.failed + entry.needsPassword > 0)
    .sort((a, b) => {
      const aKnown = knownIds.has(a.platform)
      const bKnown = knownIds.has(b.platform)
      if (aKnown !== bKnown) return aKnown ? -1 : 1
      if (aKnown && bKnown) {
        return KNOWN_PLATFORMS.findIndex((item) => item.platform === a.platform)
          - KNOWN_PLATFORMS.findIndex((item) => item.platform === b.platform)
      }
      return a.platform.localeCompare(b.platform)
    })

  return {
    database,
    generatedAt: now.toISOString(),
    timezone: TIMEZONE,
    recentWindowHours,
    ...totals,
    clients,
    platforms,
  }
}
