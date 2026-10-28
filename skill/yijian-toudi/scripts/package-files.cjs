'use strict';
const fs=require('fs'),path=require('path'),zlib=require('zlib'),crypto=require('crypto');
const REQUIRED=['SKILL.md','version.json','references/deploy.md','references/update.md','scripts/daily-boss.cjs','scripts/boss-engine.cjs','scripts/bootstrap.cjs','scripts/use.cjs','scripts/update-worker.cjs','scripts/release-source.cjs','scripts/package-files.cjs'];
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function portable(name){
 const parts=name.split('/');if(parts.some(p=>!p||p==='.'||p==='..'||/[\\:*?"<>|\x00-\x1f]/.test(p)||/[. ]$/.test(p)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)))throw Error('archive-path-invalid');return name;
}
function unpack(buffer,version){
 if(buffer.length>8*1024*1024)throw Error('archive-too-large');const data=zlib.gunzipSync(buffer,{maxOutputLength:32*1024*1024}),files=new Map(),seen=new Set();let offset=0,ended=false;
 const field=(h,a,n)=>h.subarray(a,a+n).toString('utf8').replace(/\0.*$/s,'');
 while(offset+512<=data.length){const h=data.subarray(offset,offset+512);offset+=512;if(h.every(b=>b===0)){if(offset+512>data.length||!data.subarray(offset,offset+512).every(b=>b===0))throw Error('archive-end-invalid');ended=true;break;}
 const oct=(a,n)=>{const s=field(h,a,n).trim();if(!/^[0-7]+$/.test(s))throw Error('archive-number-invalid');return parseInt(s,8);},expected=oct(148,8);let sum=0;for(let i=0;i<512;i++)sum+=i>=148&&i<156?32:h[i];if(sum!==expected)throw Error('archive-header-checksum');
 const size=oct(124,12);if(size>8*1024*1024||offset+size>data.length)throw Error('archive-entry-too-large');const type=field(h,156,1)||'0',prefix=field(h,345,155),raw=(prefix?prefix+'/':'')+field(h,0,100),name=raw.replace(/^\.\//,'').replace(/\/$/,'');
 if(!['0','5'].includes(type))throw Error('archive-entry-type-unsupported');portable(name);if(name!=='yijian-toudi'&&!name.startsWith('yijian-toudi/'))throw Error('archive-root-invalid');if(name==='yijian-toudi'&&type!=='5')throw Error('archive-root-invalid');
 const key=name.toLowerCase();if(seen.has(key))throw Error('archive-duplicate-path');seen.add(key);if(seen.size>512)throw Error('archive-too-many-files');
 if(type==='0'){const rel=name.slice('yijian-toudi/'.length);if(rel.startsWith('.')||rel.split('/').some(p=>p.startsWith('.')))throw Error('archive-private-file');files.set(rel,Buffer.from(data.subarray(offset,offset+size)));}else if(size!==0)throw Error('archive-directory-data');
 offset+=Math.ceil(size/512)*512;
 }
 if(!ended||REQUIRED.some(f=>!files.has(f)))throw Error('archive-required-file-missing');
 const meta=JSON.parse(files.get('version.json'));if(meta.version!==version||meta.updateProtocol!==1)throw Error('archive-version-protocol-mismatch');if(!/^name:\s*yijian-toudi\s*$/m.test(files.get('SKILL.md').toString()))throw Error('archive-skill-name-mismatch');return files;
}
function inside(base,target){const rel=path.relative(path.resolve(base),path.resolve(target));return Boolean(rel)&&!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel);}
function writeSlot(base,files,version,digest){
 const parent=path.resolve(fs.realpathSync(base),'installations');fs.mkdirSync(parent,{recursive:true,mode:0o700});if(fs.realpathSync(parent)!==parent)throw Error('slot-parent-symlink');const slot=path.join(parent,version+'-'+digest.slice(0,16)),root=path.join(slot,'yijian-toudi');
 if(!inside(parent,root))throw Error('slot-path-invalid');if(fs.existsSync(slot)){const r=verifySlot(root);if(r.version!==version||r.sha256!==digest)throw Error('slot-conflict');return root;}
 const staging=path.join(parent,'.stage-'+crypto.randomUUID()),stageRoot=path.join(staging,'yijian-toudi');fs.mkdirSync(stageRoot,{recursive:true,mode:0o700});const hashes={};
 for(const [rel,b]of files){portable(rel);const p=path.resolve(stageRoot,...rel.split('/'));if(!inside(stageRoot,p))throw Error('slot-file-outside');fs.mkdirSync(path.dirname(p),{recursive:true,mode:0o700});fs.writeFileSync(p,b,{flag:'wx',mode:rel.startsWith('scripts/')?0o700:0o600});hashes[rel]=sha(b);}
 fs.writeFileSync(path.join(stageRoot,'.slot-manifest.json'),JSON.stringify({schema:1,version,sha256:digest,files:hashes}),{flag:'wx',mode:0o600});verifySlot(stageRoot);
 // Both resolved rename targets stay under the declared cache. Never rename the
 // bootstrap or a currently-used version; incomplete stages remain inspectable.
 if(!inside(parent,staging)||!inside(parent,slot))throw Error('slot-rename-outside');fs.renameSync(staging,slot);return root;
}
function verifySlot(root){
 if(fs.lstatSync(root).isSymbolicLink())throw Error('slot-symlink');const m=JSON.parse(fs.readFileSync(path.join(root,'.slot-manifest.json'),'utf8'));if(m.schema!==1||!m.files||REQUIRED.some(f=>!m.files[f])||!/^[a-f0-9]{64}$/.test(m.sha256||''))throw Error('slot-manifest-invalid');
 for(const [rel,h]of Object.entries(m.files)){portable(rel);const p=path.resolve(root,...rel.split('/'));if(!inside(root,p)||fs.lstatSync(p).isSymbolicLink()||fs.realpathSync(p)!==p||sha(fs.readFileSync(p))!==h)throw Error('slot-file-invalid');}
 const v=JSON.parse(fs.readFileSync(path.join(root,'version.json'),'utf8'));if(v.version!==m.version||v.updateProtocol!==1)throw Error('slot-version-invalid');return m;
}
module.exports={unpack,writeSlot,verifySlot,sha,inside,REQUIRED};
