import { BaseExtractor } from './base.js'
import { parseDouyinShare } from '../utils/douyin.js'

export class DouyinExtractor extends BaseExtractor {
  constructor() {
    super('douyin')
  }

  async extract(url) {
    const { title, media } = await parseDouyinShare(url)
    return this.buildResult({ title, media })
  }
}
