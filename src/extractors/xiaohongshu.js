import { BaseExtractor } from './base.js'
import { parseXiaohongshuShare } from '../utils/xiaohongshu.js'

export class XiaohongshuExtractor extends BaseExtractor {
  constructor() {
    super('xiaohongshu')
  }

  async extract(url) {
    const { title, media } = await parseXiaohongshuShare(url)
    return this.buildResult({ title, media })
  }
}
