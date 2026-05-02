import path from 'node:path'

function normalizeConfiguredPath(value?: string | null) {
  const trimmed = value?.trim()
  if (!trimmed) return null
  return path.isAbsolute(trimmed) ? trimmed : path.resolve(process.cwd(), trimmed)
}

export function getRuntimeRoot() {
  return (
    normalizeConfiguredPath(process.env.PAPERSPARK_RUNTIME_ROOT)
    || normalizeConfiguredPath(process.env.PAPERSPARK_DATA_ROOT)
    || process.cwd()
  )
}

export function resolveRuntimePath(...segments: string[]) {
  return path.join(getRuntimeRoot(), ...segments)
}

export function resolveRuntimeOutPath(...segments: string[]) {
  return resolveRuntimePath('out', ...segments)
}

export function resolveRuntimeUploadPath(category: string, ...segments: string[]) {
  return resolveRuntimePath('runtime-uploads', category, ...segments)
}

export function buildRuntimeFileUrl(category: string, fileName: string) {
  return `/api/runtime-files/${encodeURIComponent(category)}/${encodeURIComponent(fileName)}`
}
