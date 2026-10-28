const fs=require('fs'),path=require('path'),os=require('os'),{_electron}=require('playwright-core');
const root=path.resolve(process.env.SINGLE_PROFILE_SOURCE_ROOT||path.join(__dirname,'..'));
const {JsonStore}=require(path.join(root,'electron/store.cjs'));
const output=process.env.SINGLE_PROFILE_REPORT||path.join(__dirname,'../test-output/single-profile-native.json');
const exe=process.env.SINGLE_PROFILE_TEST_EXE||path.join(__dirname,'../node_modules/electron/dist/electron.exe');
const checks=[],check=(name,ok)=>checks.push({name,ok:!!ok});
const seed=()=>{const p=fs.mkdtempSync(path.join(os.tmpdir(),'yjt-同档案 实测-')),s=new JsonStore(p);s.init();s.update(x=>{x.meta.onboardingSeen=true;x.resume.basic.name='SAMPLE_PROFILE_LOCK';x.settings.autoCheckUpdates=false;x.settings.kimiBridgeEnabled=false;x.settings.jobs.autoRefresh=false;x.settings.apiEnabled=false;return x;});return p;};
const launch=p=>_electron.launch({executablePath:exe,args:[...(process.env.SINGLE_PROFILE_TEST_EXE?[]:[root]),'--user-data-dir='+p],env:{...process.env,ELECTRON_RUN_AS_NODE:undefined,YIJIAN_BACKGROUND_TEST:'1'},timeout:15000});
const ready=async a=>{const w=await a.firstWindow();await w.waitForSelector('.hero-card');return w;};
(async()=>{const profile=seed(),other=seed();let first,second,independent,identity;let duplicateError='';
try{
 first=await launch(profile);const page=await ready(first),pid=first.process().pid;
 identity=await first.evaluate(({app})=>({version:app.getVersion(),packaged:app.isPackaged,exe:process.execPath}));
 if(identity.version!==JSON.parse(fs.readFileSync(root+'/package.json')).version||Boolean(process.env.SINGLE_PROFILE_TEST_EXE)!==identity.packaged)throw Error('native production identity mismatch');
 check('first production process starts and loads real app',await first.evaluate(({app})=>app.getPath('userData'))===profile);
 const before=fs.readFileSync(path.join(profile,'state.json'));
 try{second=await launch(profile);await ready(second);}catch(e){duplicateError=String(e.message);}
 check('duplicate same-profile process exits before a second window',!second&&duplicateError.includes('PROFILE_ALREADY_RUNNING'));
 check('same-profile duplicate does not rewrite state bytes',fs.readFileSync(path.join(profile,'state.json')).equals(before));
 check('first process and existing window survive duplicate',first.process().pid===pid&&!first.process().exitCode&&await page.locator('.hero-card').count()===1);
 independent=await launch(other);await ready(independent);
 check('separate explicit profile still runs independently',independent.process().pid!==pid&&await independent.evaluate(({app})=>app.getPath('userData'))===other);
 check('existing SAMPLE resume stays unchanged',new JsonStore(profile).init().resume.basic.name==='SAMPLE_PROFILE_LOCK');
}finally{await independent?.close();await second?.close();await first?.close();}
const passed=checks.filter(x=>x.ok).length,j={version:JSON.parse(fs.readFileSync(root+'/package.json')).version,source:root,identity,checks,passed,total:checks.length,isolatedProfiles:true,realOfficialSaved:false,exit:passed===checks.length?0:1};
fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(j,null,2)+'\n');
checks.forEach(x=>console.log((x.ok?'PASS ':'FAIL ')+x.name));console.log(`SINGLE_PROFILE_NATIVE ${passed}/${checks.length}; isolatedProfiles=true; officialSaved=false; exit=${j.exit}`);process.exitCode=j.exit;
})().catch(e=>{console.error(e);process.exitCode=1;});
