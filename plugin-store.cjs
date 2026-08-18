const { existsSync, readFileSync } = require('node:fs')
const { join } = require('node:path')

const INSTALL_PATTERN = /^dsh plugin --profile web add ([^\s]+)$/

function isHttpUrl(value) {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function installSpec(plugin) {
  const match = typeof plugin?.install === 'string' ? INSTALL_PATTERN.exec(plugin.install.trim()) : undefined
  if (!match) throw new Error(`插件 ${plugin?.name || 'unknown'} 的安装命令无效`)
  return match[1]
}

function normalizeCatalog(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.plugins)) throw new Error('插件目录格式无效')
  const categories = raw.categories && typeof raw.categories === 'object' ? raw.categories : {}
  const plugins = raw.plugins.map((plugin, index) => {
    if (!plugin || typeof plugin !== 'object') throw new Error(`插件目录第 ${index + 1} 项格式无效`)
    for (const field of ['name', 'owner', 'category', 'install']) {
      if (typeof plugin[field] !== 'string' || !plugin[field].trim()) {
        throw new Error(`插件目录第 ${index + 1} 项缺少 ${field}`)
      }
    }
    if (!isHttpUrl(plugin.url) || !isHttpUrl(plugin.page)) {
      throw new Error(`插件 ${plugin.name} 的链接无效`)
    }
    installSpec(plugin)
    const description = plugin.description && typeof plugin.description === 'object' ? plugin.description : {}
    return {
      ...plugin,
      name: plugin.name.trim(),
      owner: plugin.owner.trim(),
      category: plugin.category.trim(),
      description: {
        ...description,
        zh: typeof description.zh === 'string' ? description.zh : '',
        en: typeof description.en === 'string' ? description.en : ''
      },
      screenshots: Array.isArray(plugin.screenshots)
        ? plugin.screenshots.filter(isHttpUrl)
        : undefined
    }
  })
  return {
    ...raw,
    count: plugins.length,
    categories,
    plugins
  }
}

function readCatalog(file) {
  return normalizeCatalog(JSON.parse(readFileSync(file, 'utf8')))
}

async function loadCatalog({ bundledFile, remoteUrl, timeoutMs = 8_000, log = () => {} }) {
  if (remoteUrl) {
    try {
      const response = await fetch(remoteUrl, { signal: AbortSignal.timeout(timeoutMs), cache: 'no-store' })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const catalog = normalizeCatalog(await response.json())
      return { catalog, source: 'remote' }
    } catch (error) {
      log(`Plugin catalog refresh failed, using bundled snapshot: ${error.message}`)
    }
  }
  return { catalog: readCatalog(bundledFile), source: 'bundled' }
}

function installedBundles(dshHome, profile = 'web') {
  const manifest = join(dshHome, 'profiles', profile, 'package.json')
  if (!existsSync(manifest)) return []
  try {
    const parsed = JSON.parse(readFileSync(manifest, 'utf8'))
    const bundles = parsed?.dsh?.profile?.bundles
    return Array.isArray(bundles) ? bundles.filter(value => typeof value === 'string') : []
  } catch {
    return []
  }
}

function findPlugin(catalog, identity) {
  const exact = catalog.plugins.find(plugin => `${plugin.owner}/${plugin.name}` === identity)
  if (exact) return exact
  const byName = catalog.plugins.filter(plugin => plugin.name === identity)
  if (byName.length === 1) return byName[0]
  if (byName.length > 1) throw new Error(`插件名称 ${identity} 不唯一，请刷新商店后重试`)
  throw new Error('插件不存在或目录已更新，请刷新后重试')
}

module.exports = {
  findPlugin,
  installSpec,
  installedBundles,
  isHttpUrl,
  loadCatalog,
  normalizeCatalog,
  readCatalog
}
