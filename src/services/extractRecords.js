import { dbEnabled, getExtractRecords } from '../db/client.js'

function asText(value, maxLength = 4000) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed
}

export function saveExtractRecord(record = {}) {
  const collection = getExtractRecords()
  if (!dbEnabled || !collection) return

  const doc = {
    originalInput: asText(record.originalInput, 8000) || '',
    resolvedUrl: asText(record.resolvedUrl, 2000),
    platform: asText(record.platform, 32),
    title: asText(record.title, 1000) || '',
    status: asText(record.status, 32) || 'error',
    errorCode: asText(record.errorCode, 64),
    errorMessage: asText(record.errorMessage, 2000),
    needsPassword: Boolean(record.needsPassword),
    mediaCount: Number.isFinite(record.mediaCount) ? Math.max(0, record.mediaCount) : 0,
    result: record.result ? structuredClone(record.result) : null,
    clientIp: asText(record.clientIp, 128),
    userAgent: asText(record.userAgent, 500),
    createdAt: new Date(),
  }

  collection.insertOne(doc).catch((err) => {
    console.error('Failed to save extract record:', err.message)
  })
}
