'use strict';
const {randomUUID}=require('node:crypto');
const norm=v=>String(v||'').trim().toLowerCase();
const scope=s=>({accountId:s.activeAccountId||'default',profileId:s.resume?.activeProfileId||'default'});
const visible=(s,a)=>a.accountId===scope(s).accountId&&a.profileId===scope(s).profileId;
function ensure(s){
 const e=s.settings.email;if(!Array.isArray(e.accounts)){
  e.accounts=[];if(e.address)e.accounts.push({id:randomUUID(),...scope(s),address:norm(e.address),provider:'qq',method:e.method||'imap',connected:e.connected===true,status:e.browserStatus||'connected',lastSyncAt:e.lastSyncAt,scanned:e.browserScanned,partial:e.browserPartial,encryptedCode:e.encryptedCode,imapAddress:e.imapAddress});
  if(e.encryptedCode&&e.imapAddress&&norm(e.imapAddress)!==norm(e.address))e.accounts.push({id:randomUUID(),...scope(s),address:norm(e.imapAddress),provider:'qq',method:'imap',connected:true,encryptedCode:e.encryptedCode});
 }
 return e.accounts;
}
function accounts(s){return ensure(s).filter(a=>visible(s,a));}
function select(s,input={}){
 const list=accounts(s);
 if(input.mailboxId){const a=list.find(a=>a.id===input.mailboxId);if(!a)throw Error('当前账号/简历没有此邮箱');return a;}
 const provider=input.provider||'qq',method=input.method||'browser';if(!['qq','jiangnan'].includes(provider)||!['browser','imap'].includes(method)||provider==='jiangnan'&&method!=='browser')throw Error('无效邮箱连接方式');
 const address=norm(input.address);return list.find(a=>a.provider===provider&&a.method===method&&(!address||a.address===address))||{id:randomUUID(),...scope(s),provider,method,address,connected:false,encryptedCode:method==='imap'?list.find(a=>a.encryptedCode&&(norm(a.imapAddress)||a.address)===address)?.encryptedCode:undefined};
}
function commit(s,target,result,input={}){
 if(!visible(s,target))throw Error('账号或简历已切换，本轮未导入');
 const list=ensure(s),old=list.find(a=>a.id===target.id);if(old&&(!visible(s,old)||old.address!==target.address))throw Error('邮箱绑定已变化');
 const address=norm(result.address||target.address);if(!address)throw Error('邮箱身份未确认');
 if(list.some(a=>visible(s,a)&&a.id!==target.id&&a.address===address&&a.method===target.method))throw Error('此邮箱已经连接，请使用已有连接');
 const entry={...target,...old,address,connected:result.status==='connected',status:result.status,lastAttemptAt:new Date().toISOString()};
 if(result.status==='connected')Object.assign(entry,{lastSyncAt:new Date().toISOString(),scanned:result.scanned,partial:result.partial,coverageGap:result.coverageGap||0,error:''});
 else entry.error=result.error||'';
 if(input.encryptedCode)entry.encryptedCode=input.encryptedCode;
 s.settings.email.accounts=old?list.map(a=>a.id===entry.id?entry:a):[...list,entry];
 // Legacy QQ view is retained for old UI/IMAP compatibility, never points at school mailbox.
 if(entry.provider==='qq')Object.assign(s.settings.email,{method:entry.method,address,connected:entry.connected,browserStatus:entry.status,browserScanned:entry.scanned,browserPartial:entry.partial,lastSyncAt:entry.lastSyncAt});
 return entry;
}
module.exports={ensure,accounts,select,commit,visible,scope};
