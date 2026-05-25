import { put } from '@vercel/blob'

const MAX_AUDIO_SIZE = 4 * 1024 * 1024

function parseBody(body) {
  if (!body) return null
  if (typeof body === 'string') return JSON.parse(body)
  return body
}

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    return response.status(405).json({ error: '只支持上传录音' })
  }

  try {
    const body = parseBody(request.body)
    const pathname = body?.pathname
    const contentType = body?.contentType || 'audio/webm'
    const base64Audio = body?.data

    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return response.status(500).json({ error: '录音存储还没有连接好' })
    }

    if (!pathname?.startsWith('audio/') || !pathname.endsWith('.webm')) {
      return response.status(400).json({ error: '音频路径无效' })
    }

    if (!base64Audio) {
      return response.status(400).json({ error: '没有收到录音文件' })
    }

    const audioBuffer = Buffer.from(base64Audio, 'base64')
    if (audioBuffer.byteLength > MAX_AUDIO_SIZE) {
      return response.status(413).json({ error: '录音太长，请重录一段更短的发音' })
    }

    const blob = await put(pathname, audioBuffer, {
      access: 'public',
      addRandomSuffix: true,
      contentType,
    })

    return response.status(200).json({ url: blob.url })
  } catch (error) {
    return response.status(400).json({ error: error.message || '音频上传失败' })
  }
}
