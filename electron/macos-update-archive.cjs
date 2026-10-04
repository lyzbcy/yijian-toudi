'use strict';
// Inspect the central directory before ditto can follow archive symlinks.
const fs=require('node:fs/promises'),path=require('node:path').posix,zlib=require('node:zlib');
async function validateArchive(file){
 const bytes=await fs.readFile(file);let end=-1;
 for(let at=bytes.length-22;at>=Math.max(0,bytes.length-65557);at--){if(bytes.readUInt32LE(at)===0x06054b50&&at+22+bytes.readUInt16LE(at+20)===bytes.length){end=at;break;}}
 if(end<0||bytes.readUInt16LE(end+4)!==0||bytes.readUInt16LE(end+6)!==0)throw Error('mac-zip-directory-invalid');
 const count=bytes.readUInt16LE(end+10),length=bytes.readUInt32LE(end+12),start=bytes.readUInt32LE(end+16);
 if(!count||count===65535||bytes.readUInt16LE(end+8)!==count||start+length!==end)throw Error('mac-zip-directory-invalid');
 let at=start;const names=new Set();
 for(let index=0;index<count;index++){
  if(at+46>end||bytes.readUInt32LE(at)!==0x02014b50)throw Error('mac-zip-entry-invalid');
  const flags=bytes.readUInt16LE(at+8),compression=bytes.readUInt16LE(at+10),size=bytes.readUInt32LE(at+20),plain=bytes.readUInt32LE(at+24),n=bytes.readUInt16LE(at+28),extra=bytes.readUInt16LE(at+30),comment=bytes.readUInt16LE(at+32),local=bytes.readUInt32LE(at+42),type=(bytes.readUInt32LE(at+38)>>>16)&0xf000;
  if(at+46+n+extra+comment>end)throw Error('mac-zip-entry-invalid');
  const name=bytes.subarray(at+46,at+46+n).toString('utf8');
  if(!name.startsWith('一键投递.app/')||/[\x00-\x1f\\\uFFFD]/.test(name)||name.split('/').some(part=>part==='.'||part==='..')||names.has(name)||flags&1||![0,0x4000,0x8000,0xa000].includes(type))throw Error('mac-zip-entry-path-invalid');names.add(name);
  if(local+30>start||bytes.readUInt32LE(local)!==0x04034b50)throw Error('mac-zip-local-header-invalid');
  const localN=bytes.readUInt16LE(local+26),localExtra=bytes.readUInt16LE(local+28),data=local+30+localN+localExtra;
  if(data+size>start||bytes.subarray(local+30,local+30+localN).toString('utf8')!==name)throw Error('mac-zip-local-header-invalid');
  if(type===0xa000){
   if(plain>4096||size>8192||![0,8].includes(compression))throw Error('mac-zip-link-invalid');
   const encoded=bytes.subarray(data,data+size),target=(compression===0?encoded:zlib.inflateRawSync(encoded,{maxOutputLength:4096})).toString('utf8'),resolved=path.normalize(path.join(path.dirname(name),target));
   if(!target||path.isAbsolute(target)||/[\x00-\x1f\\\uFFFD]/.test(target)||!resolved.startsWith('一键投递.app/'))throw Error('mac-zip-external-link');
  }
  at+=46+n+extra+comment;
 }
 if(at!==end||!names.has('一键投递.app/Contents/Info.plist')||!names.has('一键投递.app/Contents/MacOS/一键投递'))throw Error('mac-zip-incomplete');
 return {entries:count};
}
module.exports={validateArchive};
