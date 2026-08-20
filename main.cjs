const { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, shell, Tray } = require('electron')
const { spawn, execFile } = require('node:child_process')
const { appendFileSync, createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs')
const { createServer } = require('node:net')
const { delimiter, dirname, join, resolve } = require('node:path')
const { KernelStore } = require('./kernel-store.cjs')
const { KernelUpdater } = require('./kernel-updater.cjs')

const APP_NAME = 'DeepSeek Harness'
const READY_TIMEOUT_MS = 90_000
const MAX_ERROR_OUTPUT = 12_000

/** Close-window behaviors: ask each time / minimize to tray / quit the app. */
const CLOSE_BEHAVIORS = Object.freeze(['ask', 'minimize', 'exit'])
const DEFAULT_DESKTOP_SETTINGS = Object.freeze({ closeBehavior: 'minimize' })

let mainWindow
let backend
let backendStopping = false
let booting = false
let kernelStore
let kernelUpdater
let updateChecksStarted = false
let quitting = false
let tray
let trayHintShown = false

app.setName(APP_NAME)

function userDataPath(...parts) {
  return join(app.getPath('userData'), ...parts)
}

let logDirectoryReady = false

function logDesktop(message) {
  const directory = userDataPath('logs')
  if (!logDirectoryReady) {
    mkdirSync(directory, { recursive: true })
    logDirectoryReady = true
  }
  appendFileSync(join(directory, 'desktop.log'), `${new Date().toISOString()} ${message}\n`)
}

function configuredDevelopmentWorkspace() {
  if (app.isPackaged || !process.env.DSH_DESKTOP_HARNESS_ROOT) return undefined
  const root = resolve(process.env.DSH_DESKTOP_HARNESS_ROOT)
  if (existsSync(join(root, 'apps', 'cli', 'src', 'bin.ts')) && existsSync(join(root, 'node_modules', 'tsx'))) return root
  logDesktop(`Ignoring invalid DSH_DESKTOP_HARNESS_ROOT: ${root}`)
  return undefined
}

function nodeExecutable() {
  const executable = app.isPackaged
    ? join(process.resourcesPath, 'runtime', 'node.exe')
    : join(__dirname, 'runtime', 'node.exe')
  if (!existsSync(executable)) throw new Error(`缺少内置 Node 运行时：${executable}`)
  return executable
}

function pnpmDirectory() {
  return app.isPackaged
    ? join(process.resourcesPath, 'runtime')
    : dirname(require.resolve('@pnpm/exe/package.json'))
}

function harnessEnvironment() {
  return {
    ...process.env,
    DSH_HOME: userDataPath('harness-home-v2'),
    PATH: `${pnpmDirectory()}${delimiter}${process.env.PATH || ''}`
  }
}

let nodeMajorPromise

function runtimeNodeMajor() {
  if (!nodeMajorPromise) {
    nodeMajorPromise = new Promise((resolvePromise) => {
      execFile(nodeExecutable(), ['-p', 'process.versions.node.split(".")[0]'], {
        encoding: 'utf8',
        windowsHide: true
      }, (error, stdout) => {
        if (error) {
          logDesktop(`Node version probe failed: ${error.message}`)
          resolvePromise(undefined)
          return
        }
        resolvePromise(Number(stdout.trim()))
      })
    })
  }
  return nodeMajorPromise
}

function kernelStorageRoot() {
  if (process.env.DSH_KERNEL_STORAGE_ROOT) return resolve(process.env.DSH_KERNEL_STORAGE_ROOT)
  const localRoot = process.env.LOCALAPPDATA || app.getPath('userData')
  return join(localRoot, APP_NAME, 'kernel-runtime')
}

function bootstrapKernelLocation() {
  return app.isPackaged
    ? { bootstrapArchive: join(process.resourcesPath, 'kernel-bootstrap.tar.gz') }
    : { bootstrapRoot: join(__dirname, 'build', 'kernel-bootstrap') }
}

function launchTarget() {
  const workspace = configuredDevelopmentWorkspace()
  if (workspace) {
    return {
      kind: 'source',
      label: workspace,
      cwd: workspace,
      args: ['--import', 'tsx/esm', join(workspace, 'apps', 'cli', 'src', 'bin.ts')]
    }
  }
  kernelStore.ensureInitialized()
  kernelStore.activatePending()
  const kernel = kernelStore.activeKernel()
  return { kind: 'kernel', label: `${kernel.version} (${kernel.source})`, cwd: kernel.root, args: [kernel.entry], kernel }
}

function patchLayoutStartup(targetRoot) {
  const layoutEntry = join(targetRoot, 'node_modules', '@deepseek-ai', 'dsh-client-ui-layout', 'lib', 'client.js')
  if (!existsSync(layoutEntry)) return

  const marker = '/* deepseek-harness-desktop: close details panel on startup */'
  const source = readFileSync(layoutEntry, 'utf8')
  if (source.includes(marker)) return

  const needles = [
    'const lastSession = useRef(detailsSession);',
    'const lastSession = (0, react.useRef)(detailsSession);'
  ]
  const needle = needles.find(candidate => source.includes(candidate))
  if (!needle) {
    logDesktop(`Layout startup patch skipped: marker not found in ${layoutEntry}`)
    return
  }

  const replacement = needle.includes('react.useRef')
    ? `${needle}\n\t\t${marker}\n\t\t(0, react.useEffect)(() => { actions.closeDetails(); }, [actions]);`
    : `${needle}\n\t\t${marker}\n\t\tuseEffect(() => { actions.closeDetails(); }, [actions]);`
  writeFileSync(layoutEntry, source.replace(needle, replacement), 'utf8')
  logDesktop(`Patched layout startup state: ${layoutEntry}`)
}

function readUpdateConfig() {
  const config = JSON.parse(readFileSync(join(__dirname, 'kernel-update.json'), 'utf8'))
  return {
    manifestUrl: process.env.DSH_KERNEL_MANIFEST_URL || config.manifestUrl,
    checkIntervalMs: Math.max(1, Number(config.checkIntervalHours) || 6) * 60 * 60 * 1000
  }
}

function startUpdateChecks() {
  if (!app.isPackaged || updateChecksStarted) return
  if (!kernelUpdater) {
    setTimeout(startUpdateChecks, 1000).unref()
    return
  }
  updateChecksStarted = true
  const { checkIntervalMs } = readUpdateConfig()
  const check = () => kernelUpdater.check()
    .then(result => logDesktop(`Kernel update check: ${JSON.stringify(result)}`))
    .catch(error => logDesktop(`Kernel update check failed: ${error.stack || error.message}`))
  setTimeout(check, 5000).unref()
  setInterval(check, checkIntervalMs).unref()
}

function reservePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer()
    server.unref()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(error => error ? reject(error) : resolvePort(port))
    })
  })
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

let iconDataUrlCache

function iconDataUrl() {
  if (!iconDataUrlCache) {
    iconDataUrlCache = `data:image/png;base64,${readFileSync(join(__dirname, 'build', 'icon.png')).toString('base64')}`
  }
  return iconDataUrlCache
}

function shellPage({ title, detail = '', loading = false, actions = false }) {
  const actionMarkup = actions
    ? '<div class="actions"><button id="retry">重新启动</button><button id="logs" class="secondary">打开日志</button></div>'
    : ''
  const spinner = loading ? '<div class="spinner"></div>' : ''
  const script = actions ? `<script>
    document.getElementById('retry').onclick = () => window.harnessDesktop.retry()
    document.getElementById('logs').onclick = () => window.harnessDesktop.openLogs()
  </script>` : ''
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="color-scheme" content="dark">
    <style>
      *{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0d0e12;color:#f4f4f5;font-family:Inter,"Segoe UI",sans-serif}
      .card{width:min(680px,calc(100vw - 48px));padding:48px;border:1px solid #282a31;border-radius:18px;background:#15161b;box-shadow:0 24px 80px #0008}
      .brand{display:flex;align-items:center;gap:14px;margin-bottom:34px;font-size:15px;color:#b7bbc7}.brand img{width:32px;height:32px;border-radius:8px}
      h1{margin:0 0 14px;font-size:28px;font-weight:650;letter-spacing:-.02em}pre{margin:0;color:#aeb2bd;white-space:pre-wrap;word-break:break-word;font:13px/1.6 "Cascadia Mono",Consolas,monospace;max-height:260px;overflow:auto}
      .spinner{width:26px;height:26px;margin-top:28px;border:3px solid #2a2d35;border-top-color:#4f8cff;border-radius:50%;animation:spin .8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}
      .actions{display:flex;gap:10px;margin-top:30px}button{border:0;border-radius:9px;padding:10px 16px;background:#377cf6;color:white;font-weight:600;cursor:pointer}button.secondary{background:#272a32;color:#e8e9ed}
    </style></head><body><main class="card"><div class="brand"><img src="${iconDataUrl()}"><span>DeepSeek Harness Desktop</span></div><h1>${escapeHtml(title)}</h1><pre>${escapeHtml(detail)}</pre>${spinner}${actionMarkup}</main>${script}</body></html>`
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
}

function readWindowState() {
  try {
    const state = JSON.parse(readFileSync(userDataPath('window-state.json'), 'utf8'))
    return {
      width: Math.max(960, Number(state.width) || 1440),
      height: Math.max(640, Number(state.height) || 900)
    }
  } catch {
    return { width: 1440, height: 900 }
  }
}

function saveWindowState() {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isMinimized() || mainWindow.isMaximized()) return
  writeFileSync(userDataPath('window-state.json'), JSON.stringify(mainWindow.getBounds()))
}

function desktopSettingsPath() {
  return userDataPath('desktop-settings.json')
}

function readDesktopSettings() {
  try {
    const parsed = JSON.parse(readFileSync(desktopSettingsPath(), 'utf8'))
    const behavior = parsed && typeof parsed.closeBehavior === 'string' ? parsed.closeBehavior : undefined
    return {
      closeBehavior: CLOSE_BEHAVIORS.includes(behavior) ? behavior : DEFAULT_DESKTOP_SETTINGS.closeBehavior
    }
  } catch {
    return { ...DEFAULT_DESKTOP_SETTINGS }
  }
}

function writeDesktopSettings(settings) {
  writeFileSync(desktopSettingsPath(), JSON.stringify(settings, null, 2))
}

function setCloseBehavior(behavior) {
  if (!CLOSE_BEHAVIORS.includes(behavior)) throw new Error(`未知的关闭行为：${behavior}`)
  writeDesktopSettings({ ...readDesktopSettings(), closeBehavior: behavior })
  return behavior
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function hideToTray() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.hide()
  if (!trayHintShown && process.platform === 'win32' && tray) {
    trayHintShown = true
    tray.displayBalloon({
      iconType: 'info',
      title: APP_NAME,
      content: '已最小化到系统托盘，点击托盘图标可重新打开窗口。'
    })
  }
}

function quitApp() {
  quitting = true
  app.quit()
}

async function askCloseBehavior() {
  const result = await dialog.showMessageBox(mainWindow, {
    type: 'question',
    title: '关闭 DeepSeek Harness',
    message: '关闭窗口后希望执行什么操作？',
    detail: '选择「最小化到托盘」可让应用继续在后台运行，选择「关闭程序」将完全关闭。',
    buttons: ['最小化到托盘', '关闭程序'],
    defaultId: 0,
    cancelId: 0,
    noLink: true
  })
  if (result.response === 0) hideToTray()
  else quitApp()
}

async function handleCloseRequest() {
  const { closeBehavior } = readDesktopSettings()
  if (closeBehavior === 'minimize') {
    hideToTray()
    return
  }
  if (closeBehavior === 'exit') {
    quitApp()
    return
  }
  await askCloseBehavior()
}

function createTray() {
  if (tray) return tray
  const icon = process.platform === 'win32'
    ? nativeImage.createFromPath(join(__dirname, 'build', 'icon.ico'))
    : nativeImage.createFromPath(join(__dirname, 'build', 'icon.png'))
  tray = new Tray(icon)
  tray.setToolTip(APP_NAME)
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示主窗口', click: showMainWindow },
    { type: 'separator' },
    { label: '退出', click: quitApp }
  ]))
  tray.on('click', showMainWindow)
  return tray
}

function createWindow(onShown) {
  const state = readWindowState()
  mainWindow = new BrowserWindow({
    ...state,
    minWidth: 960,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0d0e12',
    icon: join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  mainWindow.on('resize', saveWindowState)
  mainWindow.on('move', saveWindowState)
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('http://127.0.0.1:') && !url.startsWith('data:')) {
      event.preventDefault()
      if (url.startsWith('https://') || url.startsWith('http://')) shell.openExternal(url)
    }
  })
  mainWindow.loadURL(shellPage({ title: '正在启动 DeepSeek Harness', detail: '正在准备本地 Agent 运行时…', loading: true }))
  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
    setImmediate(onShown)
  })
  mainWindow.on('close', (event) => {
    if (quitting) return
    event.preventDefault()
    handleCloseRequest()
  })
}

function waitUntilReady(url, child, errorOutput) {
  const deadline = Date.now() + READY_TIMEOUT_MS
  return new Promise((resolveReady, reject) => {
    const poll = async () => {
      if (child.exitCode !== null) {
        reject(new Error(`Harness 后台进程提前退出（退出码 ${child.exitCode}）\n\n${errorOutput()}`))
        return
      }
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(1500) })
        if (response.ok) {
          resolveReady()
          return
        }
      } catch {
        // The service is expected to reject connections while its plugin tree starts.
      }
      if (Date.now() >= deadline) {
        reject(new Error(`Harness 本地服务启动超时。\n\n${errorOutput()}`))
        return
      }
      setTimeout(poll, 300)
    }
    poll()
  })
}

async function stopBackend() {
  const child = backend
  backend = undefined
  if (!child || child.exitCode !== null) return
  backendStopping = true
  const pid = child.pid
  child.kill()
  if (process.platform === 'win32' && pid) {
    setTimeout(() => execFile('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => {}), 1500).unref()
  }
}

async function launchHarness() {
  if (booting) return
  booting = true
  await stopBackend()
  backendStopping = false
  await mainWindow.loadURL(shellPage({ title: '正在启动 DeepSeek Harness', detail: '正在准备本地 Agent 运行时…', loading: true }))

  let target
  let retryAfterRollback = false
  try {
    target = launchTarget()
    patchLayoutStartup(target.cwd)
    const port = await reservePort()
    const url = `http://127.0.0.1:${port}`
    const logDirectory = userDataPath('logs')
    mkdirSync(logDirectory, { recursive: true })
    const stdoutFile = createWriteStream(join(logDirectory, 'harness.stdout.log'), { flags: 'a' })
    const stderrFile = createWriteStream(join(logDirectory, 'harness.stderr.log'), { flags: 'a' })
    let stderr = ''
    const child = spawn(nodeExecutable(), [
      ...target.args, 'web', '--port', String(port)
    ], {
      cwd: target.cwd,
      env: harnessEnvironment(),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    backend = child
    child.stdout.pipe(stdoutFile)
    child.stderr.pipe(stderrFile)
    child.stderr.on('data', chunk => {
      stderr = (stderr + chunk.toString()).slice(-MAX_ERROR_OUTPUT)
    })
    child.once('exit', (code, signal) => {
      stdoutFile.end()
      stderrFile.end()
      logDesktop(`Harness exited code=${code} signal=${signal}`)
      if (!backendStopping && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.loadURL(shellPage({ title: 'DeepSeek Harness 已停止', detail: stderr || `退出码：${code}`, actions: true }))
      }
    })
    child.once('error', error => {
      stderr = (stderr + `\n${error.stack || error.message}`).slice(-MAX_ERROR_OUTPUT)
    })
    logDesktop(`Starting Harness target=${target.label} port=${port} pid=${child.pid}`)
    await waitUntilReady(url, child, () => stderr)
    await mainWindow.loadURL(url)
    if (target.kind === 'kernel') kernelStore.confirmActive()
    logDesktop(`Harness ready url=${url}`)
    startUpdateChecks()
    if (process.env.DSH_DESKTOP_SMOKE_EXIT_MS) {
      console.log(`DSH_DESKTOP_READY ${url}`)
      setTimeout(() => app.quit(), Number(process.env.DSH_DESKTOP_SMOKE_EXIT_MS) || 2000)
    }
  } catch (error) {
    const detail = error instanceof Error ? error.stack || error.message : String(error)
    logDesktop(`Launch failed: ${detail}`)
    if (target?.kind === 'kernel' && kernelStore.rollbackProbation()) {
      logDesktop(`Kernel ${target.kernel.version} failed probation; rolling back and retrying`)
      retryAfterRollback = true
    } else {
      await mainWindow.loadURL(shellPage({ title: 'DeepSeek Harness 启动失败', detail, actions: true }))
    }
  } finally {
    booting = false
    if (retryAfterRollback) setTimeout(() => launchHarness(), 0)
  }
}

ipcMain.handle('desktop:retry', () => launchHarness())
ipcMain.handle('desktop:open-logs', () => shell.openPath(userDataPath('logs')))
ipcMain.handle('desktop:get-close-behavior', () => readDesktopSettings().closeBehavior)
ipcMain.handle('desktop:set-close-behavior', (_event, behavior) => setCloseBehavior(behavior))

const lock = app.requestSingleInstanceLock()
if (!lock) {
  app.quit()
} else {
  app.on('second-instance', showMainWindow)
  app.whenReady().then(() => {
    kernelStore = new KernelStore({ root: kernelStorageRoot(), ...bootstrapKernelLocation() })
    const updateConfig = readUpdateConfig()
    createWindow(() => launchHarness())
    createTray()
    runtimeNodeMajor().then(nodeMajor => {
      kernelUpdater = new KernelUpdater({
        store: kernelStore,
        manifestUrl: updateConfig.manifestUrl,
        publicKeyFile: join(__dirname, 'build', 'kernel-public-key.pem'),
        nodeExecutable: nodeExecutable(),
        nodeMajor,
        shellVersion: app.getVersion(),
        log: logDesktop
      })
    }).catch(error => logDesktop(`Kernel updater init failed: ${error.stack || error.message}`))
  })
}

app.on('before-quit', () => {
  quitting = true
  backendStopping = true
  stopBackend()
})

app.on('window-all-closed', () => app.quit())
