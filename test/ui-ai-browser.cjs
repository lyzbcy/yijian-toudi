const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const {_electron:electron}=require('playwright-core');
const {JsonStore}=require('../electron/store.cjs');
const {run}=require('../scripts/ai-browser.cjs');
(async()=>{
 const root=path.resolve(__dirname,'..'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'yjt-ai-browser-中文-'));
 const store=new JsonStore(dir);store.init();store.update(s=>{s.meta.onboardingSeen=true;s.settings.jobs.autoRefresh=false;s.settings.autoCheckUpdates=false;s.settings.kimiBridgeEnabled=false;return s;});
 const app=await electron.launch({args:[root,'--yjt-local-preview',`--user-data-dir=${dir}`,'--remote-debugging-port=0','--remote-debugging-address=127.0.0.1'],env:{...process.env,YIJIAN_BACKGROUND_TEST:'1'}});
 const out=[],check=(name,ok)=>out.push({name,ok:Boolean(ok)});
 try{
  await app.firstWindow();
  await app.evaluate(async({session})=>{
   await session.fromPartition('persist:jd').protocol.handle('https',request=>{
    const u=new URL(request.url);let html;
    if(u.hostname==='open.weixin.qq.com')html=u.pathname==='/connect/second'?'<button>第二跨域子页</button>':u.pathname==='/connect/nested'?'<button onclick="parent.parent.postMessage(event.isTrusted?\'nested-native\':\'nested-synthetic\',\'*\')">嵌套子页按钮</button><label>嵌套姓名<input oninput="parent.parent.postMessage(\'nested-filled:\'+this.value+\':\'+event.isTrusted,\'*\')"></label><button type="submit">保存嵌套</button>':'<button id="frameBtn" onclick="parent.postMessage(\'frame-ok\',\'*\')">跨域子页按钮</button><iframe src="https://open.weixin.qq.com/connect/nested"></iframe>';
    else if(u.pathname==='/same-frame')html='<button>同域子页按钮</button>';
    else if(u.pathname==='/popup')html='<h1>JD login popup</h1><button onclick="window.close()">关闭子窗口</button>';
    else html='<h1>JD login fixture</h1><label>姓名<input id="name"></label><button id="popup" onclick="window.open(\'https://campus.jd.com/popup\')">登录子窗口</button><button id="save" type="submit" onclick="document.body.dataset.saved=\'yes\'">保存</button><button id="nav" onclick="location.href=\'https://campus.jd.com/done?code=fixture-secret\'">跳转</button><iframe src="https://open.weixin.qq.com/connect/mock?code=fixture-secret"></iframe><script>window.receipt=\'\';addEventListener(\'message\',e=>receipt=e.data)</script>';
    if(u.hostname==='campus.jd.com'&&!['/popup','/same-frame'].includes(u.pathname))html=html.replace('<iframe src=', '<iframe src="https://campus.jd.com/same-frame"></iframe><iframe src=')+'<iframe src="https://open.weixin.qq.com/connect/second"></iframe><div id="shadow"></div><script>shadow.attachShadow({mode:"open"}).innerHTML=`<label>Shadow姓名<input id="shadowName"></label><button onclick="window.shadowClicked=true">Shadow登录</button>`</script>';
    return new Response(html,{headers:{'content-type':'text/html;charset=utf-8'}});
   });
  });
  const port=Number(fs.readFileSync(path.join(dir,'DevToolsActivePort'),'utf8').split(/\r?\n/)[0]);
  const call=r=>run({...r,port});
  const list=await call({action:'list'}),appTarget=list.targets.find(t=>t.kind==='app');
  check('exact project preview identified',appTarget?.version===require('../package.json').version);
  await call({action:'app',targetId:appTarget.targetId,command:'openLogin',companyId:'jd',recruitType:'campus',waitMs:1000});
  const opened=await call({action:'list'}),site=opened.targets.find(t=>t.kind==='web'&&t.url.startsWith('https://campus.jd.com'));
  check('WebContentsView exposed as distinct target',Boolean(site));
  const cross=site.frames.find(f=>f.framePath.length===1&&f.url==='https://open.weixin.qq.com/connect/mock');
  check('cross-origin frame enumerated',Boolean(cross));
  if(!out.at(-1).ok){fs.mkdirSync(path.join(root,'test-output'),{recursive:true});fs.writeFileSync(path.join(root,'test-output','ai-browser-selected-frame-attempt.json'),JSON.stringify(opened,null,2));}
  check('OAuth query omitted from target inventory',!JSON.stringify(opened).includes('fixture-secret'));
  const mainSnapshot=await call({action:'snapshot',targetId:appTarget.targetId});
  check('selected app snapshot keeps official target alive',mainSnapshot.ok&&(await call({action:'list'})).targets.some(t=>t.targetId===site.targetId));
  fs.mkdirSync(path.join(root,'test-output'),{recursive:true});fs.writeFileSync(path.join(root,'test-output','ai-browser-mixed-frame-inventory.json'),JSON.stringify(opened,null,2));
  for(const [url,label] of [['https://campus.jd.com/same-frame','同域子页按钮'],['https://open.weixin.qq.com/connect/second','第二跨域子页'],['https://open.weixin.qq.com/connect/nested','嵌套子页按钮']]){
   const f=site.frames.find(f=>f.url===url);let s;try{s=f&&(await call({action:'snapshot',targetId:site.targetId,framePath:f.framePath})).result;}catch(e){e.message=label+': '+e.message;throw e;}
   check('mixed frame inventory resolves '+label,Boolean(s?.elements.some(e=>e.name===label)));
   if(label==='嵌套子页按钮'){
    await call({action:'click',targetId:site.targetId,framePath:f.framePath,snapshotId:s.snapshotId,ref:s.elements.find(e=>e.name===label).ref});
    const parentPage=app.windows().find(p=>p.url().startsWith('https://campus.jd.com'));
    check('nested frame native click is trusted and preserves parent chain',await parentPage.evaluate(()=>window.receipt)==='nested-native');
    await call({action:'fill',targetId:site.targetId,framePath:f.framePath,snapshotId:s.snapshotId,ref:s.elements.find(e=>e.name==='嵌套姓名').ref,value:'嵌套中文测试'});
    check('nested native fill remains in selected child',await parentPage.evaluate(()=>window.receipt)==='nested-filled:嵌套中文测试:true'&&await parentPage.locator('#name').inputValue()==='');
    await call({action:'fill',targetId:site.targetId,framePath:f.framePath,snapshotId:s.snapshotId,ref:s.elements.find(e=>e.name==='嵌套姓名').ref,value:''});
    check('nested native fill clears an existing value',await parentPage.evaluate(()=>window.receipt)==='nested-filled::true');
    await assert.rejects(call({action:'click',targetId:site.targetId,framePath:f.framePath,snapshotId:s.snapshotId,ref:s.elements.find(e=>e.name==='保存嵌套').ref}),/submission_confirmation_required/);
    check('nested submission guard preserved',true);
    await call({action:'snapshot',targetId:site.targetId,framePath:f.framePath});
    await assert.rejects(call({action:'click',targetId:site.targetId,framePath:f.framePath,snapshotId:s.snapshotId,ref:s.elements.find(e=>e.name===label).ref}),/stale_snapshot_refresh/);
    check('nested stale refs rejected',true);
   }
  }
  const snap=(await call({action:'snapshot',targetId:site.targetId})).result;
  const ref=name=>snap.elements.find(e=>e.name===name)?.ref;
  check('DOM snapshot exposes Chinese labels and refs',Boolean(ref('姓名')&&ref('登录子窗口')));
  await call({action:'fill',targetId:site.targetId,snapshotId:snap.snapshotId,ref:ref('姓名'),value:'本地测试'});
  const page=(await app.windows()).find(p=>p.url().startsWith('https://campus.jd.com'));
  check('native browser fill writes Chinese',await page.locator('#name').inputValue()==='本地测试');
  check('open Shadow DOM enumerated',snap.shadowRoots===1&&Boolean(ref('Shadow登录')));
  await call({action:'click',targetId:site.targetId,snapshotId:snap.snapshotId,ref:ref('Shadow登录')});
  check('native Shadow DOM click works',await page.evaluate(()=>window.shadowClicked)===true);
  await assert.rejects(call({action:'click',targetId:site.targetId,snapshotId:snap.snapshotId,ref:ref('保存')}),/submission_confirmation_required/);
  check('unconfirmed save did not click',await page.locator('body').getAttribute('data-saved')===null);
  await call({action:'click',targetId:site.targetId,snapshotId:snap.snapshotId,ref:ref('保存'),confirmSubmission:true});
  check('explicit confirmed fixture click works',await page.locator('body').getAttribute('data-saved')==='yes');
  const frameSnap=(await call({action:'snapshot',targetId:site.targetId,framePath:cross.framePath})).result;
  await call({action:'click',targetId:site.targetId,framePath:cross.framePath,snapshotId:frameSnap.snapshotId,ref:frameSnap.elements[0].ref});
  check('cross-origin frame click preserves parent callback',await page.evaluate(()=>window.receipt)==='frame-ok');
  const newer=(await call({action:'snapshot',targetId:site.targetId})).result;
  await assert.rejects(call({action:'click',targetId:site.targetId,snapshotId:snap.snapshotId,ref:ref('登录子窗口')}),/stale_snapshot_refresh/);
  check('stale refs rejected',true);
  const pop=await call({action:'click',targetId:site.targetId,snapshotId:newer.snapshotId,ref:newer.elements.find(e=>e.name==='登录子窗口').ref,waitMs:600});
  check('popup discovered without first-tab guessing',pop.targets.some(t=>t.url==='https://campus.jd.com/popup'));
  const fresh=(await call({action:'snapshot',targetId:site.targetId})).result;
  const nav=await call({action:'click',targetId:site.targetId,snapshotId:fresh.snapshotId,ref:fresh.elements.find(e=>e.name==='跳转').ref,waitMs:500});
  check('navigation events sanitized',nav.events.some(e=>e.url==='https://campus.jd.com/done')&&!JSON.stringify(nav).includes('fixture-secret'));
  const cliFile=path.join(dir,'中文-request.json');fs.writeFileSync(cliFile,JSON.stringify({action:'list',port}));
  const cli=spawnSync(process.execPath,[path.join(root,'scripts/ai-browser.cjs'),cliFile],{encoding:'utf8',windowsHide:true,timeout:20000});
  check('file-body CLI operates independently',cli.status===0&&JSON.parse(cli.stdout).ok);
  check('URL fallback title omits OAuth query',!cli.stdout.includes('fixture-secret'));
  check('CLI disconnect leaves app alive',(await call({action:'list'})).targets.some(t=>t.kind==='app'));
  await call({action:'app',targetId:appTarget.targetId,command:'closeLogin'});
  check('app status readback closed workspace',(await call({action:'app',targetId:appTarget.targetId,command:'status'})).result.active===false);
 }finally{await app.close();}
 out.forEach(x=>console.log(`${x.ok?'PASS':'FAIL'} ${x.name}`));
 console.log(JSON.stringify({tests:out.length,pass:out.filter(x=>x.ok).length,fail:out.filter(x=>!x.ok).length,isolatedProfile:true}));
 assert.ok(out.every(x=>x.ok),'AI browser native regression');
})().catch(e=>{console.error(e);process.exitCode=1;});
