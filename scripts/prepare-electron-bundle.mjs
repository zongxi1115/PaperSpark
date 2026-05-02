import fs from 'node:fs/promises'
import path from 'node:path'

const projectRoot = process.cwd()
const standaloneDir = path.join(projectRoot, '.next', 'standalone')
const standaloneServer = path.join(standaloneDir, 'server.js')
const electronBuildRoot = path.join(projectRoot, '.electron-build')
const runtimeStandaloneDir = path.join(electronBuildRoot, 'standalone')
const staticSource = path.join(projectRoot, '.next', 'static')
const staticTarget = path.join(runtimeStandaloneDir, '.next', 'static')
const publicSource = path.join(projectRoot, 'public')
const publicTarget = path.join(runtimeStandaloneDir, 'public')

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

await ensureExists(standaloneServer, 'Next standalone server.js')
await ensureExists(staticSource, 'Next static 资源目录')
await ensureExists(publicSource, 'public 目录')

await copyDir(standaloneDir, runtimeStandaloneDir)
await copyDir(staticSource, staticTarget)
await copyDir(publicSource, publicTarget)

console.log('Electron bundle resources prepared.')
