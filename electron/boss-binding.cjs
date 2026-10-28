const {blockedReason}=require('./boss-batch.cjs');
// Current official header's resume link. /web/user redirects to the homepage;
// navigation alone is not identity evidence, so retain the strict classifier.
const BOSS_ACCOUNT_ENTRY='https://www.zhipin.com/web/geek/resume';
function normalizePhoneMask(value){if(typeof value!=='string')return null;const s=value.replace(/[\s-]/g,'').replace(/^(?:\+?86)(?=1)/,'');const m=s.match(/^(1\d{2})(?:\d{4}|\*{1,8})(\d{4})$/);return m?m[1]+'****'+m[2]:null;}
function classifyBossBinding(snapshot,account,{defaultPhone}={}){
 const blocked=blockedReason(snapshot);if(blocked)return {verified:false,error:blocked};
 const raw=JSON.stringify(snapshot?.data?.tree||snapshot?.data?.links||snapshot?.data?.raw||'');
 const loginAction=node=>node&&typeof node==='object'&&((['button','link'].includes(node.role)&&/^(登录|立即登录|扫码登录|微信登录|验证码登录)(?:$|[\/\s]|BOSS)/i.test(node.name||''))||(node.children||[]).some(loginAction));
 if((snapshot?.data?.tree||snapshot?.data?.links||[]).some?.(loginAction))return {verified:false,error:'login-required'};
 if(/BOSS直聘注册登录|微信扫码 安全登录|验证码登录\/注册|登录\/注册/.test(raw))return {verified:false,error:'login-required'};
 let url;try{url=new URL(snapshot?.data?.url);}catch{return {verified:false,error:'account-page-required'};}
 if(url.origin!=='https://www.zhipin.com'||!['/web/user','/web/geek/resume','/web/geek/profile'].includes(url.pathname))return {verified:false,error:'account-page-required'};
 const expected=normalizePhoneMask(account?.phoneMasked)||((account?.id==='default')?normalizePhoneMask(defaultPhone):null);
 if(!expected)return {verified:false,error:'account-phone-required'};
 const matches=[...raw.matchAll(/(?<!\d)(1\d{2}(?:\s*\*\s*){1,8}\d{4}|1\d{10})(?!\d)/g)].map(m=>normalizePhoneMask(m[1])).filter(Boolean),phones=[...new Set(matches)];
 if(!phones.length)return {verified:false,error:'account-phone-unreadable'};
 if(phones.length!==1)return {verified:false,error:'account-phone-ambiguous'};
 if(phones[0]!==expected)return {verified:false,error:'account-binding-mismatch'};
 return {verified:true,accountId:account.id,detected:phones[0]};
}
module.exports={BOSS_ACCOUNT_ENTRY,normalizePhoneMask,classifyBossBinding};
