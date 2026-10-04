'use strict';
const fs=require('node:fs/promises'),nativeFs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {execFile,spawn}=require('node:child_process'),{promisify}=require('node:util');
const run=promisify(execFile),{compareVersions}=require('./update-release.cjs'),{shaFile}=require('./windows-update.cjs');
const delay=ms=>new Promise(r=>setTimeout(r,ms)),bundleID='com.lyzbcy.yijiantoudi';
function inside(parent,child){const r=path.relative(parent,child);return r===''||(!r.startsWith('..'+path.sep)&&r!=='..'&&!path.isAbsolute(r));}
function validPath(value){return typeof value==='string'&&path.isAbsolute(value)&&!/[\x00-\x1f]/.test(value);}
function installationRoot({executable,userData,platform,arch,packaged,home=os.homedir()}){
 const p=path.posix;
 if(platform!=='darwin'||!['arm64','x64'].includes(arch)||!packaged||![executable,userData,home].every(value=>typeof value==='string'&&p.isAbsolute(value)&&!/[\x00-\x1f\\]/.test(value)))return null;
 const root=p.resolve(executable,'../../..'),parent=p.dirname(root),relative=p.relative(root,userData),dataInside=relative===''||(!relative.startsWith('../')&&relative!=='..'&&!p.isAbsolute(relative));
 if(!root.endsWith('.app')||!['/Applications',p.join(home,'Applications')].includes(parent)||p.resolve(executable)!==p.join(root,'Contents/MacOS/一键投递')||dataInside)return null;
 return root;
}
async function command(bin,args){return(await run(bin,args,{encoding:'utf8',timeout:60000,maxBuffer:8*1024*1024})).stdout.trim();}
const plist=(root,key)=>command('/usr/bin/plutil',['-extract',key,'raw','-o','-',path.join(root,'Contents/Info.plist')]);
function machoArchitectures(bytes){
 if(bytes.length<8)throw Error('mac-executable-header-invalid');
 const magic=bytes.readUInt32BE(0),fat=[0xcafebabe,0xcafebabf,0xbebafeca,0xbfbafeca].includes(magic),little=[0xbebafeca,0xbfbafeca].includes(magic);
 const read=at=>little?bytes.readUInt32LE(at):bytes.readUInt32BE(at),types=[];
 if(fat){const count=read(4),stride=[0xcafebabf,0xbfbafeca].includes(magic)?32:20;if(!count||count>32||8+count*stride>bytes.length)throw Error('mac-executable-header-invalid');for(let n=0;n<count;n++)types.push(read(8+n*stride));}
 else if(bytes.readUInt32LE(0)===0xfeedfacf)types.push(bytes.readUInt32LE(4));
 else if(magic===0xfeedfacf)types.push(bytes.readUInt32BE(4));
 else throw Error('mac-executable-header-invalid');
 return types.map(type=>type===0x0100000c?'arm64':type===0x01000007?'x64':'unsupported');
}
async function validateBundle(root,version,arch){
 const stat=await fs.lstat(root);if(!stat.isDirectory()||stat.isSymbolicLink()||await fs.realpath(root)!==path.resolve(root))throw Error('mac-installation-link-refused');
 if(await plist(root,'CFBundleIdentifier')!==bundleID||await plist(root,'CFBundleShortVersionString')!==version||await plist(root,'CFBundleExecutable')!=='一键投递')throw Error('mac-bundle-identity-mismatch');
 await command('/usr/bin/codesign',['--verify','--deep','--strict',root]);
 const handle=await fs.open(path.join(root,'Contents/MacOS/一键投递'),'r');let architectures;try{const buffer=Buffer.alloc(4096),{bytesRead}=await handle.read(buffer,0,buffer.length,0);architectures=machoArchitectures(buffer.subarray(0,bytesRead));}finally{await handle.close();}
 if(!architectures.includes(arch))throw Error('mac-bundle-architecture-mismatch');
 async function walk(dir){for(const entry of await fs.readdir(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isSymbolicLink()){if(!inside(root,await fs.realpath(file)))throw Error('mac-bundle-external-link');}else if(entry.isDirectory())await walk(file);else if(!entry.isFile())throw Error('mac-bundle-special-file');}}
 await walk(root);return root;
}
async function readInstallation(options){
 const root=installationRoot(options);if(!root)throw Error('installed-writable-mac-version-required');
 await validateBundle(root,options.current,options.arch);await fs.access(path.dirname(root),nativeFs.constants.W_OK);await fs.access(root,nativeFs.constants.W_OK);
 return {root,version:options.current};
}
async function validateStagedUpdate(staged,{directory,current,arch}){
 if(!staged?.ok||!staged.staged||staged.installed||!staged.shaOk||!staged.shaChecked||compareVersions(staged.version,current)!==1||!validPath(staged.file)||!inside(directory,staged.file)||path.basename(staged.file)!==`yijian-toudi-${staged.version}-${arch}.zip`||!/^[a-f\d]{64}$/.test(staged.sha256)||!Number.isSafeInteger(staged.bytes)||staged.bytes<=0)throw Error('verified-mac-update-required');
 const stat=await fs.lstat(staged.file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==staged.bytes||await shaFile(staged.file)!==staged.sha256)throw Error('staged-update-changed');return staged;
}
async function launchUpdateHelper(payload,directory,{spawnFn=spawn,timeoutMs=15000,templatePath=path.join(__dirname,'install-update-mac.sh')}={}){
 const options={executable:payload.oldExe,userData:payload.userData,current:payload.oldVersion,platform:process.platform,arch:payload.arch,packaged:true};
 const record=await readInstallation(options);if(record.root!==payload.root||!Number.isInteger(payload.pid)||payload.pid<=0||compareVersions(payload.version,payload.oldVersion)!==1||!/^[a-f\d]{64}$/.test(payload.sha256)||!validPath(directory)||!inside(directory,payload.file)||await shaFile(payload.file)!==payload.sha256)throw Error('mac-helper-payload-invalid');
 await fs.mkdir(directory,{recursive:true});const attempt=await fs.mkdtemp(path.join(directory,'install-')),nonce=crypto.randomBytes(24).toString('hex');
 const stage=payload.root+'.yjt-stage-'+nonce,backup=payload.root+'.yjt-backup-'+nonce,failed=payload.root+'.yjt-failed-'+nonce,lock=payload.root+'.yjt-update-lock';
 const readyFile=path.join(attempt,'ready.json'),commitFile=path.join(attempt,'commit'),abortFile=path.join(attempt,'abort'),resultFile=path.join(directory,'install-result.json'),pendingFile=path.join(directory,'install-pending.json');
 let ownsLock=false,worker;
 const abort=()=>fs.writeFile(abortFile,nonce);
 try{
  await fs.mkdir(lock);ownsLock=true;await fs.writeFile(path.join(lock,'owner'),nonce,{flag:'wx'});
  await require('./macos-update-archive.cjs').validateArchive(payload.file);
  const extract=path.join(attempt,'extracted');await fs.mkdir(extract);await command('/usr/bin/ditto',['-x','-k',payload.file,extract]);
  await validateBundle(path.join(extract,'一键投递.app'),payload.version,payload.arch);
  await command('/usr/bin/ditto',[path.join(extract,'一键投递.app'),stage]);await validateBundle(stage,payload.version,payload.arch);
  const script=path.join(attempt,'worker.sh');await fs.copyFile(templatePath,script);
  const data={...payload,nonce,stage,backup,failed,lock,attempt,readyFile,commitFile,abortFile,resultFile};const file=path.join(attempt,'payload.json');await fs.writeFile(file,JSON.stringify(data));
  let launchError=null;worker=spawnFn('/bin/bash',[script,file],{detached:true,stdio:'ignore'});worker.once('error',e=>{launchError=e;});worker.unref();
  const until=Date.now()+timeoutMs;while(Date.now()<until){
   if(launchError)throw launchError;
   let ready,result;try{ready=JSON.parse(await fs.readFile(readyFile,'utf8'));}catch{}try{result=JSON.parse(await fs.readFile(resultFile,'utf8'));}catch{}
   if(result?.nonce===nonce&&result.status==='failed')throw Error(result.message);
   if(ready?.nonce===nonce&&ready.version===payload.version&&ready.status==='ready'&&ready.pid===worker.pid){
    let committed=false;return {attempt,helperPid:worker.pid,nonce,abort,commit:async()=>{
     if(committed)throw Error('helper-already-committed');if(nativeFs.existsSync(abortFile))throw Error('helper-aborted');process.kill(worker.pid,0);
     await fs.writeFile(pendingFile,JSON.stringify({nonce,version:payload.version,exe:payload.oldExe,attempt}));await fs.writeFile(commitFile,nonce);
     const limit=Date.now()+5000;while(Date.now()<limit){let ack;try{ack=JSON.parse(await fs.readFile(path.join(attempt,'commit-ack.json'),'utf8'));}catch{}if(ack?.nonce===nonce&&ack.status==='committed'){committed=true;return;}await delay(75);}await abort();throw Error('helper-commit-ack-timeout-current-app-retained');
    }};
   }await delay(75);
  }throw Error('helper-ready-timeout-current-app-retained');
 }catch(error){
  await abort().catch(()=>{});
  // A started worker owns cleanup; it checks abort before any replacement.
  if(!worker?.pid&&ownsLock){await fs.rm(stage,{recursive:true,force:true});await fs.rm(lock,{recursive:true,force:true});}
  throw error;
 }
}
async function confirmUpdateRestart(directory,{version,executable,visible,arch=process.arch}){
 let pending,result;try{pending=JSON.parse(await fs.readFile(path.join(directory,'install-pending.json'),'utf8'));result=JSON.parse(await fs.readFile(path.join(directory,'install-result.json'),'utf8'));}catch{return null;}
 if(!visible||result.status!=='installed'||!pending.nonce||result.nonce!==pending.nonce||result.version!==version||pending.version!==version||result.exe!==executable||pending.exe!==executable)return null;
 await validateBundle(result.root,version,arch);const next={...result,status:'restarted',runningVersion:version,restartConfirmedAt:new Date().toISOString()};
 await require('./update-install-result.cjs').writeInstallResult(path.join(directory,'install-result.json'),next);return next;
}
module.exports={installationRoot,readInstallation,validateStagedUpdate,validateBundle,launchUpdateHelper,confirmUpdateRestart,machoArchitectures};
