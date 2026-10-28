// Fixed, read-only native WebContents probe. No caller JS, field values or debugger.
const {inspectPageAuthentication}=require('./page-auth-probe.cjs');
const READINESS_SCRIPT=`(()=>{const inspectAuthentication=${inspectPageAuthentication.toString()};const body=(document.body?.innerText||'').slice(0,6000);return{readyState:document.readyState,visibleControls:[...document.querySelectorAll('input,textarea,select')].filter(e=>e.type!=='hidden'&&e.type!=='file'&&!e.disabled&&e.getClientRects().length).length,loginRequired:inspectAuthentication().loginRequired,blocked:/^安全验证/.test(document.title)||/访问受限|账户存在异常行为|暂时被限制访问/.test(body.slice(0,500))};})()`;
function publicWorkspaceUrl(raw){try{const u=new URL(raw);if(u.username||u.password)return'';if(u.protocol==='about:'&&u.pathname==='blank')return'about:blank';if(u.protocol!=='https:')return'';const hash=/^#\/[a-zA-Z0-9/_-]+(?:\?|$)/.test(u.hash)?u.hash.split('?')[0]:'';return u.origin+u.pathname+hash;}catch{return'';}}
async function inspectWorkspace(manager,{timeoutMs=1500}={}){
 const status=manager?.getStatus?.()||{},url=publicWorkspaceUrl(status.url||''),base={companyId:String(status.companyId||'').replace(/[^a-z0-9_-]/g,'').slice(0,40),mode:['login','resume-review','browse'].includes(status.mode)?status.mode:'unknown',url,active:status.active===true,usable:false};
 const v=status.viewport;if(v&&typeof v==='object')base.viewport={mode:['fit','actual'].includes(v.mode)?v.mode:'unknown',scale:Number.isFinite(v.scale)&&v.scale>=.25&&v.scale<=1?v.scale:null,pending:v.pending===true,tooSmall:v.tooSmall===true,error:v.error==='viewport-unavailable'?v.error:null};
 if(!base.active)return{...base,reason:'workspace-inactive'};
 const view=manager?.getWebContents?.();if(!view||view.isDestroyed())return{...base,reason:'workspace-closed'};
 if(!url||url==='about:blank')return{...base,reason:'blank-page'};
 const before=view.getURL();let timer;try{const probe=await Promise.race([view.executeJavaScript(READINESS_SCRIPT),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('probe-timeout')),timeoutMs);})]);if(view.isDestroyed())return{...base,reason:'workspace-closed'};if(view.getURL()!==before)return{...base,url:publicWorkspaceUrl(view.getURL()),reason:'navigation-changed'};
 const visibleControls=Number.isSafeInteger(probe?.visibleControls)&&probe.visibleControls>=0&&probe.visibleControls<=10000?probe.visibleControls:0,readyState=['loading','interactive','complete'].includes(probe?.readyState)?probe.readyState:'unknown',loginRequired=probe?.loginRequired===true,blocked=probe?.blocked===true;
 const reason=blocked?'verification-required':loginRequired?'login-required':readyState==='loading'?'page-loading':visibleControls===0?'no-form':'ready';return{...base,visibleControls,readyState,loginRequired,blocked,usable:reason==='ready',reason};
 }catch{return{...base,reason:'inspection-unavailable'};}finally{clearTimeout(timer);}
}
module.exports={READINESS_SCRIPT,publicWorkspaceUrl,inspectWorkspace};
