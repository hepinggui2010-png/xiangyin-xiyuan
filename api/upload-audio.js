import { put } from '@vercel/blob'

const MAX_AUDIO_SIZE = 4 * 1024 * 1024

function parseBody(body) {
  if (!body) return null
  if (typeof body === 'string') return JSON.parse(body)
  return body
}

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    return response.status(405).json({ error: 'Only audio uploads are supported.' })
  }

  try {
    const body = parseBody(request.body)
    const pathname = body?.pathname
    const contentType = body?.contentType || 'audio/webm'
    const base64Audio = body?.data

    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return response.status(500).json({ error: 'Audio storage is not connected yet.' })
    }

    if (!pathname?.startsWith('audio/') || !pathname.endsWith('.webm')) {
      return response.status(400).json({ error: 'Invalid audio path.' })
    }

    if (!base64Audio) {
      return response.status(400).json({ error: 'No audio file was received.' })
    }

    const audioBuffer = Buffer.from(base64Audio, 'base64')
    if (audioBuffer.byteLength > MAX_AUDIO_SIZE) {
      return response.status(413).json({ error: 'The recording is too long. Please record a shorter clip.' })
    }

    const blob = await put(pathname, audioBuffer, {
      access: 'public',
      addRandomSuffix: true,
      contentType,
    })

    return response.status(200).json({ url: blob.url })
  } catch (error) {
    return response.status(400).json({ error: error.message || 'Audio upload failed.' })
  }
}
