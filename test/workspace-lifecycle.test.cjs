const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {EventEmitter}=require('node:events');
const root=path.resolve(__dirname,'..'),sourceRoot=process.env.FIXTURE_SOURCE_ROOT||root;
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject};}
function setup(){
 const views=[],sessions=new Map(),frames=new Map();let nextLoad=null,flush=()=>Promise.resolve();let flushes=0;
 class WC extends EventEmitter{
  constructor(){super();this.dead=false;this.url='';this.script=()=>Promise.resolve('');}
  getURL(){return this.url;}isDestroyed(){return this.dead;}destroy(){this.dead=true;}
  setWindowOpenHandler(f){this.popup=f;}
  loadURL(u){this.url=u;if(nextLoad){const d=nextLoad;nextLoad=null;return d.promise;}return Promise.resolve();}
  executeJavaScript(s){return this.script(s);}
 }
 class View{constructor(){this.webContents=new WC();views.push(this);}setBounds(b){this.bounds=b;}}
 const electron={WebContentsView:View,webFrameMain:{fromId:(_p,id)=>frames.get(id)},session:{defaultSession:{getUserAgent:()=> 'native-fixture'},fromPartition:id=>{
  if(!sessions.has(id))sessions.set(id,{setUserAgent(){},webRequest:{onBeforeSendHeaders(){}},cookies:{flushStore(){flushes++;return flush();}},flushStorageData(){return Promise.resolve();}});return sessions.get(id);
 }}};
 const Module=require('node:module'),file=path.join(sourceRoot,'electron/login-manager.cjs'),mod=new Module(file);
 const real=require('node:module').createRequire(path.join(root,'electron/main.cjs'));
 mod.require=id=>id==='electron'?electron:id==='./logger.cjs'?{logger:{warn(){}}}:real(id);
 mod._compile(fs.readFileSync(file,'utf8'),file);const m=mod.exports.createLoginManager();
 const parent=new EventEmitter();parent.isDestroyed=()=>false;parent.getContentSize=()=>[900,700];parent.contentView={addChildView(){},removeChildView(){}};m.setParent(parent);
 const open=()=>m.openWorkspace({company:{id:'jd',name:'京东'},url:'https://campus.jd.com/#/resume',mode:'browse'});
 return{m,open,views,frames,WC,parent,setLoad:d=>nextLoad=d,setFlush:f=>flush=f,get flushes(){return flushes;}};
}
test('concurrent close flushes and destroys a workspace only once',async()=>{
 const f=setup();await f.open();const gate=deferred();f.setFlush(()=>gate.promise);
 const a=f.m.closeWorkspace(),b=f.m.closeWorkspace();const count=f.flushes;gate.resolve();await Promise.all([a,b]);
 assert.equal(count,1);assert.equal(f.m.isActive(),false);
});
test('late old load failure does not close a replacement workspace',async()=>{
 const f=setup(),gate=deferred();f.setLoad(gate);const old=f.open();const observed=old.then(()=>null,e=>e);
 await f.m.closeWorkspace();await f.open();gate.reject(Error('fixture old network failure'));const error=await observed;
 assert.ok(error);assert.equal(f.m.isActive(),true);assert.equal(f.m.getWebContents(),f.views[1].webContents);await f.m.closeWorkspace();
});
test('late old script result is rejected after replacement',async()=>{
 const f=setup();await f.open();const gate=deferred();f.views[0].webContents.script=()=>gate.promise;
 const old=f.m.run('fixture'),observed=old.then(()=>null,e=>e);await f.m.closeWorkspace();await f.open();gate.resolve('old result');
 const error=await observed;assert.equal(error?.code,'WORKSPACE_SUPERSEDED');assert.equal(f.m.isActive(),true);await f.m.closeWorkspace();
});
test('finish with an old snapshot does not close the new workspace',async()=>{
 const f=setup();await f.open();const gate=deferred();f.views[0].webContents.script=()=>gate.promise;
 const old=f.m.finishWorkspace(),observed=old.catch(e=>e);await f.m.closeWorkspace();await f.open();gate.resolve({url:'old',text:''});await observed;
 assert.equal(f.m.isActive(),true);await f.m.closeWorkspace();
});
test('failed official callback handoff preserves the auth popup',async()=>{
 const f=setup();await f.open();const child=new EventEmitter();child.webContents=new f.WC();let closed=false;child.isDestroyed=()=>closed;child.close=child.destroy=()=>{closed=true;};
 const wc=f.m.getWebContents();wc.popup({url:'https://qq.jd.com/new/wx/login.action?ReturnUrl='+encodeURIComponent('https://campus.jd.com/#/login-callback')});wc.emit('did-create-window',child);
 child.webContents.emit('will-navigate',{preventDefault(){}},'https://qq.jd.com/new/wx/callback.action');
 f.frames.set(7,{url:'https://www.jd.com/'});const gate=deferred();f.setLoad(gate);child.webContents.emit('did-frame-finish-load',{},true,1,7);
 await new Promise(r=>setImmediate(r));gate.reject(Error('fixture campus load failure'));await new Promise(r=>setImmediate(r));
 assert.equal(closed,false);assert.equal(f.m.getStatus().diagnostics.at(-1).kind,'auth-return-error');await f.m.closeWorkspace();
});
test('unsupported attachment is rejected without injecting into website',async()=>{
 const os=require('node:os'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'yjt-upload-type-')),file=path.join(dir,'photo.png');fs.writeFileSync(file,'fixture');
 const f=setup();await f.open();let injected=0;f.m.getWebContents().script=()=>{injected++;return Promise.resolve({uploaded:false});};
 const error=await f.m.setInputFiles(file).then(()=>null,e=>e);assert.match(error?.message||'',/PDF/);assert.equal(injected,0);await f.m.closeWorkspace();
});
test('restoring a zero-size window restores its embedded login viewport',async()=>{
 const f=setup();f.parent.getContentSize=()=>[0,0];await f.open();f.parent.getContentSize=()=>[900,700];f.parent.emit('restore');
 assert.equal(f.views[0].bounds.width,900);assert.equal(f.views[0].bounds.height,648);await f.m.closeWorkspace();
});
