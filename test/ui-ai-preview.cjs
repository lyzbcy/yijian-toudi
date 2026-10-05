const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const {JsonStore}=require('../electron/store.cjs');
const {run,fetchLocalJson}=require('../scripts/ai-browser.cjs');
(async()=>{
 const root=path.resolve(__dirname,'..'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'yjt-ai-preview-中文-'));
 const s=new JsonStore(dir);s.init();s.update(x=>{x.meta.onboardingSeen=true;x.settings.autoCheckUpdates=false;x.settings.kimiBridgeEnabled=false;x.settings.jobs.autoRefresh=false;return x;});
 const manifest=path.join(dir,'connection.json'),env={...process.env,YJT_PREVIEW_PROFILE:dir,YJT_AI_CONNECTION_FILE:manifest,YJT_PREVIEW_NO_PAUSE:'1'};
 delete env.YJT_PREVIEW_CDP_PORT;
 const execute=name=>spawnSync('powershell.exe',['-NoProfile','-Command',`& '${path.join(root,'zeen-tools',name).replaceAll("'","''")}'`],{cwd:os.tmpdir(),env,encoding:'utf8',windowsHide:true,timeout:60000});
 const out=[],check=(name,ok)=>out.push({name,ok:Boolean(ok)});
 try{
  const normal=execute('一键本地预览.bat');
  check('normal preview still launches without debugging',normal.status===0&&!fs.existsSync(path.join(dir,'DevToolsActivePort')));
  const refused=execute('一键AI调试预览.bat');
  check('normal running preview not falsely claimed as debug ready',refused.status!==0&&(refused.stderr+refused.stdout).includes('AI_PREVIEW_RESTART_REQUIRED'));
  const normalStop=execute('关闭本地预览.bat');
  check('normal preview preserved until explicitly closed',normalStop.status===0&&normalStop.stdout.includes('count=1'));
  const first=execute('一键AI调试预览.bat');console.log(first.stdout.trim());if(first.status)console.log(first.stderr.trim());
  check('AI bat starts from unrelated cwd and Chinese profile',first.status===0&&first.stdout.includes('AI_PREVIEW_READY'));
  const c=JSON.parse(fs.readFileSync(manifest,'utf8')),list=await run({action:'list',port:c.port}),app=list.targets.find(x=>x.kind==='app');
  check('random loopback port manifest correct',c.port>0&&c.version===require('../package.json').version);
  check('AI debug visibly marked in app title',app.title.includes('AI DEBUG'));
  const snap=await run({action:'snapshot',port:c.port,targetId:app.targetId});
  check('browser DOM readable without desktop input',snap.result.elements.some(e=>e.name.includes('自动化中心')));
  const duplicate=execute('一键AI调试预览.bat');check('duplicate AI launch reuses existing preview',duplicate.status===0&&JSON.parse(fs.readFileSync(manifest,'utf8')).port===c.port);
  const stop=execute('关闭AI调试预览.bat');console.log(stop.stdout.trim());if(stop.status)console.log(stop.stderr.trim());
  check('paired AI stop closes app and releases port',stop.status===0&&stop.stdout.includes('DEBUG_PORT_RELEASED'));
  let live=true;try{await fetchLocalJson(c.port,'/json/version');}catch{live=false;}check('debug endpoint actually gone',!live&&!fs.existsSync(manifest));
  const again=execute('关闭AI调试预览.bat');check('AI stop idempotent',again.status===0&&again.stdout.includes('count=0'));
 }finally{execute('关闭AI调试预览.bat');}
 out.forEach(x=>console.log(`${x.ok?'PASS':'FAIL'} ${x.name}`));console.log(JSON.stringify({tests:out.length,pass:out.filter(x=>x.ok).length,fail:out.filter(x=>!x.ok).length,isolatedProfile:true}));
 assert.ok(out.every(x=>x.ok),'AI preview bat regression');
})().catch(e=>{console.error(e);process.exitCode=1;});
