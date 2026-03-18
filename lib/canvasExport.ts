import {
  createCanvasGraphSession,
  dataUrlToBlob,
  exportGraphDataUrl,
  waitForNextPaint,
} from '@/lib/canvasX6'

export async function canvasBlockToImageBlob(graphDataJson: string, isDark: boolean): Promise<Blob | null> {
  if (typeof window === 'undefined') return null
  if (!graphDataJson.trim()) return null

  const host = document.createElement('div')
  host.style.position = 'fixed'
  host.style.left = '-99999px'
  host.style.top = '0'
  host.style.width = '1400px'
  host.style.height = '1000px'
  host.style.pointerEvents = 'none'
  document.body.appendChild(host)

  let session: Awaited<ReturnType<typeof createCanvasGraphSession>> | null = null

  try {
    session = await createCanvasGraphSession({
      container: host,
      graphData: graphDataJson,
      isDark,
      width: 1400,
      height: 1000,
    })

    await waitForNextPaint()

    const dataUrl = await exportGraphDataUrl({
      graph: session.graph,
      format: 'png',
      isDark,
      maxWidth: 1800,
      maxHeight: 1400,
      quality: 1,
    })

    return await dataUrlToBlob(dataUrl)
  } finally {
    session?.dispose()
    host.remove()
  }
}
