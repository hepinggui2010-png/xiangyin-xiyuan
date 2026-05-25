# 乡音溪源

溪源乡方言声音档案。用于记录溪源九村的词语、普通话释义、村庄来源和方言发音。

## 本地运行

```powershell
npm.cmd install
npm.cmd run dev
```

如果需要在本地测试 Vercel Blob 音频上传，请先配置 `BLOB_READ_WRITE_TOKEN`，并使用：

```powershell
npm.cmd run vercel:dev
```

## 环境变量

复制 `.env.example` 为 `.env.local`，按需填写 Firebase 与 Vercel Blob 配置。Firebase 配置已有项目默认值，`BLOB_READ_WRITE_TOKEN` 需要在 Vercel 项目 Storage 中创建 Blob 后获得。

## 数据

Firestore 集合名：`entries`。

音频上传路径：`audio/{createdAt}-{safeHanzi}.webm`。

## 部署

部署到 Vercel 后，请确认：

- 已创建 Vercel Blob store，并设置 `BLOB_READ_WRITE_TOKEN`。
- Firebase 控制台已发布 `firestore.rules`。
- Firebase API key 已限制允许域名。
