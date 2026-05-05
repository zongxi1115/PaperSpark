import { exportCanvasSceneBlob, readCanvasScene } from '@/lib/canvas'

export async function canvasBlockToImageBlob(graphDataJson: string, isDark: boolean): Promise<Blob | null> {
  if (!graphDataJson.trim()) return null
  const scene = readCanvasScene(graphDataJson, isDark)
  return await exportCanvasSceneBlob(scene, isDark, {
    maxWidth: 1800,
    maxHeight: 1400,
    quality: 1,
  })
}
