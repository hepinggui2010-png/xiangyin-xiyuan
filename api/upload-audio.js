import { handleUpload } from '@vercel/blob/client'

export const config = {
  runtime: 'edge',
}

export default async function handler(request) {
  const body = await request.json()

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        if (!pathname.startsWith('audio/') || !pathname.endsWith('.webm')) {
          throw new Error('音频路径无效')
        }

        return {
          allowedContentTypes: ['audio/webm'],
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({ pathname }),
        }
      },
      onUploadCompleted: async () => {
        return undefined
      },
    })

    return Response.json(jsonResponse)
  } catch (error) {
    return Response.json({ error: error.message || '音频上传失败' }, { status: 400 })
  }
}
