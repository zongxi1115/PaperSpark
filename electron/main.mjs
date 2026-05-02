import { spawn, execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import { promisify } from 'node:util'
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'

const execFileAsync = promisify(execFile)
const DEFAULT_RENDERER_PORT = Number.parseInt(process.env.PAPERSPARK_RENDERER_PORT || '', 10) || 3000
const DEFAULT_SURYA_PORT = Number.parseInt(process.env.PAPERSPARK_SURYA_PORT || '', 10) || 8765
const MIN_PYTHON_VERSION = { major: 3, minor: 10 }

let launcherWindow = null
let loadingWindow = null
let mainWindow = null
let nextServerProcess = null
let suryaProcess = null
let isCleaningUpChildren = false

function log(scope, message) {
  console.log(`[${scope}] ${message}`)
}

function pipeProcessOutput(scope, child) {
  child.stdout?.on('data', (chunk) => {
    const text = chunk.toString('utf8').trim()
    if (text) log(scope, text)
  })

  child.stderr?.on('data', (chunk) => {
    const text = chunk.toString('utf8').trim()
    if (text) log(scope, text)
  })
}

function resolveAppRoot() {
  const appPath = app.getAppPath()
  if (process.env.PAPERSPARK_ELECTRON_DEV === '1' && appPath.endsWith(`${path.sep}electron`)) {
    return path.dirname(appPath)
  }
  return appPath
}

function resolveUnpackedAppRoot() {
  if (!app.isPackaged || process.env.PAPERSPARK_ELECTRON_DEV === '1') {
    return resolveAppRoot()
  }
  return process.resourcesPath
}

function resolveRuntimeRoot() {
  return process.env.PAPERSPARK_RUNTIME_ROOT || path.join(app.getPath('userData'), 'runtime')
}

function isDevMode() {
  return !app.isPackaged || process.env.PAPERSPARK_ELECTRON_DEV === '1'
}

function getDesktopConfigPath() {
  return path.join(app.getPath('userData'), 'desktop-config.json')
}

function readDesktopConfig() {
  try {
    const raw = fs.readFileSync(getDesktopConfigPath(), 'utf8')
    const parsed = JSON.parse(raw)
    return {
      pythonPath: null,
      deploymentMode: 'local',
      localParserEnabled: false,
      serviceUrl: '',
      mineruUrl: '',
      mineruApiKey: '',
      mineruModelVersion: 'vlm',
      ...parsed,
    }
  } catch {
    return {
      pythonPath: null,
      deploymentMode: 'local',
      localParserEnabled: false,
      serviceUrl: '',
      mineruUrl: '',
      mineruApiKey: '',
      mineruModelVersion: 'vlm',
    }
  }
}

function writeDesktopConfig(config) {
  fs.mkdirSync(path.dirname(getDesktopConfigPath()), { recursive: true })
  fs.writeFileSync(getDesktopConfigPath(), JSON.stringify(config, null, 2), 'utf8')
}

function normalizeServiceUrl(value) {
  if (!value) return ''
  const trimmed = value.trim()
  if (!trimmed) return ''
  const normalized = trimmed.replace(/\/+$/, '')

  try {
    const parsed = new URL(normalized)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return ''
    }
    return normalized
  } catch {
    return ''
  }
}

function normalizeSelectedPythonPath(selectedPath) {
  if (!selectedPath) return null
  const trimmed = selectedPath.trim()
  if (!trimmed) return null

  if (fs.existsSync(trimmed) && fs.statSync(trimmed).isDirectory()) {
    const fileName = process.platform === 'win32' ? 'python.exe' : 'python'
    const nested = path.join(trimmed, fileName)
    return fs.existsSync(nested) ? nested : trimmed
  }

  return trimmed
}

function dedupePaths(paths) {
  const normalized = new Set()
  const results = []

  for (const candidate of paths) {
    const resolved = normalizeSelectedPythonPath(candidate)
    if (!resolved) continue
    const key = process.platform === 'win32' ? resolved.toLowerCase() : resolved
    if (normalized.has(key)) continue
    normalized.add(key)
    results.push(resolved)
  }

  return results
}

async function runCommand(command, args, timeoutMs = 12000) {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      timeout: timeoutMs,
      windowsHide: true,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
    })
    return { ok: true, stdout, stderr }
  } catch (error) {
    return {
      ok: false,
      stdout: error.stdout || '',
      stderr: error.stderr || error.message || '',
    }
  }
}

function getSourceLabel(source) {
  switch (source) {
    case 'saved':
      return '上次使用'
    case 'py-launcher':
      return 'Python Launcher'
    case 'path':
      return '系统 PATH'
    case 'common-root':
      return '常见安装目录'
    case 'manual':
      return '手动选择'
    default:
      return '检测到'
  }
}

async function inspectPythonCandidate(candidatePath, source = 'detected') {
  const normalizedPath = normalizeSelectedPythonPath(candidatePath)
  if (!normalizedPath || !fs.existsSync(normalizedPath)) {
    return null
  }

  const probe = `
import importlib.util
import json
import os
import sys

checks = {}
for name in ("fastapi", "uvicorn", "chromadb", "surya"):
    checks[name] = importlib.util.find_spec(name) is not None
for name in ("matplotlib", "numpy", "pandas"):
    checks[name] = importlib.util.find_spec(name) is not None

payload = {
    "executable": sys.executable,
    "version": sys.version.split()[0],
    "major": sys.version_info.major,
    "minor": sys.version_info.minor,
    "checks": checks,
}
print(json.dumps(payload))
`.trim()

  const result = await runCommand(normalizedPath, ['-c', probe])
  if (!result.ok) {
    return {
      path: normalizedPath,
      displayName: path.basename(normalizedPath),
      version: 'unknown',
      versionLabel: '无法读取版本',
      compatible: false,
      ready: false,
      source,
      sourceLabel: getSourceLabel(source),
      issues: ['无法执行该 Python 环境'],
    }
  }

  try {
    const payload = JSON.parse(result.stdout.trim())
    const compatible = (
      Number(payload.major) > MIN_PYTHON_VERSION.major
      || (
        Number(payload.major) === MIN_PYTHON_VERSION.major
        && Number(payload.minor) >= MIN_PYTHON_VERSION.minor
      )
    )
    const missingModules = Object.entries(payload.checks || {})
      .filter(([, ok]) => !ok)
      .map(([name]) => name)
    const codeRuntimeModules = ['fastapi', 'uvicorn', 'numpy']
    const selfHostedModules = ['fastapi', 'uvicorn', 'chromadb', 'surya', 'matplotlib', 'numpy', 'pandas']
    const supportsCodeRuntime = compatible && codeRuntimeModules.every((name) => Boolean(payload.checks?.[name]))
    const supportsSelfHostedParser = compatible && selfHostedModules.every((name) => Boolean(payload.checks?.[name]))
    const ready = supportsSelfHostedParser
    const issues = []

    if (!compatible) {
      issues.push(`需要 Python ${MIN_PYTHON_VERSION.major}.${MIN_PYTHON_VERSION.minor}+`)
    }
    if (!supportsCodeRuntime) {
      const missingCodeRuntimeModules = codeRuntimeModules.filter((name) => !payload.checks?.[name])
      if (missingCodeRuntimeModules.length) {
        issues.push(`在线代码运行缺少依赖: ${missingCodeRuntimeModules.join(', ')}`)
      }
    }
    if (!supportsSelfHostedParser) {
      const missingSelfHostedModules = selfHostedModules.filter((name) => !payload.checks?.[name])
      if (missingSelfHostedModules.length) {
        issues.push(`本地自部署缺少依赖: ${missingSelfHostedModules.join(', ')}`)
      }
    }

    return {
      path: payload.executable || normalizedPath,
      displayName: path.basename(path.dirname(payload.executable || normalizedPath)) || path.basename(normalizedPath),
      version: payload.version || 'unknown',
      versionLabel: payload.version ? `Python ${payload.version}` : '未知版本',
      compatible,
      ready,
      supportsCodeRuntime,
      supportsSelfHostedParser,
      packageChecks: payload.checks || {},
      source,
      sourceLabel: getSourceLabel(source),
      issues,
    }
  } catch {
    return {
      path: normalizedPath,
      displayName: path.basename(normalizedPath),
      version: 'unknown',
      versionLabel: '读取失败',
      compatible: false,
      ready: false,
      source,
      sourceLabel: getSourceLabel(source),
      issues: ['无法解析环境检测结果'],
    }
  }
}

function collectPythonExecutables(rootPath, depth = 2) {
  const results = []
  if (!rootPath || !fs.existsSync(rootPath)) return results

  const visit = (currentPath, currentDepth) => {
    if (currentDepth < 0) return
    let entries = []
    try {
      entries = fs.readdirSync(currentPath, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name)
      if (entry.isFile() && /^python(?:3(?:\.\d+)?)?\.exe$/i.test(entry.name)) {
        results.push(fullPath)
      }
      if (entry.isDirectory() && currentDepth > 0) {
        visit(fullPath, currentDepth - 1)
      }
    }
  }

  visit(rootPath, depth)
  return results
}

async function scanPythonInstallations() {
  const config = readDesktopConfig()
  const sources = []

  if (config.pythonPath) {
    sources.push({ path: config.pythonPath, source: 'saved' })
  }

  if (process.platform === 'win32') {
    const pyLauncher = await runCommand('py', ['-0p'])
    if (pyLauncher.ok) {
      const lines = pyLauncher.stdout.split(/\r?\n/)
      for (const line of lines) {
        const match = line.match(/[A-Za-z]:\\.*?python(?:w)?\.exe/i)
        if (match) {
          sources.push({ path: match[0], source: 'py-launcher' })
        }
      }
    }

    for (const command of ['python', 'python3']) {
      const whereResult = await runCommand('where.exe', [command])
      if (!whereResult.ok) continue
      for (const line of whereResult.stdout.split(/\r?\n/).map(item => item.trim()).filter(Boolean)) {
        sources.push({ path: line, source: 'path' })
      }
    }

    const commonRoots = [
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python'),
      path.join(process.env.USERPROFILE || '', 'AppData', 'Local', 'Programs', 'Python'),
      path.join(process.env.USERPROFILE || '', 'miniconda3'),
      path.join(process.env.USERPROFILE || '', 'anaconda3'),
      path.join(process.env.PROGRAMDATA || '', 'Miniconda3'),
      path.join(process.env.PROGRAMFILES || '', 'Python'),
      path.join(process.env['PROGRAMFILES(X86)'] || '', 'Python'),
    ]

    for (const root of commonRoots) {
      for (const candidatePath of collectPythonExecutables(root, 2)) {
        sources.push({ path: candidatePath, source: 'common-root' })
      }
    }
  } else {
    for (const command of ['python3', 'python']) {
      const whichResult = await runCommand('which', [command])
      if (!whichResult.ok) continue
      for (const line of whichResult.stdout.split(/\r?\n/).map(item => item.trim()).filter(Boolean)) {
        sources.push({ path: line, source: 'path' })
      }
    }
  }

  const uniqueCandidates = dedupePaths(sources.map(item => item.path))
  const inspected = []
  for (const candidatePath of uniqueCandidates.slice(0, 16)) {
    const sourceRecord = sources.find(item => normalizeSelectedPythonPath(item.path) === candidatePath)
    const candidate = await inspectPythonCandidate(candidatePath, sourceRecord?.source || 'detected')
    if (candidate) inspected.push(candidate)
  }

  inspected.sort((left, right) => {
    if (left.ready !== right.ready) return left.ready ? -1 : 1
    if (left.compatible !== right.compatible) return left.compatible ? -1 : 1
    return left.path.localeCompare(right.path)
  })

  return inspected
}

async function findAvailablePort(preferredPort) {
  const tryPort = (port) => new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', (error) => {
      server.close()
      reject(error)
    })
    server.once('listening', () => {
      const address = server.address()
      server.close(() => {
        if (typeof address === 'object' && address?.port) {
          resolve(address.port)
          return
        }
        resolve(port)
      })
    })
    server.listen(port, '127.0.0.1')
  })

  try {
    return await tryPort(preferredPort)
  } catch {
    return await tryPort(0)
  }
}

async function waitForUrl(url, { timeoutMs = 45000, intervalMs = 500 } = {}) {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, {
        method: 'GET',
        cache: 'no-store',
      })
      if (response.ok || response.status < 500) {
        return
      }
    } catch {
      // noop
    }

    await new Promise(resolve => setTimeout(resolve, intervalMs))
  }

  throw new Error(`Timed out while waiting for ${url}`)
}

async function startSuryaService(port, runtimeRoot, pythonPath) {
  const serviceDataRoot = path.join(runtimeRoot, 'surya-data')
  const appRoot = resolveUnpackedAppRoot()
  const scriptPath = path.join(appRoot, 'scripts', 'start_surya_service.py')

  fs.mkdirSync(serviceDataRoot, { recursive: true })

  suryaProcess = spawn(pythonPath, [
    scriptPath,
    '--host', '127.0.0.1',
    '--port', String(port),
    '--accelerator', 'skip-install',
  ], {
    cwd: appRoot,
    env: {
      ...process.env,
      PAPERSPARK_RUNTIME_ROOT: runtimeRoot,
      PYTHONIOENCODING: 'utf-8',
      PYTHONUTF8: '1',
      SURYA_DATA_ROOT: serviceDataRoot,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })

  pipeProcessOutput('surya', suryaProcess)

  suryaProcess.once('exit', (code) => {
    log('surya', `exited with code ${code ?? 'null'}`)
    suryaProcess = null
  })

  try {
    await waitForUrl(`http://127.0.0.1:${port}/health`, { timeoutMs: 120000, intervalMs: 1000 })
    return {
      ok: true,
      serviceUrl: `http://127.0.0.1:${port}`,
    }
  } catch (error) {
    return {
      ok: false,
      serviceUrl: `http://127.0.0.1:${port}`,
      error: error instanceof Error ? error.message : '启动失败',
    }
  }
}

async function startInternalNextServer(port, runtimeRoot, options = {}) {
  const suryaServiceUrl = options.suryaServiceUrl || ''
  const pythonPath = options.pythonPath || ''
  const mineruUrl = options.mineruUrl || ''
  const mineruApiKey = options.mineruApiKey || ''
  const mineruModelVersion = options.mineruModelVersion || 'vlm'
  const defaultAdvancedProvider = options.defaultAdvancedProvider || ''
  const serverScript = path.join(resolveUnpackedAppRoot(), 'standalone', 'server.js')
  if (!fs.existsSync(serverScript)) {
    throw new Error(`找不到 Next standalone 入口: ${serverScript}`)
  }

  nextServerProcess = spawn(process.execPath, [serverScript], {
    cwd: path.dirname(serverScript),
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      NODE_ENV: 'production',
      HOSTNAME: '127.0.0.1',
      PORT: String(port),
      PAPERSPARK_DESKTOP: '1',
      PAPERSPARK_RUNTIME_ROOT: runtimeRoot,
      ...(pythonPath ? {
        PAPERSPARK_PYTHON_PATH: pythonPath,
      } : {}),
      ...(defaultAdvancedProvider ? {
        NEXT_PUBLIC_DEFAULT_ADVANCED_PARSE_PROVIDER: defaultAdvancedProvider,
      } : {}),
      ...(suryaServiceUrl ? {
        SURYA_OCR_SERVICE_URL: suryaServiceUrl,
        SURYA_SERVICE_URL: suryaServiceUrl,
        NEXT_PUBLIC_SURYA_SERVICE_URL: suryaServiceUrl,
        NEXT_PUBLIC_SURYA_OCR_SERVICE_URL: suryaServiceUrl,
      } : {}),
      ...(mineruUrl ? {
        MINERU_SERVICE_URL: mineruUrl,
        MINERU_API_BASE_URL: mineruUrl,
        NEXT_PUBLIC_MINERU_SERVICE_URL: mineruUrl,
      } : {}),
      ...(mineruApiKey ? {
        MINERU_API_KEY: mineruApiKey,
        NEXT_PUBLIC_MINERU_API_KEY: mineruApiKey,
      } : {}),
      ...(mineruModelVersion ? {
        MINERU_MODEL_VERSION: mineruModelVersion,
        NEXT_PUBLIC_MINERU_MODEL_VERSION: mineruModelVersion,
      } : {}),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })

  pipeProcessOutput('next', nextServerProcess)

  nextServerProcess.once('exit', (code) => {
    log('next', `exited with code ${code ?? 'null'}`)
    nextServerProcess = null
  })

  await waitForUrl(`http://127.0.0.1:${port}`, { timeoutMs: 60000, intervalMs: 500 })
  return `http://127.0.0.1:${port}`
}

function emitWindowState(window) {
  if (!window || window.isDestroyed()) return
  window.webContents.send('desktop:window-state', {
    isMaximized: window.isMaximized(),
  })
}

function registerWindowStateEvents(window) {
  const handler = () => emitWindowState(window)
  window.on('maximize', handler)
  window.on('unmaximize', handler)
  window.on('enter-full-screen', handler)
  window.on('leave-full-screen', handler)
  window.webContents.once('did-finish-load', handler)
}

function createLoadingWindow() {
  if (loadingWindow && !loadingWindow.isDestroyed()) {
    return loadingWindow
  }

  loadingWindow = new BrowserWindow({
    width: 520,
    height: 300,
    resizable: false,
    minimizable: false,
    maximizable: false,
    closable: false,
    movable: true,
    frame: false,
    show: false,
    backgroundColor: '#f8fafc',
    alwaysOnTop: true,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
    },
  })

  const html = `
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    :root {
      --text: #0f172a;
      --muted: #64748b;
      --line: rgba(226, 232, 240, 0.9);
      --bg: #f8fafc;
      --accent: #6366f1;
    }

    * { box-sizing: border-box; }

    html, body {
      margin: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
      background:
        radial-gradient(circle at top, rgba(99, 102, 241, 0.08), transparent 38%),
        linear-gradient(180deg, #fbfdff 0%, #f6f8fc 100%);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "PingFang SC", "Microsoft YaHei", sans-serif;
      color: var(--text);
    }

    .wrap {
      width: 100%;
      height: 100%;
      display: grid;
      place-items: center;
      padding: 28px;
    }

    .panel {
      width: 100%;
      border: 1px solid var(--line);
      background: rgba(255, 255, 255, 0.8);
      box-shadow: 0 22px 48px rgba(15, 23, 42, 0.08);
      padding: 28px 30px 24px;
    }

    .top {
      display: flex;
      align-items: center;
      gap: 14px;
      margin-bottom: 22px;
    }

    .icon {
      width: 46px;
      height: 46px;
      border-radius: 0;
      display: grid;
      place-items: center;
      background: rgba(99, 102, 241, 0.08);
      color: var(--accent);
      flex: 0 0 auto;
    }

    .title {
      margin: 0;
      font-size: 20px;
      line-height: 1.2;
      letter-spacing: -0.02em;
    }

    .desc {
      margin: 6px 0 0;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.7;
    }

    .progress {
      height: 2px;
      overflow: hidden;
      background: rgba(148, 163, 184, 0.22);
    }

    .progress > span {
      display: block;
      width: 38%;
      height: 100%;
      background: linear-gradient(90deg, transparent, var(--accent), transparent);
      animation: slide 1.15s ease-in-out infinite;
      transform-origin: left center;
    }

    .status {
      margin-top: 18px;
      font-size: 12px;
      color: var(--muted);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }

    .dots {
      display: inline-flex;
      gap: 6px;
      align-items: center;
    }

    .dots span {
      width: 7px;
      height: 7px;
      border-radius: 999px;
      background: rgba(99, 102, 241, 0.45);
      animation: pulse 1.1s ease-in-out infinite;
    }

    .dots span:nth-child(2) { animation-delay: 0.12s; }
    .dots span:nth-child(3) { animation-delay: 0.24s; }

    @keyframes pulse {
      0%, 80%, 100% { transform: translateY(0); opacity: 0.35; }
      40% { transform: translateY(-3px); opacity: 1; }
    }

    @keyframes slide {
      0% { transform: translateX(-60%); }
      100% { transform: translateX(260%); }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="panel">
      <div class="top">
        <div class="icon" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M9 2h6a4 4 0 0 1 4 4v4h-6a4 4 0 0 0-4 4v8H9a7 7 0 0 1-7-7V9a7 7 0 0 1 7-7Z" fill="currentColor" opacity="0.18"/>
            <path d="M15 22H9a4 4 0 0 1-4-4v-4h6a4 4 0 0 0 4-4V2h2a7 7 0 0 1 7 7v6a7 7 0 0 1-7 7Z" fill="currentColor" opacity="0.18"/>
            <path d="M9 2h6a4 4 0 0 1 4 4v4h-6a4 4 0 0 0-4 4v8H9a7 7 0 0 1-7-7V9a7 7 0 0 1 7-7Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
            <path d="M15 22H9a4 4 0 0 1-4-4v-4h6a4 4 0 0 0 4-4V2h2a7 7 0 0 1 7 7v6a7 7 0 0 1-7 7Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
          </svg>
        </div>
        <div>
          <h1 class="title">正在启动 PaperSpark</h1>
          <p class="desc" id="loadingText">正在准备运行环境，请稍候。</p>
        </div>
      </div>
      <div class="progress" aria-hidden="true"><span></span></div>
      <div class="status">
        <span>初始化中</span>
        <span class="dots" aria-hidden="true"><span></span><span></span><span></span></span>
      </div>
    </div>
  </div>
</body>
</html>`

  loadingWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`).catch((error) => {
    log('loading', `failed to load loading window: ${error instanceof Error ? error.message : String(error)}`)
  })

  loadingWindow.once('ready-to-show', () => {
    if (loadingWindow && !loadingWindow.isDestroyed()) {
      loadingWindow.show()
      loadingWindow.focus()
    }
  })

  loadingWindow.on('closed', () => {
    loadingWindow = null
  })

  return loadingWindow
}

function updateLoadingWindow(message) {
  if (!loadingWindow || loadingWindow.isDestroyed()) return
  const safe = String(message || '').replace(/\\/g, '\\\\').replace(/`/g, '\\`')
  loadingWindow.webContents.executeJavaScript(`
    const text = document.getElementById('loadingText')
    if (text) text.textContent = \`${safe}\`
  `).catch(() => {})
}

function closeLoadingWindow() {
  if (!loadingWindow || loadingWindow.isDestroyed()) {
    loadingWindow = null
    return
  }
  loadingWindow.destroy()
  loadingWindow = null
}

async function createMainWindow({ pythonPath = null, enableLocalParser = false, deploymentMode = 'local', serviceUrl = '', mineruUrl = '', mineruApiKey = '', mineruModelVersion = 'vlm' } = {}) {
  const runtimeRoot = resolveRuntimeRoot()
  fs.mkdirSync(runtimeRoot, { recursive: true })

  const isDev = isDevMode()
  let suryaServiceUrl = serviceUrl || process.env.SURYA_OCR_SERVICE_URL || process.env.SURYA_SERVICE_URL || ''

  if (pythonPath && enableLocalParser) {
    updateLoadingWindow('正在启动 Python 解析服务...')
    const suryaPort = isDev ? DEFAULT_SURYA_PORT : await findAvailablePort(DEFAULT_SURYA_PORT)
    const suryaResult = await startSuryaService(suryaPort, runtimeRoot, pythonPath)
    suryaServiceUrl = suryaResult.serviceUrl

    if (!suryaResult.ok) {
      dialog.showMessageBox({
        type: 'warning',
        title: 'Surya OCR 未启动',
        message: '主应用会继续打开，但 OCR 微服务没有成功启动。',
        detail: [
          `Python 路径: ${pythonPath}`,
          `服务地址: ${suryaServiceUrl}`,
          `原因: ${suryaResult.error || '未知错误'}`,
        ].join('\n'),
      }).catch(() => {})
    }
  }

  const rendererUrl = process.env.PAPERSPARK_ELECTRON_RENDERER_URL?.trim()
  updateLoadingWindow('正在拉起前端项目...')
  const appUrl = rendererUrl
    || await startInternalNextServer(
      isDev ? DEFAULT_RENDERER_PORT : await findAvailablePort(DEFAULT_RENDERER_PORT),
      runtimeRoot,
      {
        suryaServiceUrl,
        pythonPath,
        mineruUrl,
        mineruApiKey,
        mineruModelVersion,
        defaultAdvancedProvider:
          deploymentMode === 'cloud'
            ? 'surya-modal'
            : deploymentMode === 'mineru'
              ? 'mineru'
              : enableLocalParser
                ? 'surya-local'
                : '',
      },
    )

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1120,
    minHeight: 720,
    show: false,
    backgroundColor: '#f7f3ea',
    frame: false,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      preload: path.join(resolveAppRoot(), 'electron', 'preload.cjs'),
    },
  })

  registerWindowStateEvents(mainWindow)

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url).catch(() => {})
    return { action: 'deny' }
  })

  const revealMainWindow = () => {
    closeLoadingWindow()
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show()
      mainWindow.focus()
    }
  }

  mainWindow.once('ready-to-show', revealMainWindow)
  mainWindow.webContents.once('did-finish-load', revealMainWindow)

  await mainWindow.loadURL(appUrl)
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  if (isDev) {
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  }
}

function createLauncherWindow() {
  launcherWindow = new BrowserWindow({
    width: 980,
    height: 820,
    minWidth: 880,
    minHeight: 760,
    frame: false,
    resizable: false,
    backgroundColor: '#efe4d3',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      preload: path.join(resolveAppRoot(), 'electron', 'preload.cjs'),
    },
  })

  registerWindowStateEvents(launcherWindow)
  launcherWindow.loadFile(path.join(resolveAppRoot(), 'electron', 'launcher.html')).catch((error) => {
    dialog.showErrorBox('PaperSpark 启动失败', error instanceof Error ? error.message : String(error))
    app.quit()
  })

  launcherWindow.on('closed', () => {
    launcherWindow = null
    if (!mainWindow) {
      app.quit()
    }
  })
}

function stopChildProcess(child) {
  if (!child || child.killed) return
  child.kill()
}

async function killChildProcessTree(child, label) {
  if (!child?.pid) return

  try {
    if (process.platform === 'win32') {
      await execFileAsync('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        encoding: 'utf8',
      })
    } else {
      child.kill('SIGTERM')
    }
    log('cleanup', `stopped ${label} process tree (${child.pid})`)
  } catch (error) {
    const code = error?.code
    if (code !== 128 && code !== 'ESRCH') {
      log('cleanup', `failed to stop ${label} (${child.pid}): ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

async function cleanupChildProcesses() {
  if (isCleaningUpChildren) return
  isCleaningUpChildren = true

  const nextChild = nextServerProcess
  const suryaChild = suryaProcess
  nextServerProcess = null
  suryaProcess = null

  await Promise.allSettled([
    killChildProcessTree(nextChild, 'next'),
    killChildProcessTree(suryaChild, 'surya'),
  ])
}

ipcMain.handle('desktop:get-launcher-state', async () => {
  const config = readDesktopConfig()
  return {
    savedPythonPath: config.pythonPath || null,
    savedDeploymentMode: config.deploymentMode || 'local',
    savedLocalParserEnabled: Boolean(config.localParserEnabled),
    savedServiceUrl: config.serviceUrl || '',
    savedMineruUrl: config.mineruUrl || '',
    savedMineruApiKey: config.mineruApiKey || '',
    savedMineruModelVersion: config.mineruModelVersion || 'vlm',
    candidates: await scanPythonInstallations(),
  }
})

ipcMain.handle('desktop:browse-python-path', async () => {
  const owner = launcherWindow || BrowserWindow.getFocusedWindow()
  const result = await dialog.showOpenDialog(owner, {
    title: '选择 Python 可执行文件或所在目录',
    properties: ['openFile', 'openDirectory'],
    filters: process.platform === 'win32'
      ? [{ name: 'Python', extensions: ['exe'] }]
      : undefined,
  })

  if (result.canceled || result.filePaths.length === 0) {
    return null
  }

  const selected = normalizeSelectedPythonPath(result.filePaths[0])
  const inspected = await inspectPythonCandidate(selected, 'manual')
  if (!inspected) {
    throw new Error('无法识别所选路径，请选择有效的 Python 目录或可执行文件。')
  }

  return inspected
})

ipcMain.handle('desktop:confirm-python-path', async (_event, payload) => {
  const mode = payload?.mode === 'cloud' || payload?.mode === 'mineru' ? payload.mode : 'local'
  const normalizedPath = normalizeSelectedPythonPath(payload?.pythonPath)
  const enableLocalParser = Boolean(payload?.enableLocalParser)
  const normalizedServiceUrl = normalizeServiceUrl(payload?.serviceUrl)
  const normalizedMineruUrl = normalizeServiceUrl(payload?.mineruUrl)
  const normalizedMineruApiKey = typeof payload?.mineruApiKey === 'string' ? payload.mineruApiKey.trim() : ''
  const normalizedMineruModelVersion = typeof payload?.mineruModelVersion === 'string' && payload.mineruModelVersion.trim()
    ? payload.mineruModelVersion.trim()
    : 'vlm'

  let inspected = null
  if (normalizedPath) {
    inspected = await inspectPythonCandidate(normalizedPath, 'manual')
  }

  if (mode === 'local') {
    if (enableLocalParser && normalizedPath && !inspected?.supportsSelfHostedParser) {
      throw new Error('当前 Python 环境依赖不完整，还不能作为本地自部署引擎使用。')
    }
  } else if (mode === 'cloud' && !normalizedServiceUrl) {
    throw new Error('请输入有效的 Modal 服务地址。')
  } else if (mode === 'mineru' && (!normalizedMineruUrl || !normalizedMineruApiKey)) {
    throw new Error('请填写完整的 MinerU 服务地址和 API Key。')
  }

  writeDesktopConfig({
    pythonPath: inspected?.path || null,
    deploymentMode: mode,
    localParserEnabled: mode === 'local' ? Boolean(enableLocalParser && inspected?.supportsSelfHostedParser) : false,
    serviceUrl: mode === 'cloud' ? normalizedServiceUrl : '',
    mineruUrl: normalizedMineruUrl,
    mineruApiKey: normalizedMineruApiKey,
    mineruModelVersion: normalizedMineruModelVersion,
  })

  const pendingLauncher = launcherWindow
  createLoadingWindow()
  updateLoadingWindow(
    mode === 'local'
      ? (inspected?.path
        ? (enableLocalParser && inspected?.supportsSelfHostedParser
          ? '正在启动本地 Python 解析引擎...'
          : '正在接入所选 Python 运行环境...')
        : '已跳过 Python 运行环境，正在拉起前端项目...')
      : mode === 'cloud'
        ? (inspected?.path
        ? '正在连接云端解析，并接入本地 Python 运行环境...'
        : '正在连接云端解析，随后拉起前端项目...')
        : (inspected?.path
          ? '正在接入 MinerU 云端解析，并保留本地 Python 运行环境...'
          : '正在接入 MinerU 云端解析，随后拉起前端项目...'),
  )
  pendingLauncher?.hide()

  try {
    await createMainWindow({
      pythonPath: inspected?.path || null,
      enableLocalParser: mode === 'local' ? Boolean(enableLocalParser && inspected?.supportsSelfHostedParser) : false,
      deploymentMode: mode,
      serviceUrl: mode === 'cloud' ? normalizedServiceUrl : '',
      mineruUrl: normalizedMineruUrl,
      mineruApiKey: normalizedMineruApiKey,
      mineruModelVersion: normalizedMineruModelVersion,
    })
    if (pendingLauncher && !pendingLauncher.isDestroyed()) {
      pendingLauncher.destroy()
    }
    launcherWindow = null
  } catch (error) {
    closeLoadingWindow()
    pendingLauncher?.show()
    throw error
  }

  return { ok: true }
})

ipcMain.handle('desktop:window-action', (event, action) => {
  const window = BrowserWindow.fromWebContents(event.sender)
  if (!window) return { isMaximized: false }

  if (action === 'minimize') {
    window.minimize()
  } else if (action === 'toggle-maximize') {
    if (window.isMaximized()) {
      window.unmaximize()
    } else {
      window.maximize()
    }
  } else if (action === 'close') {
    window.close()
  }

  return { isMaximized: window.isMaximized() }
})

ipcMain.handle('desktop:get-window-state', (event) => {
  const window = BrowserWindow.fromWebContents(event.sender)
  return {
    isMaximized: Boolean(window?.isMaximized()),
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  void cleanupChildProcesses()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createLauncherWindow()
  }
})

app.whenReady()
  .then(() => createLauncherWindow())
  .catch((error) => {
    dialog.showErrorBox('PaperSpark 启动失败', error instanceof Error ? error.message : String(error))
    app.quit()
  })
