param([Parameter(Mandatory=$true)][string]$PayloadFile)
$ErrorActionPreference='Stop'
$p=$null;$committed=$false;$backupReady=$false;$installerStarted=$false
$guid='3c9e6782-3db2-56c2-b59b-7731dce81b79'
$uninstallKey='HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\'+$guid
$installKey='HKCU:\Software\'+$guid
function HashFile([string]$file){$stream=[IO.File]::OpenRead($file);$hash=[Security.Cryptography.SHA256]::Create();try{return [BitConverter]::ToString($hash.ComputeHash($stream)).Replace('-','').ToLowerInvariant()}finally{$stream.Dispose();$hash.Dispose()}}
function WriteJson([string]$file,$value){[IO.File]::WriteAllText($file,($value|ConvertTo-Json -Depth 8 -Compress),(New-Object Text.UTF8Encoding $false))}
function KnownRoot {
 $full=[IO.Path]::GetFullPath($p.root).TrimEnd('\');$exe=[IO.Path]::GetFullPath($p.oldExe)
 if($full.Length -lt 10 -or $full -ne [IO.Path]::GetDirectoryName($exe) -or [IO.Path]::GetFileName($exe) -ne '一键投递.exe'){throw 'invalid-install-root'}
 if($full -eq [IO.Path]::GetPathRoot($full).TrimEnd('\') -or $full -eq $env:USERPROFILE -or $full -eq $env:WINDIR){throw 'invalid-root-boundary'}
 return $full
}
try {
 $p=[IO.File]::ReadAllText($PayloadFile,[Text.Encoding]::UTF8)|ConvertFrom-Json
 $root=KnownRoot
 $record=Get-ItemProperty -LiteralPath $uninstallKey
 if($record.DisplayVersion -ne $p.oldVersion -or $record.InstallLocation.TrimEnd('\') -ne $root){throw 'old-installation-record-mismatch'}
 if(!(Test-Path -LiteralPath $p.oldExe -PathType Leaf) -or (HashFile $p.file) -ne $p.sha256){throw 'update-package-hash-mismatch'}
 if(([IO.Path]::GetFullPath($p.userData)).StartsWith($root+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'user-data-inside-install-root'}
 if((Get-Item -LiteralPath $root).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'install-root-reparse-point'}
 if(@(Get-ChildItem -LiteralPath $root -Recurse -Force|Where-Object {$_.Attributes -band [IO.FileAttributes]::ReparsePoint}).Count){throw 'install-tree-reparse-point'}
 $all=@(Get-CimInstance Win32_Process);$owned=@([int]$p.pid)
 do{$before=$owned.Count;$owned+=@($all|Where-Object {$owned -contains [int]$_.ParentProcessId -and $owned -notcontains [int]$_.ProcessId}|ForEach-Object {[int]$_.ProcessId})}while($owned.Count-ne$before)
 if(@($all|Where-Object {$_.Name-eq'一键投递.exe'-and$owned-notcontains[int]$_.ProcessId}).Count){throw 'another-product-process-is-running'}
 WriteJson $p.readyFile @{status='ready';nonce=$p.nonce;version=$p.version;pid=$PID}
 $deadline=[DateTime]::UtcNow.AddSeconds(45)
 while(!(Test-Path -LiteralPath $p.commitFile)){if((Test-Path -LiteralPath $p.abortFile)-or[DateTime]::UtcNow-gt$deadline){exit 1};Start-Sleep -Milliseconds 100}
 if((Test-Path -LiteralPath $p.abortFile)-or[IO.File]::ReadAllText($p.commitFile)-ne$p.nonce){exit 1}
 $committed=$true
 WriteJson (Join-Path $p.attempt 'commit-ack.json') @{status='committed';nonce=$p.nonce}
 $old=Get-Process -Id $p.pid -ErrorAction SilentlyContinue
 if($old -and !$old.WaitForExit(60000)){throw 'old-process-did-not-exit'}
 if(Test-Path -LiteralPath $p.abortFile){exit 1}
 $waitChildren=[DateTime]::UtcNow.AddSeconds(10)
 while(@(Get-CimInstance Win32_Process|Where-Object {$_.Name-eq'一键投递.exe'}).Count){if([DateTime]::UtcNow-gt$waitChildren){throw 'another-installed-instance-is-running'};Start-Sleep -Milliseconds 250}
 # Backup the complete flat electron-builder root before NSIS replaces files.
 # No copy/delete crosses shells. All recursive moves are exactly this verified root.
 $backupRoot=Join-Path $p.attempt 'backup-root'
 Copy-Item -LiteralPath $root -Destination $backupRoot -Recurse
 $snapshot=@(Get-ChildItem -LiteralPath $root -Recurse -File -Force|ForEach-Object {@{relative=$_.FullName.Substring($root.Length+1);hash=HashFile $_.FullName}})
 foreach($row in $snapshot){if((HashFile (Join-Path $backupRoot $row.relative))-ne$row.hash){throw 'backup-hash-mismatch'}}
 WriteJson (Join-Path $p.attempt 'backup-hashes.json') $snapshot
 & reg.exe export ('HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\'+$guid) (Join-Path $p.attempt 'uninstall.reg') /y | Out-Null
 if($LASTEXITCODE-ne0){throw 'registry-backup-failed'}
 & reg.exe export ('HKCU\Software\'+$guid) (Join-Path $p.attempt 'install.reg') /y | Out-Null
 if($LASTEXITCODE-ne0){throw 'registry-backup-failed'}
 $links=@((Join-Path ([Environment]::GetFolderPath('Programs')) '一键投递.lnk'),(Join-Path ([Environment]::GetFolderPath('Desktop')) '一键投递.lnk'))
 $linkRows=@();foreach($link in $links){$copy=Join-Path $p.attempt ('link-'+$linkRows.Count+'.lnk');$existed=Test-Path -LiteralPath $link;if($existed){Copy-Item -LiteralPath $link -Destination $copy};$linkRows+=@{path=$link;backup=$copy;existed=$existed}}
 $cache=Join-Path $env:LOCALAPPDATA 'yijian-toudi-updater\installer.exe';$cacheExisted=Test-Path -LiteralPath $cache
 if($cacheExisted){Copy-Item -LiteralPath $cache -Destination (Join-Path $p.attempt 'previous-cache.exe')}
 $backupReady=$true
 if((HashFile $p.file)-ne$p.sha256){throw 'update-package-changed-after-backup'}
 $installerStarted=$true
 $installer=Start-Process -FilePath $p.file -ArgumentList ('/S /currentuser --updated /D='+$root) -WindowStyle Hidden -PassThru -Wait
 if($installer.ExitCode-ne0){throw ('installer-exit-'+$installer.ExitCode)}
 $record=Get-ItemProperty -LiteralPath $uninstallKey
 if($record.DisplayVersion-ne$p.version-or$record.InstallLocation.TrimEnd('\')-ne$root-or!(Test-Path -LiteralPath $p.oldExe -PathType Leaf)){throw 'installed-version-or-directory-mismatch'}
 $wsh=New-Object -ComObject WScript.Shell
 if(!(Test-Path -LiteralPath $links[0])-or$wsh.CreateShortcut($links[0]).TargetPath-ne$p.oldExe){throw 'start-menu-target-mismatch'}
 $desktop=(Get-ItemProperty -LiteralPath $installKey).DesktopShortcut-eq1
 if($desktop -ne [bool]$p.desktop){throw 'desktop-preference-changed'}
 if($desktop-and(!(Test-Path -LiteralPath $links[1])-or$wsh.CreateShortcut($links[1]).TargetPath-ne$p.oldExe)){throw 'desktop-target-mismatch'}
 WriteJson $p.resultFile @{status='installed';version=$p.version;nonce=$p.nonce;exe=$p.oldExe;root=$root;backup=$backupRoot;shortcuts=$links;desktop=$desktop}
 # Interactive app must be visible. Pass the exact existing profile, not a shell command.
 Start-Process -FilePath $p.oldExe -ArgumentList ('"--user-data-dir='+$p.userData+'"') -WindowStyle Normal | Out-Null
} catch {
 $message=$_.Exception.Message;$restored=$false;$restoreError=$null
 if($p-and$backupReady-and$installerStarted){
  try {
   $root=KnownRoot
   $failed=Join-Path $p.attempt 'failed-install-root'
   if(Test-Path -LiteralPath $root){Move-Item -LiteralPath $root -Destination $failed}
   Copy-Item -LiteralPath $backupRoot -Destination $root -Recurse
   foreach($row in $snapshot){if((HashFile (Join-Path $root $row.relative))-ne$row.hash){throw 'restored-file-hash-mismatch'}}
   foreach($key in @($uninstallKey,$installKey)){if(Test-Path -LiteralPath $key){Remove-Item -LiteralPath $key -Recurse}}
   & reg.exe import (Join-Path $p.attempt 'uninstall.reg') | Out-Null;if($LASTEXITCODE-ne0){throw 'registry-restore-failed'}
   & reg.exe import (Join-Path $p.attempt 'install.reg') | Out-Null;if($LASTEXITCODE-ne0){throw 'registry-restore-failed'}
   foreach($s in $linkRows){if($s.existed){Copy-Item -LiteralPath $s.backup -Destination $s.path -Force}else{if(Test-Path -LiteralPath $s.path){Remove-Item -LiteralPath $s.path}}}
   if($cacheExisted){Copy-Item -LiteralPath (Join-Path $p.attempt 'previous-cache.exe') -Destination $cache -Force}else{if(Test-Path -LiteralPath $cache){Remove-Item -LiteralPath $cache}}
   $restored=$true
  }catch{$restoreError=$_.Exception.Message}
 }
 if($p-and$p.resultFile){WriteJson $p.resultFile @{status='failed';version=$p.version;nonce=$p.nonce;message=$message;restored=$restored;restoreError=$restoreError}}
 if($p-and$committed-and(!(Get-Process -Id $p.pid -ErrorAction SilentlyContinue))-and(Test-Path -LiteralPath $p.oldExe -PathType Leaf)){
  Start-Process -FilePath $p.oldExe -ArgumentList ('"--user-data-dir='+$p.userData+'"') -WindowStyle Normal | Out-Null
 }
 exit 1
}
