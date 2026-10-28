const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {_electron:electron}=require('playwright-core');
(async()=>{
 const root=path.resolve(__dirname,'..'),sourceRoot=process.env.FIXTURE_SOURCE_ROOT||root;
 const app=await electron.launch({args:[root,`--user-data-dir=${fs.mkdtempSync(path.join(os.tmpdir(),'yjt-batch-actions-'))}`],executablePath:process.env.ELECTRON_EXECUTABLE||undefined,env:{...process.env,YIJIAN_BACKGROUND_TEST:'1'}});
 const results=[],check=(name,ok)=>results.push({name,ok:Boolean(ok)});
 try{
  await app.firstWindow();
  // Register before creation: Electron loadURL can finish before Playwright has
  // registered the new window. A synchronous app.windows().find races that event.
  const fixtureWindow=app.waitForEvent('window');
  await app.evaluate(async({BrowserWindow})=>{const win=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true}});await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(`<dialog id="resumeBatchDialog"><button class="dialog-close">关闭</button><div id="resumeBatchTargets"></div><input type="checkbox" id="resumeBatchAll"><span id="resumeBatchCount"></span><button id="resumeBatchStart">开始</button><select id="resumeBatchConcurrency"><option>4</option></select><button id="resumeBatchStop">停止</button><div id="resumeBatchProgress"></div><p id="resumeBatchMessage"></p></dialog>`));});
  const page=await fixtureWindow;
  await page.waitForURL(/^data:/);
  await page.evaluate(source=>{
   window.actions=0;window.startRequested=false;
   const entry={id:'jd:campus',name:'京东',status:'review-required',open:true,busy:false};
   window.batch={active:true,entries:[entry]};window.catalog={targets:[{id:'jd:campus',name:'京东',track:'campus'}],selected:['jd:campus'],batch:window.batch};
   window.oneClick={resumeBatchCatalog:async()=>window.catalog,resumeBatchAction:async()=>{window.actions++;},resumeBatchStart:()=>{window.startRequested=true;return new Promise(resolve=>window.resolveStart=resolve);},onResumeBatchChanged:fn=>window.changed=fn};
   new Function(source)();window.ResumeBatchUI.open(window.catalog);
  },fs.readFileSync(path.join(sourceRoot,'src/resume-batch-ui.js'),'utf8'));
  const focus=page.locator('[data-batch-action="focus"]');await focus.click();await page.waitForFunction(()=>window.actions===1);
  check('focus action remains reusable after success',!await focus.isDisabled());
  if(!await focus.isDisabled()){await focus.click();await page.waitForFunction(()=>window.actions===2);}
  check('focus can run twice',await page.evaluate(()=>window.actions===2));
  await page.evaluate(()=>window.changed({active:false,entries:[]}));await page.locator('#resumeBatchStart').click();await page.waitForFunction(()=>window.startRequested);
  await page.evaluate(()=>window.changed({active:false,entries:[]}));
  check('idle event cannot unlock an in-flight start',await page.locator('#resumeBatchStart').isDisabled());
  check('selection locked during start',await page.locator('[data-resume-target]').isDisabled());
  check('parallel count locked during start',await page.locator('#resumeBatchConcurrency').isDisabled());
  await page.evaluate(()=>window.resolveStart({active:true,entries:[]}));await page.waitForTimeout(60);
  check('successful start remains locked while active',await page.locator('#resumeBatchStart').isDisabled());
 }finally{await app.close();}
 for(const r of results)console.log(`${r.ok?'PASS':'FAIL'} ${r.name}`);
 console.log(JSON.stringify({tests:results.length,pass:results.filter(r=>r.ok).length,fail:results.filter(r=>!r.ok).length,offline:true}));
 assert.ok(results.every(r=>r.ok),'batch actions regression');
})().catch(e=>{console.error(e);process.exitCode=1});
