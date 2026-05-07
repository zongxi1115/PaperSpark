import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'

const projectRoot = process.cwd()
const rootPackageJsonPath = path.join(projectRoot, 'package.json')
const standaloneDir = path.join(projectRoot, '.next', 'standalone')
const standaloneServer = path.join(standaloneDir, 'server.js')
const electronBuildRoot = path.join(projectRoot, '.electron-build')
const stagedAppDir = path.join(electronBuildRoot, 'app')
const stagedElectronDir = path.join(stagedAppDir, 'electron')
const stagedStandaloneDir = path.join(stagedAppDir, 'standalone')
const stagedPackageJsonPath = path.join(stagedAppDir, 'package.json')
const staticSource = path.join(projectRoot, '.next', 'static')
const staticTarget = path.join(stagedStandaloneDir, '.next', 'static')
const publicSource = path.join(projectRoot, 'public')
const publicTarget = path.join(stagedStandaloneDir, 'public')
const electronSource = path.join(projectRoot, 'electron')
const standaloneNodeModulesDir = path.join(stagedStandaloneDir, 'node_modules')

async function ensureExists(target, label) {
  try {
    await fs.access(target)
  } catch {
    throw new Error(`缺少 ${label}: ${target}`)
  }
}

async function copyDir(source, target) {
  await fs.rm(target, { recursive: true, force: true })
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.cp(source, target, {
    recursive: true,
    dereference: true,
    verbatimSymlinks: false,
  })
}

async function createStagedElectronApp() {
  const packageJsonRaw = await fs.readFile(rootPackageJsonPath, 'utf8')
  const packageJson = JSON.parse(packageJsonRaw)
  const stagedPackageJson = {
    name: packageJson.name,
    version: packageJson.version,
    private: true,
    type: packageJson.type || 'module',
    description: packageJson.description,
    author: packageJson.author,
    main: packageJson.main || 'electron/main.mjs',
  }

  await copyDir(electronSource, stagedElectronDir)
  await fs.writeFile(stagedPackageJsonPath, `${JSON.stringify(stagedPackageJson, null, 2)}\n`, 'utf8')
}

async function buildStandaloneRuntimePackageJson() {
  const packageJsonRaw = await fs.readFile(rootPackageJsonPath, 'utf8')
  const packageJson = JSON.parse(packageJsonRaw)
  const dependencyNames = Object.keys(packageJson.dependencies || {})
  const runtimeDependencies = {}

  for (const dependencyName of dependencyNames) {
    const installedPackagePath = path.join(projectRoot, 'node_modules', ...dependencyName.split('/'), 'package.json')
    const installedPackageRaw = await fs.readFile(installedPackagePath, 'utf8')
    const installedPackage = JSON.parse(installedPackageRaw)
    runtimeDependencies[dependencyName] = installedPackage.version
  }

  const runtimePackageJson = {
    name: `${packageJson.name || 'paperspark'}-standalone-runtime`,
    private: true,
    type: packageJson.type || 'module',
    dependencies: runtimeDependencies,
  }

  await fs.writeFile(
    path.join(stagedStandaloneDir, 'package.json'),
    `${JSON.stringify(runtimePackageJson, null, 2)}\n`,
    'utf8',
  )
}

function getPnpmCommand() {
  return process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
}

async function installStandaloneRuntimeDependencies() {
  await fs.rm(standaloneNodeModulesDir, { recursive: true, force: true })
  await buildStandaloneRuntimePackageJson()

  await new Promise((resolve, reject) => {
    const child = spawn(
      getPnpmCommand(),
      [
        '--dir',
        stagedStandaloneDir,
        'install',
        '--prod',
        '--ignore-scripts',
        '--ignore-workspace',
        '--no-lockfile',
        '--config.node-linker=hoisted',
      ],
      {
        cwd: projectRoot,
        stdio: 'inherit',
        shell: process.platform === 'win32',
      },
    )

    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) {
        resolve()
        return
      }

      reject(new Error(`安装 standalone 运行时依赖失败，退出码 ${code ?? 'null'}`))
    })
  })
}

await ensureExists(standaloneServer, 'Next standalone server.js')
await ensureExists(staticSource, 'Next static 资源目录')
await ensureExists(publicSource, 'public 目录')
await ensureExists(rootPackageJsonPath, '根 package.json')
await ensureExists(electronSource, 'Electron 主进程目录')

await copyDir(standaloneDir, stagedStandaloneDir)
await copyDir(staticSource, staticTarget)
await copyDir(publicSource, publicTarget)
await createStagedElectronApp()
await installStandaloneRuntimeDependencies()

console.log('Electron bundle resources prepared.')
