import fs from 'node:fs/promises'
import path from 'node:path'

const projectRoot = process.cwd()
const prepackagedRoot = path.join(projectRoot, 'release', 'electron', 'win-unpacked')
const appRoot = path.join(prepackagedRoot, 'resources', 'app')
const targets = [
  path.join(appRoot, 'node_modules', '@blocknote', 'xl-ai', 'src'),
  path.join(appRoot, '.next', 'standalone', 'node_modules'),
]

async function removeIfExists(target) {
  try {
    await fs.rm(target, { recursive: true, force: true })
    console.log(`Removed ${target}`)
  } catch (error) {
    throw new Error(`Failed to prune ${target}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function collectMaxPathLength(root) {
  let maxLength = 0
  let maxPath = ''

  const visit = async (currentPath) => {
    let entries = []
    try {
      entries = await fs.readdir(currentPath, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name)
      if (fullPath.length > maxLength) {
        maxLength = fullPath.length
        maxPath = fullPath
      }
      if (entry.isDirectory()) {
        await visit(fullPath)
      }
    }
  }

  await visit(root)
  return { maxLength, maxPath }
}

for (const target of targets) {
  await removeIfExists(target)
}

const { maxLength, maxPath } = await collectMaxPathLength(appRoot)
console.log(`Longest remaining path: ${maxLength}`)
if (maxPath) {
  console.log(maxPath)
}

if (maxLength > 260) {
  throw new Error(
    `Remaining Windows package path length is still ${maxLength}; electron-builder's 7za step is likely to fail.`,
  )
}
