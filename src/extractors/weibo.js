import { BaseExtractor } from './base.js'
import { parseWeiboShare } from '../utils/weibo.js'

export class WeiboExtractor extends BaseExtractor {
  constructor() {
    super('weibo')
  }

  async extract(url) {
    const { title, media } = await parseWeiboShare(url)
    return this.buildResult({ title, media })
  }
}
