import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const packageJsonPath = resolve('package.json')
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
const latestReleaseVersion = (process.argv[2] || '').trim()

function parseVersion(version) {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-dev\.(\d+))?$/)

  if (!match) {
    throw new Error(`Unsupported version format: ${version}`)
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    dev: match[4] ? Number(match[4]) : null,
  }
}

function formatVersion({ major, minor, patch, dev = null }) {
  const stable = `${major}.${minor}.${patch}`
  return dev === null ? stable : `${stable}-dev.${dev}`
}

function incrementPatch(version) {
  return {
    major: version.major,
    minor: version.minor,
    patch: version.patch + 1,
    dev: null,
  }
}

const currentVersion = parseVersion(packageJson.version)
const releaseVersion = parseVersion(latestReleaseVersion || packageJson.version.replace(/-dev\.\d+$/, ''))
const devBaseVersion = incrementPatch(releaseVersion)

const currentMatchesDevBase =
  currentVersion.major === devBaseVersion.major &&
  currentVersion.minor === devBaseVersion.minor &&
  currentVersion.patch === devBaseVersion.patch &&
  currentVersion.dev !== null

const nextVersion = formatVersion({
  ...devBaseVersion,
  dev: currentMatchesDevBase ? currentVersion.dev + 1 : 1,
})

packageJson.version = nextVersion
writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`)

process.stdout.write(nextVersion)
