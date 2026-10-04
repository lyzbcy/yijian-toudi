const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawnSync}=require('node:child_process');
for(const key of ['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','http_proxy','https_proxy','all_proxy'])delete process.env[key];
const {chromium}=require('playwright-core');
const {JsonStore}=require('../electron/store.cjs');
(async()=>{
 const root=path.resolve(__dirname,'..'), profile=fs.mkdtempSync(path.join(os.tmpdir(),'yjt-preview-中文-'));
 const s=new JsonStore(profile);s.init();s.update(x=>{x.meta.onboardingSeen=true;x.settings.autoCheckUpdates=false;x.settings.kimiBridgeEnabled=false;x.settings.jobs.autoRefresh=false;return x;});
 const env={...process.env,YJT_PREVIEW_PROFILE:profile,YJT_PREVIEW_CDP_PORT:'0',YJT_PREVIEW_NO_PAUSE:'1'};
 const execute=name=>spawnSync('powershell.exe',['-NoProfile','-Command',`& '${path.join(root,'zeen-tools',name).replaceAll("'","''")}'`],{cwd:os.tmpdir(),env,encoding:'utf8',windowsHide:true,timeout:60000});
 const results=[],check=(name,ok)=>results.push({name,ok:Boolean(ok)});let browser;
 try{
  const first=execute('一键本地预览.bat');console.log(first.stdout.trim());if(first.status)console.log(first.stderr.trim());
  check('double-click entry launches from unrelated cwd',first.status===0&&first.stdout.includes('PREVIEW_STARTED'));
  const port=fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split(/\r?\n/)[0];
  browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const page=browser.contexts()[0].pages().find(p=>p.url().includes('/src/index.html'));
  check('source app page rendered',Boolean(page));
  await page.waitForSelector('.hero-card');
  check('local preview marker in document title',(await page.title()).includes('LOCAL PREVIEW'));
  check('preview runtime query active',new URL(page.url()).searchParams.get('localPreview')==='1');
  check('latest source version shown',(await page.locator('body').textContent()).includes(`v${require('../package.json').version}`));
  check('sidebar version comes from runtime',(await page.locator('#appVersion').textContent())===require('../package.json').version);
  await page.locator('[data-page="resume"]').first().click();await page.waitForSelector('#resume-basic');
  check('resume page usable',await page.locator('#resumeForm [name]').count()>20);
  const second=execute('一键本地预览.bat');check('duplicate launch does not create another instance',second.status===0&&second.stdout.includes('PREVIEW_ALREADY_RUNNING'));
  const stop=execute('关闭本地预览.bat');if(stop.status)console.log(stop.stderr);check('paired stop succeeds',stop.status===0&&stop.stdout.includes('PREVIEW_STOPPED count=1'));
  let open=true;try{await fetch(`http://127.0.0.1:${port}/json/version`)}catch{open=false;}check('debug listener released',!open);
  const again=execute('关闭本地预览.bat');check('stop idempotent',again.status===0&&again.stdout.includes('count=0'));
 }finally{await browser?.close().catch(()=>{});execute('关闭本地预览.bat');}
 results.forEach(r=>console.log(`${r.ok?'PASS':'FAIL'} ${r.name}`));
 console.log(JSON.stringify({tests:results.length,pass:results.filter(x=>x.ok).length,fail:results.filter(x=>!x.ok).length,isolatedProfile:true}));
 if(results.some(x=>!x.ok))process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
