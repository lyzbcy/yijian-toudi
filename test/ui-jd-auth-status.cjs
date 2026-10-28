const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {_electron:electron}=require('playwright-core'),{JsonStore}=require('../electron/store.cjs');
const root=path.resolve(__dirname,'..'),fixtureSourceRoot=process.env.FIXTURE_SOURCE_ROOT||root;
(async()=>{
 const checks=[];const check=(name,ok)=>checks.push({name,ok:Boolean(ok)});
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'yjt-jd-result-'));
 const store=new JsonStore(dir);store.init();store.update(s=>{s.meta.onboardingSeen=true;s.settings.autoCheckUpdates=false;s.settings.kimiBridgeEnabled=false;s.settings.jobs.autoRefresh=false;return s;});
 const app=await electron.launch({args:[root,`--user-data-dir=${dir}`],env:{...process.env,YIJIAN_BACKGROUND_TEST:'1'}});
 try{
  const page=await app.firstWindow();await page.waitForSelector('#workspaceBar',{state:'attached'});
  const native=await app.evaluate(async({app,BrowserWindow,session},{fixtureSourceRoot})=>{
   const Module=process.getBuiltinModule('node:module'),fs=process.getBuiltinModule('node:fs'),path=process.getBuiltinModule('node:path');
   const req=Module.createRequire(`${app.getAppPath()}/electron/main.cjs`);let loaded=req('./login-manager.cjs');
   if(fixtureSourceRoot!==app.getAppPath()){
    const mod=new Module(`${fixtureSourceRoot}/electron/login-manager.cjs`);
    mod.require=id=>id.startsWith('./')&&fs.existsSync(path.join(fixtureSourceRoot,'electron',id))?Module.createRequire(mod.id)(id):req(id);
    mod._compile(fs.readFileSync(mod.id,'utf8'),mod.id);loaded=mod.exports;
   }
   let clock=0;const m=loaded.createLoginManager({authTiming:{now:()=>clock,scanWaitMs:300,callbackTimeoutMs:200,checkEveryMs:30}});
   const parent=new BrowserWindow({show:false}),part=session.fromPartition('persist:jd');m.setParent(parent);
   await part.protocol.handle('https',()=>new Response('<!doctype html><section>基本信息</section><a href="#">登录</a>',{headers:{'content-type':'text/html; charset=utf-8'}}));
   const wait=ms=>new Promise(r=>setTimeout(r,ms)),result={};
   const open=mode=>m.openWorkspace({company:{id:'jd',name:'京东'},url:'https://campus.jd.com/#/resume?type=present',mode:mode||'login'});
   const observe=url=>m.getWebContents().emit('will-navigate',{preventDefault(){}},url);
   const entry='https://qq.jd.com/new/wx/login.action?ReturnUrl=fixture',callback='https://qq.jd.com/new/wx/callback.action?code=fixture';
   try{
    await open();await wait(100);result.pending=m.getStatus().auth?.state==='pending';
    observe(entry);await wait(50);result.awaiting=m.getStatus().auth?.state==='awaiting-scan';
    clock=300;await wait(100);result.stale=m.getStatus().auth?.state==='stale';result.noRefresh=m.getCurrentUrl().includes('campus.jd.com/#/resume');
    observe(callback);result.checking=m.getStatus().auth?.state==='checking';clock=500;await wait(100);
    result.failure=m.getStatus().auth?.code==='CALLBACK_NO_AUTH';
    try{await m.finishWorkspace();result.rejected=false;}catch(e){result.rejected=e.code==='LOGIN_NOT_VERIFIED';}
    result.retained=m.isActive();if(!m.isActive())await open();
    await part.cookies.set({url:'https://campus.jd.com/',name:'thor',value:'FIXTURE_NOT_A_REAL_CREDENTIAL',secure:true});
    await m.run(`document.querySelector('a').remove();true`);await wait(100);result.verified=m.getStatus().auth?.state==='verified';
    // Credential removed immediately before finish: check must not trust last poll.
    await part.cookies.remove('https://campus.jd.com/','thor');
    try{await m.finishWorkspace();result.freshCheck=false;}catch(e){result.freshCheck=e.code==='LOGIN_NOT_VERIFIED'&&m.isActive();}
    if(!m.isActive())await open();
    await part.cookies.set({url:'https://campus.jd.com/',name:'thor',value:'FIXTURE_NOT_A_REAL_CREDENTIAL',secure:true});
    await m.run(`document.querySelector('a')?.remove();true`);await wait(100);
    await m.getWebContents().loadURL('https://www.jd.com/');
    try{await m.finishWorkspace();result.routeCheck=false;}catch(e){result.routeCheck=e.code==='LOGIN_NOT_VERIFIED'&&m.isActive();}
    if(!m.isActive())await open();
    await m.getWebContents().loadURL('https://campus.jd.com/#/resume');await m.run(`document.querySelector('a').remove();true`);await wait(100);
    await m.finishWorkspace();result.finish=!m.isActive();
    await open();const old=m.getWebContents();
    if(m.restartLogin){await m.restartLogin();result.restart=old.isDestroyed()&&m.isActive()&&m.getCurrentUrl().includes('campus.jd.com/#/resume')&&m.getStatus().auth.state==='pending';}
    else result.restart=false;
    await m.closeWorkspace();await open('resume-review');
    try{await m.restartLogin();result.reviewGuard=false;}catch(e){result.reviewGuard=typeof m.restartLogin==='function'&&e.message.includes('简历编辑页保持不动')&&m.isActive();}
    await m.closeWorkspace();result.closed=m.getStatus().auth==null;
   }finally{await m.closeWorkspace();if(!parent.isDestroyed())parent.destroy();await part.cookies.remove('https://campus.jd.com/','thor');part.protocol.unhandle('https');}
   return result;
  },{fixtureSourceRoot});
  for(const [key,value]of Object.entries(native))check(`native fixture: ${key}`,value);
  const base={active:true,company:{id:'jd',name:'京东'},mode:'login',url:'https://campus.jd.com/#/resume',context:{},diagnostics:[]};
  for(const state of ['pending','awaiting-scan','checking','stale','failed','verified']){
   await app.evaluate(({BrowserWindow},status)=>BrowserWindow.getAllWindows()[0].webContents.send('workspace:changed',status),{...base,auth:{state,code:'FIXTURE',message:`fixture ${state}`}});
   await page.waitForFunction(s=>document.querySelector('#workspaceBarHint').dataset.authState===s,state);
   const ui=await page.evaluate(()=>({disabled:document.querySelector('#workspaceFinish').disabled,retry:!document.querySelector('#workspaceRestartLogin').classList.contains('hidden'),text:document.querySelector('#workspaceBarHint').innerText,height:document.querySelector('#workspaceBar').getBoundingClientRect().height,cancel:!document.querySelector('#workspaceCancel').disabled}));
   check(`UI ${state}: completion matches actual verification`,ui.disabled===(state!=='verified'));
   check(`UI ${state}: explicit retry only stale/failed`,ui.retry===['stale','failed'].includes(state));
   check(`UI ${state}: message and usable cancel/header`,ui.text===`fixture ${state}`&&ui.cancel&&ui.height===52);
  }
  check('preload exposes explicit restart',await page.evaluate(()=>typeof window.oneClick.restartLogin==='function'));
 }finally{await app.close();}
 const report={at:new Date().toISOString(),isolatedProfile:true,network:'in-memory HTTPS fixture; no real login/save/application',checks};
 fs.mkdirSync(path.join(root,'test-output'),{recursive:true});fs.writeFileSync(path.join(root,'test-output/ui-jd-auth-status.json'),JSON.stringify(report,null,2));
 const count=checks.filter(x=>x.ok).length;console.log(`JD_AUTH_RESULT ${count}/${checks.length}`);for(const item of checks.filter(x=>!x.ok))console.log(`FAIL ${item.name}`);if(count!==checks.length)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});

