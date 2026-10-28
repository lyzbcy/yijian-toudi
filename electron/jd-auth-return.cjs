// Recover the observed JD mall landing, not a declaration of authenticated state.
// Keep OAuth parameters in memory; never persist code, cookie or account values.
function createJdAuthReturnTracker({companyId,initialUrl,now=Date.now}) {
 let enabled=false,target=null,callbackSeen=false,expires=0;
 try { const u=new URL(initialUrl);enabled=companyId==='jd'&&u.origin==='https://campus.jd.com'&&u.pathname==='/'&&u.hash.startsWith('#/resume'); } catch {}
 function parse(raw){try{const u=new URL(raw);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port?u:null;}catch{return null;}}
 function observe(raw){
  if(!enabled)return;
  const u=parse(raw);if(!u)return;
  if(u.origin==='https://qq.jd.com'&&u.pathname==='/new/wx/login.action'){
   const r=parse(u.searchParams.get('ReturnUrl'));
   target=r&&r.origin==='https://campus.jd.com'&&r.pathname==='/'&&r.hash==='#/login-callback'&&!r.search?r.href:null;
   callbackSeen=false;expires=0;
  } else if(target&&!callbackSeen&&u.origin==='https://qq.jd.com'&&u.pathname==='/new/wx/callback.action'){
   // Waiting for a person's scan is not a callback handoff. Start this short
   // TTL only at the first observed callback; repeated callbacks cannot renew it.
   callbackSeen=true;expires=now()+10*60*1000;
  }
 }
 function consume(raw){
  const u=parse(raw);
  if(!target||!callbackSeen||now()>=expires||!u||u.origin!=='https://www.jd.com'||u.pathname!=='/')return null;
  const result=target;target=null;callbackSeen=false;return result;
 }
 return {observe,consume};
}
module.exports={createJdAuthReturnTracker};
