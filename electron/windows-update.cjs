'use strict';
const fs=require('node:fs/promises'),nativeFs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawn,execFile}=require('node:child_process');
const {compareVersions}=require('./update-release.cjs');
const GUID='3c9e6782-3db2-56c2-b59b-7731dce81b79';
const delay=ms=>new Promise(r=>setTimeout(r,ms)),quote=s=>"'"+s.replaceAll("'","''")+"'";
const shaFile=file=>new Promise((resolve,reject)=>{const h=crypto.createHash('sha256'),stream=nativeFs.createReadStream(file);stream.on('data',c=>h.update(c)).on('error',reject).on('end',()=>resolve(h.digest('hex')));});
function inside(parent,child){const r=path.relative(parent,child);return r===''||(!r.startsWith('..'+path.sep)&&r!=='..'&&!path.isAbsolute(r));}
function validPath(p){return typeof p==='string'&&path.isAbsolute(p)&&!/[\x00-\x1f"]/.test(p);}
async function readInstallation({execFileFn=execFile}={}){
 const code=`$ErrorActionPreference='Stop';[Console]::OutputEncoding=New-Object Text.UTF8Encoding $false;$OutputEncoding=[Console]::OutputEncoding;try{$r=Get-ItemProperty -LiteralPath 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${GUID}';$i=Get-ItemProperty -LiteralPath 'HKCU:\\Software\\${GUID}';@{root=$r.InstallLocation;version=$r.DisplayVersion;desktop=($i.DesktopShortcut -eq 1)}|ConvertTo-Json -Compress}catch{'null'}`;
 return new Promise((resolve,reject)=>execFileFn('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(code,'utf16le').toString('base64')],{windowsHide:true,timeout:10000,encoding:'utf8'},(e,out)=>{if(e)return reject(e);try{resolve(JSON.parse(out.trim().replace(/^\uFEFF/,'')));}catch{reject(Error('installation-record-invalid'));}}));
}
function installationMatches(record,{executable,current,platform,arch,packaged,userData}){
 return platform==='win32'&&arch==='x64'&&packaged&&record?.version===current&&validPath(record.root)&&validPath(executable)&&validPath(userData)&&path.basename(executable)==='一键投递.exe'&&path.resolve(record.root)===path.dirname(path.resolve(executable))&&!inside(record.root,userData);
}
async function validateStagedUpdate(staged,{directory,current}){
 if(!staged?.ok||!staged.staged||staged.installed||!staged.shaOk||!staged.shaChecked||compareVersions(staged.version,current)!==1||!validPath(staged.file)||!inside(directory,staged.file)||path.basename(staged.file)!==`yijian-toudi-setup-${staged.version}.exe`||!/^[a-f\d]{64}$/.test(staged.sha256)||!Number.isSafeInteger(staged.bytes)||staged.bytes<=0)throw Error('verified-update-required');
 const stat=await fs.lstat(staged.file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==staged.bytes||await shaFile(staged.file)!==staged.sha256)throw Error('staged-update-changed');return staged;
}
async function launchUpdateHelper(payload,directory,{spawnFn=spawn,timeoutMs=15000,templatePath=path.join(__dirname,'install-update.ps1')}={}){
 if(![payload.root,payload.oldExe,payload.file,payload.userData].every(validPath)||!Number.isInteger(payload.pid)||payload.pid<=0||compareVersions(payload.version,payload.oldVersion)!==1||!/^[a-f\d]{64}$/.test(payload.sha256))throw Error('helper-payload-invalid');
 await fs.mkdir(directory,{recursive:true});const attempt=await fs.mkdtemp(path.join(directory,'install-')),nonce=crypto.randomBytes(24).toString('hex');
 const readyFile=path.join(attempt,'ready.json'),commitFile=path.join(attempt,'commit'),abortFile=path.join(attempt,'abort'),scriptFile=path.join(attempt,'worker.ps1'),payloadFile=path.join(attempt,'payload.json'),resultFile=path.join(directory,'install-result.json'),pendingFile=path.join(directory,'install-pending.json');
 const data={...payload,attempt,nonce,readyFile,commitFile,abortFile,resultFile};await fs.writeFile(scriptFile,'\uFEFF'+(await fs.readFile(templatePath,'utf8')).replace(/^\uFEFF/,''));await fs.writeFile(payloadFile,JSON.stringify(data));
 const workerErrorFile=path.join(attempt,'worker-stderr.log'),entry=`$ErrorActionPreference='Stop';try{& ${quote(scriptFile)} -PayloadFile ${quote(payloadFile)}}catch{[IO.File]::WriteAllText(${quote(workerErrorFile)},$_.ToString());exit 1}`;
 const args='-NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand '+Buffer.from(entry,'utf16le').toString('base64');
 const bootstrap=`$ErrorActionPreference='Stop';$child=Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList ${quote(args)} -WindowStyle Hidden -PassThru;$child.Id`;
 let child,ended=null,launchError=null,stderr='';
 const abort=async()=>{await fs.writeFile(abortFile,nonce);};
 try{
  child=spawnFn('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(bootstrap,'utf16le').toString('base64')],{detached:false,stdio:['ignore','pipe','pipe'],windowsHide:true});child.stdout?.resume();child.stderr?.on('data',d=>stderr=(stderr+d).slice(-3000));child.once('error',e=>{launchError=e;});child.once('close',(code,signal)=>{ended={code,signal};});
  const end=Date.now()+timeoutMs;while(Date.now()<end){
   if(launchError)throw launchError;if(ended&&ended.code!==0)throw Error('helper-bootstrap-failed:'+stderr);
   let ready;try{ready=JSON.parse(await fs.readFile(readyFile,'utf8'));}catch{}
   if(ended?.code===0&&ready?.nonce===nonce&&ready.version===payload.version&&ready.status==='ready'&&Number.isInteger(ready.pid)&&ready.pid>0){
    let committed=false;return {attempt,helperPid:ready.pid,nonce,abort,commit:async()=>{if(committed)throw Error('helper-already-committed');if(nativeFs.existsSync(abortFile))throw Error('helper-aborted');process.kill(ready.pid,0);await fs.writeFile(pendingFile,JSON.stringify({nonce,version:payload.version,exe:payload.oldExe,attempt}));await fs.writeFile(commitFile,nonce);const limit=Date.now()+5000;while(Date.now()<limit){let ack;try{ack=JSON.parse(await fs.readFile(path.join(attempt,'commit-ack.json'),'utf8'));}catch{}if(ack?.nonce===nonce&&ack.status==='committed'){committed=true;return;}await delay(75);}await abort();throw Error('helper-commit-ack-timeout-current-app-retained');}};
   }
   let result;try{result=JSON.parse((await fs.readFile(resultFile,'utf8')).replace(/^\uFEFF/,''));}catch{}
   if(result?.nonce===nonce&&result.status==='failed')throw Error(result.message||'helper-start-failed');await delay(75);
  }throw Error('helper-ready-timeout-current-app-retained');
 }catch(e){await abort().catch(()=>{});if(child&&!ended)child.kill();await fs.writeFile(path.join(attempt,'launch-error.json'),JSON.stringify({message:e.message,stderr,workerError:await fs.readFile(workerErrorFile,'utf8').catch(()=> '')}));throw e;}
}
async function confirmUpdateRestart(directory,{version,executable,visible,readInstallationFn=readInstallation}){
 let pending,result;try{pending=JSON.parse(await fs.readFile(path.join(directory,'install-pending.json'),'utf8'));result=JSON.parse((await fs.readFile(path.join(directory,'install-result.json'),'utf8')).replace(/^\uFEFF/,''));}catch{return null;}
 if(!visible||result.status!=='installed'||!pending.nonce||result.nonce!==pending.nonce||result.version!==version||pending.version!==version||path.resolve(result.exe||'')!==path.resolve(executable)||path.resolve(pending.exe||'')!==path.resolve(executable))return null;
 const record=await readInstallationFn();if(record?.version!==version||path.resolve(record.root||'')!==path.dirname(path.resolve(executable)))throw Error('restart-installation-mismatch');
 const next={...result,status:'restarted',runningVersion:version,runningExe:executable,restartConfirmedAt:new Date().toISOString()};await fs.writeFile(path.join(directory,'install-result.json'),JSON.stringify(next,null,2));return next;
}
module.exports={readInstallation,installationMatches,validateStagedUpdate,launchUpdateHelper,confirmUpdateRestart,shaFile,GUID};
