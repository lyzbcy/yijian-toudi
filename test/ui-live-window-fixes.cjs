// Offline regressions use the exact labels/roles observed in the user's windows.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {_electron:electron}=require('playwright-core');
const {JsonStore}=require('../electron/store.cjs');
const root=path.resolve(__dirname,'..');
const sourceRoot=process.env.FIXTURE_SOURCE_ROOT||root;
const policy=require(path.join(sourceRoot,'electron/navigation-policy.cjs'));
const {INSTALL_RESUME_UPLOAD_OBSERVER:install}=require(path.join(sourceRoot,'electron/resume-upload.cjs'));
(async()=>{
 const out=[];const check=(name,ok)=>out.push({name,ok:Boolean(ok)});
 check('observed singular ByteDance return domain',policy.isAllowedWorkspaceUrl('bytedance','https://job.bytedance.com/campus/login'));
 if(policy.createWorkspaceNavigationPolicy){
  let time=0;const p=policy.createWorkspaceNavigationPolicy('bytedance',{now:()=>time});
  const callback='https://campus-auth.bytedance.com/oauth/return';
  const auth='https://open.weixin.qq.com/connect/qrconnect?redirect_uri='+encodeURIComponent(callback);
  check('callback initially closed',!p.allows(callback));
  p.observe('https://evil.example',auth);check('untrusted initiator cannot enroll callback',!p.allows(callback));
  p.observe('https://jobs.bytedance.com/campus/login',auth);
  check('official OAuth return learned',p.allows(callback+'?code=fixture&state=fixture'));
  check('learned callback exact path',!p.allows('https://campus-auth.bytedance.com/unrelated'));
  p.observe('https://jobs.bytedance.com',auth.replace(encodeURIComponent(callback),encodeURIComponent('https://bytedance.com.evil.example/cb')));
  check('phishing callback closed',!p.allows('https://bytedance.com.evil.example/cb'));
  check('credential and nonstandard port rejected',!p.allows('https://user:password@job.bytedance.com/')&&!p.allows('https://job.bytedance.com:9443/'));
  time=11*60*1000;check('callback expires',!p.allows(callback));
 }else for(const name of ['callback initially closed','untrusted initiator cannot enroll callback','official OAuth return learned','learned callback exact path','phishing callback closed','credential and nonstandard port rejected','callback expires'])check(name,false);
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'yjt-live-window-'));
 const s=new JsonStore(dir);s.init();s.update(x=>{x.meta.onboardingSeen=true;x.settings.kimiBridgeEnabled=false;x.settings.autoCheckUpdates=false;x.settings.jobs.autoRefresh=false;return x;});
 const a=await electron.launch({args:[root,`--user-data-dir=${dir}`],executablePath:process.env.ELECTRON_EXECUTABLE||undefined,env:{...process.env,YIJIAN_BACKGROUND_TEST:'1'}});
 try{
  await a.firstWindow();
  const results=await a.evaluate(async({BrowserWindow},{install})=>{
   const out=[],w=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
   const pause=ms=>new Promise(r=>setTimeout(r,ms));const run=s=>w.webContents.executeJavaScript(s);
   const check=(name,ok)=>out.push({name,ok:Boolean(ok)});
   try{
    for(const sample of [
     {id:'baidu',role:'',yes:'覆盖',no:'仅替换简历',prompt:'是否根据您上传附件中的简历，刷新简历的信息？刷新后，原来的信息将被覆盖。'},
     {id:'alibaba',role:'alertdialog',yes:'是，覆盖掉',no:'否，仅替换附件',prompt:'是否根据您上传附件中的简历，刷新简历详情中的信息？刷新之后，原来的信息将丢失。'}
    ]){
     for(const preexisting of [false,true]){
      const html=`<meta charset="utf-8"><style>.overlay{position:fixed;left:0;top:0;background:white;padding:20px;z-index:10}</style><main><h1>简历详情</h1><form><label>姓名<input id="name"></label><section id="parsed">待解析</section></form><input id="file" type="file" accept=".pdf"></main><script>window.clicks=0;window.cancelled=false;window.show=()=>{const d=document.createElement('div');d.className='overlay';${sample.role?`d.setAttribute('role','${sample.role}');`:''}d.innerHTML=${JSON.stringify(`<p>${sample.prompt}</p><button id="yes">${sample.yes}</button><button id="no">${sample.no}</button>`)};document.body.append(d);yes.onclick=()=>{window.clicks++;d.remove();setTimeout(()=>{parsed.textContent='解析后的简历字段';if('${sample.id}'==='baidu')document.getElementById('name').value='解析后的姓名';},600)};no.onclick=()=>{cancelled=true;d.remove()};};file.onchange=()=>{file.value='';show()};${preexisting?'show();':''}</script>`;
      await w.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(html));await run(install);
      if(!preexisting)await run(`(()=>{const d=new DataTransfer();d.items.add(new File(['fixture'],'resume.pdf',{type:'application/pdf'}));file.files=d.files;file.dispatchEvent(new Event('change',{bubbles:true}));})()`);
      await pause(3000);
      let state=await run(`({phase:window.__yjtResumeUpload?.phase,clicks,cancelled})`);
      check(`${sample.id} ${preexisting?'existing':'upload'} exact positive once`,state.clicks===1&&!state.cancelled);
      check(`${sample.id} ${preexisting?'existing':'upload'} parsing ready`,state.phase==='ready');
      await run(install);await pause(300);check(`${sample.id} observer reinstall idempotent ${preexisting}`,await run('clicks===1'));
     }
    }
    for(const scenario of ['application','ambiguous','hidden','dismiss-only']){
     const positive=scenario==='ambiguous'?'<button>覆盖</button><button>覆盖</button>':'<button>覆盖</button>';
     const prompt=scenario==='application'?'是否根据简历刷新信息并提交申请？':'是否根据上传附件中的简历刷新信息？';
     await w.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(`<meta charset="utf-8"><form><input id="name"></form><div role="alertdialog" style="${scenario==='hidden'?'display:none':''}"><p>${prompt}</p>${positive}<button>仅替换附件</button></div><script>window.clicks=0;document.querySelectorAll('button').forEach(b=>b.onclick=()=>{clicks++;b.parentElement.remove()})</script>`));
     await run(install);await pause(2000);
     check(`${scenario} never yields false ready`,await run(`window.__yjtResumeUpload?.phase!=='ready'`));
     if(scenario!=='dismiss-only')check(`${scenario} untouched`,await run('clicks===0'));
    }
   }finally{w.destroy();}
   return out;
  },{install});
  out.push(...results);
 }finally{await a.close();}
 for(const r of out)console.log(`${r.ok?'PASS':'FAIL'} ${r.name}`);
 console.log(JSON.stringify({tests:out.length,pass:out.filter(x=>x.ok).length,fail:out.filter(x=>!x.ok).length,offline:true}));
 if(out.some(x=>!x.ok))process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
