// Official WebBridge daemon is the HTTP server; APP is only a loopback client.
const http=require('node:http');
const ACTIONS=new Set(['navigate','find_tab','snapshot','click','fill','evaluate','cdp','screenshot','network','upload','save_as_pdf','list_tabs','list_browser_tabs','attach_tab','close_tab','close_session']);
const LIMIT=16*1024*1024;
class KimiDaemonClient {
 constructor({port=10086,session='yijian-toudi-app',log=()=>{},pollMs=30000}={}) {
  if(!Number.isInteger(port)||port<1||port>65535)throw Error('invalid-daemon-port');
  if(typeof session!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(session))throw Error('invalid-daemon-session');
  Object.assign(this,{port,session,log,pollMs,transport:'daemon-http',started:false,connected:false,reason:'not-started',boundAccountId:null,epoch:0});
  this.listeners={connected:[],disconnected:[]};this.pending=new Set();this.probe=null;this.timer=null;
 }
 on(event,fn){if(this.listeners[event])this.listeners[event].push(fn);}
 emit(event){for(const fn of this.listeners[event]||[])try{fn();}catch{this.log('bridge-listener-failed');}}
 setState(connected,reason){const changed=this.connected!==connected;this.connected=connected;this.reason=reason;if(!connected)this.boundAccountId=null;if(changed)this.emit(connected?'connected':'disconnected');}
 isUp(){return this.started&&this.connected;}
 bindAccount(id){this.boundAccountId=id||null;}
 getBoundAccount(){return this.boundAccountId;}
 status(){return {running:this.started,connected:this.isUp(),port:this.port,transport:this.transport,reason:this.reason,boundAccount:this.getBoundAccount()};}
 async start(){if(this.started){await this.refresh();return {started:false,reason:'already-running',port:this.port,transport:this.transport};}this.started=true;const epoch=this.epoch;await this.refresh();const current=this.started&&this.epoch===epoch;if(current&&this.pollMs>0){this.timer=setInterval(()=>this.refresh(),Math.max(1000,this.pollMs));this.timer.unref?.();}return {started:current,port:this.port,transport:this.transport};}
 stop(){this.started=false;this.epoch++;if(this.timer)clearInterval(this.timer);this.timer=null;this.probe=null;for(const cancel of this.pending)cancel();this.pending.clear();this.setState(false,'not-started');}
 async refresh(){if(!this.started)return false;if(this.probe)return this.probe;const epoch=this.epoch;const probe=(async()=>{try{const r=await this.request('list_tabs',{},3000);if(this.started&&this.epoch===epoch)this.setState(r.data?.success===true&&Array.isArray(r.data.tabs),r.data?.success===true&&Array.isArray(r.data.tabs)?null:'daemon-extension-unavailable');}catch(e){if(this.started&&this.epoch===epoch)this.setState(false,e.message);}return this.isUp();})();this.probe=probe;try{return await probe;}finally{if(this.probe===probe)this.probe=null;}}
 request(action,args,timeoutMs){
  return new Promise((resolve,reject)=>{
   if(!this.started){reject(Error('bridge-stopped'));return;}
   const body=Buffer.from(JSON.stringify({action,args,session:this.session}),'utf8');let done=false,req,timer;
   const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);this.pending.delete(cancel);if(error){req?.destroy();reject(Error(error));}else resolve(value);};
   const cancel=()=>finish('bridge-stopped');this.pending.add(cancel);
   timer=setTimeout(()=>finish('daemon-timeout'),Math.max(1,Math.min(Number(timeoutMs)||45000,120000)));
   req=http.request({host:'127.0.0.1',port:this.port,path:'/command',method:'POST',headers:{'Content-Type':'application/json; charset=utf-8','Content-Length':body.length}},res=>{
    if(res.statusCode!==200){res.resume();finish('daemon-http-status');return;}
    const chunks=[];let size=0;res.on('data',c=>{size+=c.length;if(size>LIMIT){finish('daemon-response-too-large');res.destroy();}else chunks.push(c);});
    res.on('error',()=>finish('daemon-response-error'));res.on('aborted',()=>finish('daemon-response-error'));
    res.on('end',()=>{if(done)return;let value;try{value=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{finish('daemon-invalid-response');return;}
     if(!value||value.ok!==true||!Object.hasOwn(value,'data')||value.data===null){
      const filePermission=action==='upload'&&value?.error?.code==='extension_error'&&typeof value.error.message==='string'&&value.error.message.startsWith("upload needs Chrome's per-extension file access");
      finish(filePermission?'daemon-file-access-required':'daemon-command-failed');return;
     }
     if(value.data?.success===false){finish('daemon-tool-failed');return;}finish(null,{data:value.data});
    });
   });req.on('error',error=>finish(error.code==='ECONNREFUSED'?'daemon-unavailable':'daemon-network-error'));req.end(body);
  });
 }
 async sendTool(action,args={}, {timeoutMs=45000}={}){
  if(!ACTIONS.has(action)||!args||typeof args!=='object'||Array.isArray(args))throw Error('invalid-daemon-command');
  const epoch=this.epoch;try{return await this.request(action,args,timeoutMs);}catch(e){if(this.started&&this.epoch===epoch&&e.message!=='daemon-file-access-required')this.setState(false,e.message);throw e;}
 }
 navigate(url,{newTab,group_title,...timing}={}){return this.sendTool('navigate',{url,...(newTab?{newTab:true}:{}),...(group_title?{group_title}:{})},timing);}
 snapshot(opts){return this.sendTool('snapshot',{}, {timeoutMs:40000,...opts});}
 click(selector,opts){return this.sendTool('click',{selector},opts);}
 fill(selector,value,opts){return this.sendTool('fill',{selector,value},opts);}
}
// Start only an already-installed official binary after an observed refusal.
// Detached launch intentionally has no kill/restart timeout: daemon outlives APP.
async function startInstalledDaemon({home=require('node:os').homedir(),platform=process.platform,spawn=require('node:child_process').spawn}={}){
 const path=require('node:path'),fs=require('node:fs'),binary=path.join(home,'.kimi-webbridge','bin',platform==='win32'?'kimi-webbridge.exe':'kimi-webbridge');
 try{if(!fs.statSync(binary).isFile())return {started:false,reason:'daemon-not-installed'};}catch{return {started:false,reason:'daemon-not-installed'};}
 return new Promise(resolve=>{let child;try{child=spawn(binary,['start'],{detached:true,windowsHide:true,stdio:'ignore'});}catch{resolve({started:false,reason:'daemon-start-failed'});return;}child.once('error',()=>resolve({started:false,reason:'daemon-start-failed'}));child.once('spawn',()=>{child.unref();resolve({started:true});});});
}
module.exports={KimiDaemonClient,startInstalledDaemon};
