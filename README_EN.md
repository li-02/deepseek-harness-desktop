# DeepSeek Harness Desktop

[简体中文](README.md) | [English](README_EN.md)

DeepSeek Harness Desktop is a Windows desktop client for DeepSeek Harness. It packages the local agent runtime as a desktop application while allowing the desktop shell and Harness kernel to be updated independently.

## Features

- **Ready to use**: The package includes a bootstrap Harness kernel and Node.js runtime, so no development environment is required for the first launch.
- **Desktop experience**: Starts the local Harness service automatically and opens it in a dedicated window whose size and position are preserved.
- **Secure updates**: Checks for kernel updates in the background and verifies downloads with an Ed25519 signature and SHA-256 digest.
- **Pre-activation checks**: Tests every new kernel in an isolated environment before marking it ready for activation.
- **Automatic rollback**: Restores the previous working kernel if an updated kernel fails during its first real launch.
- **Persistent data**: Stores settings, sessions, and logs separately from the kernel so they survive kernel updates.
- **Failure recovery**: Provides restart and log shortcuts when the application fails to start.
- **Single-instance operation**: Focuses the existing window instead of starting multiple background instances.

## Download and installation

Download the latest Windows x64 release from the [Releases page](https://github.com/li-02/deepseek-harness-desktop/releases):

- `DeepSeek-Harness-Desktop-Setup-<version>-x64.exe`: Installer edition, recommended for everyday use.
- `DeepSeek-Harness-Desktop-Portable-<version>-x64.exe`: Portable edition that runs without installation.

For the installer edition, follow the setup wizard and launch the app from the desktop or Start menu. For the portable edition, run the downloaded executable directly.

> Windows or your browser may warn that the file was downloaded from the internet. Verify that it came from this repository's GitHub Releases page before running it.

## Usage guide

1. Launch DeepSeek Harness Desktop.
2. Wait while the app prepares the local agent runtime. The first launch may take a little longer.
3. Complete the service configuration, create a session, and start working in the Harness interface.
4. Close the window to exit both the application and its local background service.

After launch, the app periodically checks for Harness kernel updates in the background. A downloaded and verified update is activated automatically on the next launch, without reinstalling the desktop client.

## How updates work

- Each application package contains a bootstrap kernel that can start offline.
- A downloaded kernel is staged only after its version, compatibility, signature, file hash, and startup check all pass.
- A staged kernel is activated on the next launch and is confirmed only after its first real startup succeeds.
- If that startup fails, the app rolls back automatically and temporarily blocks the faulty version.
- Updates to the desktop client itself must be downloaded from the Releases page.

## Data and logs

Default locations:

- Harness settings and sessions: `%APPDATA%\DeepSeek Harness\harness-home-v2`
- Desktop logs: `%APPDATA%\DeepSeek Harness\logs`
- Kernel versions and update files: `%LOCALAPPDATA%\DeepSeek Harness\kernel-runtime`

If startup fails, select **Open Logs** on the error page. The main log files are:

- `desktop.log`: Desktop shell, startup, and update events.
- `harness.stdout.log`: Harness standard output.
- `harness.stderr.log`: Harness error output.

## Troubleshooting

### The app remains on the loading screen

The first launch needs time to prepare the local service. If it does not finish, close and reopen the app. If an error page appears, open the logs for the underlying error.

### The app does not start after an update

The app automatically attempts to roll back to the previous working kernel. If the problem persists, open the logs from the error page and include the relevant error details when filing an issue.

### Resetting local data

Exit the app, then back up and remove `%APPDATA%\DeepSeek Harness` to reset settings, sessions, and logs. This operation cannot be undone, so preserve any data you need first.

## Local development

Node.js, npm, and PowerShell are required:

```powershell
npm install
npm run runtime:prepare
npm run kernel:bootstrap
npm test
npm start
```

Build the Windows installer and portable editions:

```powershell
npm run dist
```

`harness-path.json` selects the DeepSeek Harness source directory in development mode. Packaged applications ignore this file by default; set `DSH_DESKTOP_HARNESS_ROOT` to explicitly use a source directory.

## License

See [LICENSE](LICENSE) for this project's license and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for third-party notices.
