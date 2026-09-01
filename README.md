# TakeIt Backend

分享链接媒体提取与下载工具 — 后端 API 服务。

## 技术栈

- Node.js + Express
- cheerio (HTML 解析)
- axios (HTTP 请求)

## 快速开始

```bash
npm install
cp .env.example .env
npm run dev
```

默认运行在 http://localhost:3001

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| PORT | 服务端口 | 3001 |
| CORS_ORIGIN | 允许的前端域名 | http://localhost:5173 |

## API 端点

### POST /api/extract

解析分享链接中的媒体资源。

```json
// Request
{ "url": "https://ppt.cc/xxx", "password": "0115" }

// Response
{
  "platform": "pptcc",
  "title": "视频标题",
  "needsPassword": false,
  "media": [
    { "type": "video", "url": "...", "thumbnail": "...", "filename": "..." }
  ]
}
```

### GET /api/download

代理下载媒体文件。

```
GET /api/download?url=<encoded_url>&filename=<name>
```

### GET /health

健康检查。

## 支持平台

| 平台 | 域名 |
|------|------|
| MyPPT | myppt.cc |
| LURL | lurl.cc |
| PPT.cc | ppt.cc |
| Twitter/X | twitter.com, x.com |

## 免责声明

本工具仅用于提取用户有权访问的公开媒体资源，请勿用于非法用途。
