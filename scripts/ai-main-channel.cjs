'use strict';
// App control and inventory must not enable Runtime/Debugger on every website.
// Some recruiting sites intentionally leave their page when a console listener
// attaches. Keep their protection intact and inspect only the selected app.
const WebSocket=require('ws');
async function call(port,target,method,params={}){
 const u=new URL(target.webSocketDebuggerUrl);
 if(!['127.0.0.1','localhost'].includes(u.hostname)||Number(u.port)!==port||u.protocol!=='ws:')throw Error('non_local_debug_socket');
 const ws=new WebSocket(u.href);let openTimer;
 await new Promise((resolve,reject)=>{openTimer=setTimeout(()=>{ws.terminate();reject(Error('debug_socket_timeout'));},10000);ws.once('open',()=>{clearTimeout(openTimer);resolve();});ws.once('error',e=>{clearTimeout(openTimer);reject(e);});});
 try{const requests=Array.isArray(method)?method:[{method,params}];let last;
 for(let i=0;i<requests.length;i++)last=await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error('debug_call_timeout')),45000);
  const listener=raw=>{let r;try{r=JSON.parse(raw);}catch{return;}if(r.id!==i+1)return;clearTimeout(timer);ws.off('message',listener);if(r.error)reject(Error(r.error.message));else if(r.result?.exceptionDetails)reject(Error('app_business_call_failed'));else resolve(r.result);};ws.on('message',listener);
  ws.once('error',e=>{clearTimeout(timer);reject(e);});ws.once('close',()=>{clearTimeout(timer);reject(Error('debug_socket_closed'));});
  ws.send(JSON.stringify({id:i+1,...(typeof requests[i]==='function'?requests[i](last):requests[i])}));
 });return last;}finally{ws.close();}
}
async function runSelected(r,connection,{fetchLocalJson,isAppPage,sanitizeUrl,sanitizeText,snapshot,act}){
 const sanitizeData=value=>typeof value==='string'?sanitizeText(value):Array.isArray(value)?value.map(sanitizeData):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,sanitizeData(v)])):value;
 const inventory=async()=>{
  const list=(await fetchLocalJson(connection.port,'/json/list')).filter(t=>t.type==='page');
  const endpoint=await fetchLocalJson(connection.port,'/json/version');
  const {targetInfos}=await call(connection.port,{webSocketDebuggerUrl:endpoint.webSocketDebuggerUrl},'Target.getTargets');
  const frameUrls=new Map(targetInfos.filter(t=>t.type==='iframe').map(t=>[t.targetId,t.url]));
  const items=[];
  for(const t of list){
   const isApp=isAppPage({url:()=>t.url});let frames=[],details=[];
   try{
    const {root}=await call(connection.port,t,'DOM.getDocument',{depth:-1,pierce:true});
    const visit=async(document,framePath=[],name='',url=t.url,debugTarget=t,frameId=t.id)=>{
     frames.push({framePath,name,url:sanitizeUrl(document?.documentURL||url)});
     details.push({framePath,debugTarget,frameId});
     if(!document||framePath.length>=8)return;
     // DOM owner order is stable across debugger connections. Target discovery
     // order is not; never use it as the iframe index.
     const owners=[];const collect=node=>{if(['IFRAME','FRAME'].includes(node.nodeName)){owners.push(node);return;}(node.children||[]).forEach(collect);(node.shadowRoots||[]).forEach(collect);};collect(document);
     for(let i=0;i<owners.length;i++){
      const owner=owners[i],attrs=Object.fromEntries((owner.attributes||[]).reduce((a,v,j,all)=>j%2?a:[...a,[v,all[j+1]]],[]));
      let child=owner.contentDocument,childTarget=debugTarget;const childUrl=frameUrls.get(owner.frameId)||attrs.src||'';
      if(!child&&owner.frameId){try{const socket=new URL(t.webSocketDebuggerUrl);socket.pathname='/devtools/page/'+owner.frameId;childTarget={webSocketDebuggerUrl:socket.href};child=(await call(connection.port,childTarget,'DOM.getDocument',{depth:-1,pierce:true})).root;}catch{childTarget=debugTarget;}}
      await visit(child,[...framePath,i],attrs.name||'',childUrl,childTarget,owner.frameId);
     }
    };await visit(root);
   }catch{frames=[{framePath:[],name:'',url:sanitizeUrl(t.url)}];}
   const title=t.title===t.url.replace(/^https?:\/\//,'')?sanitizeUrl(t.url).replace(/^https?:\/\//,''):sanitizeText(t.title||'');
   items.push({targetId:t.id,kind:isApp?'app':'web',...(isApp?{version:new URL(t.url).searchParams.get('appVersion')}:{ }),title,url:sanitizeUrl(t.url),frames,details,raw:t});
  }
  return items;
 };
 const publicItems=items=>items.map(({raw,details,...i})=>i),items=await inventory(),apps=items.filter(t=>t.kind==='app');
 if(apps.length!==1)throw Error('expected_one_project_preview');
 if(!r.port&&connection.targetId&&apps[0].targetId!==connection.targetId)throw Error('stale_connection_manifest_restart_preview');
 if(r.action==='list')return{ok:true,targets:publicItems(items)};
 const item=items.find(t=>t.targetId===r.targetId);if(!item)throw Error('target_not_found_refresh_list');
 if(item.kind==='web'&&r.framePath.length>=2&&['snapshot','click','fill'].includes(r.action)){
  const detail=item.details.find(f=>JSON.stringify(f.framePath)===JSON.stringify(r.framePath)),observed=item.frames.find(f=>JSON.stringify(f.framePath)===JSON.stringify(r.framePath));
  if(!detail?.frameId)throw Error('frame_not_found_refresh_list');
  if(r.expectUrl&&observed.url!==r.expectUrl)throw Error('frame_url_changed_refresh_list');
  const evaluate=async(fn,arg)=>{const response=await call(connection.port,detail.debugTarget,[{method:'Page.createIsolatedWorld',params:{frameId:detail.frameId,worldName:'yjt-ai-nested'}},context=>({method:'Runtime.evaluate',params:{expression:`(${fn.toString()})(${JSON.stringify(arg)})`,contextId:context.executionContextId,returnByValue:true,awaitPromise:true}})]);return response.result?.value;};
  const locator=selector=>({count:()=>evaluate(selector=>(window.__yjtAiSnapshot?.nodes||[]).filter(e=>e.isConnected&&e.matches(selector)).length,selector),click:async()=>{
   const point=await evaluate(selector=>{const e=window.__yjtAiSnapshot?.nodes.find(e=>e.isConnected&&e.matches(selector));if(!e||e.disabled)throw Error('element_not_actionable');e.scrollIntoView({block:'center'});const b=e.getBoundingClientRect();if(b.width<=0||b.height<=0)throw Error('element_not_visible');let x=b.x+b.width/2,y=b.y+b.height/2,w=window;const hit=e.getRootNode().elementFromPoint(x,y);if(hit!==e&&!e.contains(hit))throw Error('element_intercepts_pointer');while(w.parent!==w){try{const owner=w.frameElement;if(!owner)break;const r=owner.getBoundingClientRect();x+=r.x+owner.clientLeft;y+=r.y+owner.clientTop;w=w.parent;}catch{break;}}return{x,y};},selector);
   await call(connection.port,detail.debugTarget,[{method:'Input.dispatchMouseEvent',params:{type:'mouseMoved',...point}},{method:'Input.dispatchMouseEvent',params:{type:'mousePressed',button:'left',clickCount:1,...point}},{method:'Input.dispatchMouseEvent',params:{type:'mouseReleased',button:'left',clickCount:1,...point}}]);
  },fill:async value=>{
   await evaluate(selector=>{const e=window.__yjtAiSnapshot?.nodes.find(e=>e.isConnected&&e.matches(selector));if(!e||e.disabled||e.readOnly||!e.matches('textarea,input:not([type]),input[type="text"],input[type="email"],input[type="tel"],input[type="search"],input[type="url"],input[type="password"]'))throw Error('element_not_fillable');e.focus();e.select();},selector);
   await call(connection.port,detail.debugTarget,[{method:'Input.dispatchKeyEvent',params:{type:'keyDown',key:'Backspace',code:'Backspace',windowsVirtualKeyCode:8}},{method:'Input.dispatchKeyEvent',params:{type:'keyUp',key:'Backspace',code:'Backspace',windowsVirtualKeyCode:8}},...(value?[{method:'Input.insertText',params:{text:value}}]:[])]);
  }});
  const frame={evaluate,locator,url:()=>observed.url},result=r.action==='snapshot'?await snapshot(frame):await act(frame,r);
  if(r.waitMs)await new Promise(resolve=>setTimeout(resolve,r.waitMs));
  return{ok:true,targetId:r.targetId,framePath:r.framePath,result,events:[],targets:publicItems(await inventory())};
 }
 if(item.kind!=='app'||r.framePath.length)throw Error('app_command_requires_app_main_frame');
 if(r.expectUrl&&item.url!==r.expectUrl)throw Error('frame_url_changed_refresh_list');
 const evaluate=async(fn,arg)=>{const expression=`(${fn.toString()})(${JSON.stringify(arg)})`;const result=await call(connection.port,item.raw,'Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});return result.result?.value;};
 let result;
 if(r.action==='snapshot')result=await snapshot({evaluate,url:()=>item.url});
 else if(r.command==='shutdown'){
  await evaluate(async()=>{await window.oneClick.resumeBatchAction({action:'stop'});await window.oneClick.closeLogin();setTimeout(()=>window.close(),100);});
  return{ok:true,result:{shutdownRequested:true}};
 }else{
  const status=await evaluate(async request=>{
   if(request.command==='openLogin')await window.oneClick.openLogin(request.companyId,request.recruitType);
   else if(request.command==='closeLogin')await window.oneClick.closeLogin();
   const s=await window.oneClick.workspaceStatus();return{active:s.active,companyId:s.companyId,mode:s.mode,title:s.title,url:s.url,diagnostics:s.diagnostics};
  },r);
  result={...status,title:sanitizeText(status.title||''),url:sanitizeUrl(status.url),diagnostics:sanitizeData(status.diagnostics||[])};
 }
 if(r.waitMs)await new Promise(resolve=>setTimeout(resolve,r.waitMs));
 return{ok:true,targetId:r.targetId,framePath:r.framePath,result,events:[],targets:publicItems(await inventory())};
}
module.exports={runSelected};
