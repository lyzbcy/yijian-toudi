'use strict';
// Explicit integration: real current-version NSIS default-path install/reinstall.
// No /D override and no native UI clicks; GUI acceptance remains separate.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {execFileSync}=require('node:child_process'),{_electron:electron}=require('playwright-core');
const {readInstallation,shaFile}=require('../electron/windows-update.cjs'),{JsonStore}=require('../electron/store.cjs');
const root=path.resolve(__dirname,'..'),pkg=require('../package.json');
const ps=code=>execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from("$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue';[Console]::OutputEncoding=New-Object Text.UTF8Encoding $false;"+code,'utf16le').toString('base64')],{windowsHide:true,encoding:'utf8',timeout:240000}).trim();
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<120;i++){if(await fn())return;await delay(250);}throw Error('Default installation cleanup timed out');}
(async()=>{
 assert.equal(process.platform,'win32');assert.equal(await readInstallation(),null,'Preserve existing registered installation');
 const info=JSON.parse(ps(`Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public static class TaskDefaultFolders{[DllImport("shell32.dll")]public static extern int SHGetKnownFolderPath([MarshalAs(UnmanagedType.LPStruct)]Guid id,uint flags,IntPtr token,out IntPtr value);}';$ptr=[IntPtr]::Zero;$status=[TaskDefaultFolders]::SHGetKnownFolderPath([Guid]'5CD7AEE2-2219-4A67-B85D-6C9CE15660CB',0,[IntPtr]::Zero,[ref]$ptr);$programFiles=Join-Path $env:LOCALAPPDATA 'Programs';try{if($status-eq 0){$programFiles=[Runtime.InteropServices.Marshal]::PtrToStringUni($ptr)}}finally{if($ptr-ne [IntPtr]::Zero){[Runtime.InteropServices.Marshal]::FreeCoTaskMem($ptr)}};@{userPrograms=$programFiles;programs=[Environment]::GetFolderPath('Programs');desktop=[Environment]::GetFolderPath('Desktop');cache=(Join-Path $env:LOCALAPPDATA 'yijian-toudi-updater\\installer.exe');privateKeyExists=(Test-Path -LiteralPath 'HKCU:\\Software\\3c9e6782-3db2-56c2-b59b-7731dce81b79')}|ConvertTo-Json -Compress`));
 assert.equal(info.privateKeyExists,false,'Preserve any prior private installer registration');
 const allowedRoots=[pkg.build.productName,pkg.name].map(name=>path.resolve(info.userPrograms,name));
 for(const directory of allowedRoots)assert.equal(fs.existsSync(directory),false,'Preserve pre-existing default installation directory');
 const builderLib=path.dirname(require.resolve('app-builder-lib',{paths:[path.dirname(require.resolve('electron-builder'))]}));
 const directoryName=require(path.join(builderLib,'targets/targetUtil.js')).getWindowsInstallationDirName({productFilename:pkg.build.productName,sanitizedName:pkg.name},true);
 const expectedRoot=path.resolve(info.userPrograms,directoryName),base=fs.mkdtempSync(path.join(root,'verification/2026-10-04-recovery/install-smoke-default-')),profile=path.join(base,'isolated-profile');
 const preserved=[path.join(info.programs,'一键投递.lnk'),path.join(info.desktop,'一键投递.lnk'),info.cache].map(file=>({file,bytes:fs.existsSync(file)?fs.readFileSync(file):null}));
 for(const [i,item]of preserved.entries())if(item.bytes)fs.writeFileSync(path.join(base,`preserved-${i}.bin`),item.bytes);
 const fixture=new JsonStore(profile);fixture.init();fixture.update(s=>{s.settings.kimiBridgeEnabled=false;s.settings.autoCheckUpdates=false;s.settings.jobs.autoRefresh=false;s.settings.apiPort=0;return s;});
 const installer=path.join(root,'release',`yijian-toudi-setup-${pkg.version}.exe`),installerHash=await shaFile(installer),operationFile=path.join(base,'operation.json');
 function operation(exe,args){fs.writeFileSync(operationFile,JSON.stringify({exe,args}));return ps(`$o=Get-Content -Raw -Encoding UTF8 -LiteralPath '${operationFile.replaceAll("'","''")}'|ConvertFrom-Json;$p=Start-Process -FilePath $o.exe -ArgumentList $o.args -WindowStyle Hidden -Wait -PassThru;$p.ExitCode`);}
 const report={version:pkg.version,mode:'real-nsis-default-path-no-D-override',installerHash,expectedRoot,fixtureOnly:true,guiClicks:false,checks:[],ok:false};let app;
 try{
  assert.equal(operation(installer,'/S /currentuser /DESKTOP=0'),'0');
  let record=await readInstallation();assert.equal(path.resolve(record.root),expectedRoot);assert.equal(record.version,pkg.version);assert.equal(record.desktop,false);
  assert.equal(fs.existsSync(path.join(info.programs,'一键投递.lnk')),true);assert.equal(fs.existsSync(path.join(info.desktop,'一键投递.lnk')),preserved[1].bytes!==null);
  report.checks.push('Default user-programs installation without /D, version/registration and start-menu entry verified; desktop preference disabled');
  const executable=path.join(expectedRoot,'一键投递.exe');
  app=await electron.launch({executablePath:executable,args:[`--user-data-dir=${profile}`],env:{...process.env,YIJIAN_BACKGROUND_TEST:'0'}});
  let page=await app.firstWindow();page.setDefaultTimeout(20000);await page.locator('#onboardingDialog[open]').waitFor();await page.locator('[data-recruit="social"]').click();await page.locator('#onboardingDialog[open]').waitFor({state:'hidden'});
  await page.locator('.sidebar [data-page="resume"]').click();await page.locator('[name="education.0.school"]').fill('默认目录安装验收样本大学');await page.locator('#saveResumeButton').click();await page.waitForFunction(async()=> (await window.oneClick.getState()).resume.education[0].school==='默认目录安装验收样本大学');
  const before=await page.evaluate(()=>window.oneClick.getState());assert.equal(await page.locator('#appVersion').textContent(),pkg.version);report.checks.push('Actual installed visible app completed onboarding and persisted sample resume through UI');
  await app.close();app=null;
  assert.equal(operation(installer,'/S /currentuser /DESKTOP=1'),'0');record=await readInstallation();assert.equal(path.resolve(record.root),expectedRoot);assert.equal(record.desktop,true);assert.equal(fs.existsSync(path.join(info.desktop,'一键投递.lnk')),true);
  report.checks.push('Same-version default-path reinstall enabled desktop shortcut and retained registration path');
  app=await electron.launch({executablePath:executable,args:[`--user-data-dir=${profile}`],env:{...process.env,YIJIAN_BACKGROUND_TEST:'0'}});page=await app.firstWindow();await page.locator('.hero-card').waitFor();await page.locator('.sidebar [data-page="resume"]').click();assert.equal(await page.locator('[name="education.0.school"]').inputValue(),'默认目录安装验收样本大学');const after=await page.evaluate(()=>window.oneClick.getState());assert.equal(after.settings.apiToken,before.settings.apiToken);
  report.checks.push('Reinstalled actual app reopened with retained sample resume and private API credential');
  await app.close();app=null;report.ok=true;
 }catch(error){report.error=error.message;throw error;}
 finally{
  await app?.close().catch(()=>{});const record=await readInstallation();
  if(record&&allowedRoots.includes(path.resolve(record.root))){assert.equal(operation(path.join(record.root,'Uninstall 一键投递.exe'),'/S /currentuser'),'0');await until(async()=>await readInstallation()===null);assert.equal(fs.existsSync(path.join(profile,'state.json')),true);report.checks.push('Actual uninstaller removed default installation and retained isolated user data');}
  for(const item of preserved){if(item.bytes){fs.mkdirSync(path.dirname(item.file),{recursive:true});fs.writeFileSync(item.file,item.bytes);assert.deepEqual(fs.readFileSync(item.file),item.bytes);}else if(fs.existsSync(item.file))fs.unlinkSync(item.file);assert.equal(fs.existsSync(item.file),item.bytes!==null);}
  report.checks.push('Original desktop/start-menu shortcuts and installer cache restored byte-for-byte');fs.writeFileSync(path.join(base,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({ok:report.ok,version:pkg.version,checks:report.checks.length,report:path.join(base,'report.json'),error:report.error}));
 }
})().catch(error=>{console.error(error.message);process.exitCode=1;});
