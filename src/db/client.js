import { MongoClient } from 'mongodb'

const connectionString = process.env.MONGODB_URI || ''
export const dbEnabled = Boolean(connectionString)

const DB_NAME = process.env.MONGODB_DB || 'takeit'
const COLLECTION_NAME = 'extract_records'

let client = null
let database = null
let records = null

export function getExtractRecords() {
  return records
}

export async function initDatabase() {
  if (!dbEnabled) {
    console.warn('MONGODB_URI 未配置，解析记录将不会写入数据库')
    return false
  }

  client = new MongoClient(connectionString, {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 5000,
  })
  await client.connect()
  database = client.db(DB_NAME)
  records = database.collection(COLLECTION_NAME)

  await records.createIndexes([
    { key: { createdAt: -1 } },
    { key: { platform: 1 } },
    { key: { status: 1 } },
    { key: { resolvedUrl: 1 } },
  ])

  await database.command({ ping: 1 })
  return true
}

export async function checkDatabase() {
  if (!dbEnabled || !database) return 'disabled'
  try {
    await database.command({ ping: 1 })
    return 'ok'
  } catch (err) {
    console.error('MongoDB health check failed:', err.message)
    return 'error'
  }
}
