param([ValidateSet('start','stop','check')][string]$Action = 'start')
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$electron = Join-Path $root 'node_modules\electron\dist\electron.exe'
# PREVIEW_PROFILE_HELPERS_START
function Normalize-PreviewProfilePath([string]$Value) {
  $full = [IO.Path]::GetFullPath($Value)
  if ($full.Length -gt [IO.Path]::GetPathRoot($full).Length) { return $full.TrimEnd([char[]]@([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)) }
  return $full
}
function Resolve-PreviewProfile([string]$Root, [string]$AppData, [string]$Override) {
  if ($Override) { return Normalize-PreviewProfilePath $Override }
  $preference = Join-Path $Root '.local-data\local-preview-profile.json'
  try { $preferenceItem = Get-Item -LiteralPath $preference -Force -ErrorAction Stop }
  catch [System.Management.Automation.ItemNotFoundException] { return Join-Path $AppData 'yijian-toudi' }
  if ($preferenceItem.PSIsContainer -or ($preferenceItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Invalid local preview preference file. Original data was not opened.' }
  $choice = Get-Content -LiteralPath $preference -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($choice.schemaVersion -ne 1 -or $choice.profile -isnot [string] -or !$choice.profile) { throw 'Invalid local preview profile preference. Original data was not opened.' }
  $selected = Normalize-PreviewProfilePath $choice.profile
  $base = Normalize-PreviewProfilePath (Join-Path $Root '.local-data')
  if (!$selected.StartsWith($base + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or !(Test-Path -LiteralPath (Join-Path $selected 'state.json') -PathType Leaf)) { throw 'Preferred preview profile is missing or outside local data. Original data was not opened.' }
  $cursor = [IO.DirectoryInfo]::new($selected)
  while ($cursor) {
    if (($cursor.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Preferred preview profile contains a reparse point.' }
    if ($cursor.FullName -eq $base) { break }
    $cursor = $cursor.Parent
  }
  $stateItem = Get-Item -LiteralPath (Join-Path $selected 'state.json') -Force
  if (($stateItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Preferred preview state contains a reparse point.' }
  return $selected
}
function Test-PreviewProcessProfile([string]$CommandLine, [string]$ExpectedProfile, [string]$DefaultProfile) {
  if (!$CommandLine) { return $false }
  if ($CommandLine -notlike '*--user-data-dir=*') { return (Normalize-PreviewProfilePath $ExpectedProfile) -eq (Normalize-PreviewProfilePath $DefaultProfile) }
  $match = [regex]::Match($CommandLine, '(?i)(?:^|\s)(?:"--user-data-dir=(?<whole>[^"]+)"|--user-data-dir="(?<value>[^"]+)"|--user-data-dir=(?<plain>[^\s"]+))(?=\s|$)')
  if (!$match.Success) { return $false }
  $value = @('whole','value','plain') | ForEach-Object { $match.Groups[$_].Value } | Where-Object { $_ } | Select-Object -First 1
  return (Normalize-PreviewProfilePath $value) -eq (Normalize-PreviewProfilePath $ExpectedProfile)
}
# END_PREVIEW_PROFILE_HELPERS
$profile = Resolve-PreviewProfile $root $env:APPDATA $env:YJT_PREVIEW_PROFILE
$defaultProfile = Join-Path $env:APPDATA 'yijian-toudi'
$version = (Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
if (!(Test-Path -LiteralPath $electron -PathType Leaf)) { throw 'Electron dependency missing. Run pnpm install in the project first.' }
$sha = [Security.Cryptography.SHA256]::Create()
$key = [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($profile.ToLowerInvariant()))).Replace('-','').Substring(0,24)
$mutex = [Threading.Mutex]::new($false, "Local\YjtPreview$key")
if (!$mutex.WaitOne(10000)) { throw 'Another preview launcher is busy.' }
try {
  $processes = @(Get-CimInstance Win32_Process)
  $matches = @($processes | Where-Object { $_.ExecutablePath -eq $electron -and $_.CommandLine -like '*--yjt-local-preview*' -and (Test-PreviewProcessProfile $_.CommandLine $profile $defaultProfile) -and $_.CommandLine -notlike '*--type=*' })
  if ($Action -eq 'check') { Write-Output "PREVIEW_CHECK_OK version=$version running=$($matches.Count)"; exit 0 }
  . (Join-Path $PSScriptRoot 'preview-window.ps1')
  if ($Action -eq 'stop') {
    foreach ($item in $matches) {
      $p = Get-Process -Id $item.ProcessId -ErrorAction SilentlyContinue
      if ($p) {
        if (![YjtPreviewNativeWindow]::Close([uint32]$p.Id)) { throw "Preview PID $($p.Id) has no uniquely identified, enabled preview window. Original process retained." }
        if (!$p.WaitForExit(15000)) { throw "Preview PID $($p.Id) is still closing. Preserve it and retry after reviewing the window." }
      }
    }
    Write-Output "PREVIEW_STOPPED count=$($matches.Count)"; exit 0
  }
  if ($matches.Count -gt 0) {
    if ($env:YJT_PREVIEW_CDP_PORT -and $matches[0].CommandLine -notlike '*--remote-debugging-port=*') { throw 'AI_PREVIEW_RESTART_REQUIRED: close normal preview, then launch AI preview.' }
    Write-Output "PREVIEW_ALREADY_RUNNING pid=$($matches[0].ProcessId) sourceVersion=$version"; exit 0
  }
  # Do not open a second writer on the installed app's profile.
  if (@($processes | Where-Object { $_.CommandLine -and ($_.Name -eq '一键投递.exe' -or ($_.ExecutablePath -eq $electron -and $_.CommandLine.Contains($root))) -and $_.CommandLine -notlike '*--type=*' -and (Test-PreviewProcessProfile $_.CommandLine $profile $defaultProfile) }).Count -gt 0) {
    throw 'Close the existing One-click Application window before starting local preview.'
  }
  $arguments = @(('"' + $root + '"'), '--yjt-local-preview', ('"--user-data-dir=' + $profile + '"'))
  if ($env:YJT_PREVIEW_CDP_PORT) {
    $arguments += ('--remote-debugging-port=' + [int]$env:YJT_PREVIEW_CDP_PORT)
    $arguments += '--remote-debugging-address=127.0.0.1'
  }
  $oldNodeMode = $env:ELECTRON_RUN_AS_NODE; $oldBackground = $env:YIJIAN_BACKGROUND_TEST
  try {
    Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
    Remove-Item Env:YIJIAN_BACKGROUND_TEST -ErrorAction SilentlyContinue
    $p = Start-Process -FilePath $electron -ArgumentList $arguments -WorkingDirectory $root -WindowStyle Normal -PassThru
  } finally {
    $env:ELECTRON_RUN_AS_NODE = $oldNodeMode; $env:YIJIAN_BACKGROUND_TEST = $oldBackground
  }
  $ready = $false
  for ($i=0; $i -lt 100; $i++) {
    Start-Sleep -Milliseconds 300; $p.Refresh()
    if ($p.HasExited) { throw "Preview exited early: $($p.ExitCode)" }
    if ([YjtPreviewNativeWindow]::ReadyHandle([uint32]$p.Id) -ne 0) { $ready = $true; break }
  }
  if (!$ready) { throw "Preview PID $($p.Id) did not show its ready window within 30 seconds. Process retained for diagnosis." }
  Write-Output "PREVIEW_STARTED version=$version pid=$($p.Id)"
} finally {
  $mutex.ReleaseMutex(); $mutex.Dispose(); $sha.Dispose()
}
