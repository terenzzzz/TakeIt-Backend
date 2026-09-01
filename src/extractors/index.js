import { MypptExtractor } from './myppt.js'
import { LurlExtractor } from './lurl.js'
import { PptccExtractor } from './pptcc.js'
import { TwitterExtractor } from './twitter.js'

const extractors = {
  myppt: new MypptExtractor(),
  lurl: new LurlExtractor(),
  pptcc: new PptccExtractor(),
  twitter: new TwitterExtractor(),
}

export function getExtractor(platformId) {
  return extractors[platformId] || null
}

export { extractors }
