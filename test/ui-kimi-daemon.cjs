const fs=require('fs'),os=require('os'),path=require('path'),http=require('http'),{_electron:electron}=require('playwright-core'),{JsonStore}=require('../electron/store.cjs');
(async()=>{
 const root=path.resolve(__dirname,'..'),profile=fs.mkdtempSync(path.join(os.tmpdir(),'yjt-kimi-ui-')),store=new JsonStore(profile);store.init();store.update(s=>{s.meta.onboardingSeen=true;s.settings.kimiBridgeEnabled=false;s.settings.autoCheckUpdates=false;s.settings.apiEnabled=false;s.settings.jobs.autoRefresh=false;return s;});
 const requests=[];let offline=false;const server=http.createServer((req,res)=>{let raw='';req.on('data',c=>raw+=c);req.on('end',()=>{const body=JSON.parse(raw);requests.push(body);res.end(JSON.stringify(offline?{ok:false,error:'SAMPLE'}:{ok:true,data:{success:true,tabs:[]}}));});});await new Promise(r=>server.listen(0,'127.0.0.1',r));let app;const checks={},check=(key,value)=>{checks[key]=!!value;if(!value)throw Error(key);};
 try{
  app=await electron.launch({executablePath:process.env.KIMI_APP_EXECUTABLE||undefined,args:[root,`--user-data-dir=${profile}`],env:{...process.env,YIJIAN_BACKGROUND_TEST:'1'}});
  const identity=await app.evaluate(({app})=>({version:app.getVersion(),packaged:app.isPackaged,appPath:app.getAppPath(),exe:process.execPath}));
  check('runtimeIdentity',identity.version===require('../package.json').version&&(process.env.KIMI_APP_EXECUTABLE?(identity.packaged&&fs.realpathSync(identity.exe)===fs.realpathSync(process.env.KIMI_APP_EXECUTABLE)&&path.resolve(identity.appPath)===path.resolve(path.dirname(identity.exe),'resources/app.asar')):(!identity.packaged&&path.resolve(identity.appPath)===root)));
  await app.evaluate(({app},port)=>{const http=process.getBuiltinModule('node:http'),original=http.request;http.request=function(opts,...rest){if(opts?.host==='127.0.0.1'&&opts.port===10086&&opts.path==='/command')opts={...opts,port};return original.call(this,opts,...rest);};},server.address().port);
  const win=await app.firstWindow();await win.waitForSelector('#companyFilter[data-ready="1"]',{state:'attached'});
  const disabled=await win.evaluate(()=>window.oneClick.kimiStatus());check('disabledDisconnected',!disabled.running&&!disabled.connected);
  const connected=await win.evaluate(()=>window.oneClick.kimiRestart());check('productionIPCConnected',connected.running&&connected.connected&&connected.transport==='daemon-http');
  check('officialCommandSchema',requests.every(r=>r.action==='list_tabs'&&r.session==='yijian-toudi-app'&&Object.keys(r.args).length===0));
  await win.locator('.nav-item[data-page="settings"]').click();await win.waitForFunction(()=>document.querySelector('#kimiBridgeStatus').textContent.includes('HTTP 客户端'));
  check('uiHTTPLabel',(await win.locator('#kimiBridgeStatus').innerText()).includes('HTTP 客户端'));
  check('uiOfficialHelp',await win.locator('a[href="https://www.kimi.com/zh-cn/features/webbridge"]').count()===1);
  offline=true;const failed=await win.evaluate(()=>window.oneClick.kimiStatus());check('freshStatusDisconnect',failed.running&&!failed.connected&&failed.reason==='daemon-command-failed');
  offline=false;const restored=await win.evaluate(()=>window.oneClick.kimiRestart());check('clientReconnect',restored.connected);
  const result=await win.evaluate(()=>window.oneClick.debugKimi({tool:'list_tabs',args:{}}));check('debugUsesSameClient',result.data.success&&Array.isArray(result.data.tabs));
  check('noWebsiteWrites',requests.every(r=>r.action==='list_tabs'));check('noDaemonClose',!requests.some(r=>/^close/.test(r.action)));
  await app.close();app=null;check('daemonStillListening',server.listening);
  const out={ok:true,checks,identity,transport:'controlled-loopback-HTTP',officialWebsite:false};fs.mkdirSync(root+'/test-output',{recursive:true});fs.writeFileSync(root+'/test-output/ui-kimi-daemon.json',JSON.stringify(out,null,2));console.log(`KIMI_DAEMON_UI ${Object.values(checks).filter(Boolean).length}/12; controlledHTTP=true; noWebsiteWrites=true`);
 }finally{if(app)await app.close();server.closeAllConnections?.();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
