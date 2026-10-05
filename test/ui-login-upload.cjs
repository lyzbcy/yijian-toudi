const fs=require('fs'),path=require('path'),os=require('os'),assert=require('assert/strict');
const {_electron:electron}=require('playwright-core');
const {JsonStore}=require('../electron/store.cjs');
(async()=>{
 const root=path.resolve(__dirname,'..'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'yjt-login-upload-'));
 const s=new JsonStore(dir);s.init();s.update(x=>{x.meta.onboardingSeen=true;x.settings.kimiBridgeEnabled=false;x.settings.autoCheckUpdates=false;x.settings.jobs.autoRefresh=false;return x;});
 const attachment=path.join(dir,'resume-123.pdf');fs.writeFileSync(attachment,'%PDF-1.4 fixture');
 const a=await electron.launch({args:[root,`--user-data-dir=${dir}`],executablePath:process.env.ELECTRON_EXECUTABLE||undefined,env:{...process.env,YIJIAN_BACKGROUND_TEST:'1'}});
 try{
  await a.firstWindow();
  const results=await a.evaluate(async({app,BrowserWindow,session},{source,attachment})=>{
   const req=process.getBuiltinModule('node:module').createRequire(`${app.getAppPath()}/electron/main.cjs`);
   let mod=req('./login-manager.cjs');
   if(source){const M=process.getBuiltinModule('node:module').Module;const m=new M(`${app.getAppPath()}/electron/login-manager.cjs`);m.require=req;m._compile(process.getBuiltinModule('node:fs').readFileSync(source,'utf8'),m.id);mod=m.exports;}
   const out=[],parent=new BrowserWindow({show:false});
   const check=(name,ok,details='')=>out.push({name,ok:Boolean(ok),details});
   const pause=ms=>new Promise(r=>setTimeout(r,ms));
   const m=mod.createLoginManager();m.setParent(parent);
   const part=session.fromPartition('persist:bytedance');
   await part.protocol.handle('https',r=>new Response(r.url.startsWith('https://open.weixin.qq.com/')?`<script>location.href=${JSON.stringify(new URL(r.url).searchParams.get('redirect_uri'))}</script>`:r.url.includes('/callback')?`<script>document.cookie='fixture-auth=ok; path=/';opener.postMessage('fixture-auth-ok','https://jobs.bytedance.com');window.close();</script>`:`<h1>登录样本</h1><section role="dialog"><p>你的 AI 求职搭子来了 线上咨询 个性化荐岗</p><button onclick="this.parentElement.remove()">稍后再说</button></section><script>window.receipt='';addEventListener('message',e=>{if(['https://jobs.bytedance.com','https://job.bytedance.com','https://campus-auth.bytedance.com'].includes(e.origin))window.receipt=e.data;});</script>`,{headers:{'content-type':'text/html; charset=utf-8'}}));
   await m.openWorkspace({company:{id:'bytedance',name:'fixture'},url:'https://jobs.bytedance.com/campus/login'});
   check('ByteDance introduction no longer covers login',await m.run(`!document.querySelector('section[role=dialog]')`));
   const opened=await m.run(`(()=>{window.child=window.open('about:blank');return !!window.child;})()`);
   check('blank SSO popup opens',opened);
   if(opened){await m.run(`window.child.location='https://jobs.bytedance.com/callback';true`);await pause(800);check('callback reaches opener',await m.run(`window.receipt==='fixture-auth-ok'`));}
   else check('callback reaches opener',false);
   for(const callback of ['https://job.bytedance.com/callback','https://campus-auth.bytedance.com/callback']){
    const auth='https://open.weixin.qq.com/connect/qrconnect?redirect_uri='+encodeURIComponent(callback);
    await m.run(`window.receipt='';window.child=window.open(${JSON.stringify(auth)});true`);
    await pause(1200);
    check(`OAuth popup return ${new URL(callback).hostname}`,await m.run(`window.receipt==='fixture-auth-ok'`));
   }
   const ua=await m.run('navigator.userAgent');check('no hardcoded macOS Chrome132',!ua.includes('Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132'));
   const mainReturn='https://campus-auth.bytedance.com/callback';
   await m.run(`location.href=${JSON.stringify('https://open.weixin.qq.com/connect/qrconnect?redirect_uri='+encodeURIComponent(mainReturn))};true`);
   await pause(1000);
   check('main-frame adaptive OAuth callback lands',m.getCurrentUrl()===mainReturn);
   await m.closeWorkspace();
   check('callback cookie retained', (await part.cookies.get({name:'fixture-auth',url:'https://jobs.bytedance.com/'})).length===1);
   if(opened) {
     check('session cookie attributes preserved',(await part.cookies.get({name:'fixture-auth',url:'https://jobs.bytedance.com/'}))[0]?.session===true);
   } else check('session cookie attributes preserved',false);
   for(const id of ['baidu','alibaba']){
    const p=session.fromPartition(`persist:${id}`);
    await p.protocol.handle('https',()=>new Response(`<meta charset="utf-8"><style>input{display:block} [role=dialog]{position:fixed;top:10px;left:10px;background:white;padding:20px}</style><h1>简历编辑</h1><label>简历附件<input id="file" type="file" accept=".pdf"></label><label>姓名<input id="name"></label><script>file.onchange=()=>{file.value='';setTimeout(()=>{const d=document.createElement('div');d.setAttribute('role','dialog');d.innerHTML='<p>是否根据简历中的信息刷新当前信息？</p><button id="no">取消</button><button id="yes">确定</button>';document.body.append(d);yes.onclick=()=>{document.body.dataset.confirmed='yes';d.remove();setTimeout(()=>{document.getElementById('name').value='解析后的姓名'},2200)};no.onclick=()=>{document.body.dataset.cancelled='yes';d.remove()};},100)};</script>`,{headers:{'content-type':'text/html; charset=utf-8'}}));
    const url=id==='baidu'?'https://talent.baidu.com/jobs/resume/create':'https://campus-talent.alibaba.com/personal/resume';
    await m.openWorkspace({company:{id,name:id},url,mode:'resume-review',context:{action:'fill-resume'}});
    let upload;try{upload=await m.setInputFiles(attachment);}catch(e){upload={error:e.message};}
    check(`${id} resetting file input handled`,upload?.uploaded===true,upload?.error||'');
    check(`${id} parsing completed before upload resolves`,await m.run(`document.getElementById('name').value==='解析后的姓名'`));
    await pause(1500);
    check(`${id} refresh confirmation clicked`,await m.run(`document.body.dataset.confirmed==='yes' && document.body.dataset.cancelled!=='yes'`));
    check(`${id} parsed field survived`,await m.run(`document.getElementById('name').value==='解析后的姓名'`));
    await m.run(`(()=>{const input=document.getElementById('file');input.onchange=()=>{const d=document.createElement('div');d.setAttribute('role','dialog');d.innerHTML='<p>是否根据简历提交申请？</p><button id="apply">确定</button>';document.body.append(d);document.getElementById('apply').onclick=()=>document.body.dataset.applied='yes'};const dt=new DataTransfer();dt.items.add(new File(['fixture'],'test.pdf',{type:'application/pdf'}));input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await pause(500);
    check(`${id} application dialog untouched`,await m.run(`document.body.dataset.applied!=='yes'`));
    await m.closeWorkspace();
   }
   parent.destroy();return out;
  },{source:process.env.LOGIN_MANAGER_SOURCE||null,attachment});
  for(const r of results)console.log(`${r.ok?'PASS':'FAIL'} ${r.name}${r.details?' / '+r.details:''}`);
  console.log(JSON.stringify({tests:results.length,pass:results.filter(x=>x.ok).length,fail:results.filter(x=>!x.ok).length,offline:true}));
  assert.ok(results.every(x=>x.ok),'login/upload regression failed');
 }finally{await a.close();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
