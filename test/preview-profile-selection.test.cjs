const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),os=require('os'),{spawnSync}=require('child_process');
const source=path.resolve(process.env.SINGLE_PROFILE_SOURCE_ROOT||path.join(__dirname,'..'));
function fixture(){const root=fs.mkdtempSync(path.join(os.tmpdir(),'yjt-选择 中文-')),data=root+'/.local-data',chosen=data+'/live-fixture';fs.mkdirSync(chosen,{recursive:true});fs.writeFileSync(chosen+'/state.json','{}');return{root,data,chosen,default:path.join(root,'appdata','yijian-toudi')};}
const q=s=>"'"+s.replaceAll("'","''")+"'";
function run(f,code){
 const s=fs.readFileSync(source+'/zeen-tools/local-preview.ps1','utf8'),a=s.indexOf('# PREVIEW_PROFILE_HELPERS_START'),b=s.indexOf('# END_PREVIEW_PROFILE_HELPERS');let helpers;
 if(a>=0&&b>a)helpers=s.slice(a,b);
 else{
  // Execute the actual older resolver expression, rather than falsely counting
  // its already-working canonical default as a failure for lacking a new API.
  const old=s.match(/^\$profile = (.+)$/m);assert.ok(old,'real production resolver required');
  const expression=old[1].replaceAll('$env:YJT_PREVIEW_PROFILE','$Override').replaceAll('$env:APPDATA','$AppData');
  helpers=`function Resolve-PreviewProfile([string]$Root,[string]$AppData,[string]$Override){$profile = ${expression}\nreturn $profile\n}`;
 }
 const file=f.root+'/guard-test.ps1';fs.writeFileSync(file,'\uFEFF$ErrorActionPreference="Stop"\n'+helpers+'\n'+code+'\n');const r=spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',file],{windowsHide:true,encoding:'utf8',timeout:15000});assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/PROFILE_SELECTION_OK/);
}
test('ordinary preview without preference still uses canonical profile',()=>{const f=fixture();run(f,`if((Resolve-PreviewProfile ${q(f.root)} ${q(path.join(f.root,'appdata'))} '') -ne ${q(f.default)}){throw 'default changed'};Write-Output PROFILE_SELECTION_OK`);});
test('ordinary start and stop resolve saved private preference; explicit tests override it',()=>{const f=fixture();fs.writeFileSync(f.data+'/local-preview-profile.json',JSON.stringify({schemaVersion:1,profile:f.chosen}));run(f,`if((Resolve-PreviewProfile ${q(f.root)} ${q(f.root)} '') -ne ${q(path.resolve(f.chosen))}){throw 'preference ignored'};if((Resolve-PreviewProfile ${q(f.root)} ${q(f.root)} ${q(f.default)}) -ne ${q(f.default)}){throw 'override ignored'};Write-Output PROFILE_SELECTION_OK`);});
test('invalid preferred path, schema, directory, missing state and base junction never fall back',()=>{
 const cases=[];
 for(const choice of [{schemaVersion:1,profile:'outside'},{schemaVersion:2,profile:'chosen'},{schemaVersion:1,profile:'missing'}]){const f=fixture();choice.profile=choice.profile==='chosen'?f.chosen:f.root+'/'+choice.profile;fs.writeFileSync(f.data+'/local-preview-profile.json',JSON.stringify(choice));cases.push(f);}
 const directory=fixture();fs.mkdirSync(directory.data+'/local-preview-profile.json');cases.push(directory);
 const jroot=fs.mkdtempSync(path.join(os.tmpdir(),'yjt-junction-')),outside=jroot+'/outside',j={root:jroot,data:jroot+'/.local-data',chosen:jroot+'/.local-data/live-fixture'};fs.mkdirSync(outside+'/live-fixture',{recursive:true});fs.writeFileSync(outside+'/live-fixture/state.json','{}');fs.symlinkSync(outside,j.data,'junction');fs.writeFileSync(j.data+'/local-preview-profile.json',JSON.stringify({schemaVersion:1,profile:j.chosen}));cases.push(j);
 for(const f of cases)run(f,`$caught=$false;try{Resolve-PreviewProfile ${q(f.root)} ${q(f.root)} ''|Out-Null}catch{$caught=$true};if(!$caught){throw 'invalid preference accepted'};Write-Output PROFILE_SELECTION_OK`);
 const production=fs.readFileSync(source+'/zeen-tools/local-preview.ps1','utf8');assert.match(production,/\$stateItem\.Attributes -band \[IO\.FileAttributes\]::ReparsePoint/);assert.match(production,/\$preferenceItem\.Attributes -band \[IO\.FileAttributes\]::ReparsePoint/);
});
test('process comparison handles quotes, trailing separators, exact paths and distinct defaults',()=>{const f=fixture(),p=path.resolve(f.chosen);run(f,`$p=${q(p)};$d=${q(f.default)};foreach($cmd in @('electron "--user-data-dir='+$p+'"','electron --user-data-dir="'+$p+'"','electron "--user-data-dir='+$p+'\\"')){if(!(Test-PreviewProcessProfile $cmd ($p+'\\') $d)){throw 'normalized quoted path missed'}};if(Test-PreviewProcessProfile ('electron "--user-data-dir='+$p+'-other"') $p $d){throw 'prefix collision'};if(Test-PreviewProcessProfile 'installed.exe' $p $d){throw 'other default profile blocked'};if(!(Test-PreviewProcessProfile 'installed.exe' $d $d)){throw 'same default missed'};Write-Output PROFILE_SELECTION_OK`);});
