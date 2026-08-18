const { writeFileSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { normalizeCatalog } = require('../plugin-store.cjs')

const SOURCE_URL = process.env.DSH_PLUGIN_CATALOG_SOURCE || 'https://awesome-dsh-plugin.com/plugins.json'

async function main() {
  const response = await fetch(SOURCE_URL, { signal: AbortSignal.timeout(30_000), cache: 'no-store' })
  if (!response.ok) throw new Error(`下载插件目录失败：HTTP ${response.status}`)
  const catalog = normalizeCatalog(await response.json())
  const destination = resolve(process.argv[2] || join(__dirname, '..', 'plugin-catalog.json'))
  writeFileSync(destination, `${JSON.stringify(catalog, null, 2)}\n`)
  console.log(`已同步 ${catalog.plugins.length} 个插件到 ${destination}`)
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
