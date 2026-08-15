const { execFileSync } = require('node:child_process')
const { createHash, sign } = require('node:crypto')
const { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } = require('node:fs')
const { join, resolve } = require('node:path')
const tar = require('tar')
const { manifestPayload, sha256File } = require('../kernel-common.cjs')

function option(name) {
  const index = process.argv.indexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}

function has(name) {
  return process.argv.includes(name)
}

function runNpm(args, options = {}) {
  const npmCli = process.env.npm_execpath
  if (npmCli) return execFileSync(process.execPath, [npmCli, ...args], options)
  return execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, options)
}

async function main() {
  const root = resolve(__dirname, '..')
  const version = option('--version') || runNpm(['view', '@deepseek-ai/dsh', 'version'], { encoding: 'utf8' }).trim()
  const bootstrap = has('--bootstrap')
  const release = has('--release')
  if (!bootstrap && !release) throw new Error('必须指定 --bootstrap 或 --release')

  const workRoot = join(root, '.kernel-build')
  const stage = join(workRoot, `dsh-${version}-${process.platform}-${process.arch}`)
  rmSync(stage, { recursive: true, force: true })
  mkdirSync(stage, { recursive: true })
  const bootstrapSource = join(root, 'build', 'kernel-bootstrap')
  const bootstrapDescriptor = existsSync(join(bootstrapSource, 'kernel.json'))
    ? JSON.parse(readFileSync(join(bootstrapSource, 'kernel.json'), 'utf8'))
    : undefined
  if (bootstrapDescriptor?.version === version) {
    cpSync(bootstrapSource, stage, { recursive: true })
  } else {
    runNpm([
      'install', '--prefix', stage, '--omit=dev', '--no-audit', '--no-fund', '--package-lock=true',
      `@deepseek-ai/dsh@${version}`
    ], { stdio: 'inherit' })
  }

  const entry = 'node_modules/@deepseek-ai/dsh/lib/bin.js'
  const descriptor = {
    schemaVersion: 1,
    version,
    source: `npm:@deepseek-ai/dsh@${version}`,
    entry,
    minShellVersion: '0.3.0',
    nodeMajor: 24,
    kernelApiVersion: 1,
    platform: process.platform,
    arch: process.arch,
    builtAt: new Date().toISOString()
  }
  writeFileSync(join(stage, 'kernel.json'), `${JSON.stringify(descriptor, null, 2)}\n`)
  execFileSync(process.execPath, [join(stage, entry), '--version'], { cwd: stage, stdio: 'inherit' })

  if (bootstrap) {
    const destination = join(root, 'build', 'kernel-bootstrap')
    const bootstrapArchive = join(root, 'build', 'kernel-bootstrap.tar.gz')
    rmSync(destination, { recursive: true, force: true })
    cpSync(stage, destination, { recursive: true })
    rmSync(bootstrapArchive, { force: true })
    await tar.c({ cwd: stage, file: bootstrapArchive, gzip: true, portable: true }, ['.'])
    console.log(`Bootstrap kernel ${version}: ${destination}`)
  }

  if (release) {
    const output = resolve(option('--output') || join(root, 'dist', 'kernel'))
    mkdirSync(output, { recursive: true })
    const archiveName = `deepseek-harness-kernel-${version}-${process.platform}-${process.arch}.tar.gz`
    const archive = join(output, archiveName)
    rmSync(archive, { force: true })
    await tar.c({ cwd: stage, file: archive, gzip: true, portable: true }, ['.'])
    const sha256 = await sha256File(archive)
    const size = statSync(archive).size
    const repository = process.env.GITHUB_REPOSITORY || 'li-02/deepseek-harness-desktop'
    const tag = `kernel-v${version}`
    const url = process.env.KERNEL_DOWNLOAD_URL || `https://github.com/${repository}/releases/download/${tag}/${archiveName}`
    const manifest = {
      schemaVersion: 1,
      channel: 'stable',
      version,
      source: descriptor.source,
      minShellVersion: descriptor.minShellVersion,
      nodeMajor: descriptor.nodeMajor,
      kernelApiVersion: descriptor.kernelApiVersion,
      url,
      size,
      sha256
    }
    const privateKeyValue = process.env.KERNEL_SIGNING_PRIVATE_KEY
      || (existsSync(join(root, 'secrets', 'kernel-private-key.pem')) ? readFileSync(join(root, 'secrets', 'kernel-private-key.pem'), 'utf8') : '')
    if (!privateKeyValue) throw new Error('缺少 KERNEL_SIGNING_PRIVATE_KEY，不能发布未签名内核')
    const privateKey = privateKeyValue.replaceAll('\\n', '\n')
    manifest.signature = sign(null, Buffer.from(manifestPayload(manifest)), privateKey).toString('base64')
    writeFileSync(join(output, 'stable.json'), `${JSON.stringify(manifest, null, 2)}\n`)
    writeFileSync(join(output, `${archiveName}.sha256`), `${sha256}  ${archiveName}\n`)
    const releaseMeta = createHash('sha256').update(manifestPayload(manifest)).digest('hex')
    console.log(`Kernel release ${version}: ${archive}`)
    console.log(`Manifest payload SHA256: ${releaseMeta}`)
  }
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
