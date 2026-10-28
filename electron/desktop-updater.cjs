'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {summarizeRelease,UPDATE_REPO}=require('./update-release.cjs');
const API=`https://api.github.com/repos/${UPDATE_REPO}/releases/latest`;
const shanghaiDay=date=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
function checksumFor(text,name,sidecarName){
 if(typeof text!=='string'||Buffer.byteLength(text)>65536)throw Error('checksum-too-large');
 const lines=text.replace(/^\uFEFF/,'').trim().split(/\r?\n/),exact=[];
 for(const line of lines){const m=/^([a-f\d]{64})[ \t]+\*?(.+)$/i.exec(line);if(m&&m[2]===name)exact.push(m[1].toLowerCase());}
 if(exact.length===1)return exact[0];if(exact.length>1)throw Error('checksum-ambiguous');
 const bare=/^[a-f\d]{64}$/i.test(text.trim())&&[name+'.sha256',name.replace(/\.(exe|zip)$/i,'.sha256')].includes(sidecarName);
 if(bare)return text.trim().toLowerCase();throw Error('checksum-for-package-missing');
}
function finalResponseUrl(url){if(!url)return true;try{const u=new URL(url);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&['api.github.com','github.com','release-assets.githubusercontent.com','objects.githubusercontent.com'].includes(u.hostname);}catch{return false;}}
function createDesktopUpdater({store,directory,fetchFn,current,platform,arch,onProgress=()=>{},now=()=>new Date(),timeoutMs=120000}){
 let checking=null,downloading=false;
 const persist=patch=>store.update(s=>{s.meta.desktopUpdate={...(s.meta.desktopUpdate||{}),...patch};return s;});
 async function consume(url,limit,visit,signal){
  const response=await fetchFn(url,{signal,redirect:'follow',cache:'no-store',headers:{'User-Agent':'yijian-toudi-updater','Accept':'application/octet-stream, application/json'}});
  if(response.status!==200)throw Error(`HTTP ${response.status}`);if(!finalResponseUrl(response.url))throw Error('untrusted-response-origin');
  const declared=Number(response.headers.get('content-length'));if(declared>limit)throw Error('response-too-large');
  let bytes=0;const reader=response.body?.getReader();if(!reader)throw Error('empty-response');
  try{for(;;){const{done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>limit)throw Error('response-too-large');await visit(Buffer.from(value));}}
  catch(e){await reader.cancel().catch(()=>{});throw e;}finally{reader.releaseLock();}
  if(declared>0&&bytes!==declared)throw Error('truncated-response');return bytes;
 }
 async function text(url,signal){const chunks=[];await consume(url,65536,c=>chunks.push(c),signal);return Buffer.concat(chunks).toString('utf8');}
 function check({manual=true}={}){
  if(checking)return checking;
  const day=shanghaiDay(now()),old=store.get().meta.desktopUpdate||{};
  if(!manual&&old.attemptDay===day)return Promise.resolve({...old.lastResult,current,skipped:true,cached:Boolean(old.lastFailure),...(old.lastFailure?{updateAvailable:false}:{}),lastFailure:old.lastFailure||null});
  // Attempts are durable BEFORE network I/O, so failures cannot cause startup retry loops.
  persist({attemptDay:day,attemptAt:now().toISOString(),lastFailure:null});
  checking=(async()=>{const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);try{
   const release=JSON.parse(await text(API,controller.signal)),result=summarizeRelease(release,current,platform,arch);
   if(result.reason==='not-trusted-stable-release')throw Error(result.reason);
   persist({successDay:day,successAt:now().toISOString(),lastFailure:null,lastResult:result});return result;
  }catch(e){persist({lastFailure:String(e.message).slice(0,250)});throw e;}finally{clearTimeout(timer);checking=null;}})();return checking;
 }
 async function download(input={}){
  if(downloading)throw Error('update-download-in-progress');downloading=true;
  let attempt,handle,part;const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
   onProgress({phase:'checking',received:0});const release=await check({manual:true});
   if(!release.updateAvailable)throw Error(release.reason||'no-newer-stable-package');
   if(input.version&&input.version!==release.latest)throw Error('release-changed-check-again');
   if(Object.keys(input).some(k=>!['version','downloadUrl','downloadName','sha256Url'].includes(k)))throw Error('invalid-download-request');
   for(const[k,v]of [['downloadUrl',release.download.url],['downloadName',release.download.name],['sha256Url',release.sha256.url]])if(input[k]!==undefined&&input[k]!==v)throw Error('release-target-mismatch');
   const expected=checksumFor(await text(release.sha256.url,controller.signal),release.download.name,release.sha256.name);
   await fs.mkdir(directory,{recursive:true});attempt=await fs.mkdtemp(path.join(directory,'download-'));part=path.join(attempt,'package.part');handle=await fs.open(part,'wx');
   const hash=crypto.createHash('sha256');let received=0,last=0;
   const bytes=await consume(release.download.url,release.download.size,async c=>{await handle.writeFile(c);hash.update(c);received+=c.length;if(received===release.download.size||Date.now()-last>=100){last=Date.now();onProgress({phase:'downloading',received,total:release.download.size,percent:Math.floor(received/release.download.size*100)});}},controller.signal);
   await handle.sync();await handle.close();handle=null;
   if(bytes!==release.download.size)throw Error('package-size-mismatch');onProgress({phase:'verifying',received:bytes,total:bytes});
   const actual=hash.digest('hex');if(actual!==expected)throw Error('package-sha256-mismatch');
   const file=path.join(attempt,release.download.name);await fs.rename(part,file);part=null;
   const result={ok:true,version:release.latest,file,shaChecked:true,shaOk:true,sha256:actual,bytes,staged:true,installed:false,releaseUrl:release.url};
   await fs.writeFile(path.join(attempt,'verified.json'),JSON.stringify(result,null,2));onProgress({phase:'verified',received:bytes,total:bytes,percent:100});return result;
  }catch(e){onProgress({phase:'failed',message:String(e.message).slice(0,250)});throw e;}
  finally{clearTimeout(timer);await handle?.close().catch(()=>{});if(part)await fs.unlink(part).catch(()=>{});downloading=false;}
 }
 return {check,download,busy:()=>downloading};
}
module.exports={createDesktopUpdater,checksumFor,shanghaiDay,finalResponseUrl,API};
