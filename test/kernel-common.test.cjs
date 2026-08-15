const { generateKeyPairSync, sign } = require('node:crypto')
const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { manifestPayload, verifyManifestSignature } = require('../kernel-common.cjs')

function manifest() {
  return {
    schemaVersion: 1,
    channel: 'stable',
    version: '1.2.3',
    source: 'npm:@deepseek-ai/dsh@1.2.3',
    minShellVersion: '0.3.0',
    nodeMajor: 24,
    kernelApiVersion: 1,
    url: 'https://example.test/kernel.tar.gz',
    size: 123,
    sha256: 'a'.repeat(64)
  }
}

describe('kernel update manifest', () => {
  it('accepts a signed manifest and rejects a modified payload', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519')
    const value = manifest()
    value.signature = sign(null, Buffer.from(manifestPayload(value)), privateKey).toString('base64')
    assert.doesNotThrow(() => verifyManifestSignature(value, publicKey))
    value.size += 1
    assert.throws(() => verifyManifestSignature(value, publicKey), /签名无效/u)
  })
})
