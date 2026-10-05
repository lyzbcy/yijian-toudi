const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),zlib=require('node:zlib'),{spawn}=require('node:child_process');
const {FILES,ROOT,packageFeedback,readArchive,verifyArchive}=require('../scripts/package-feedback.cjs');
const sourceRoot=path.resolve(__dirname,'..'),version=require('../package.json').version;
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'yjt-feedback-package-'));assert.ok(dir.startsWith(path.resolve(os.tmpdir())+path.sep));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const artifact=packageFeedback({sourceRoot,outputDir:dir});return{dir,...artifact};}
test('feedback archive is complete, immutable and independently hash/version verified',t=>{
 const artifact=fixture(t),files=readArchive(fs.readFileSync(artifact.archive),version);
 assert.deepEqual([...files.keys()].sort(),[...FILES].sort());assert.equal(verifyArchive(artifact.archive,artifact.checksum,version).files,11);
 for(const [name,bytes]of files)if(name!=='version.json')assert.deepEqual(bytes,fs.readFileSync(path.join(sourceRoot,name)));
 const before=fs.readFileSync(artifact.archive);packageFeedback({sourceRoot,outputDir:artifact.dir});assert.deepEqual(fs.readFileSync(artifact.archive),before);
 assert.throws(()=>verifyArchive(artifact.archive,artifact.checksum,'99.0.0'),/version-invalid/);
 fs.writeFileSync(artifact.checksum,'invalid checksum');assert.throws(()=>verifyArchive(artifact.archive,artifact.checksum,version),/checksum-invalid/);
});
test('feedback archive rejects traversal, links, hidden extras, duplicate paths and appended data',t=>{
 const artifact=fixture(t),raw=zlib.gunzipSync(fs.readFileSync(artifact.archive));
 function mutate(fn){const data=Buffer.from(raw);fn(data);let sum=0;for(let i=0;i<512;i++)sum+=i>=148&&i<156?32:data[i];data.fill(0,148,156);data.write(sum.toString(8).padStart(6,'0')+'\0 ',148,'ascii');return zlib.gzipSync(data);}
 const setName=(data,name)=>{data.fill(0,0,100);data.write(name,0,'utf8');};
 for(const name of [ROOT+'/../secret',ROOT+'/.env',ROOT+'/unexpected.cjs'])assert.throws(()=>readArchive(mutate(data=>setName(data,name)),version),/file-invalid/);
 assert.throws(()=>readArchive(mutate(data=>{data[156]=50;}),version),/entry-invalid/);
 const second=512+Math.ceil(Number.parseInt(raw.subarray(124,136).toString(),8)/512)*512;
 assert.throws(()=>readArchive(mutate(data=>setName(data,raw.subarray(second,second+100).toString().replace(/\0.*$/s,''))),version),/file-invalid/);
 const appended=Buffer.from(raw);appended[appended.length-1]=1;assert.throws(()=>readArchive(zlib.gzipSync(appended),version),/end-invalid/);
});
test('unpacked service boots without repository/dependencies and exposes actual matching health version',async t=>{
 const artifact=fixture(t),files=readArchive(fs.readFileSync(artifact.archive),version),directory=path.join(artifact.dir,'isolated-service');fs.mkdirSync(directory);
 for(const [name,bytes]of files){const target=path.join(directory,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes);}
 const child=spawn(process.execPath,['support/feedback-server.cjs'],{cwd:directory,windowsHide:true,env:{...process.env,YJT_FEEDBACK_PUBLIC_URL:'https://feedback.example.invalid/',YJT_FEEDBACK_WEBHOOK:'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key='+'0'.repeat(32),YJT_FEEDBACK_DATA:path.join(directory,'isolated-data'),PORT:'0'},stdio:['ignore','pipe','pipe']});
 let errorOutput='';child.stderr.on('data',chunk=>{errorOutput+=chunk.toString();});
 try{
  const port=await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(Error('unpacked-server-start-timeout')),10000);child.on('error',error=>{clearTimeout(timer);reject(error);});child.on('exit',code=>{clearTimeout(timer);reject(Error('unpacked-server-exited:'+code));});child.stdout.on('data',chunk=>{output+=chunk.toString();const match=/FEEDBACK_RELAY_READY loopback port=(\d+)/.exec(output);if(match){clearTimeout(timer);resolve(Number(match[1]));}});});
  const response=await fetch(`http://127.0.0.1:${port}/healthz`);assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true,service:ROOT.replace('-server',''),version});
  assert.equal(errorOutput,'');assert.equal(fs.existsSync(path.join(directory,'node_modules')),false);
 }finally{if(child.exitCode===null){await new Promise(resolve=>{child.once('exit',resolve);child.kill();});}}
});
