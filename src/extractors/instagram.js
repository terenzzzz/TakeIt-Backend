import { BaseExtractor } from './base.js'
import { parseInstagramShare } from '../utils/instagram.js'

export class InstagramExtractor extends BaseExtractor {
  constructor() {
    super('instagram')
  }

  async extract(url) {
    const { title, media } = await parseInstagramShare(url)
    return this.buildResult({ title, media })
  }
}
