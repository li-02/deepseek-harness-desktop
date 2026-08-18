const test = require('node:test')
const assert = require('node:assert/strict')
const { findPlugin, installSpec, normalizeCatalog } = require('./plugin-store.cjs')

function catalog(plugin = {}) {
  return {
    updated: '2026-08-18',
    categories: { tools: { zh: '工具', en: 'Tools' } },
    plugins: [{
      name: 'demo', owner: 'alice', url: 'https://example.com/repo', page: 'https://example.com/demo',
      category: 'tools', description: { zh: '演示', en: 'Demo' }, npm: 'demo', stars: 1,
      install: 'dsh plugin --profile web add demo', added: '2026-08-18', screenshots: ['https://example.com/1.png'],
      futureField: true, ...plugin
    }]
  }
}

test('目录允许新增字段并保留合法截图', () => {
  const parsed = normalizeCatalog(catalog())
  assert.equal(parsed.count, 1)
  assert.equal(parsed.plugins[0].futureField, true)
  assert.deepEqual(parsed.plugins[0].screenshots, ['https://example.com/1.png'])
})

test('只接受固定 profile 的 dsh plugin add 命令', () => {
  assert.equal(installSpec(catalog().plugins[0]), 'demo')
  assert.throws(() => installSpec({ name: 'bad', install: 'dsh plugin --profile root add demo' }), /安装命令无效/)
  assert.throws(() => installSpec({ name: 'bad', install: 'cmd.exe /c calc.exe' }), /安装命令无效/)
})

test('插件使用 owner/name 唯一定位', () => {
  const parsed = normalizeCatalog(catalog())
  assert.equal(findPlugin(parsed, 'alice/demo').name, 'demo')
})
