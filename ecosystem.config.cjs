const fs = require('fs')
const path = require('path')

function loadEnvFile(filePath) {
  const env = {}
  const fullPath = path.resolve(__dirname, filePath)
  if (!fs.existsSync(fullPath)) return env
  for (const line of fs.readFileSync(fullPath, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim()
  }
  return env
}

module.exports = {
  apps: [
    {
      name: 'takeit-api',
      cwd: '/var/www/TakeIt-Backend',
      script: 'src/index.js',
      interpreter: '/home/ubuntu/.nvm/versions/node/v24.14.1/bin/node',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        ...loadEnvFile('.env'),
        HTTP_PROXY: '',
        HTTPS_PROXY: '',
        http_proxy: '',
        https_proxy: '',
        ALL_PROXY: '',
        all_proxy: '',
        SOCKS_PROXY: '',
        SOCKS5_PROXY: '',
        GIT_HTTP_PROXY: '',
        GIT_HTTPS_PROXY: '',
        NO_PROXY: '',
        no_proxy: '',
      },
    },
  ],
}
