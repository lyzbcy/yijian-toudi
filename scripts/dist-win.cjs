// Existing per-user NSIS identity and upgrade switches stay in the backend.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),version=require('../package.json').version;
const out=path.resolve(process.env.YIJIAN_BUILD_OUTPUT||path.join(root,'release'));
fs.mkdirSync(out,{recursive:true});
const cli=require.resolve('electron-builder/cli.js');
function run(exe,args){const r=cp.spawnSync(exe,args,{cwd:root,stdio:'inherit',windowsHide:true});if(r.error)throw r.error;if(r.status!==0)throw Error('build failed: '+r.status);}
run(process.execPath,[cli,'--win','nsis','--x64','--config.electronDist='+path.join(root,'node_modules/electron/dist'),'--config.directories.output='+out,'--config.win.artifactName=yijian-toudi-backend-${version}.${ext}']);
const unpacked=path.join(out,'win-unpacked');
function size(dir){return fs.readdirSync(dir,{withFileTypes:true}).reduce((n,e)=>n+(e.isDirectory()?size(path.join(dir,e.name)):fs.statSync(path.join(dir,e.name)).size),0);}
const cache=process.env.ELECTRON_BUILDER_CACHE||path.join(process.env.LOCALAPPDATA,'electron-builder','Cache');
const candidates=fs.readdirSync(path.join(cache,'nsis')).filter(n=>/^nsis-3\./.test(n)).map(n=>path.join(cache,'nsis',n,'Bin','makensis.exe')).filter(n=>fs.existsSync(n));
if(!candidates.length)throw Error('cached makensis.exe missing');
run(candidates.sort().at(-1),['/DROOT='+root,'/DOUT='+out,'/DVERSION='+version,'/DPAYLOAD_BYTES='+size(unpacked),path.join(root,'installer/themed-wrapper.nsi')]);
const file=path.join(out,'yijian-toudi-setup-'+version+'.exe'),bytes=fs.statSync(file).size,sha256=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
fs.writeFileSync(path.join(out,'yijian-toudi-'+version+'-build.json'),JSON.stringify({version,file,bytes,sha256,public:false,installed:false},null,2));
console.log('THEMED_INSTALLER '+file+' '+bytes+' bytes SHA256='+sha256);
