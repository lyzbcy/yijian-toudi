const fs=require('fs'),path=require('path'),os=require('os'),{_electron:electron}=require('playwright-core');
const root=path.resolve(__dirname,'..'),source=process.env.RESUME_EDITOR_SOURCE_ROOT||root,{JsonStore}=require(path.join(source,'electron/store.cjs'));
(async()=>{
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'yjt-editor-')),store=new JsonStore(profile);store.init();
store.update(s=>{s.meta.onboardingSeen=true;s.settings.kimiBridgeEnabled=false;s.settings.autoCheckUpdates=false;s.settings.apiEnabled=false;s.settings.autoRefreshJobs=false;
const p=s.resume.profiles.find(p=>p.id===s.resume.activeProfileId);p.education=[{school:'隔离测试大学',start:'2023-09-08',end:'2027-06',isHighestDegree:false,isDoubleDegree:false,learningMode:'测试学习形式',majorCategory:'测试分类'}];p.experience=[{company:'隔离测试公司',start:'2026-07-02',end:'至今'}];p.projects=[{name:'隔离测试项目',start:'2026-08',end:'2026-09-28'}];return s;});
const tests=[],check=(name,ok)=>tests.push({name,ok:!!ok}),launch=()=>electron.launch({executablePath:process.env.ELECTRON_EXECUTABLE||undefined,args:[source,`--user-data-dir=${profile}`,...(process.env.UI_RESUME_OBSERVER_MANIFEST?['--remote-debugging-port=2847','--remote-debugging-address=127.0.0.1']:[])],env:{...process.env,YIJIAN_BACKGROUND_TEST:'1',ELECTRON_DISABLE_SECURITY_WARNINGS:'true'}});
let app=await launch();
const runtime=await app.evaluate(({app})=>({version:app.getVersion(),appPath:app.getAppPath(),executable:process.execPath}));
if(process.env.ELECTRON_EXECUTABLE&&(!runtime.appPath.endsWith('.asar')||path.resolve(runtime.executable).toLowerCase()!==path.resolve(process.env.ELECTRON_EXECUTABLE).toLowerCase())){await app.close();throw Error('packaged_test_expected_actual_ASAR_executable');}
try{
const p=await app.firstWindow();await p.waitForSelector('.hero-card');await p.locator('.sidebar [data-page=resume]').first().click();await p.waitForSelector('[name="education.0.school"]');
const value=n=>p.locator(`[name="${n}"]`).inputValue(),has=n=>p.locator(`[name="${n}"]`).count();
for(const key of ['majorCategory','isFullTime','isHighestDegree','isDoubleDegree'])check('education editor '+key,await has('education.0.'+key)===1);
check('exact day displayed without truncation',await value('education.0.start')==='2023-09-08');check('month displayed unchanged',await value('education.0.end')==='2027-06');
check('ongoing displayed without loss',await value('experience.0.end')==='至今');
const ready=await has('education.0.isHighestDegree');
if(ready){check('negative answer visibly selected',await value('education.0.isHighestDegree')==='false');await p.locator('[name="education.0.isHighestDegree"]').selectOption('true');await p.locator('[name="education.0.isDoubleDegree"]').selectOption('false');}
await p.locator('#saveResumeButton').click();await p.waitForTimeout(500);
const saved=await p.evaluate(()=>window.oneClick.getState()),edu=saved.resume.education[0];
check('save preserves exact day',edu.start==='2023-09-08');check('save preserves ongoing',saved.resume.experience[0].end==='至今');check('save preserves project exact day',saved.resume.projects[0].end==='2026-09-28');
check('saved flags retain true and false types',edu.isHighestDegree===true&&edu.isDoubleDegree===false);check('enum/major-category persisted',edu.learningMode==='测试学习形式'&&edu.majorCategory==='测试分类');
const {planJdWidgets}=require(path.join(source,'electron/jd-widget-fill.cjs'));
const widgets=planJdWidgets(saved.resume);check('saved app facts reach JD exact positive/negative requests',widgets.some(x=>x.key==='education.0.isHighestDegree'&&x.value==='是')&&widgets.some(x=>x.key==='education.0.isDoubleDegree'&&x.value==='否'));
if(ready){
 await p.locator('[name="projects.0.start"]').fill('2026-02-31');await p.locator('#saveResumeButton').click();await p.waitForTimeout(350);const current=await p.evaluate(()=>window.oneClick.getState());check('invalid date keeps persisted data untouched',current.resume.projects[0].start==='2026-08');check('invalid date remains draft for correction',await value('projects.0.start')==='2026-02-31');check('validation tells user which segment',/项目经历第1段/.test(await p.locator('#toastRegion').textContent()));await p.locator('[name="projects.0.start"]').fill('2026-08');
 await p.locator('[data-add-segment=education]').click();await p.waitForSelector('[name="education.1.isHighestDegree"]');await p.locator('[name="education.1.isHighestDegree"]').selectOption('false');await p.locator('#saveResumeButton').click();await p.waitForTimeout(400);const s=await p.evaluate(()=>window.oneClick.getState());check('negative-only trailing segment is not trimmed',s.resume.education.length===2&&s.resume.education[1].isHighestDegree===false);check('unanswered flag remains distinct from no',s.resume.education[1].isDoubleDegree==='');
 if(process.env.UI_RESUME_OBSERVER_MANIFEST){const manifest=path.resolve(process.env.UI_RESUME_OBSERVER_MANIFEST);fs.writeFileSync(manifest,JSON.stringify({port:2847,source,profile,tests,version:require(path.join(source,'package.json')).version}));console.log('RESUME_EDITOR_OBSERVER_READY');const until=Date.now()+180000;while(!fs.existsSync(manifest+'.done')&&Date.now()<until)await new Promise(r=>setTimeout(r,1000));if(!fs.existsSync(manifest+'.done'))throw Error('observer_timeout');}
}
await app.close();app=null;app=await launch();const reopened=await app.firstWindow();await reopened.waitForSelector('.hero-card');await reopened.locator('.sidebar [data-page=resume]').first().click();await reopened.waitForSelector('[name="education.0.school"]');
check('relaunch retains exact date',await reopened.locator('[name="education.0.start"]').inputValue()==='2023-09-08');check('relaunch retains ongoing',await reopened.locator('[name="experience.0.end"]').inputValue()==='至今');if(ready)check('relaunch negative selection matches state',await reopened.locator('[name="education.0.isDoubleDegree"]').inputValue()==='false');
}finally{await app?.close();}
const report={at:new Date().toISOString(),source,runtime,version:require(path.join(source,'package.json')).version,isolatedProfile:profile,realWebsite:false,tests,passed:tests.filter(t=>t.ok).length,total:tests.length};const file=process.env.RESUME_EDITOR_REPORT||path.join(root,'test-output/ui-resume-editor.json');fs.writeFileSync(file,JSON.stringify(report,null,2));console.log(`RESUME_EDITOR_UI ${report.passed}/${report.total}`);for(const t of tests.filter(t=>!t.ok))console.log('FAIL '+t.name);if(tests.some(t=>!t.ok))process.exitCode=1;
})().catch(e=>{console.error(e.message);process.exitCode=1});
