import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import rateLimit from 'express-rate-limit'
import { checkDatabase, initDatabase } from './db/client.js'
import extractRoutes from './routes/extract.js'

const app = express()
const PORT = process.env.PORT || 3001

app.set('trust proxy', 1)

app.use(cors({ origin: process.env.CORS_ORIGIN || 'http://localhost:5173' }))
app.use(express.json())

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: 'RATE_LIMIT', message: '请求过于频繁，请稍后重试' },
})
app.use('/api/extract', limiter)

app.get('/health', async (_req, res) => {
  res.json({ status: 'ok', database: await checkDatabase() })
})

app.use('/api', extractRoutes)

app.use((err, _req, res, _next) => {
  console.error(err)
  res.status(500).json({ error: 'INTERNAL_ERROR', message: '服务器内部错误' })
})

async function start() {
  try {
    const ready = await initDatabase()
    if (ready) console.log('MongoDB connected')
  } catch (err) {
    console.error('MongoDB init failed:', err.message)
  }

  app.listen(PORT, () => {
    console.log(`TakeIt API running on http://localhost:${PORT}`)
  })
}

start()
