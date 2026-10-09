import { Router } from 'express'
import { getExtractStats, parseRecentWindowDays, parseRecentWindowHours } from '../services/extractStats.js'

const router = Router()

router.get('/', async (req, res, next) => {
  const days = parseRecentWindowDays(req.query.days)
  if (req.query.days !== undefined && days === null) {
    return res.status(400).json({
      error: 'INVALID_WINDOW',
      message: 'days 需要是 1 到 31 的整数',
    })
  }

  const hours = parseRecentWindowHours(req.query.hours)
  if (!days && hours === null) {
    return res.status(400).json({
      error: 'INVALID_WINDOW',
      message: 'hours 需要是 1 到 720 的整数',
    })
  }

  try {
    const stats = await getExtractStats({ hours: hours || undefined, days })
    res.status(stats.database === 'error' ? 503 : 200).json(stats)
  } catch (err) {
    next(err)
  }
})

export default router
