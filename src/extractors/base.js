import { buildMediaFilename } from '../utils/filename.js'

export class BaseExtractor {
  constructor(platform) {
    this.platform = platform
  }

  async extract(_url, _options = {}) {
    throw new Error('extract() must be implemented')
  }

  buildResult({ title = '', needsPassword = false, media = [], passwordRequired = false }) {
    return {
      platform: this.platform,
      title,
      needsPassword: needsPassword || passwordRequired,
      media: media.map((item, index) => ({
        type: item.type,
        url: item.url,
        thumbnail: item.thumbnail || item.url,
        filename: item.filename || buildMediaFilename(item.url, item.type, index),
      })),
    }
  }
}
