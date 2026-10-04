#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const {run,fetchLocalJson}=require('./ai-browser.cjs');
const root=path.resolve(__dirname,'..'),file=process.env.YJT_AI_CONNECTION_FILE?path.resolve(process.env.YJT_AI_CONNECTION_FILE):path.join(root,'.local-data','ai-preview.json');
async function main(){
 const action=process.argv[2]||'start';
 if(action==='stop'){
  if(!fs.existsSync(file)){console.log('AI_PREVIEW_STOPPED count=0');return;}
  const c=JSON.parse(fs.readFileSync(file,'utf8'));let info;
  try{info=await run({action:'list',port:c.port});}catch(e){
   // A stale manifest does not authorize operating on an unrelated endpoint.
   if(e.code==='ECONNREFUSED'){fs.unlinkSync(file);console.log('AI_PREVIEW_STOPPED count=0');return;}throw e;
  }
  const app=info.targets.find(t=>t.kind==='app');
  if(c.targetId&&app.targetId!==c.targetId)throw Error('stale_connection_manifest_process_retained');
  await run({action:'app',command:'shutdown',targetId:app.targetId,port:c.port,confirmDiscard:true});
  for(let i=0;i<50;i++){await new Promise(r=>setTimeout(r,200));try{await fetchLocalJson(c.port,'/json/version');}catch{fs.unlinkSync(file);console.log('AI_PREVIEW_STOPPED count=1; DEBUG_PORT_RELEASED');return;}}
  throw Error('preview_still_closing_process_retained');
 }
 if(action!=='start')throw Error('usage: ai-preview.cjs start|stop');
 if(process.platform!=='win32')throw Error('Windows_preview_launcher_required');
 const profile=process.env.YJT_PREVIEW_PROFILE||path.join(process.env.APPDATA,'yijian-toudi');
 const result=spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'zeen-tools','local-preview.ps1'),'start'],{cwd:root,env:{...process.env,YJT_PREVIEW_CDP_PORT:'0'},windowsHide:true,encoding:'utf8',timeout:60000});
 if(result.status!==0)throw Error((result.stderr||result.stdout||result.error?.message||'preview_start_failed').trim());
 const port=Number(fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split(/\r?\n/)[0]);
 const info=await run({action:'list',port}),app=info.targets.find(x=>x.kind==='app');
 if(app.version!==require('../package.json').version)throw Error('preview_version_mismatch_restart_required');
 fs.mkdirSync(path.dirname(file),{recursive:true});
 fs.writeFileSync(file,JSON.stringify({port,targetId:app.targetId,version:app.version,root,profile},null,2)+'\n');
 console.log(`AI_PREVIEW_READY version=${app.version} endpoint=http://127.0.0.1:${port} manifest=${file}`);
}
if(require.main===module)main().catch(e=>{console.error(String(e.message));process.exitCode=1;});
