param([ValidateSet('start','stop','check')][string]$Action = 'start')
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$electron = Join-Path $root 'node_modules\electron\dist\electron.exe'
$profile = if ($env:YJT_PREVIEW_PROFILE) { [IO.Path]::GetFullPath($env:YJT_PREVIEW_PROFILE) } else { Join-Path $env:APPDATA 'yijian-toudi' }
$version = (Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
if (!(Test-Path -LiteralPath $electron -PathType Leaf)) { throw 'Electron dependency missing. Run pnpm install in the project first.' }
$sha = [Security.Cryptography.SHA256]::Create()
$key = [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($profile.ToLowerInvariant()))).Replace('-','').Substring(0,24)
$mutex = [Threading.Mutex]::new($false, "Local\YjtPreview$key")
if (!$mutex.WaitOne(10000)) { throw 'Another preview launcher is busy.' }
try {
  $processes = @(Get-CimInstance Win32_Process)
  $matches = @($processes | Where-Object { $_.ExecutablePath -eq $electron -and $_.CommandLine -like '*--yjt-local-preview*' -and $_.CommandLine.Contains($profile) -and $_.CommandLine -notlike '*--type=*' })
  if ($Action -eq 'check') { Write-Output "PREVIEW_CHECK_OK version=$version running=$($matches.Count)"; exit 0 }
  if ($Action -eq 'stop') {
    foreach ($item in $matches) {
      $p = Get-Process -Id $item.ProcessId -ErrorAction SilentlyContinue
      if ($p) {
        if (!$p.CloseMainWindow()) { throw "Preview PID $($p.Id) has no closable window. No unrelated process was stopped." }
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
  if (!$env:YJT_PREVIEW_PROFILE -and @($processes | Where-Object { ($_.Name -eq '一键投递.exe' -or ($_.ExecutablePath -eq $electron -and $_.CommandLine.Contains($root))) -and $_.CommandLine -notlike '*--type=*' -and ($_.CommandLine -notlike '*--user-data-dir=*' -or $_.CommandLine.Contains($profile)) }).Count -gt 0) {
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
    if ($p.MainWindowHandle -ne 0 -and $p.MainWindowTitle -like '*LOCAL PREVIEW*') { $ready = $true; break }
  }
  if (!$ready) { throw "Preview PID $($p.Id) did not show its ready window within 30 seconds. Process retained for diagnosis." }
  Write-Output "PREVIEW_STARTED version=$version pid=$($p.Id)"
} finally {
  $mutex.ReleaseMutex(); $mutex.Dispose(); $sha.Dispose()
}
