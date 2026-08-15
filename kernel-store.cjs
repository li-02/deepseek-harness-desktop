const { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } = require('node:fs')
const { basename, isAbsolute, join, resolve, sep } = require('node:path')
const tar = require('tar')

const STATE_SCHEMA_VERSION = 1
const KERNEL_SCHEMA_VERSION = 1

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'))
}

function safeVersion(version) {
  if (typeof version !== 'string' || !/^[0-9A-Za-z][0-9A-Za-z.+_-]{0,127}$/u.test(version)) {
    throw new Error(`不安全的内核版本目录名：${String(version)}`)
  }
  return version
}

function assertInside(parent, child) {
  const root = resolve(parent) + sep
  const target = resolve(child)
  if (!target.startsWith(root)) throw new Error(`内核路径越界：${target}`)
  return target
}

class KernelStore {
  constructor({ root, bootstrapRoot, bootstrapArchive }) {
    this.root = resolve(root)
    this.bootstrapRoot = bootstrapRoot ? resolve(bootstrapRoot) : undefined
    this.bootstrapArchive = bootstrapArchive ? resolve(bootstrapArchive) : undefined
    this.versionsRoot = join(this.root, 'versions')
    this.stagingRoot = join(this.root, 'staging')
    this.downloadsRoot = join(this.root, 'downloads')
    this.stateFile = join(this.root, 'current.json')
  }

  ensureDirectories() {
    mkdirSync(this.versionsRoot, { recursive: true })
    mkdirSync(this.stagingRoot, { recursive: true })
    mkdirSync(this.downloadsRoot, { recursive: true })
  }

  ensureInitialized() {
    this.ensureDirectories()
    if (existsSync(this.stateFile)) return this.readState()
    const sourceRoot = this.prepareBootstrap()
    const descriptor = this.validateKernel(sourceRoot)
    const destination = this.versionRoot(descriptor.version)
    if (!existsSync(destination)) {
      if (sourceRoot.startsWith(this.stagingRoot + sep)) renameSync(sourceRoot, destination)
      else cpSync(sourceRoot, destination, { recursive: true })
    }
    const state = this.defaultState(descriptor.version)
    this.writeState(state)
    return state
  }

  prepareBootstrap() {
    if (this.bootstrapRoot && existsSync(join(this.bootstrapRoot, 'kernel.json'))) return this.bootstrapRoot
    if (!this.bootstrapArchive || !existsSync(this.bootstrapArchive)) throw new Error('安装包缺少初始 Harness 内核')
    const destination = this.resetStaging('bootstrap')
    tar.x({
      cwd: destination,
      file: this.bootstrapArchive,
      sync: true,
      strict: true,
      filter: entryPath => {
        const parts = entryPath.replaceAll('\\', '/').split('/')
        if (isAbsolute(entryPath) || parts.includes('..')) throw new Error(`初始内核压缩包包含越界路径：${entryPath}`)
        return true
      }
    })
    return destination
  }

  defaultState(active) {
    return { schemaVersion: STATE_SCHEMA_VERSION, active, previous: null, pending: null, probation: null, bad: [] }
  }

  readState() {
    const state = readJson(this.stateFile)
    if (state.schemaVersion !== STATE_SCHEMA_VERSION) throw new Error(`不支持的内核状态版本：${state.schemaVersion}`)
    safeVersion(state.active)
    for (const field of ['previous', 'pending', 'probation']) {
      if (state[field] !== null) safeVersion(state[field])
    }
    if (!Array.isArray(state.bad) || state.bad.some(version => typeof version !== 'string')) throw new Error('内核坏版本列表无效')
    return state
  }

  writeState(state) {
    mkdirSync(this.root, { recursive: true })
    const temporary = `${this.stateFile}.tmp-${process.pid}`
    writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`)
    renameSync(temporary, this.stateFile)
  }

  versionRoot(version) {
    return assertInside(this.versionsRoot, join(this.versionsRoot, safeVersion(version)))
  }

  stagingPath(version) {
    return assertInside(this.stagingRoot, join(this.stagingRoot, safeVersion(version)))
  }

  downloadPath(version) {
    return assertInside(this.downloadsRoot, join(this.downloadsRoot, `${safeVersion(version)}.tar.gz`))
  }

  validateKernel(root) {
    const descriptor = readJson(join(root, 'kernel.json'))
    if (descriptor.schemaVersion !== KERNEL_SCHEMA_VERSION) throw new Error(`不支持的内核包版本：${descriptor.schemaVersion}`)
    safeVersion(descriptor.version)
    if (typeof descriptor.entry !== 'string' || descriptor.entry.length === 0) throw new Error('内核包缺少入口文件')
    const entry = assertInside(root, join(root, descriptor.entry))
    if (!existsSync(entry)) throw new Error(`内核入口不存在：${entry}`)
    if (!Number.isSafeInteger(descriptor.kernelApiVersion) || descriptor.kernelApiVersion < 1) throw new Error('内核 API 版本无效')
    return { ...descriptor, root: resolve(root), entry }
  }

  activeKernel() {
    const state = this.readState()
    return this.validateKernel(this.versionRoot(state.active))
  }

  activatePending() {
    const state = this.readState()
    if (state.pending === null) return state
    this.validateKernel(this.versionRoot(state.pending))
    state.previous = state.active
    state.active = state.pending
    state.pending = null
    state.probation = state.active
    this.writeState(state)
    return state
  }

  confirmActive() {
    const state = this.readState()
    state.probation = null
    this.writeState(state)
    this.prune(state)
  }

  rollbackProbation() {
    const state = this.readState()
    if (state.probation === null || state.previous === null) return false
    const failed = state.active
    state.active = state.previous
    state.previous = null
    state.probation = null
    state.bad = [...new Set([...state.bad, failed])].slice(-20)
    this.writeState(state)
    return true
  }

  installExtracted(version, extractedRoot) {
    const normalized = safeVersion(version)
    const descriptor = this.validateKernel(extractedRoot)
    if (descriptor.version !== normalized) throw new Error(`内核版本不匹配：清单 ${normalized}，包内 ${descriptor.version}`)
    const destination = this.versionRoot(normalized)
    if (existsSync(destination)) rmSync(destination, { recursive: true, force: true })
    renameSync(extractedRoot, destination)
    return this.validateKernel(destination)
  }

  markPending(version) {
    const normalized = safeVersion(version)
    this.validateKernel(this.versionRoot(normalized))
    const state = this.readState()
    if (state.bad.includes(normalized)) throw new Error(`内核版本已被标记为不可用：${normalized}`)
    if (state.active === normalized) return false
    state.pending = normalized
    this.writeState(state)
    return true
  }

  hasVersion(version) {
    return existsSync(this.versionRoot(version))
  }

  resetStaging(version) {
    const path = this.stagingPath(version)
    rmSync(path, { recursive: true, force: true })
    mkdirSync(path, { recursive: true })
    return path
  }

  prune(state = this.readState()) {
    const keep = new Set([state.active, state.previous, state.pending].filter(Boolean))
    for (const version of state.bad.slice(-1)) keep.add(version)
    if (!existsSync(this.versionsRoot)) return
    const { readdirSync } = require('node:fs')
    for (const entry of readdirSync(this.versionsRoot, { withFileTypes: true })) {
      if (entry.isDirectory() && !keep.has(basename(entry.name))) {
        rmSync(this.versionRoot(entry.name), { recursive: true, force: true })
      }
    }
  }
}

module.exports = { KernelStore, assertInside, safeVersion }
