const fs=require('fs'),path=require('path'),os=require('os'),assert=require('assert/strict'),{_electron:electron}=require('playwright-core');
(async()=>{const root=path.resolve(__dirname,'..'),fixtureSourceRoot=process.env.FIXTURE_SOURCE_ROOT||root,app=await electron.launch({args:[root,`--user-data-dir=${fs.mkdtempSync(path.join(os.tmpdir(),'yjt-auth-frame-'))}`],executablePath:process.env.ELECTRON_EXECUTABLE||undefined,env:{...process.env,YIJIAN_BACKGROUND_TEST:'1'}});let result;
try{await app.firstWindow();result=await app.evaluate(async({app,BrowserWindow,session},{fixtureSourceRoot})=>{
 const Module=process.getBuiltinModule('node:module'),req=Module.createRequire(`${app.getAppPath()}/electron/main.cjs`);let module=req('./login-manager.cjs');
 if(fixtureSourceRoot!==app.getAppPath()){const old=Module.createRequire(`${fixtureSourceRoot}/electron/login-manager.cjs`),m=new Module(`${fixtureSourceRoot}/electron/login-manager.cjs`);m.require=id=>id==='./navigation-policy.cjs'?old(id):req(id);m._compile(process.getBuiltinModule('node:fs').readFileSync(m.id,'utf8'),m.id);module=m.exports;}
 const manager=module.createLoginManager(),parent=new BrowserWindow({show:false});manager.setParent(parent);const part=session.fromPartition('persist:jd');
 await part.protocol.handle('https',request=>{const u=new URL(request.url);let html;
  if(u.pathname==='/auth-frame-redirect')return new Response(null,{status:302,headers:{location:'http://campus.jd.com/auth-frame-return?fixture=1'}});
  if(u.pathname==='/empty')html='<h1>workspace only</h1>';
  else if(u.pathname==='/auth-frame-return')html='<h1>frame received HTTPS return</h1>';
  else html='<h1>campus parent</h1><iframe src="https://campus.jd.com/auth-frame-redirect"></iframe>';
  return new Response(html,{headers:{'content-type':'text/html'}});
 });
 const pause=ms=>new Promise(r=>setTimeout(r,ms)),out={};
 try{await manager.openWorkspace({company:{id:'jd',name:'京东'},url:'https://campus.jd.com/auth-frame-parent',mode:'login'});await pause(1600);
 out.parentPreserved=manager.getCurrentUrl()==='https://campus.jd.com/auth-frame-parent';
 out.childReached=manager.getWebContents().mainFrame.framesInSubtree.some(f=>f!==manager.getWebContents().mainFrame&&f.url.startsWith('https://campus.jd.com/auth-frame-return'));
 await manager.closeWorkspace();
 await manager.openWorkspace({company:{id:'jd',name:'京东'},url:'https://campus.jd.com/empty',mode:'login'});
 const created=new Promise(resolve=>manager.getWebContents().once('did-create-window',resolve));await manager.run(`window.open('https://campus.jd.com/auth-frame-parent');true`);const popup=await created;await pause(1600);
 out.popupParentPreserved=popup.webContents.getURL()==='https://campus.jd.com/auth-frame-parent';
 out.popupChildReached=popup.webContents.mainFrame.framesInSubtree.some(f=>f!==popup.webContents.mainFrame&&f.url.startsWith('https://campus.jd.com/auth-frame-return'));
 out.workspacePreserved=manager.getCurrentUrl()==='https://campus.jd.com/empty';
 return out;}finally{await manager.closeWorkspaceIfOpen();parent.destroy();}
},{fixtureSourceRoot});}finally{await app.close();}
const rows=Object.entries(result);for(const [name,ok]of rows)console.log(`${ok?'PASS':'FAIL'} ${name}`);console.log(JSON.stringify({tests:rows.length,pass:rows.filter(([,v])=>v).length,fail:rows.filter(([,v])=>!v).length,offline:true}));assert.ok(rows.every(([,v])=>v),'iframe upgrade must never replace parent');
})().catch(e=>{console.error(e);process.exitCode=1});
