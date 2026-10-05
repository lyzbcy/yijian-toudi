'use strict';
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const ROOT='yijian-toudi-feedback-server';
const FILES=['version.json','support/README.md','support/feedback-server.cjs','electron/feedback.cjs','electron/diagnostics.cjs','electron/wecom-notify.cjs','support/deploy/feedback.env.example','support/deploy/Caddyfile.example','support/deploy/yijian-feedback.service','support/deploy/Dockerfile','support/deploy/compose.yml'];
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function readArchive(buffer,version){
 if(buffer.length>4*1024*1024)throw Error('feedback-archive-too-large');
 const data=zlib.gunzipSync(buffer,{maxOutputLength:16*1024*1024}),files=new Map();let offset=0,ended=false;
 const field=(h,a,n)=>h.subarray(a,a+n).toString('utf8').replace(/\0.*$/s,'');
 while(offset+512<=data.length){
  const header=data.subarray(offset,offset+512);offset+=512;
  if(header.every(byte=>byte===0)){if(data.length-offset<512||data.subarray(offset).some(byte=>byte!==0))throw Error('feedback-archive-end-invalid');ended=true;break;}
  const number=(a,n)=>{const value=field(header,a,n).trim();if(!/^[0-7]+$/.test(value))throw Error('feedback-archive-number-invalid');return parseInt(value,8);};
  let sum=0;for(let i=0;i<512;i++)sum+=i>=148&&i<156?32:header[i];if(sum!==number(148,8))throw Error('feedback-archive-header-invalid');
  const size=number(124,12),prefix=field(header,345,155),name=(prefix?prefix+'/':'')+field(header,0,100),type=field(header,156,1)||'0';
  if(type!=='0'||!name.startsWith(ROOT+'/'))throw Error('feedback-archive-entry-invalid');
  const relative=name.slice(ROOT.length+1);if(!FILES.includes(relative)||files.has(relative))throw Error('feedback-archive-file-invalid');
  if(size>2*1024*1024||offset+size>data.length)throw Error('feedback-archive-size-invalid');
  files.set(relative,Buffer.from(data.subarray(offset,offset+size)));offset+=Math.ceil(size/512)*512;
 }
 if(!ended||files.size!==FILES.length||FILES.some(file=>!files.has(file)))throw Error('feedback-archive-incomplete');
 const metadata=JSON.parse(files.get('version.json'));if(metadata.version!==version||metadata.service!==ROOT||metadata.protocol!==1)throw Error('feedback-archive-version-invalid');
 return files;
}
function packageFeedback({sourceRoot=path.resolve(__dirname,'..'),outputDir=path.join(sourceRoot,'release')}={}){
 const version=JSON.parse(fs.readFileSync(path.join(sourceRoot,'package.json'),'utf8')).version;if(!/^\d+\.\d+\.\d+$/.test(version))throw Error('feedback-package-version-invalid');
 const expected=new Map(FILES.map(file=>[file,file==='version.json'?Buffer.from(JSON.stringify({version,service:ROOT,protocol:1},null,2)+'\n'):fs.readFileSync(path.join(sourceRoot,file))]));
 fs.mkdirSync(outputDir,{recursive:true});const archive=path.join(outputDir,`${ROOT}-${version}.tar.gz`),checksum=path.join(outputDir,`${ROOT}-${version}.sha256`);
 if(fs.existsSync(archive)){const previous=readArchive(fs.readFileSync(archive),version);if(FILES.some(file=>!previous.get(file).equals(expected.get(file))))throw Error('feedback-package-existing-version-differs');}
 else{
  const staging=fs.mkdtempSync(path.join(outputDir,'.feedback-stage-')),directory=path.join(staging,ROOT);fs.mkdirSync(directory);
  for(const[file,bytes]of expected){const destination=path.join(directory,file);fs.mkdirSync(path.dirname(destination),{recursive:true});fs.writeFileSync(destination,bytes);}
  const temporary=`package-${process.pid}.tar.gz`,result=spawnSync('tar',['--format=ustar','-czf',temporary,...FILES.map(file=>ROOT+'/'+file)],{cwd:staging,encoding:'utf8'});
  if(result.status!==0)throw Error('feedback-package-tar-failed:'+String(result.error?.message||result.stderr||result.status));
  const packed=fs.readFileSync(path.join(staging,temporary)),actual=readArchive(packed,version);if(FILES.some(file=>!actual.get(file).equals(expected.get(file))))throw Error('feedback-package-content-mismatch');
  fs.writeFileSync(archive,packed,{flag:'wx'});
  // These exact generated children remain inside this staging directory.
  for(const file of FILES)fs.unlinkSync(path.join(directory,file));
  for(const relative of ['support/deploy','support','electron'])fs.rmdirSync(path.join(directory,relative));
  fs.rmdirSync(directory);fs.unlinkSync(path.join(staging,temporary));fs.rmdirSync(staging);
 }
 const digest=sha(fs.readFileSync(archive)),text=`${digest}  ${path.basename(archive)}\n`;
 if(fs.existsSync(checksum)&&fs.readFileSync(checksum,'utf8')!==text)throw Error('feedback-package-checksum-conflict');
 if(!fs.existsSync(checksum))fs.writeFileSync(checksum,text,{flag:'wx'});
 return{version,archive,checksum,sha256:digest,files:FILES.length};
}
function verifyArchive(archive,checksum,version){const bytes=fs.readFileSync(archive),digest=sha(bytes),line=fs.readFileSync(checksum,'utf8').trim();if(line!==`${digest}  ${path.basename(archive)}`)throw Error('feedback-package-checksum-invalid');return{verified:true,version,sha256:digest,files:readArchive(bytes,version).size};}
if(require.main===module){if(process.argv[2]==='--verify'){const[,,,archive,checksum,version]=process.argv;if(!archive||!checksum||!version)throw Error('Usage: --verify ARCHIVE CHECKSUM VERSION');console.log(JSON.stringify(verifyArchive(archive,checksum,version)));}else if(process.argv.length===2)console.log(JSON.stringify(packageFeedback()));else throw Error('Unknown feedback packaging arguments');}
module.exports={FILES,ROOT,readArchive,packageFeedback,verifyArchive};
