'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {_electron:electron}=require('playwright-core');
const {JsonStore}=require('../electron/store.cjs');
const root=path.resolve(__dirname,'..'),version=require('../package.json').version;
const out=process.env.YJT_AUTHOR_OUTPUT||path.join(root,'test-output','author-page');fs.mkdirSync(out,{recursive:true});
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'yjt-author-'));
const store=new JsonStore(profile);store.init();store.update(s=>{s.meta.onboardingSeen=true;s.settings.kimiBridgeEnabled=false;s.settings.autoCheckUpdates=false;s.settings.jobs.autoRefresh=false;s.settings.apiPort=0;return s;});
const report={ok:false,version,platform:process.platform,packaged:!!process.env.YJT_PACKAGED_EXECUTABLE,visible:process.env.YJT_VISIBLE_TEST==='1'||process.env.YJT_INACTIVE_TEST==='1',shownInactive:process.env.YJT_INACTIVE_TEST==='1',sampleProfile:true,checks:[],widths:[],externalLinksOpened:0,realApplications:0,externalMessages:0,phoneScanOrMembershipVerified:false};
let application,page;const errors=[];
async function authorReady(){
 await page.waitForSelector('#page-author.active');
 await page.waitForFunction(()=>document.querySelectorAll('.page.active').length===1&&document.querySelector('.sidebar .nav-item.active')?.dataset.page==='author');
 await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.querySelectorAll('#page-author img')].map(i=>i.decode()));await Promise.all(document.querySelector('#page-author').getAnimations().map(a=>a.finished.catch(()=>{})));scrollTo({top:0,behavior:'instant'});});
 assert.equal(await page.locator('#pageTitle').textContent(),'关于捞鱼');
}
(async()=>{
 application=await electron.launch({args:[...(process.env.YJT_PACKAGED_EXECUTABLE?[]:[root]),`--user-data-dir=${profile}`],executablePath:process.env.YJT_PACKAGED_EXECUTABLE||undefined,env:{...process.env,YIJIAN_BACKGROUND_TEST:process.env.YJT_VISIBLE_TEST==='1'?'0':'1',ELECTRON_DISABLE_SECURITY_WARNINGS:'true'}});
 try{
  page=await application.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.waitForSelector('.hero-card');
  if(process.env.YJT_INACTIVE_TEST==='1')await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].showInactive());
  await application.evaluate(({shell})=>{global.__authorExternal=[];shell.openExternal=async url=>{global.__authorExternal.push(url);};});
  for(const width of [1100,1280,1440]){
   await application.evaluate(({BrowserWindow},width)=>{const w=BrowserWindow.getAllWindows()[0];w.setMinimumSize(0,0);w.setContentSize(width,900);},width);
   await page.locator('.sidebar [data-page="author"]').click();await authorReady();
   const images=await page.locator('#page-author .qr-grid img').evaluateAll(imgs=>imgs.map(i=>{const r=i.getBoundingClientRect();return{alt:i.alt,src:i.getAttribute('src'),naturalWidth:i.naturalWidth,naturalHeight:i.naturalHeight,width:r.width,height:r.height,right:r.right};}));
   assert.equal(images.length,3);assert(images.every(i=>i.width>=150&&i.right<=width&&i.naturalWidth>0));
   assert.equal(await page.locator('#page-author [data-external], #page-author a[href^="http"]').count(),0);
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   await page.screenshot({path:path.join(out,`page-${width}.png`),animations:'disabled'});
   const qrNames=[];
   for(let i=0;i<3;i++){
    const button=page.locator('#page-author [data-author-qr]').nth(i);await button.focus();await button.press('Enter');await page.locator('#authorQrDialog[open]').waitFor();await page.locator('#authorQrImage').evaluate(i=>i.decode());
    assert.equal(await page.locator('#authorQrImage').getAttribute('src'),images[i].src);assert.equal(await page.locator('#authorQrTitle').textContent(),images[i].alt);
    const name=`enlarged-${width}-${i}.png`;await page.locator('#authorQrImage').screenshot({path:path.join(out,name),animations:'disabled'});qrNames.push(name);
    if(i===1)await page.locator('#authorQrDialog .dialog-close').click();else await page.keyboard.press('Escape');
    await page.waitForFunction(()=>!document.querySelector('#authorQrDialog').open);assert.equal(await button.evaluate(b=>document.activeElement===b),true);
   }
   report.widths.push({width,images,enlargedScreenshots:qrNames});
  }
  report.checks.push('Actual sidebar navigation and three widths; original packaged images load without overflow','Actual keyboard enlargement of all three QR images; Escape and close button restore focus');
  await page.locator('.sidebar [data-page="settings"]').click();await page.locator('#settingsAuthorButton').click();await authorReady();
  await page.locator('.sidebar [data-page="jobs"]').click();await page.locator('#promoButton').click();await authorReady();
  assert.deepEqual(await application.evaluate(()=>global.__authorExternal),[]);assert.equal(application.windows().length,1);assert.deepEqual(errors,[]);
  report.checks.push('Settings and floating entries reach same standalone page, with one window and no external open request');
  report.externalOpenHookIsExplicitObservationFixture=true;report.externalLinksOpened=0;report.pageErrors=errors;report.ok=true;
  console.log(JSON.stringify({ok:true,version,packaged:report.packaged,widths:report.widths.map(v=>v.width),groups:report.checks.length,externalLinksOpened:0}));
 }finally{if(application)await application.close();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');}
})().catch(e=>{report.failure={message:e.message,stack:e.stack};fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.error(e);process.exitCode=1;});
