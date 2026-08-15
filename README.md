# DeepSeek Harness Desktop

[简体中文](README.md) | [English](README_EN.md)

DeepSeek Harness Desktop 是面向 Windows 的 DeepSeek Harness 桌面客户端。它将本地 Agent 运行环境封装为桌面应用，并让桌面外壳与 Harness 内核独立更新。

## 功能特性

- **开箱即用**：安装包内置初始 Harness 内核和 Node.js 运行时，首次启动无需额外配置开发环境。
- **桌面化体验**：自动启动本地 Harness 服务并在独立窗口中打开，窗口大小和位置会自动保存。
- **安全更新**：后台检查内核更新，并使用 Ed25519 签名和 SHA-256 摘要验证下载内容。
- **更新前检查**：新内核会在隔离环境中完成启动测试，通过后才会等待激活。
- **自动回滚**：更新后的内核首次启动失败时，应用会自动恢复到上一个可用版本。
- **数据持久化**：设置、会话和日志独立于内核保存，更新内核不会清除用户数据。
- **故障恢复**：启动失败页面提供重新启动和打开日志功能，方便排查问题。
- **单实例运行**：重复启动应用时会聚焦已有窗口，避免同时运行多个后台实例。

## 下载与安装

前往 [Releases](https://github.com/li-02/deepseek-harness-desktop/releases) 下载最新的 Windows x64 版本：

- `DeepSeek-Harness-Desktop-Setup-<version>-x64.exe`：安装版，适合日常使用。
- `DeepSeek-Harness-Desktop-Portable-<version>-x64.exe`：便携版，无需安装即可运行。

安装版按向导完成安装后，从桌面或开始菜单启动。便携版直接运行下载的可执行文件即可。

> Windows 或浏览器可能会提示该文件来自互联网。请确认文件来自本仓库的 GitHub Releases 页面后再运行。

## 使用指南

1. 启动 DeepSeek Harness Desktop。
2. 等待应用准备本地 Agent 运行时；首次启动可能需要稍长时间。
3. 在打开的 Harness 界面中完成服务配置、创建会话并开始使用。
4. 直接关闭窗口即可退出应用和本地后台服务。

应用启动后会在后台定期检查 Harness 内核更新。更新下载并验证完成后，将在下一次启动时自动启用，无需重新安装桌面客户端。

## 更新机制

- 安装包包含一个可离线启动的初始内核。
- 下载的内核只有在版本、兼容性、签名、文件哈希和启动检查全部通过后才会进入待更新状态。
- 待更新内核在下次启动时激活；首次实际启动成功后才会被确认为可用版本。
- 如果首次启动失败，应用会自动回滚，并暂时阻止再次启用该故障版本。
- 桌面客户端本身的更新需要从 Releases 页面下载新版本。

## 数据与日志

默认数据位置：

- Harness 设置和会话：`%APPDATA%\DeepSeek Harness\harness-home-v2`
- 桌面端日志：`%APPDATA%\DeepSeek Harness\logs`
- 内核版本与更新文件：`%LOCALAPPDATA%\DeepSeek Harness\kernel-runtime`

如果启动失败，可在错误页面选择“打开日志”。主要日志文件包括：

- `desktop.log`：桌面外壳、启动和更新记录。
- `harness.stdout.log`：Harness 标准输出。
- `harness.stderr.log`：Harness 错误输出。

## 常见问题

### 启动一直停留在加载页面

首次启动需要准备本地服务。若长时间没有完成，请关闭并重新启动应用；出现错误页面后，可打开日志查看具体原因。

### 更新后无法启动

应用会自动尝试回滚到上一个可用内核。如果仍然失败，请在错误页面打开日志，并在提交 Issue 时附上相关错误信息。

### 如何重置本地数据

退出应用后，备份并删除 `%APPDATA%\DeepSeek Harness` 可重置设置、会话和日志。此操作不可撤销，请先保留需要的数据。

## 本地开发

需要 Node.js、npm 和 PowerShell：

```powershell
npm install
npm run runtime:prepare
npm run kernel:bootstrap
npm test
npm start
```

生成 Windows 安装版和便携版：

```powershell
npm run dist
```

`harness-path.json` 用于选择开发模式下的 DeepSeek Harness 源码目录。打包后的应用默认忽略该文件；如需显式使用源码目录，可设置 `DSH_DESKTOP_HARNESS_ROOT`。

## 许可证

本项目许可证见 [LICENSE](LICENSE)，第三方组件声明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
