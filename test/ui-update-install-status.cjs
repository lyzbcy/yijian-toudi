'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {_electron:electron}=require('playwright-core'),{JsonStore}=require('../electron/store.cjs');
(async()=>{
 const root=path.resolve(__dirname,'..'),output=path.join(root,'test-output'),profile=fs.mkdtempSync(path.join(os.tmpdir(),'yjt-install-status-'));fs.mkdirSync(output,{recursive:true});
 const store=new JsonStore(profile);store.init();store.update(s=>{s.meta.onboardingSeen=true;s.settings.kimiBridgeEnabled=false;s.settings.autoCheckUpdates=false;s.settings.jobs.autoRefresh=false;s.settings.apiPort=0;return s;});
 const application=await electron.launch({args:[root,'--user-data-dir='+profile],env:{...process.env,YIJIAN_BACKGROUND_TEST:'1'}}),page=await application.firstWindow(),errors=[],checks=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(15000);
 try{
  await page.locator('.hero-card').waitFor();
  async function statusFixture(responses){await application.evaluate(({ipcMain},items)=>{ipcMain.removeHandler('update:install-status');let index=0;ipcMain.handle('update:install-status',()=>items[Math.min(index++,items.length-1)]);},responses);await page.reload();await page.locator('.hero-card').waitFor();}
  await statusFixture([{status:'installed'},{status:'failed',message:'updated-app-restart-not-confirmed',restored:true,restorationDeferred:false}]);
  await page.locator('.toast-text').filter({hasText:'旧版文件已恢复'}).waitFor();assert.match(await page.locator('.toast-text').textContent(),/新版未能完成启动确认/);checks.push('Real renderer polls pending installed state and displays restored-old-version failure after fixture status transition');
  await statusFixture([{status:'installed'},{status:'failed',message:'updated-app-restart-not-confirmed',restored:false,restorationDeferred:true}]);
  await page.locator('.toast-text').filter({hasText:'当前程序仍在运行'}).waitFor();const text=await page.locator('.toast-text').textContent();assert.match(text,/先保存资料并正常关闭软件/);assert(!text.includes('旧版文件已恢复'));assert(!text.includes('updated-app-restart-not-confirmed'));checks.push('Live unconfirmed update explains retained recovery copy and saving/closing without claiming restoration or exposing helper codes');
  await statusFixture([{status:'installed'},{status:'restarted'}]);await page.waitForTimeout(1100);assert.equal(await page.locator('.toast-text').count(),0);checks.push('Confirmed restart ends watcher without an incorrect failure toast');
  assert.deepEqual(errors,[]);const report={version:require('../package.json').version,ok:true,fixtureOnly:true,realOSHelperVerified:false,checks,pageErrors:errors};fs.writeFileSync(path.join(output,'update-install-status.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
 }finally{await application.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
