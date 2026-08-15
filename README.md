# DeepSeek Harness Desktop

Windows desktop shell with an independently updatable DeepSeek Harness kernel. Users install the Electron shell once; signed Harness kernels download in the background, pass an isolated startup probe, and activate atomically on the next launch.

Repository and release downloads: <https://github.com/li-02/deepseek-harness-desktop>

## Runtime model

- The installer contains one bootstrap kernel so the first launch works offline.
- Production runs `%LOCALAPPDATA%\DeepSeek Harness\kernel-runtime\versions\<version>` instead of a Git checkout.
- `%APPDATA%\DeepSeek Harness\harness-home-v2` owns user settings and sessions and survives kernel replacement.
- A downloaded kernel is verified with Ed25519 and SHA256 before extraction.
- The previous kernel remains available until the new kernel completes its first real startup. Failed probation rolls back automatically.
- `DSH_DESKTOP_HARNESS_ROOT` opts into a source checkout for local development only.

## Local development

```powershell
npm install
npm run runtime:prepare
npm run kernel:bootstrap
npm test
npm start
npm run dist
```

`harness-path.json` selects the source checkout used by `npm start`. A packaged application ignores it unless `DSH_DESKTOP_HARNESS_ROOT` is explicitly set.

## Kernel publishing

The repository public key is committed at `build/kernel-public-key.pem`. Its private key stays outside Git and must be stored as the `KERNEL_SIGNING_PRIVATE_KEY` GitHub Actions secret.

```powershell
npm run kernel:keygen
npm run kernel:release
```

`.github/workflows/kernel-release.yml` checks the latest public `@deepseek-ai/dsh` package every six hours. A new version produces a Windows x64 kernel archive, a signed `stable.json`, an immutable version release, and the floating `kernel-stable` channel asset consumed by installed clients.

The desktop shell has its own slower release channel. Pushing `desktop-v<package-version>` runs `.github/workflows/desktop-release.yml` and publishes the installer and portable executable.

## Local data

- Kernel versions: `%LOCALAPPDATA%\DeepSeek Harness\kernel-runtime`
- Settings, sessions, and logs: `%APPDATA%\DeepSeek Harness`
