const { execFile, spawn } = require('node:child_process')
const { createWriteStream, existsSync, readFileSync, rmSync, statSync } = require('node:fs')
const { createServer } = require('node:net')
const { isAbsolute, join } = require('node:path')
const { Readable } = require('node:stream')
const { pipeline } = require('node:stream/promises')
const semver = require('semver')
const tar = require('tar')
const { sha256File, validateManifest, verifyManifestSignature } = require('./kernel-common.cjs')

const MANIFEST_TIMEOUT_MS = 15_000
const DOWNLOAD_TIMEOUT_MS = 15 * 60_000
const HEALTH_TIMEOUT_MS = 90_000
const MAX_KERNEL_BYTES = 1_500_000_000

function reservePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer()
    server.unref()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(error => error ? reject(error) : resolvePort(port))
    })
  })
}

function stopProcessTree(child) {
  if (!child || child.exitCode !== null) return Promise.resolve()
  const pid = child.pid
  child.kill()
  if (process.platform !== 'win32' || !pid) return Promise.resolve()
  return new Promise(resolveStop => {
    setTimeout(() => {
      execFile('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => resolveStop())
    }, 1000).unref()
  })
}

function tarPathIsSafe(entryPath) {
  if (isAbsolute(entryPath)) return false
  return !entryPath.replaceAll('\\', '/').split('/').includes('..')
}

class KernelUpdater {
  constructor({ store, manifestUrl, publicKeyFile, nodeExecutable, nodeMajor, shellVersion, log }) {
    this.store = store
    this.manifestUrl = manifestUrl
    this.publicKey = readFileSync(publicKeyFile)
    this.nodeExecutable = nodeExecutable
    this.nodeMajor = nodeMajor
    this.shellVersion = shellVersion
    this.log = log
    this.checking = false
  }

  async check() {
    if (this.checking || !this.manifestUrl) return { status: 'skipped' }
    this.checking = true
    try {
      const manifest = await this.fetchManifest()
      const active = this.store.activeKernel()
      const state = this.store.readState()
      if (manifest.nodeMajor !== this.nodeMajor) {
        return { status: 'incompatible-node', version: manifest.version }
      }
      if (manifest.kernelApiVersion !== 1 || semver.lt(this.shellVersion, manifest.minShellVersion)) {
        return { status: 'incompatible-shell', version: manifest.version, minShellVersion: manifest.minShellVersion }
      }
      if (!semver.gt(manifest.version, active.version) || state.pending === manifest.version) {
        return { status: 'current', version: active.version }
      }
      if (state.bad.includes(manifest.version)) return { status: 'blocked', version: manifest.version }
      await this.downloadAndStage(manifest)
      return { status: 'pending', version: manifest.version }
    } finally {
      this.checking = false
    }
  }

  async fetchManifest() {
    const separator = this.manifestUrl.includes('?') ? '&' : '?'
    const response = await fetch(`${this.manifestUrl}${separator}desktopCacheBust=${Date.now()}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(MANIFEST_TIMEOUT_MS)
    })
    if (!response.ok) throw new Error(`获取内核更新清单失败：HTTP ${response.status}`)
    const manifest = validateManifest(await response.json())
    verifyManifestSignature(manifest, this.publicKey)
    return manifest
  }

  async downloadAndStage(manifest) {
    this.store.ensureDirectories()
    const archive = this.store.downloadPath(manifest.version)
    const partial = `${archive}.part`
    rmSync(partial, { force: true })
    const response = await fetch(manifest.url, { cache: 'no-store', signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) })
    if (!response.ok || !response.body) throw new Error(`下载内核失败：HTTP ${response.status}`)
    const declaredLength = Number(response.headers.get('content-length') || 0)
    if (declaredLength > MAX_KERNEL_BYTES || declaredLength > manifest.size) throw new Error('内核下载大小超过清单限制')
    await pipeline(Readable.fromWeb(response.body), createWriteStream(partial, { flags: 'wx' }))
    const actualSize = statSync(partial).size
    if (actualSize !== manifest.size || actualSize > MAX_KERNEL_BYTES) throw new Error(`内核文件大小不匹配：${actualSize}`)
    const actualHash = await sha256File(partial)
    if (actualHash !== manifest.sha256) throw new Error('内核文件 SHA256 校验失败')
    const staging = this.store.resetStaging(manifest.version)
    try {
      await tar.x({
        cwd: staging,
        file: partial,
        strict: true,
        filter: entryPath => {
          if (!tarPathIsSafe(entryPath)) throw new Error(`内核压缩包包含越界路径：${entryPath}`)
          return true
        }
      })
      const descriptor = this.store.validateKernel(staging)
      if (descriptor.version !== manifest.version || descriptor.kernelApiVersion !== manifest.kernelApiVersion) {
        throw new Error('内核压缩包元数据与更新清单不一致')
      }
      await this.healthCheck(descriptor)
      this.store.installExtracted(manifest.version, staging)
      this.store.markPending(manifest.version)
      this.log(`Kernel ${manifest.version} downloaded, verified, and marked pending`)
    } finally {
      rmSync(partial, { force: true })
      if (existsSync(staging)) rmSync(staging, { recursive: true, force: true })
    }
  }

  async healthCheck(descriptor) {
    const port = await reservePort()
    const url = `http://127.0.0.1:${port}`
    const healthHome = join(this.store.root, 'health', descriptor.version)
    const child = spawn(this.nodeExecutable, [descriptor.entry, 'web', '--port', String(port)], {
      cwd: descriptor.root,
      env: { ...process.env, DSH_HOME: healthHome },
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe']
    })
    let stderr = ''
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-8000) })
    const deadline = Date.now() + HEALTH_TIMEOUT_MS
    try {
      while (Date.now() < deadline) {
        if (child.exitCode !== null) throw new Error(`新内核健康检查提前退出：${child.exitCode}\n${stderr}`)
        try {
          const response = await fetch(url, { signal: AbortSignal.timeout(1500) })
          if (response.ok) return
        } catch {
          // The new kernel rejects connections until every plugin is ready.
        }
        await new Promise(resolveWait => setTimeout(resolveWait, 300))
      }
      throw new Error(`新内核健康检查超时\n${stderr}`)
    } finally {
      await stopProcessTree(child)
      rmSync(healthHome, { recursive: true, force: true })
    }
  }
}

module.exports = { KernelUpdater, reservePort, stopProcessTree, tarPathIsSafe }
