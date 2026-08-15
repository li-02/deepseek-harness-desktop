const assert = require('node:assert/strict')
const { mkdirSync, mkdtempSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { afterEach, describe, it } = require('node:test')
const { KernelStore } = require('../kernel-store.cjs')

const temporaryRoots = []

function fakeKernel(root, version) {
  mkdirSync(join(root, 'bin'), { recursive: true })
  writeFileSync(join(root, 'bin', 'dsh.js'), '')
  writeFileSync(join(root, 'kernel.json'), JSON.stringify({
    schemaVersion: 1,
    version,
    source: `test:${version}`,
    entry: 'bin/dsh.js',
    kernelApiVersion: 1
  }))
}

function storeFixture() {
  const fixture = mkdtempSync(join(tmpdir(), 'dsh-kernel-store-'))
  temporaryRoots.push(fixture)
  const bootstrap = join(fixture, 'bootstrap')
  fakeKernel(bootstrap, '1.0.0')
  return new KernelStore({ root: join(fixture, 'store'), bootstrapRoot: bootstrap })
}

afterEach(() => {
  while (temporaryRoots.length > 0) rmSync(temporaryRoots.pop(), { recursive: true, force: true })
})

describe('KernelStore', () => {
  it('initializes from the bundled kernel', () => {
    const store = storeFixture()
    const state = store.ensureInitialized()
    assert.equal(state.active, '1.0.0')
    assert.equal(store.activeKernel().version, '1.0.0')
  })

  it('activates a staged kernel and rolls back failed probation', () => {
    const store = storeFixture()
    store.ensureInitialized()
    const staging = store.resetStaging('1.1.0')
    fakeKernel(staging, '1.1.0')
    store.installExtracted('1.1.0', staging)
    assert.equal(store.markPending('1.1.0'), true)
    store.activatePending()
    assert.equal(store.activeKernel().version, '1.1.0')
    assert.equal(store.rollbackProbation(), true)
    assert.equal(store.activeKernel().version, '1.0.0')
    assert.deepEqual(store.readState().bad, ['1.1.0'])
  })

  it('keeps a successful activated kernel', () => {
    const store = storeFixture()
    store.ensureInitialized()
    const staging = store.resetStaging('1.1.0')
    fakeKernel(staging, '1.1.0')
    store.installExtracted('1.1.0', staging)
    store.markPending('1.1.0')
    store.activatePending()
    store.confirmActive()
    assert.equal(store.readState().probation, null)
    assert.equal(store.activeKernel().version, '1.1.0')
  })
})
