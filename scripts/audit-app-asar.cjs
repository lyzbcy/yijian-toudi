'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
function asarModule(){const builder=path.dirname(require.resolve('electron-builder')),lib=path.dirname(require.resolve('app-builder-lib',{paths:[builder]}));return require(require.resolve('@electron/asar',{paths:[lib]}));}
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function auditAppAsar(archive,root,version){
 const asar=asarModule(),metadata=JSON.parse(asar.extractFile(archive,'package.json'));assert.equal(metadata.version,version);
 const entries=asar.listPackage(archive).map(name=>name.replaceAll('\\','/'));
 assert.deepEqual(entries.filter(name=>!/^\/(electron|src|node_modules)(\/|$)/.test(name)&&name!=='/package.json'),[]);
 assert.deepEqual(entries.filter(name=>/(^|\/)(state\.json|feedback-outbox\.json|\.env|test-output|verification|\.git)(\/|$)/.test(name)),[]);
 const embeddedSecrets=/sk-[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|qyapi\.weixin\.qq\.com\/cgi-bin\/webhook\/send\?key=[a-f0-9-]{15,}/;
 let ownFiles=0;
 for(const entry of entries.filter(name=>/^\/(electron|src)\//.test(name))){
  const relative=entry.slice(1),native=path.normalize(relative),stat=asar.statFile(archive,native);if(stat.files)continue;
  const original=path.join(root,relative);assert.ok(fs.existsSync(original)&&fs.statSync(original).isFile(),`Unexpected packaged application file: ${relative}`);
  const bytes=asar.extractFile(archive,native);assert.equal(sha(bytes),sha(fs.readFileSync(original)),`Packaged source mismatch: ${relative}`);
  if(/\.(cjs|js|json|ps1|html|css)$/.test(relative))assert.equal(embeddedSecrets.test(bytes.toString('utf8')),false,`Embedded private key pattern: ${relative}`);
  ownFiles++;
 }
 return{version,ownFilesMatched:ownFiles,asarEntries:entries.length,noPrivateDataFiles:true,noKnownKeyPatterns:true};
}
module.exports={auditAppAsar,sha};
