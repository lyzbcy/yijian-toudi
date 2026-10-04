#!/usr/bin/env node
'use strict';
// Opt-in local preview browser control. No desktop coordinates or first-tab guessing.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { fileURLToPath } = require('node:url');
const { randomUUID } = require('node:crypto');
const { chromium } = require('playwright-core');
const ROOT = path.resolve(__dirname, '..');
const CONNECTION = process.env.YJT_AI_CONNECTION_FILE ? path.resolve(process.env.YJT_AI_CONNECTION_FILE) : path.join(ROOT, '.local-data', 'ai-preview.json');
const ACTIONS = new Set(['list', 'snapshot', 'click', 'fill', 'screenshot', 'app']);
function sanitizeUrl(raw) {
  try { const u = new URL(raw); const route=/^#\/[a-zA-Z0-9/_-]+(?:\?|$)/.test(u.hash)?u.hash.split('?')[0]:''; return u.protocol === 'data:' ? 'data:[page]' : u.origin === 'null' ? `${u.protocol}${u.pathname}${route}` : u.origin + u.pathname + route; }
  catch { return ''; }
}
function cleanError(error) {
  const lines=String(error?.message||error).split('\n');
  return sanitizeText([lines[0],...lines.slice(1).filter(l=>/intercepts pointer|element is |outside of the viewport|detached from the DOM|not visible|not stable/.test(l)).slice(0,5).map(l=>l.replace(/<[^>]*>/g,'[element]'))].join('\n'));
}
function sanitizeText(text) { return String(text).replace(/https?:\/\/[^\s'"<>]+/g, sanitizeUrl); }
function normalizeRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('invalid_request');
  const fields = new Set(['action','port','targetId','framePath','expectUrl','snapshotId','ref','value','confirmSubmission','confirmDiscard','path','command','companyId','recruitType','waitMs']);
  for (const key of Object.keys(input)) if (!fields.has(key)) throw Error('unknown_field:' + key);
  const r = {...input, framePath:input.framePath || [], waitMs:input.waitMs ?? 300};
  if (!ACTIONS.has(r.action)) throw Error('unsupported_action');
  if (r.port !== undefined && (!Number.isInteger(r.port) || r.port < 1 || r.port > 65535)) throw Error('invalid_port');
  if (!Array.isArray(r.framePath) || r.framePath.length > 8 || r.framePath.some(i=>!Number.isInteger(i)||i<0||i>100)) throw Error('invalid_frame_path');
  if (!Number.isInteger(r.waitMs) || r.waitMs < 0 || r.waitMs > 2000) throw Error('invalid_wait');
  if (r.action !== 'list' && (typeof r.targetId !== 'string' || !r.targetId)) throw Error('target_id_required');
  if (['click','fill'].includes(r.action)) {
    if (typeof r.snapshotId !== 'string' || !r.snapshotId) throw Error('snapshot_id_required');
    if (!/^e\d+$/.test(r.ref || '')) throw Error('invalid_ref');
  }
  if (r.action === 'fill' && (typeof r.value !== 'string' || r.value.length > 20000)) throw Error('fill_value_required');
  if (r.confirmSubmission !== undefined && typeof r.confirmSubmission !== 'boolean') throw Error('invalid_confirmation');
  if (r.action === 'screenshot' && (!r.path || !path.isAbsolute(r.path))) throw Error('absolute_screenshot_path_required');
  if (r.action === 'app' && !['status','openLogin','closeLogin','shutdown'].includes(r.command)) throw Error('unsupported_app_command');
  if (r.command === 'shutdown' && r.confirmDiscard !== true) throw Error('discard_confirmation_required');
  if (r.action === 'app' && r.command === 'openLogin') {
    if (!['tencent','baidu','bytedance','alibaba','meituan','jd','xiaomi'].includes(r.companyId)) throw Error('invalid_company');
    if (!['campus','social'].includes(r.recruitType)) throw Error('invalid_recruit_type');
  }
  return r;
}
function fetchLocalJson(port, route) {
  return new Promise((resolve,reject)=>{
    const req=http.get({host:'127.0.0.1',port,path:route},res=>{
      let data=''; res.on('data',chunk=>{data+=chunk;if(data.length>2*1024*1024)req.destroy(Error('local_response_too_large'));});
      res.on('end',()=>{try{if(res.statusCode!==200)throw Error('debug_endpoint_http_'+res.statusCode);resolve(JSON.parse(data));}catch(e){reject(e);}});
    });
    req.setTimeout(5000,()=>req.destroy(Error('debug_endpoint_timeout')));req.on('error',reject);
  });
}
function isAppPage(page) {
  try { const u=new URL(page.url()); return u.protocol==='file:' && fileURLToPath(u).toLowerCase()===path.join(ROOT,'src','index.html').toLowerCase() && u.searchParams.get('localPreview')==='1'; }
  catch { return false; }
}
function requiresConsoleSafeChannel(target) {
  try { return new URL(target.url).hostname==='talent.baidu.com'; } catch { return false; }
}
async function readFrameUrl(frame) {
  if(frame.url())return frame.url();
  // Electron may attach an OOPIF with an empty cached URL. Read its own realm,
  // rather than misidentifying it as the parent or opening its URL elsewhere.
  let timer;
  try{return await Promise.race([frame.evaluate(()=>location.href),new Promise(resolve=>{timer=setTimeout(()=>resolve(''),1000);})]);}
  catch{return '';}finally{clearTimeout(timer);}
}
async function frameTree(frame, indices=[]) {
  const owners=await frame.locator('iframe,frame').elementHandles();const children=[];
  for(let i=0;i<owners.length;i++){const child=await owners[i].contentFrame();children.push(child?await frameTree(child,[...indices,i]):[{framePath:[...indices,i],name:'',url:''}]);await owners[i].dispose();}
  return [{framePath:indices,name:frame.name(),url:sanitizeUrl(await readFrameUrl(frame))},...children.flat()];
}
async function resolveFrame(page, indices) {
  let frame=page.mainFrame();
  for(let depth=0;depth<indices.length;depth++){const index=indices[depth],owner=await frame.locator('iframe,frame').nth(index).elementHandle({timeout:1000});frame=owner?await owner.contentFrame():null;await owner?.dispose();if(!frame)throw Error('frame_not_found_refresh_list:depth_'+depth);}
  return frame;
}
async function targets(browser) {
  const out=[];
  for(const context of browser.contexts())for(const page of context.pages()) {
    if(page.isClosed())continue;
    let cdp;
    try { cdp=await context.newCDPSession(page); const {targetInfo}=await cdp.send('Target.getTargetInfo');out.push({targetId:targetInfo.targetId,kind:isAppPage(page)?'app':'web',...(isAppPage(page)?{version:new URL(page.url()).searchParams.get('appVersion')}:{ }),title:await page.title().catch(()=>''),url:sanitizeUrl(page.url()),frames:await frameTree(page.mainFrame()),page}); }
    catch(error){if(!page.isClosed())throw error;}
    finally {await cdp?.detach().catch(()=>{});}
  }
  return out;
}
function publicTargets(items){return items.map(({page,...item})=>item);}
async function snapshot(frame) {
  const snapshotId=randomUUID();
  const data=await frame.evaluate(({snapshotId})=>{
    const roots=[document];
    for(let i=0;i<roots.length&&roots.length<80;i++)for(const e of roots[i].querySelectorAll('*'))if(e.shadowRoot)roots.push(e.shadowRoot);
    roots.forEach(root=>root.querySelectorAll('[data-yjt-ai-ref]').forEach(e=>e.removeAttribute('data-yjt-ai-ref')));
    const nodes=roots.flatMap(root=>[...root.querySelectorAll('button,a,input,textarea,select,[role="button"],[role="checkbox"],[contenteditable="true"],img[alt]')])
      .filter(e=>e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden').slice(0,250);
    window.__yjtAiSnapshot={id:snapshotId,nodes};
    const elements=nodes.map((e,i)=>{
      const ref='e'+(i+1);e.setAttribute('data-yjt-ai-ref',snapshotId+':'+ref);
      return {ref,tag:e.tagName.toLowerCase(),role:e.getAttribute('role')||'',type:e.type||'',name:(e.getAttribute('aria-label')||[...(e.labels||[])].map(l=>l.innerText).join(' ')||e.innerText||e.getAttribute('alt')||e.getAttribute('placeholder')||e.title||'').trim().slice(0,200),disabled:Boolean(e.disabled)};
    });
    const text=[document.body?.innerText||'',...roots.slice(1).map(root=>[...root.children].filter(e=>!['STYLE','SCRIPT'].includes(e.tagName)).map(e=>e.innerText||'').join('\n'))].join('\n');
    return {title:document.title,text:text.slice(0,8000),shadowRoots:roots.length-1,elements};
  },{snapshotId});
  return {snapshotId,url:sanitizeUrl(await readFrameUrl(frame)),...data,text:sanitizeText(data.text),elements:data.elements.map(e=>({...e,name:sanitizeText(e.name)}))};
}
function requiresSubmission(info){return info.submitsForm||/提交|投递|申请|发送|保存|覆盖|submit|apply|send|save/i.test(info.name.replace(/\s+/g,''));}
async function act(frame,r) {
  const info=await frame.evaluate(({snapshotId,ref})=>{
    const state=window.__yjtAiSnapshot;if(!state||state.id!==snapshotId)return {error:'stale_snapshot_refresh'};
    const element=state.nodes[Number(ref.slice(1))-1];
    if(!element?.isConnected||element.getAttribute('data-yjt-ai-ref')!==snapshotId+':'+ref)return {error:'stale_element_refresh'};
    return {type:element.type||'',submitsForm:element.type==='submit'&&Boolean(element.form),name:(element.getAttribute('aria-label')||element.innerText||element.getAttribute('alt')||element.name||'').slice(0,200),tag:element.tagName.toLowerCase()};
  },r);
  if(info.error)throw Error(info.error);
  if(r.action==='fill'&&info.type==='password')throw Error('password_entry_is_manual');
  if(r.action==='click'&&requiresSubmission(info)&&r.confirmSubmission!==true)throw Error('submission_confirmation_required');
  const locator=frame.locator(`[data-yjt-ai-ref="${r.snapshotId}:${r.ref}"]`);
  if(await locator.count()!==1)throw Error('ambiguous_ref_refresh');
  if(r.action==='click')await locator.click({timeout:5000,noWaitAfter:true});else await locator.fill(r.value,{timeout:5000});
  return {acted:true,ref:r.ref,name:info.name};
}
async function run(input) {
  const r=normalizeRequest(input);
  const connection=r.port?{port:r.port}:JSON.parse(fs.readFileSync(CONNECTION,'utf8'));
  if(!Number.isInteger(connection.port)||connection.port<1||connection.port>65535)throw Error('invalid_connection_port');
  const version=await fetchLocalJson(connection.port,'/json/version');
  const socket=new URL(version.webSocketDebuggerUrl);
  if(!['127.0.0.1','localhost'].includes(socket.hostname)||Number(socket.port)!==connection.port)throw Error('non_local_debug_socket');
  // Inventory/app operations do not need a browser-wide Playwright attachment.
  // That attachment enables console collection on unrelated recruiting pages.
  if(r.action==='list'||r.action==='app'||(r.framePath.length>=2&&['snapshot','click','fill'].includes(r.action))||(r.action==='snapshot'&&!r.framePath.length&&(!connection.targetId||r.targetId===connection.targetId))){
    const list=await fetchLocalJson(connection.port,'/json/list');
    const selected=list.find(t=>t.id===r.targetId);
    if(r.framePath.length>=2||r.action!=='snapshot'||selected&&isAppPage({url:()=>selected.url}))return require('./ai-main-channel.cjs').runSelected(r,connection,{fetchLocalJson,isAppPage,sanitizeUrl,sanitizeText,snapshot,act});
  }
  // A Playwright browser attachment enables Runtime on every page, including
  // unrelated workspaces. Refuse that route while Baidu's guarded page is open.
  const openTargets=await fetchLocalJson(connection.port,'/json/list');
  if(openTargets.some(requiresConsoleSafeChannel))throw Error('baidu_workspace_requires_console_safe_channel_use_app_status_or_close_workspace_before_browser_debugging');
  const browser=await chromium.connectOverCDP(socket.href,{timeout:10000});
  const events=[];let actionSession;
  try {
    const items=await targets(browser);
    if(items.filter(x=>x.kind==='app').length!==1)throw Error('expected_one_project_preview');
    if(!r.port&&connection.targetId&&items.find(x=>x.kind==='app').targetId!==connection.targetId)throw Error('stale_connection_manifest_restart_preview');
    if(r.action==='list')return {ok:true,targets:publicTargets(items)};
    const match=items.filter(x=>x.targetId===r.targetId);if(match.length!==1)throw Error('target_not_found_refresh_list');
    const page=match[0].page,frame=await resolveFrame(page,r.framePath);
    if(r.expectUrl&&sanitizeUrl(await readFrameUrl(frame))!==r.expectUrl)throw Error('frame_url_changed_refresh_list');
    page.on('framenavigated',f=>{if(events.length<30)events.push({kind:'navigation',url:sanitizeUrl(f.url()),main:f===page.mainFrame()});});
    actionSession=await page.context().newCDPSession(page);await actionSession.send('Page.enable');
    for(const event of ['Page.frameRequestedNavigation','Page.windowOpen'])actionSession.on(event,details=>{if(events.length<30)events.push({kind:event,url:sanitizeUrl(details.url)});});
    page.context().on('page',p=>{if(events.length<30)events.push({kind:'target-created',url:sanitizeUrl(p.url())});});
    let result;
    if(r.action==='snapshot')result=await snapshot(frame);
    else if(['click','fill'].includes(r.action))result=await act(frame,r);
    else if(r.action==='screenshot'){await page.screenshot({path:r.path});result={path:r.path};}
    else if(r.action==='app') {
      if(match[0].kind!=='app'||r.framePath.length)throw Error('app_command_requires_app_main_frame');
      if(r.command==='shutdown') {
        await page.evaluate(async()=>{await window.oneClick.resumeBatchAction({action:'stop'});await window.oneClick.closeLogin();setTimeout(()=>window.close(),100);});
        return {ok:true,result:{shutdownRequested:true}};
      }
      const status=await page.evaluate(async(r)=>{
        if(r.command==='openLogin')await window.oneClick.openLogin(r.companyId,r.recruitType);
        else if(r.command==='closeLogin')await window.oneClick.closeLogin();
        const s=await window.oneClick.workspaceStatus();
        return {active:s.active,companyId:s.companyId,mode:s.mode,title:s.title,url:s.url,diagnostics:s.diagnostics};
      },r);
      result={...status,url:sanitizeUrl(status.url)};
    }
    if(r.waitMs)await page.waitForTimeout(r.waitMs);
    return {ok:true,targetId:r.targetId,framePath:r.framePath,result,events,targets:publicTargets(await targets(browser))};
  } catch(error){error.observation={events,targets:publicTargets(await targets(browser).catch(()=>[]))};throw error;}
  finally {await actionSession?.detach().catch(()=>{});await browser.close().catch(()=>{});}
}
if(require.main===module) {
  (async()=>{
    const arg=process.argv[2];if(!arg)throw Error('usage: node scripts/ai-browser.cjs list|REQUEST.json');
    const request=arg==='list'?{action:'list'}:JSON.parse(fs.readFileSync(path.resolve(arg),'utf8').replace(/^\uFEFF/,''));
    console.log(JSON.stringify(await run(request)));
  })().catch(error=>{console.error(JSON.stringify({ok:false,error:cleanError(error),...error.observation}));process.exitCode=1;});
}
module.exports={run,normalizeRequest,sanitizeUrl,resolveFrame,fetchLocalJson,isAppPage,requiresSubmission,requiresConsoleSafeChannel};
