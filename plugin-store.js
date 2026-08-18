const state = {
  catalog: { updated: '', source: '', categories: {}, plugins: [] },
  installed: new Set(),
  selectedCategory: 'all',
  query: '',
  sort: 'stars',
  installing: new Set(),
  pendingInstall: null
}

const elements = {
  catalogStatus: document.querySelector('#catalogStatus'),
  installedCount: document.querySelector('#installedCount'),
  pluginCount: document.querySelector('#pluginCount'),
  searchInput: document.querySelector('#searchInput'),
  categoryList: document.querySelector('#categoryList'),
  sortSelect: document.querySelector('#sortSelect'),
  resultsTitle: document.querySelector('#resultsTitle'),
  resultsMeta: document.querySelector('#resultsMeta'),
  messageArea: document.querySelector('#messageArea'),
  pluginGrid: document.querySelector('#pluginGrid'),
  emptyState: document.querySelector('#emptyState'),
  confirmDialog: document.querySelector('#confirmDialog'),
  confirmText: document.querySelector('#confirmText'),
  riskCheckbox: document.querySelector('#riskCheckbox'),
  confirmInstallButton: document.querySelector('#confirmInstallButton')
}

function api() {
  if (!window.pluginStore) {
    throw new Error('插件商店 API 不可用，请确认窗口 preload 配置。')
  }
  return window.pluginStore
}

function text(value, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function normalizeListResult(result) {
  const catalog = result?.catalog && typeof result.catalog === 'object' ? result.catalog : {}
  return {
    catalog: {
      updated: text(catalog.updated || catalog.source || ''),
      source: text(result?.source),
      categories: catalog.categories && typeof catalog.categories === 'object' ? catalog.categories : {},
      plugins: Array.isArray(catalog.plugins) ? catalog.plugins : []
    },
    installed: Array.isArray(result?.installed) ? result.installed.filter(item => typeof item === 'string') : []
  }
}

function categoryLabel(key) {
  if (key === 'all') return '全部'
  const category = state.catalog.categories[key]
  if (typeof category === 'string') return category
  return text(category?.zh, text(category?.en, key))
}

function pluginDescription(plugin) {
  if (typeof plugin.description === 'string') return plugin.description
  return text(plugin.description?.zh, text(plugin.description?.en, '暂无描述。'))
}

function pluginIdentity(plugin) {
  return `${text(plugin.owner, 'unknown')}/${text(plugin.name, 'unknown')}`
}

function installedKeys(plugin) {
  return [
    plugin.name,
    plugin.npm,
    plugin.install,
    pluginIdentity(plugin),
    plugin.url
  ].filter(Boolean).map(value => String(value).toLowerCase())
}

function isInstalled(plugin) {
  const installed = Array.from(state.installed).map(value => value.toLowerCase())
  return installedKeys(plugin).some(key => installed.includes(key))
}

function countByCategory() {
  return state.catalog.plugins.reduce((counts, plugin) => {
    const category = text(plugin.category, 'other')
    counts.set(category, (counts.get(category) || 0) + 1)
    return counts
  }, new Map())
}

function showMessage(message, tone = 'info') {
  elements.messageArea.textContent = message
  elements.messageArea.className = `message-area ${tone === 'error' ? 'error' : tone === 'success' ? 'success' : ''}`.trim()
  elements.messageArea.hidden = false
}

function clearMessage() {
  elements.messageArea.hidden = true
  elements.messageArea.textContent = ''
}

function renderSummary() {
  const total = state.catalog.plugins.length
  const source = state.catalog.source === 'remote' ? '在线目录' : state.catalog.source === 'bundled' ? '内置快照' : '目录'
  elements.catalogStatus.textContent = state.catalog.updated ? `${source} · 更新于 ${state.catalog.updated}` : `${source}已加载`
  elements.installedCount.textContent = String(state.catalog.plugins.filter(isInstalled).length)
  elements.pluginCount.textContent = String(total)
}

function renderCategories() {
  const counts = countByCategory()
  const categories = ['all', ...Object.keys(state.catalog.categories)]
  const known = new Set(categories)
  for (const key of counts.keys()) {
    if (!known.has(key)) categories.push(key)
  }

  elements.categoryList.replaceChildren(...categories.map(key => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = `category-button${state.selectedCategory === key ? ' active' : ''}`
    button.dataset.category = key
    const label = document.createElement('span')
    label.textContent = categoryLabel(key)
    const count = document.createElement('span')
    count.className = 'category-count'
    count.textContent = String(key === 'all' ? state.catalog.plugins.length : counts.get(key) || 0)
    button.append(label, count)
    return button
  }))
}

function searchableText(plugin) {
  return [
    plugin.name,
    plugin.owner,
    plugin.url,
    plugin.page,
    plugin.category,
    plugin.npm,
    plugin.install,
    pluginDescription(plugin)
  ].filter(Boolean).join(' ').toLowerCase()
}

function filteredPlugins() {
  const query = state.query.trim().toLowerCase()
  return state.catalog.plugins
    .filter(plugin => state.selectedCategory === 'all' || plugin.category === state.selectedCategory)
    .filter(plugin => !query || searchableText(plugin).includes(query))
    .sort((left, right) => {
      if (state.sort === 'name') return text(left.name).localeCompare(text(right.name), 'zh-CN')
      if (state.sort === 'added') return text(right.added).localeCompare(text(left.added))
      return Number(right.stars || 0) - Number(left.stars || 0)
    })
}

function makeBadge(label, className = '') {
  const badge = document.createElement('span')
  badge.className = className
  badge.textContent = label
  return badge
}

function makeButton(label, className, action, value) {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = className
  button.dataset.action = action
  if (value) button.dataset.value = value
  button.textContent = label
  return button
}

function renderPluginCard(plugin) {
  const installed = isInstalled(plugin)
  const identity = pluginIdentity(plugin)
  const installing = state.installing.has(identity)
  const card = document.createElement('article')
  card.className = `plugin-card${installed ? ' installed' : ''}`

  const head = document.createElement('div')
  head.className = 'card-head'
  const titleBlock = document.createElement('div')
  const title = document.createElement('h3')
  title.className = 'plugin-name'
  title.textContent = text(plugin.name, '未命名插件')
  const owner = document.createElement('p')
  owner.className = 'plugin-owner'
  owner.textContent = `作者：${text(plugin.owner, '未知')}`
  titleBlock.append(title, owner)
  const status = makeBadge(installing ? '安装中' : installed ? '已安装' : '未安装', `status-badge${installed ? ' installed' : installing ? ' installing' : ''}`)
  head.append(titleBlock, status)

  const badges = document.createElement('div')
  badges.className = 'badges'
  badges.append(
    makeBadge(categoryLabel(plugin.category), 'category-badge'),
    makeBadge(`★ ${Number(plugin.stars || 0)}`, 'stars-badge')
  )
  if (plugin.npm) badges.append(makeBadge(`npm: ${plugin.npm}`, 'category-badge'))
  if (Array.isArray(plugin.screenshots) && plugin.screenshots.length) {
    badges.append(makeBadge(`${plugin.screenshots.length} 张截图`, 'category-badge'))
  }

  const description = document.createElement('p')
  description.className = 'description'
  description.textContent = pluginDescription(plugin)

  const meta = document.createElement('div')
  meta.className = 'plugin-meta'
  if (plugin.added) meta.append(makeBadge(`收录：${plugin.added}`, 'meta-label'))

  const command = document.createElement('div')
  command.className = 'install-command'
  command.textContent = text(plugin.install, '无安装命令')

  const actions = document.createElement('div')
  actions.className = 'card-actions'
  const installButton = makeButton(installed ? '已安装' : installing ? '安装中...' : '安装', installed || installing ? 'ghost-button' : 'primary-button', 'install', identity)
  installButton.disabled = installed || installing
  actions.append(installButton)
  if (plugin.page) actions.append(makeButton('详情页', 'link-button', 'open-external', plugin.page))
  if (plugin.url) actions.append(makeButton('来源', 'link-button', 'open-external', plugin.url))

  if (installing) {
    const progress = document.createElement('div')
    progress.className = 'progress-row'
    const spinner = document.createElement('span')
    spinner.className = 'spinner'
    const label = document.createElement('span')
    label.textContent = '正在安装，请稍候...'
    progress.append(spinner, label)
    card.append(head, badges, description, meta, command, progress, actions)
  } else {
    card.append(head, badges, description, meta, command, actions)
  }

  return card
}

function renderPlugins() {
  const plugins = filteredPlugins()
  const category = categoryLabel(state.selectedCategory)
  elements.resultsTitle.textContent = state.selectedCategory === 'all' ? '全部插件' : category
  elements.resultsMeta.textContent = `显示 ${plugins.length} / ${state.catalog.plugins.length} 个插件`
  elements.emptyState.hidden = plugins.length !== 0
  elements.pluginGrid.replaceChildren(...plugins.map(renderPluginCard))
}

function render() {
  renderSummary()
  renderCategories()
  renderPlugins()
}

async function loadCatalog() {
  clearMessage()
  elements.catalogStatus.textContent = '正在加载...'
  await refreshCatalog()
}

async function refreshCatalog() {
  try {
    const result = normalizeListResult(await api().list())
    state.catalog = result.catalog
    state.installed = new Set(result.installed)
    render()
  } catch (error) {
    showMessage(error.message || '加载插件目录失败。', 'error')
    elements.catalogStatus.textContent = '加载失败'
    render()
  }
}

function requestInstall(identity) {
  const plugin = state.catalog.plugins.find(item => pluginIdentity(item) === identity)
  if (!plugin) {
    showMessage('插件不存在或目录已刷新，请重新选择。', 'error')
    return
  }
  state.pendingInstall = plugin
  elements.riskCheckbox.checked = false
  elements.confirmInstallButton.disabled = true
  elements.confirmText.textContent = `准备安装 ${pluginIdentity(plugin)}。安装命令：${text(plugin.install, '无')}`
  if (typeof elements.confirmDialog.showModal === 'function') {
    elements.confirmDialog.showModal()
  } else {
    showMessage('当前 Electron 版本不支持确认弹窗。', 'error')
  }
}

async function confirmInstall() {
  const plugin = state.pendingInstall
  if (!plugin || !elements.riskCheckbox.checked) return
  const identity = pluginIdentity(plugin)
  elements.confirmDialog.close()
  state.installing.add(identity)
  render()
  showMessage(`正在安装 ${plugin.name}...`)
  try {
    const result = await api().install(identity)
    state.installed = new Set(Array.isArray(result?.installed) ? result.installed : [...state.installed, plugin.name])
    showMessage(`${plugin.name} 安装完成，重启应用后生效。`, 'success')
    await refreshCatalog()
  } catch (error) {
    showMessage(error.message || `${plugin.name} 安装失败。`, 'error')
  } finally {
    state.installing.delete(identity)
    state.pendingInstall = null
    render()
  }
}

async function restartApp() {
  showMessage('正在请求重启应用...')
  try {
    await api().restart()
  } catch (error) {
    showMessage(error.message || '重启请求失败。', 'error')
  }
}

async function openExternal(url) {
  try {
    await api().openExternal(url)
  } catch (error) {
    showMessage(error.message || '打开外部链接失败。', 'error')
  }
}

document.addEventListener('click', event => {
  const target = event.target.closest('[data-action]')
  if (!target) return
  const action = target.dataset.action
  if (action === 'refresh') loadCatalog()
  if (action === 'restart') restartApp()
  if (action === 'install') requestInstall(target.dataset.value)
  if (action === 'open-external') openExternal(target.dataset.value)
  if (action === 'cancel-install') elements.confirmDialog.close()
})

elements.categoryList.addEventListener('click', event => {
  const target = event.target.closest('[data-category]')
  if (!target) return
  state.selectedCategory = target.dataset.category
  render()
})

elements.searchInput.addEventListener('input', event => {
  state.query = event.target.value
  renderPlugins()
})

elements.sortSelect.addEventListener('change', event => {
  state.sort = event.target.value
  renderPlugins()
})

elements.riskCheckbox.addEventListener('change', event => {
  elements.confirmInstallButton.disabled = !event.target.checked
})

elements.confirmInstallButton.addEventListener('click', confirmInstall)

loadCatalog()
