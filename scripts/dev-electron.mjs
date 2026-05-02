import { spawn } from 'node:child_process'
import path from 'node:path'

const projectRoot = process.cwd()
const runtimeRoot = path.join(projectRoot, '.desktop-runtime')
const rendererUrl = 'http://127.0.0.1:3000'
const packageManager = 'pnpm'
const useShell = process.platform === 'win32'

let nextProcess = null
let electronProcess = null

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function waitForRenderer() {
  for (let index = 0; index < 120; index += 1) {
    try {
      const response = await fetch(rendererUrl)
      if (response.ok || response.status < 500) return
    } catch {
      // noop
    }
    await wait(500)
  }

  throw new Error('Next dev server 启动超时')
}

function stopChild(child) {
  if (!child || child.killed) return
  child.kill()
}

function wireChildLogs(prefix, child) {
  child.stdout?.on('data', (chunk) => process.stdout.write(`[${prefix}] ${chunk}`))
  child.stderr?.on('data', (chunk) => process.stderr.write(`[${prefix}] ${chunk}`))
}

const sharedEnv = {
  ...process.env,
  PAPERSPARK_ELECTRON_DEV: '1',
  PAPERSPARK_ELECTRON_RENDERER_URL: rendererUrl,
  PAPERSPARK_RUNTIME_ROOT: path.join(runtimeRoot, 'app-data'),
  PAPERSPARK_SURYA_PORT: '8765',
  SURYA_OCR_SERVICE_URL: 'http://127.0.0.1:8765',
  SURYA_SERVICE_URL: 'http://127.0.0.1:8765',
}

nextProcess = spawn(packageManager, ['dev'], {
  cwd: projectRoot,
  env: sharedEnv,
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
  shell: useShell,
})

wireChildLogs('next-dev', nextProcess)

nextProcess.once('exit', (code) => {
  console.log(`[next-dev] exited with code ${code ?? 'null'}`)
  stopChild(electronProcess)
})

await waitForRenderer()

electronProcess = spawn(packageManager, ['exec', 'electron', 'electron/main.mjs'], {
  cwd: projectRoot,
  env: sharedEnv,
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
  shell: useShell,
})

wireChildLogs('electron', electronProcess)

electronProcess.once('exit', (code) => {
  console.log(`[electron] exited with code ${code ?? 'null'}`)
  stopChild(nextProcess)
  process.exit(code ?? 0)
})

process.on('SIGINT', () => {
  stopChild(electronProcess)
  stopChild(nextProcess)
  process.exit(130)
})

process.on('SIGTERM', () => {
  stopChild(electronProcess)
  stopChild(nextProcess)
  process.exit(143)
})
