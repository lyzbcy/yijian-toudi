'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process'),{auditAppAsar,sha}=require('./audit-app-asar.cjs');
assert.equal(process.platform,'darwin','macOS verification must run on an actual macOS host');
const root=path.resolve(__dirname,'..'),version=require('../package.json').version;
const application=path.join(root,'release',process.arch==='arm64'?'mac-arm64':'mac','一键投递.app');
const executable=path.join(application,'Contents/MacOS/一键投递');assert.ok(fs.statSync(executable).isFile());
const audit=auditAppAsar(path.join(application,'Contents/Resources/app.asar'),root,version);
const names=fs.readdirSync(path.join(root,'release')).filter(name=>name===`一键投递-${version}-${process.arch}.zip`||name===`一键投递-${version}-${process.arch}.dmg`);
assert.equal(names.length,2,'Current native-architecture ZIP and DMG are required');
const artifacts=names.map(name=>{const bytes=fs.readFileSync(path.join(root,'release',name));return{name,bytes:bytes.length,sha256:sha(bytes)};});
for(const file of artifacts)fs.writeFileSync(path.join(root,'release',file.name+'.sha256'),`${file.sha256}  ${file.name}\n`);
// Verify both distributed containers rather than only the builder output.
const isolated=fs.mkdtempSync(path.join(process.env.RUNNER_TEMP||os.tmpdir(),'yjt-mac-install-'));
const mount=path.join(isolated,'mounted'),installed=path.join(isolated,'installed'),unzipped=path.join(isolated,'unzipped');
for(const directory of [mount,installed,unzipped])fs.mkdirSync(directory);
const dmg=artifacts.find(file=>file.name.endsWith('.dmg')),zip=artifacts.find(file=>file.name.endsWith('.zip'));
const appName='一键投递.app';let mounted=false;
try{
 execFileSync('hdiutil',['attach',path.join(root,'release',dmg.name),'-readonly','-nobrowse','-mountpoint',mount],{stdio:'pipe',timeout:60000});mounted=true;
 auditAppAsar(path.join(mount,appName,'Contents/Resources/app.asar'),root,version);
 // ditto preserves framework symlinks and executable modes.
 execFileSync('ditto',[path.join(mount,appName),path.join(installed,appName)],{stdio:'pipe',timeout:60000});
}finally{if(mounted)execFileSync('hdiutil',['detach',mount],{stdio:'pipe',timeout:60000});}
execFileSync('ditto',['-x','-k',path.join(root,'release',zip.name),unzipped],{stdio:'pipe',timeout:60000});
auditAppAsar(path.join(installed,appName,'Contents/Resources/app.asar'),root,version);
auditAppAsar(path.join(unzipped,appName,'Contents/Resources/app.asar'),root,version);
const installedExecutable=path.join(installed,appName,'Contents/MacOS/一键投递');fs.accessSync(installedExecutable,fs.constants.X_OK);
const report={ok:true,...audit,host:process.platform,architecture:process.arch,artifacts,dmgMountedAndCopied:true,zipExtractedAndAudited:true,runtimeTarget:'isolated-dmg-copy',signature:'not-verified',endUserInstall:'not-verified',realAccounts:'not-verified'};
fs.mkdirSync(path.join(root,'test-output'),{recursive:true});fs.writeFileSync(path.join(root,'test-output/mac-candidate.json'),JSON.stringify(report,null,2));
if(process.env.GITHUB_ENV)fs.appendFileSync(process.env.GITHUB_ENV,`YJT_PACKAGED_EXECUTABLE=${installedExecutable}\nYJT_VISIBLE_TEST=1\n`);
console.log(JSON.stringify(report));
