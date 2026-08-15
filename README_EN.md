# DeepSeek Harness Desktop

[简体中文](README.md) | [English](README_EN.md)

DeepSeek Harness Desktop is a Windows desktop app that lets you use DeepSeek Harness — a powerful AI assistant workbench — on your own computer, with no programming knowledge required. Just install it and open it: everything is set up for you automatically.

## What it does for you

- **Ready to use**: No need to install Node.js or any development environment.
- **Feels like a normal app**: Launches the Harness workbench in its own window and remembers the window size and position.
- **Automatic updates**: Checks for core updates in the background — no manual work, just restart the app when asked.
- **Rolls back if an update fails**: If the app can't start after an update, it automatically restores the last working version.
- **Your data is safe**: Settings, sessions, and logs are stored separately and survive updates.
- **Single window**: Launching the app again focuses the existing window instead of starting extra background instances.

## Download and install

Download the latest Windows x64 version from the [Releases page](https://github.com/li-02/deepseek-harness-desktop/releases). There are two options:

- **Installer** (`DeepSeek-Harness-Desktop-Setup-<version>-x64.exe`): Follow the setup wizard, then launch the app from the desktop or Start menu. Recommended for most people.
- **Portable** (`DeepSeek-Harness-Desktop-Portable-<version>-x64.exe`): No installation needed — just run the downloaded file. Great for temporary use or a USB stick.

> Note: Windows or your browser may warn that the file was downloaded from the internet. As long as it came from the GitHub Releases page above, it's safe to run.

## First-time use

1. Double-click to launch DeepSeek Harness Desktop.
2. The first launch takes a little longer while the runtime is prepared — please be patient.
3. Once open, you'll see the Harness workbench: create a session, chat with the AI, or schedule tasks.
4. Close the window to quit — the app and its background service stop together.

## Plugin store: add new features to the workbench

Just like an app store on your phone, the Harness workbench has a built-in **plugin store** where you can add new capabilities (such as memory, tools, and more).

How to open it: click the **Settings** button in the workbench, go to **Plugins**, then switch to the **Plugin store** tab.

- **Browse and search**: Filter by category, or use the search box to find plugins by name, author, or description.
- **Install a plugin**: Click **Install** on a plugin, check the box acknowledging it's a third-party plugin (meaning it isn't made by the official team — make sure you trust it), then click **Confirm install**.
- **Restart to activate**: After installation, restart the app so the new plugin can load.
- **See what's installed**: Switch to the **Plugin list** tab to view the plugins currently installed.

> Note: Most plugins in the store are made by community developers. Before installing, read the description, check the source, and make sure you trust it.

## About automatic updates

- The app checks for updates quietly in the background. Once an update is downloaded and verified, it takes effect on **the next launch** — no reinstallation needed.
- If the app fails to start after an update, it automatically rolls back to the last working version.
- Major updates to the desktop client itself must be downloaded from the Releases page.

## Troubleshooting

### Stuck on the loading screen

The first launch needs time to prepare the local service. If it takes too long, close and reopen the app. If an error page appears, click **Open Logs** to see what went wrong.

### The app won't start after an update

The app automatically tries to roll back to the last working version. If it still fails, open the logs from the error page and include them when filing an issue.

### Resetting local data

Exit the app, then back up and delete the `%APPDATA%\DeepSeek Harness` folder to reset settings, sessions, and logs. This cannot be undone, so make sure you keep anything you need.

## Where data and logs live

- Harness settings and sessions: `%APPDATA%\DeepSeek Harness\harness-home-v2`
- Desktop logs: `%APPDATA%\DeepSeek Harness\logs`
- Kernel versions and update files: `%LOCALAPPDATA%\DeepSeek Harness\kernel-runtime`

Main log files:

- `desktop.log`: App startup and update events.
- `harness.stdout.log` / `harness.stderr.log`: Harness runtime output and errors.

## License

See [LICENSE](LICENSE) for this project's license and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for third-party notices.
