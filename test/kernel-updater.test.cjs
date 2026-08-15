const assert = require('node:assert/strict')
const { generateKeyPairSync, sign } = require('node:crypto')
const { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { afterEach, describe, it } = require('node:test')
const tar = require('tar')
const { manifestPayload, sha256File } = require('../kernel-common.cjs')
const { KernelStore } = require('../kernel-store.cjs')
const { KernelUpdater, tarPathIsSafe } = require('../kernel-updater.cjs')

const temporaryRoots = []

function fakeKernel(root, version) {
  mkdirSync(join(root, 'bin'), { recursive: true })
  writeFileSync(join(root, 'bin', 'dsh.js'), `
    const { createServer } = require('node:http')
    const port = Number(process.argv[process.argv.indexOf('--port') + 1])
    createServer((request, response) => { response.end('ready') }).listen(port, '127.0.0.1')
  `)
  writeFileSync(join(root, 'kernel.json'), JSON.stringify({
    schemaVersion: 1,
    version,
    source: `test:${version}`,
    entry: 'bin/dsh.js',
    kernelApiVersion: 1
  }))
}

afterEach(() => {
  while (temporaryRoots.length > 0) rmSync(temporaryRoots.pop(), { recursive: true, force: true })
})

describe('kernel archive paths', () => {
  it('accepts relative package paths', () => {
    assert.equal(tarPathIsSafe('node_modules/@deepseek-ai/dsh/lib/bin.js'), true)
  })

  it('rejects absolute and parent traversal paths', () => {
    assert.equal(tarPathIsSafe('../outside'), false)
    assert.equal(tarPathIsSafe('node_modules/../../outside'), false)
    assert.equal(tarPathIsSafe('C:\\outside'), false)
  })

  it('downloads, verifies, probes, and stages a signed kernel', async () => {
    const fixture = mkdtempSync(join(tmpdir(), 'dsh-kernel-update-'))
    temporaryRoots.push(fixture)
    const bootstrap = join(fixture, 'bootstrap')
    const update = join(fixture, 'update')
    fakeKernel(bootstrap, '1.0.0')
    fakeKernel(update, '1.1.0')
    const archive = join(fixture, 'kernel.tar.gz')
    await tar.c({ cwd: update, file: archive, gzip: true }, ['.'])
    const { privateKey, publicKey } = generateKeyPairSync('ed25519')
    const publicKeyFile = join(fixture, 'public.pem')
    writeFileSync(publicKeyFile, publicKey.export({ type: 'spki', format: 'pem' }))
    const manifest = {
      schemaVersion: 1,
      channel: 'stable',
      version: '1.1.0',
      source: 'test:1.1.0',
      minShellVersion: '0.3.0',
      nodeMajor: Number(process.versions.node.split('.')[0]),
      kernelApiVersion: 1,
      url: 'https://updates.example.test/kernel.tar.gz',
      size: statSync(archive).size,
      sha256: await sha256File(archive)
    }
    manifest.signature = sign(null, Buffer.from(manifestPayload(manifest)), privateKey).toString('base64')
    const originalFetch = global.fetch
    global.fetch = async url => String(url).startsWith('https://updates.example.test/stable.json')
      ? new Response(JSON.stringify(manifest), { status: 200 })
      : new Response(readFileSync(archive), { status: 200, headers: { 'content-length': String(manifest.size) } })
    try {
      const store = new KernelStore({ root: join(fixture, 'store'), bootstrapRoot: bootstrap })
      store.ensureInitialized()
      const updater = new KernelUpdater({
        store,
        manifestUrl: 'https://updates.example.test/stable.json',
        publicKeyFile,
        nodeExecutable: process.execPath,
        nodeMajor: manifest.nodeMajor,
        shellVersion: '0.3.0',
        log: () => {}
      })
      assert.deepEqual(await updater.check(), { status: 'pending', version: '1.1.0' })
      assert.equal(store.readState().pending, '1.1.0')
      store.activatePending()
      assert.equal(store.activeKernel().version, '1.1.0')
    } finally {
      global.fetch = originalFetch
    }
  })
})
