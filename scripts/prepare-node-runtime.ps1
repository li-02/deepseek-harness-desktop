$ErrorActionPreference = 'Stop'
$version = '24.15.0'
$archiveName = "node-v$version-win-x64.zip"
$baseUrl = "https://nodejs.org/dist/v$version"
$projectRoot = Split-Path -Parent $PSScriptRoot
$runtimeDirectory = Join-Path $projectRoot 'runtime'
$temporaryRoot = Join-Path ([System.IO.Path]::GetTempPath()) "dsh-node-runtime-$PID"
$archive = Join-Path $temporaryRoot $archiveName

New-Item -ItemType Directory -Force $temporaryRoot | Out-Null
try {
  $checksums = Invoke-RestMethod "$baseUrl/SHASUMS256.txt"
  $line = ($checksums -split "`n" | Where-Object { $_ -match "\s+$([regex]::Escape($archiveName))\s*$" } | Select-Object -First 1)
  if (-not $line) { throw "Node checksum is missing for $archiveName" }
  $expected = ($line -split '\s+')[0].ToLowerInvariant()
  Invoke-WebRequest "$baseUrl/$archiveName" -OutFile $archive
  $sha256 = [System.Security.Cryptography.SHA256]::Create()
  $stream = [System.IO.File]::OpenRead($archive)
  try {
    $actual = ([System.BitConverter]::ToString($sha256.ComputeHash($stream))).Replace('-', '').ToLowerInvariant()
  } finally {
    $stream.Dispose()
    $sha256.Dispose()
  }
  if ($actual -ne $expected) { throw "Node runtime checksum mismatch: $actual" }
  Expand-Archive -LiteralPath $archive -DestinationPath $temporaryRoot -Force
  New-Item -ItemType Directory -Force $runtimeDirectory | Out-Null
  Copy-Item -LiteralPath (Join-Path $temporaryRoot "node-v$version-win-x64\node.exe") -Destination (Join-Path $runtimeDirectory 'node.exe') -Force
  Write-Output "Prepared Node $version runtime"
} finally {
  if ([System.IO.Directory]::Exists($temporaryRoot)) { [System.IO.Directory]::Delete($temporaryRoot, $true) }
}
