# TakeIt Backend

分享链接媒体提取与下载工具 — 后端 API 服务。解析各平台分享页中的图片、视频、音频资源，并通过代理接口提供下载。

## 技术栈

- **Node.js** + **Express** — HTTP 服务
- **axios** — 常规 HTTP 请求（PPT.cc、Twitter、抖音、下载代理）
- **curl-cffi-node** — 浏览器指纹模拟，绕过 MyPPT / LURL 的 Cloudflare 防护
- **Playwright Core + Chromium + Xvfb** — 抖音 Web API 被 Argus 拦截时的浏览器解析兜底
- **cheerio** — HTML 解析与媒体 URL 提取
- **express-rate-limit** — API 速率限制
- **cors** — 跨域配置

## 快速开始

```bash
npm install
cp .env.example .env
npx playwright-core install chromium  # 安装抖音浏览器兜底所需 Chromium
npm run dev    # 开发模式（文件变更自动重启）
npm start      # 生产模式
```

默认运行在 http://localhost:3001

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `PORT` | 服务端口 | `3001` |
| `CORS_ORIGIN` | 允许的前端域名 | `http://localhost:5173` |
| `CHROMIUM_EXECUTABLE_PATH` | Chromium 可执行文件路径；Playwright 无法自动定位时填写 | 空 |

抖音浏览器兜底在 Linux 服务器上还需要 `Xvfb`。程序会按需启动虚拟显示并复用一个 Chromium 实例。

## 项目结构

```
src/
├── index.js              # 入口：Express 应用、CORS、速率限制
├── routes/extract.js     # /api/extract、/api/download 路由
├── extractors/           # 各平台解析器
│   ├── myppt-lurl.js     # MyPPT / LURL 共用逻辑（密码解锁、媒体提取）
│   ├── pptcc.js          # PPT.cc 解析
│   ├── twitter.js        # Twitter/X 解析（fxtwitter API）
│   ├── douyin.js         # 抖音解析
│   ├── xiaohongshu.js    # 小红书解析
│   └── instagram.js      # Instagram 解析
├── services/
│   ├── detector.js       # 平台识别
│   ├── fetcher.js        # axios 请求封装
│   ├── impersonatedHttp.js  # curl-cffi 浏览器模拟请求
│   ├── douyinBrowser.js  # Chromium 浏览器解析兜底与实例复用
│   └── shortlinkHttp.js  # 短链页面抓取与密码解锁
└── utils/
    ├── douyin.js         # 抖音短链解析、ttwid 会话、Web API 提取
    ├── xiaohongshu.js    # 小红书短链解析、INITIAL_STATE 提取
    ├── instagram.js      # Instagram shortcode、embed contextJSON 提取
    └── ...               # URL、文件名、密码等工具函数
```

## API 端点

### GET /health

健康检查。

```json
{ "status": "ok" }
```

### POST /api/extract

解析分享链接中的媒体资源。

**请求体**

```json
{
  "url": "https://lurl.cc/xxx",
  "password": "0115"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `url` | string | 是 | 分享链接，或包含链接的分享文案（如抖音复制粘贴的整段文字） |
| `password` | string | 否 | 页面访问密码；省略时 MyPPT / LURL 会尝试从页面日期自动推断 |

**成功响应**

```json
{
  "platform": "lurl",
  "title": "页面标题",
  "needsPassword": false,
  "media": [
    {
      "type": "video",
      "url": "https://...",
      "thumbnail": "https://...",
      "filename": "media-1.mp4",
      "qualities": [
        {
          "label": "1080p",
          "url": "https://...",
          "width": 1920,
          "height": 1080,
          "bitrate": 1609149
        }
      ]
    }
  ]
}
```

| 字段 | 说明 |
|------|------|
| `platform` | 平台标识：`myppt` / `lurl` / `pptcc` / `twitter` / `douyin` / `xiaohongshu` / `instagram` |
| `needsPassword` | 页面需要密码且尚未解锁时为 `true`，此时 `media` 为空 |
| `media[].type` | 媒体类型：`image` / `video` / `audio` |
| `media[].qualities` | 视频可用清晰度列表，按质量从高到低排列；平台仅返回单一源时可能省略 |

**错误响应**

| HTTP 状态码 | error | 说明 |
|-------------|-------|------|
| 400 | `INVALID_URL` | URL 无效 |
| 400 | `UNSUPPORTED_PLATFORM` | 不支持的平台 |
| 401 | `PASSWORD_FAILED` | 密码不正确 |
| 410 | `EXPIRED` | 链接已过期或失效 |
| 422 | `BLOCKED` | 目标站点防护拦截 |
| 422 | `NO_MEDIA` | 未找到可下载媒体 |
| 422 | `PARSE_FAILED` | 解析失败 |
| 429 | `RATE_LIMIT` | 请求过于频繁（每分钟最多 30 次） |

### GET /api/download

代理下载媒体文件，解决前端跨域与 Referer 限制。

```
GET /api/download?url=<encoded_url>&filename=<name>&inline=<0|1>
```

| 参数 | 必填 | 说明 |
|------|------|------|
| `url` | 是 | 媒体直链（需 URL 编码） |
| `filename` | 否 | 下载文件名；省略时从 URL 或 Content-Type 推断 |
| `inline` | 否 | 设为 `1` 时以内联方式预览，默认为附件下载 |

## 支持平台

| 平台 | 域名 | 媒体类型 | 特性 |
|------|------|----------|------|
| Twitter/X | twitter.com, x.com, mobile.twitter.com | 图片、视频 | 通过 [fxtwitter](https://api.fxtwitter.com) API 解析；支持多码率 MP4 |
| Instagram | instagram.com, instagr.am | 图片、视频 | 解析公开 Embed 与 Polaris GraphQL；支持图集及多清晰度 |
| 抖音 | douyin.com, v.douyin.com, iesdouyin.com | 图片、视频 | Web Detail API + Chromium 兜底；支持分享文案、图集及多清晰度 |
| 小红书 | xiaohongshu.com, xhslink.com, xhslink.cn, rednote.com | 图片、视频 | 短链跳转、页面状态提取及多清晰度 |
| MyPPT.cc | myppt.cc | 图片、视频 | curl-cffi 绕过 Cloudflare；密码页解锁；日期密码自动尝试 |
| LURL.cc | lurl.cc | 图片、视频 | 同 MyPPT.cc |
| PPT.cc | ppt.cc | 图片、视频 | HTML 解析，从 `<video>` / `<img>` / 脚本中提取 |

## 核心机制

### 密码解锁（MyPPT / LURL）

1. 使用 curl-cffi 模拟 Chrome 131 访问页面
2. 若页面含 `encrypt_pass` 表单，向 `/session.php` 提交密码解锁
3. 未提供密码时，从页面文本中提取日期（如 `2024/01/15`）并生成 `MMDD` 变体自动尝试
4. 解锁失败或需手动输入时返回 `needsPassword: true`

### 抖音解析

1. 从输入中提取抖音链接（支持 `v.douyin.com` 短链及整段分享文案）
2. 跟随短链跳转，解析作品 `aweme_id`
3. 注册 `ttwid` 并访问 `douyin.com/video/{id}` 建立会话
4. 优先调用 Douyin Web Detail API 获取标题、封面与播放地址
5. 遇到 `Uifid Not Found`、`Sign Invalid` 等 Argus 拦截时，自动使用有界面 Chromium + Xvfb 执行官方安全脚本并拦截详情响应
6. 浏览器上下文复用且请求串行，降低启动开销与风控概率
7. 视频清晰度按分辨率去重；图集返回原图及实况视频

### 小红书解析

1. 从输入中提取小红书链接（支持 `xhslink.com` / `xhslink.cn` 短链及整段分享文案）
2. 使用 curl-cffi 跟随短链跳转到笔记页
3. 解析页面中的 `window.__INITIAL_STATE__` 数据
4. 图集返回 `imageList` 中的高清图片；视频优先使用 `originVideoKey` 构建无水印地址

### Instagram 解析

1. 从输入中提取 Instagram 链接（支持 `/reel/`、`/p/`、`/tv/` 及带 `stkn` 的分享链接）
2. 优先访问公开 Embed 页并解析 `contextJSON`
3. Embed 未返回媒体时，使用匿名 Polaris GraphQL 查询
4. 视频返回可用 `video_versions` 清晰度；图片选择最高分辨率；图集遍历子项

### 媒体提取

- 从 HTML 元素（`video`、`audio`、`img`、`preload` 链接）提取
- 从页面源码中正则匹配嵌入的媒体 URL（含 r2limit CDN）
- 自动去重，并根据 URL 路径或 Content-Type 生成文件名

### 速率限制

`POST /api/extract` 限制为：**每分钟最多 30 次请求**。

## 免责声明

本工具仅用于提取用户有权访问的公开媒体资源，请勿用于非法用途。
