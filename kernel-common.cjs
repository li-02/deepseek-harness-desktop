const { createHash, verify } = require('node:crypto')
const { createReadStream } = require('node:fs')
const semver = require('semver')

const MANIFEST_FIELDS = [
  'schemaVersion',
  'channel',
  'version',
  'source',
  'minShellVersion',
  'nodeMajor',
  'kernelApiVersion',
  'url',
  'size',
  'sha256'
]

function manifestPayload(manifest) {
  const payload = {}
  for (const field of MANIFEST_FIELDS) payload[field] = manifest[field]
  return JSON.stringify(payload)
}

function validateManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('内核更新清单不是对象')
  if (manifest.schemaVersion !== 1) throw new Error(`不支持的内核更新清单版本：${manifest.schemaVersion}`)
  for (const field of ['channel', 'version', 'source', 'minShellVersion', 'url', 'sha256', 'signature']) {
    if (typeof manifest[field] !== 'string' || manifest[field].length === 0) throw new Error(`内核更新清单缺少 ${field}`)
  }
  if (!semver.valid(manifest.version)) throw new Error(`内核版本不是有效 SemVer：${manifest.version}`)
  if (!semver.valid(manifest.minShellVersion)) throw new Error(`最低外壳版本不是有效 SemVer：${manifest.minShellVersion}`)
  if (!Number.isSafeInteger(manifest.nodeMajor) || manifest.nodeMajor < 1) throw new Error('内核更新清单的 nodeMajor 无效')
  if (!Number.isSafeInteger(manifest.kernelApiVersion) || manifest.kernelApiVersion < 1) throw new Error('内核更新清单的 kernelApiVersion 无效')
  if (!Number.isSafeInteger(manifest.size) || manifest.size < 1) throw new Error('内核更新清单的 size 无效')
  if (!/^[a-f0-9]{64}$/u.test(manifest.sha256)) throw new Error('内核更新清单的 sha256 无效')
  const url = new URL(manifest.url)
  if (url.protocol !== 'https:') throw new Error('内核下载地址必须使用 HTTPS')
  return manifest
}

function verifyManifestSignature(manifest, publicKey) {
  validateManifest(manifest)
  const signature = Buffer.from(manifest.signature, 'base64')
  if (signature.length === 0 || !verify(null, Buffer.from(manifestPayload(manifest)), publicKey, signature)) {
    throw new Error('内核更新清单签名无效')
  }
}

function sha256File(file) {
  return new Promise((resolveHash, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(file)
    stream.on('error', reject)
    stream.on('data', chunk => hash.update(chunk))
    stream.on('end', () => resolveHash(hash.digest('hex')))
  })
}

module.exports = { MANIFEST_FIELDS, manifestPayload, sha256File, validateManifest, verifyManifestSignature }
