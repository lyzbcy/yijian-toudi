'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {installationRoot,validateZipEntries,validateStagedUpdate}=require('../electron/macos-update.cjs');
const {validateArchive}=require('../electron/macos-update-archive.cjs');
const opts={executable:'/Applications/一键投递.app/Contents/MacOS/一键投递',userData:'/Users/sample/Library/Application Support/一键投递',home:'/Users/sample',platform:'darwin',arch:'arm64',packaged:true};
test('Mac automatic installation is limited to real Applications locations outside user data',()=>{
 assert.equal(installationRoot(opts),'/Applications/一键投递.app');
 assert.equal(installationRoot({...opts,executable:'/Users/sample/Applications/一键投递.app/Contents/MacOS/一键投递'}),'/Users/sample/Applications/一键投递.app');
 for(const patch of [{platform:'win32'},{arch:'ia32'},{packaged:false},{executable:'/Volumes/download/一键投递.app/Contents/MacOS/一键投递'},{executable:'/Applications/Parent/一键投递.app/Contents/MacOS/一键投递'},{userData:'/Applications/一键投递.app/profile'},{executable:'/Applications/一键投递.app/Contents/MacOS/Electron'}])assert.equal(installationRoot({...opts,...patch}),null);
});
test('Mac archive validates symlink targets before extraction and refuses duplicates and traversal',async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'yjt-mac-zip-')),file=path.join(directory,'archive.zip');
 function zip(rows){const local=[],central=[];let offset=0;for(const [name,contents,type=0x8000]of rows){const n=Buffer.from(name),data=Buffer.from(contents),head=Buffer.alloc(30),entry=Buffer.alloc(46);head.writeUInt32LE(0x04034b50);head.writeUInt32LE(data.length,18);head.writeUInt32LE(data.length,22);head.writeUInt16LE(n.length,26);entry.writeUInt32LE(0x02014b50);entry.writeUInt32LE(data.length,20);entry.writeUInt32LE(data.length,24);entry.writeUInt16LE(n.length,28);entry.writeUInt32LE((type*65536)>>>0,38);entry.writeUInt32LE(offset,42);local.push(head,n,data);central.push(entry,n);offset+=head.length+n.length+data.length;}const body=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(rows.length,8);end.writeUInt16LE(rows.length,10);end.writeUInt32LE(body.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...local,body,end]);}
 const base=[['一键投递.app/Contents/Info.plist','plist'],['一键投递.app/Contents/MacOS/一键投递','executable']];
 try{await fs.writeFile(file,zip([...base,['一键投递.app/Contents/Frameworks/Current','../MacOS',0xa000]]));assert.equal((await validateArchive(file)).entries,3);
  for(const target of ['/tmp/outside','../../../outside','..\\outside']){await fs.writeFile(file,zip([...base,['一键投递.app/Contents/Frameworks/Current',target,0xa000]]));await assert.rejects(validateArchive(file),/mac-zip-external-link/);}
  await fs.writeFile(file,zip([...base,base[0]]));await assert.rejects(validateArchive(file),/mac-zip-entry-path-invalid/);
  await fs.writeFile(file,zip([...base,['一键投递.app/../outside','bad']]));await assert.rejects(validateArchive(file),/mac-zip-entry-path-invalid/);
 }finally{await fs.rm(directory,{recursive:true,force:true});}
});
test('Mac zip entries refuse traversal, extra roots, backslashes and missing executable',()=>{
 const good='一键投递.app/\n一键投递.app/Contents/Info.plist\n一键投递.app/Contents/MacOS/一键投递\n';assert.equal(validateZipEntries(good).length,3);
 for(const extra of ['../outside','一键投递.app/../outside','一键投递.app/Contents/./outside','Other.app/file','一键投递.app/Contents/evil\\file','/一键投递.app/Contents/file'])assert.throws(()=>validateZipEntries(good+extra),/mac-archive-path-invalid/);
 assert.throws(()=>validateZipEntries('一键投递.app/Contents/Info.plist'),/mac-archive-incomplete/);
});
test('Mac staging rehashes the exact newer architecture zip and rejects tampering or symlink',async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'yjt-mac-stage-'));try{
  const bytes=Buffer.from('unit-boundary-only-not-an-installable-zip'),file=path.join(directory,'yijian-toudi-0.5.41-arm64.zip');await fs.writeFile(file,bytes);
  const staged={ok:true,staged:true,installed:false,shaOk:true,shaChecked:true,version:'0.5.41',file,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')},context={directory,current:'0.5.40',arch:'arm64'};
  assert.equal(await validateStagedUpdate(staged,context),staged);
  for(const patch of [{version:'0.5.40'},{shaChecked:false},{installed:true},{file:path.join(directory,'other.zip')},{bytes:0}])await assert.rejects(validateStagedUpdate({...staged,...patch},context),/verified-mac-update-required/);
  await assert.rejects(validateStagedUpdate(staged,{...context,arch:'x64'}),/verified-mac-update-required/);
  await fs.writeFile(file,Buffer.alloc(bytes.length,1));await assert.rejects(validateStagedUpdate(staged,context),/staged-update-changed/);
 }finally{await fs.rm(directory,{recursive:true,force:true});}
});
