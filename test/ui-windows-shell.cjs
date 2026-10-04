'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {_electron:electron}=require('playwright-core');const {JsonStore}=require('../electron/store.cjs');
(async()=>{
 if(process.platform!=='win32'){console.log(JSON.stringify({skipped:true,scope:'Windows native chrome only'}));return;}
 const root=path.resolve(__dirname,'..'),profile=fs.mkdtempSync(path.join(os.tmpdir(),'yjt-windows-shell-')),s=new JsonStore(profile);s.init();s.update(v=>{v.meta.onboardingSeen=true;v.settings.kimiBridgeEnabled=false;v.settings.autoCheckUpdates=false;v.settings.jobs.autoRefresh=false;v.settings.apiPort=0;return v;});
 const output=process.env.YJT_WINDOWS_SHELL_OUTPUT||'test-output';fs.mkdirSync(output,{recursive:true});
 const app=await electron.launch({args:[...(process.env.YJT_PACKAGED_EXECUTABLE?[]:[root]),`--user-data-dir=${profile}`],executablePath:process.env.YJT_PACKAGED_EXECUTABLE||undefined,env:{...process.env,YIJIAN_BACKGROUND_TEST:'1'}});
 const report={ok:false,version:require('../package.json').version,packaged:!!process.env.YJT_PACKAGED_EXECUTABLE,platform:process.platform,realApplications:0,externalMessages:0};
 try{const p=await app.firstWindow();await p.waitForSelector('.hero-card');
  const native=await app.evaluate(({Menu,BrowserWindow})=>({applicationMenuAbsent:Menu.getApplicationMenu()===null,menuBarVisible:BrowserWindow.getAllWindows()[0].isMenuBarVisible(),resizable:BrowserWindow.getAllWindows()[0].isResizable(),minimizable:BrowserWindow.getAllWindows()[0].isMinimizable(),maximizable:BrowserWindow.getAllWindows()[0].isMaximizable(),closable:BrowserWindow.getAllWindows()[0].isClosable()}));
  report.native=native;assert(native.applicationMenuAbsent);assert.equal(native.menuBarVisible,false);assert(native.resizable&&native.minimizable&&native.maximizable&&native.closable);
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].showInactive());
  await p.waitForFunction(()=>navigator.windowControlsOverlay?.visible===true);
  await p.evaluate(async()=>{await document.fonts.ready;await Promise.all(document.getAnimations().map(a=>a.finished.catch(()=>{})));});
  await p.waitForFunction(()=>getComputedStyle(document.querySelector('.page.active')).opacity==='1');
  const pixels=await p.evaluate(async()=>{await document.querySelector('.brand-mark img').decode();const r=navigator.windowControlsOverlay?.getTitlebarAreaRect();return{platformClass:document.body.classList.contains('windows-shell'),logo:document.querySelector('.brand-mark img').getAttribute('src'),logoLoaded:document.querySelector('.brand-mark img').naturalWidth>0,overlayVisible:navigator.windowControlsOverlay?.visible,titlebarArea:r?{x:r.x,y:r.y,width:r.width,height:r.height}:null,scrollbarWidth:getComputedStyle(document.documentElement,'::-webkit-scrollbar').width,workspacePaddingRight:getComputedStyle(document.querySelector('.workspace-bar')).paddingRight};});
  report.renderer=pixels;assert(pixels.platformClass);assert(pixels.logoLoaded&&pixels.logo.endsWith('stickers/mascot.png'));assert.equal(pixels.overlayVisible,true);assert.equal(pixels.scrollbarWidth,'8px');assert.equal(pixels.workspacePaddingRight,'160px');
  const bytes=await app.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows()[0].webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG().toString('base64'));fs.writeFileSync(path.join(output,'windows-shell.png'),Buffer.from(bytes,'base64'));
  await p.evaluate(()=>window.oneClick.openFeedback('bug'));
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('feedback.html')).showInactive());
  const feedback=app.windows().find(w=>w.url().endsWith('feedback.html'));
  await feedback.waitForFunction(()=>navigator.windowControlsOverlay?.visible===true);
  report.feedback=await feedback.evaluate(()=>({overlayVisible:navigator.windowControlsOverlay.visible,headerTop:document.querySelector('main').getBoundingClientRect().top,dragRegion:getComputedStyle(document.querySelector('.window-titlebar')).webkitAppRegion,scrollbarWidth:getComputedStyle(document.documentElement,'::-webkit-scrollbar').width}));
  assert(report.feedback.overlayVisible&&report.feedback.headerTop>=40);assert.equal(report.feedback.dragRegion,'drag');assert.equal(report.feedback.scrollbarWidth,'8px');
  const feedbackPixels=await app.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('feedback.html')).webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG().toString('base64'));
  fs.writeFileSync(path.join(output,'windows-feedback-shell.png'),Buffer.from(feedbackPixels,'base64'));
  await feedback.locator('#feedbackCancel').click();
  for(let i=0;i<50&&await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().filter(w=>!w.isDestroyed()&&!w.webContents.isDestroyed()).length!==1);i++)await p.waitForTimeout(50);
  await app.evaluate(async({app,BrowserWindow})=>{
   const req=process.getBuiltinModule('node:module').createRequire(`${app.getAppPath()}/electron/main.cjs`);
   global.shellBatch=await req('./resume-batch-window.cjs').createResumeBatchWindow(BrowserWindow.getAllWindows().find(w=>!w.isDestroyed()&&!w.webContents.isDestroyed()&&w.webContents.getURL().includes('/src/index.html')),{id:'tencent',name:'腾讯',resumeRecruitType:'campus'},0,4,()=>global.shellBatch.dispose());
   BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith('data:')).showInactive();
  });
  const batch=app.windows().find(w=>w.url().startsWith('data:'));
  await batch.waitForFunction(()=>navigator.windowControlsOverlay?.visible===true);
  report.batch=await batch.evaluate(()=>({overlayVisible:navigator.windowControlsOverlay.visible,headerHeight:document.querySelector('header').getBoundingClientRect().height,captionPadding:getComputedStyle(document.querySelector('header')).paddingRight,dragRegion:getComputedStyle(document.querySelector('header')).webkitAppRegion,titleElided:getComputedStyle(document.querySelector('b')).textOverflow}));
  assert(report.batch.overlayVisible);assert.equal(report.batch.headerHeight,52);assert.equal(report.batch.captionPadding,'148px');assert.equal(report.batch.dragRegion,'drag');assert.equal(report.batch.titleElided,'ellipsis');
  const batchPixels=await app.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith('data:')).webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG().toString('base64'));
  fs.writeFileSync(path.join(output,'windows-batch-shell.png'),Buffer.from(batchPixels,'base64'));await app.evaluate(()=>global.shellBatch.dispose());
  report.ok=true;report.native=native;report.renderer=pixels;report.nativeCaptionButtonsClicked=false;console.log(JSON.stringify(report));
 }catch(e){report.failure=e.message;throw e;}finally{fs.writeFileSync(path.join(output,'windows-shell.json'),JSON.stringify(report,null,2)+'\n');await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
