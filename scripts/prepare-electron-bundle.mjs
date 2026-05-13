import fs from 'node:fs/promises'
import path from 'node:path'

const projectRoot = process.cwd()
const rootPackageJsonPath = path.join(projectRoot, 'package.json')
const standaloneDir = path.join(projectRoot, '.next', 'standalone')
const standaloneServer = path.join(standaloneDir, 'server.js')
const standalonePnpmDir = path.join(standaloneDir, 'node_modules', '.pnpm')
const electronBuildRoot = path.join(projectRoot, '.electron-build')
const stagedAppDir = path.join(electronBuildRoot, 'app')
const stagedElectronDir = path.join(stagedAppDir, 'electron')
const stagedStandaloneDir = path.join(stagedAppDir, 's')
const stagedPackageJsonPath = path.join(stagedAppDir, 'package.json')
const staticSource = path.join(projectRoot, '.next', 'static')
const staticTarget = path.join(stagedStandaloneDir, '.next', 'static')
const publicSource = path.join(projectRoot, 'public')
const publicTarget = path.join(stagedStandaloneDir, 'public')
const electronSource = path.join(projectRoot, 'electron')
const pnpmStoreDir = path.join(projectRoot, 'node_modules', '.pnpm')
const stagedStandaloneNodeModulesDir = path.join(stagedStandaloneDir, 'node_modules')
const requiredStandalonePackages = [
  // Next resolves these through a runtime require hook, so output file tracing can miss them.
  'styled-jsx',
  'client-only',
]

async function ensureExists(target, label) {
  try {
    await fs.access(target)
  } catch {
    throw new Error(`缺少 ${label}: ${target}`)
  }
}

async function ensureNextStandaloneBuildExists() {
  try {
    await fs.access(standaloneServer)
  } catch {
    throw new Error([
      `缺少 Next standalone server.js: ${standaloneServer}`,
      '',
      '请先运行 `pnpm build` 生成 Next standalone 输出，然后再运行 `pnpm desktop:build`。',
      '如果你要一次性打安装包，请直接运行 `pnpm desktop:dist`；如果只想生成目录包，请运行 `pnpm desktop:pack`。',
    ].join('\n'))
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

function getPackagePathParts(packageName) {
  return packageName.split('/')
}

async function pathExists(target) {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
}

async function findInstalledPackageDir(packageName) {
  const directPackageDir = path.join(projectRoot, 'node_modules', ...getPackagePathParts(packageName))
  if (await pathExists(path.join(directPackageDir, 'package.json'))) {
    return directPackageDir
  }

  const entries = await fs.readdir(pnpmStoreDir, { withFileTypes: true })
  const matches = []

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const candidate = path.join(pnpmStoreDir, entry.name, 'node_modules', ...getPackagePathParts(packageName))
    if (await pathExists(path.join(candidate, 'package.json'))) {
      matches.push(candidate)
    }
  }

  if (matches.length > 0) {
    matches.sort((left, right) => left.localeCompare(right))
    return matches[0]
  }

  throw new Error(`无法在 node_modules 中找到 standalone 运行时依赖: ${packageName}`)
}

async function copyStandaloneRuntimePackage(packageName) {
  const source = await findInstalledPackageDir(packageName)
  const target = path.join(stagedStandaloneNodeModulesDir, ...getPackagePathParts(packageName))
  await copyDir(source, target)
}

async function collectStandaloneRuntimePackageNames() {
  let entries = []
  try {
    entries = await fs.readdir(standalonePnpmDir, { withFileTypes: true })
  } catch {
    return []
  }

  const packageNames = new Set()

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === 'node_modules') continue
    const nestedNodeModulesDir = path.join(standalonePnpmDir, entry.name, 'node_modules')

    let nestedEntries = []
    try {
      nestedEntries = await fs.readdir(nestedNodeModulesDir, { withFileTypes: true })
    } catch {
      continue
    }

    for (const nestedEntry of nestedEntries) {
      if (!nestedEntry.isDirectory() || nestedEntry.name === '.bin') continue
      if (nestedEntry.name.startsWith('@')) {
        const scopeDir = path.join(nestedNodeModulesDir, nestedEntry.name)
        let scopedEntries = []
        try {
          scopedEntries = await fs.readdir(scopeDir, { withFileTypes: true })
        } catch {
          continue
        }

        for (const scopedEntry of scopedEntries) {
          if (!scopedEntry.isDirectory()) continue
          packageNames.add(`${nestedEntry.name}/${scopedEntry.name}`)
        }
        continue
      }

      packageNames.add(nestedEntry.name)
    }
  }

  return [...packageNames].sort((left, right) => left.localeCompare(right))
}

async function ensureStandaloneRuntimePackages() {
  const packageNames = await collectStandaloneRuntimePackageNames()
  const allPackageNames = [...new Set([...packageNames, ...requiredStandalonePackages])]

  for (const packageName of allPackageNames) {
    const targetPackageJsonPath = path.join(stagedStandaloneNodeModulesDir, ...getPackagePathParts(packageName), 'package.json')
    if (await pathExists(targetPackageJsonPath)) continue
    await copyStandaloneRuntimePackage(packageName)
  }
}

async function ensureRequiredStandalonePackages() {
  await fs.mkdir(stagedStandaloneNodeModulesDir, { recursive: true })
  await ensureStandaloneRuntimePackages()
}

async function main() {
  await ensureNextStandaloneBuildExists()
  await ensureExists(staticSource, 'Next static 资源目录')
  await ensureExists(publicSource, 'public 目录')
  await ensureExists(rootPackageJsonPath, '根 package.json')
  await ensureExists(electronSource, 'Electron 主进程目录')

  await fs.rm(stagedAppDir, { recursive: true, force: true })
  await copyDir(standaloneDir, stagedStandaloneDir)
  await copyDir(staticSource, staticTarget)
  await copyDir(publicSource, publicTarget)
  await createStagedElectronApp()
  await ensureRequiredStandalonePackages()

  console.log('Electron bundle resources prepared.')
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
