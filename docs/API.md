# TakeIt API 接口文档

Base URL：`http://localhost:3001`（默认）

Content-Type：`application/json`（除下载接口返回二进制流）

速率限制：所有 `/api/*` 接口共享 **每分钟 30 次** 请求上限。

---

## 接口一览

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/health` | 健康检查 |
| `POST` | `/api/extract` | 解析分享链接中的媒体 |
| `GET` | `/api/download` | 代理下载媒体文件 |

---

## 1. 健康检查

### `GET /health`

用于探活，不受速率限制。

#### 响应 `200`

```json
{
  "status": "ok"
}
```

---

## 2. 解析媒体

### `POST /api/extract`

根据分享链接识别平台并提取图片 / 视频 / 音频资源。

#### 请求体

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `url` | `string` | 是 | 分享链接；可省略 `https://` 前缀 |
| `password` | `string` | 否 | 页面访问密码。MyPPT / LURL 未传时会尝试从页面日期自动推断 |

```json
{
  "url": "https://lurl.cc/xxx",
  "password": "0115"
}
```

#### 成功响应 `200`

```json
{
  "platform": "lurl",
  "title": "页面标题",
  "needsPassword": false,
  "media": [
    {
      "type": "video",
      "url": "https://example.com/video.mp4",
      "thumbnail": "https://example.com/thumb.jpg",
      "filename": "media-1.mp4"
    }
  ]
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `platform` | `string` | 平台标识：`myppt` / `lurl` / `pptcc` / `twitter` |
| `title` | `string` | 页面或推文标题 |
| `needsPassword` | `boolean` | 需要密码且尚未解锁时为 `true`，此时 `media` 为空数组 |
| `media` | `array` | 媒体列表 |
| `media[].type` | `string` | `image` / `video` / `audio` |
| `media[].url` | `string` | 媒体直链 |
| `media[].thumbnail` | `string` | 缩略图；无则回退为 `url` |
| `media[].filename` | `string` | 建议下载文件名 |

#### 错误响应

统一格式：

```json
{
  "error": "ERROR_CODE",
  "message": "人类可读说明"
}
```

| HTTP | `error` | `message` | 说明 |
|------|---------|-----------|------|
| `400` | `INVALID_URL` | 请输入有效的分享链接 | URL 缺失或格式无效 |
| `400` | `UNSUPPORTED_PLATFORM` | 暂不支持该平台，敬请期待 | 域名不在支持列表 |
| `401` | `PASSWORD_FAILED` | 密码不正确，请重试 | 提供的密码错误 |
| `410` | `EXPIRED` | 该链接可能已过期或失效 | 链接失效 / 404 |
| `422` | `BLOCKED` | 目标网站启用了防护，暂时无法解析 | Cloudflare 等拦截 |
| `422` | `NO_MEDIA` | 未找到可下载的媒体资源 | 页面无可用媒体 |
| `422` | `PARSE_FAILED` | 解析失败，请检查链接是否正确 | 通用解析失败 |
| `429` | `RATE_LIMIT` | 请求过于频繁，请稍后重试 | 超出速率限制 |
| `500` | `INTERNAL_ERROR` | 服务器内部错误 | 未捕获异常 |

#### 调用示例

```bash
curl -X POST http://localhost:3001/api/extract \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://ppt.cc/xxx","password":"0115"}'
```

---

## 3. 代理下载

### `GET /api/download`

代理拉取媒体直链，解决前端跨域与 Referer 限制，以流式响应返回文件。

#### Query 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `url` | `string` | 是 | 媒体直链，需 URL 编码 |
| `filename` | `string` | 否 | 下载文件名；省略时从 URL 路径或 `Content-Type` 推断 |
| `inline` | `string` | 否 | 传 `1` 时以 `inline` 预览，否则为 `attachment` 下载 |

#### 成功响应 `200`

- Body：媒体二进制流
- Headers：
  - `Content-Type`：上游返回的 MIME（如有）
  - `Content-Length`：上游返回的长度（如有）
  - `Content-Disposition`：`attachment` 或 `inline`，附带文件名

#### 错误响应

| HTTP | `error` | `message` | 说明 |
|------|---------|-----------|------|
| `400` | `INVALID_URL` | 缺少下载地址 | 未传 `url` |
| `429` | `RATE_LIMIT` | 请求过于频繁，请稍后重试 | 超出速率限制 |
| `500` | `DOWNLOAD_FAILED` | 下载失败，请重试 | 上游拉取失败 |
| `500` | `INTERNAL_ERROR` | 服务器内部错误 | 未捕获异常 |

#### 调用示例

```bash
# 下载
curl -OJ "http://localhost:3001/api/download?url=$(python3 -c 'import urllib.parse; print(urllib.parse.quote("https://example.com/a.mp4", safe=""))')&filename=demo.mp4"

# 内联预览
curl -I "http://localhost:3001/api/download?url=<encoded_url>&inline=1"
```

前端拼接示例：

```js
const downloadUrl =
  `/api/download?url=${encodeURIComponent(media.url)}` +
  `&filename=${encodeURIComponent(media.filename)}`
```

---

## 支持平台

| 平台 | `platform` | 域名 | 备注 |
|------|------------|------|------|
| MyPPT | `myppt` | `myppt.cc` | 支持密码；可自动尝试日期密码 |
| LURL | `lurl` | `lurl.cc` | 同 MyPPT |
| PPT.cc | `pptcc` | `ppt.cc` | HTML 解析提取媒体 |
| Twitter/X | `twitter` | `twitter.com` / `x.com` / `mobile.twitter.com` | 经 fxtwitter API 解析 |

---

## 通用约定

1. **CORS**：默认允许源为 `http://localhost:5173`，可通过环境变量 `CORS_ORIGIN` 配置。
2. **错误体**：失败时均为 `{ error, message }`；成功时 `/api/extract` 返回业务对象，`/api/download` 返回文件流。
3. **密码流程**：若 `/api/extract` 返回 `needsPassword: true`，前端应提示用户输入密码后再次请求，并带上 `password` 字段。
4. **下载建议**：优先使用 `/api/download` 代理，避免浏览器直连源站失败。
