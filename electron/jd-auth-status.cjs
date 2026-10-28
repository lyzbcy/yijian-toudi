// Observable login outcome, not a declaration that QR scan means authenticated.
// No URLs, query parameters, cookie values, account names or form data are stored.
function createJdAuthStatus({now=Date.now,scanWaitMs=300000,callbackTimeoutMs=30000}={}) {
 let state='pending',code='LOGIN_NOT_VERIFIED',entryAt=null,callbackAt=null;
 const messages={pending:'正在核对官网登录状态；尚未确认登录。','awaiting-scan':'请扫描当前二维码；手机提示成功后，仍需核对官网登录结果。',stale:'二维码等待时间较长；如需继续，可重新打开登录。不要反复扫描同一张旧码。',checking:'已收到扫码回调，正在核对官网登录结果。',verified:'已核对：校招页面已登录。',failed:'扫码回调已返回，但官网尚未建立登录会话。页面已保留，请勿反复扫描同一张旧码。'};
 function observe(raw){let u;try{u=new URL(raw);}catch{return;}if(u.protocol!=='https:'||u.username||u.password||u.port)return;
  if(u.origin==='https://qq.jd.com'&&u.pathname==='/new/wx/login.action'){entryAt=now();callbackAt=null;state='awaiting-scan';code='WAITING_FOR_SCAN';}
  else if(entryAt!==null&&u.origin==='https://qq.jd.com'&&u.pathname==='/new/wx/callback.action'&&callbackAt===null){callbackAt=now();state='checking';code='CHECKING_AUTH_RESULT';}
 }
 function update(probe){
  if(probe?.isCampus&&probe.resumeSection&&probe.loginVisible===false&&probe.hasAuthCookie===true){state='verified';code='CAMPUS_LOGIN_VERIFIED';return snapshot();}
  // A prior result must not authorize completion on a different/loading page or
  // after the credential disappears. The next positive probe can verify again.
  if(state==='verified'){state='pending';code='LOGIN_NOT_VERIFIED';entryAt=null;callbackAt=null;}
  if(callbackAt!==null&&now()-callbackAt>=callbackTimeoutMs){state='failed';code=probe?.isCampus&&probe.loginVisible===true&&probe.hasAuthCookie===false?'CALLBACK_NO_AUTH':'AUTH_CHECK_TIMEOUT';}
  else if(callbackAt===null&&entryAt!==null&&now()-entryAt>=scanWaitMs){state='stale';code='SCAN_WAIT_TOO_LONG';}
  return snapshot();
 }
 function snapshot(){return{state,code,message:code==='AUTH_CHECK_TIMEOUT'?'登录结果核验超时，页面已保留；请查看官网提示。':messages[state],attemptAgeSeconds:entryAt===null?null:Math.max(0,Math.floor((now()-entryAt)/1000))};}
 return{observe,update,snapshot};
}
module.exports={createJdAuthStatus};
