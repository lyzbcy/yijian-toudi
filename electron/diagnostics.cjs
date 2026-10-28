// Export only structural diagnostics. Raw messages, stacks and arbitrary metadata
// may contain resume values/credentials and must never enter the shared log.
const COMPANIES=new Set(['tencent','bytedance','alibaba','baidu','meituan','jd','xiaomi','boss']);
const CODES=new Set(['ETIMEDOUT','ECONNRESET','ECONNREFUSED','ENOTFOUND','ENOENT','EACCES','ERR_FAILED','ERR_ABORTED','ERR_NETWORK_CHANGED','ERR_INTERNET_DISCONNECTED']);
const STATUS=new Set(['running','done','error','cancelled','verified','review-required','login-required','access-restricted','security-check','send-unverified','persist-failed','ready','waiting','failed','unknown']);
function diagnosticEntries(entries){
 return (Array.isArray(entries)?entries:[]).slice(-50).map(entry=>{
  const level=['info','warn','error'].includes(entry?.level)?entry.level:'info',raw=String(entry?.msg||''),meta={};
  let msg=level==='error'?'运行错误':level==='warn'?'运行提醒':'运行事件';
  for(const [pattern,title]of [[/refresh|抓取|刷新/i,'岗位刷新'],[/login|登录|auth/i,'登录流程'],[/resume|简历|field|字段/i,'简历处理'],[/batch|批量|boss/i,'批量任务'],[/update|更新|download/i,'版本更新'],[/mail|邮件|imap/i,'邮件同步'],[/kimi|bridge/i,'浏览器连接']])if(pattern.test(raw)){msg=title;break;}
  const m=entry?.meta;if(m&&typeof m==='object'){
   for(const key of ['count','applied','total','previewed','failed','durationMs','statusCode','inputCount'])if(typeof m[key]==='number'&&Number.isFinite(m[key])&&m[key]>=0&&m[key]<=1e10)meta[key]=m[key];
   for(const key of ['company','companyId'])if(COMPANIES.has(m[key]))meta[key]=m[key];
   for(const key of ['status','phase'])if(STATUS.has(m[key]))meta[key]=m[key];
   if(CODES.has(m.code))meta.code=m.code;
  }
  const ts=/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(entry?.ts||'')?entry.ts:'';
  return{ts,level,msg,meta};
 });
}
function redactNote(value){
 return String(value||'').slice(0,1500)
 .replace(/https?:\/\/[^\s<>]+/gi,'[链接已移除]')
 .replace(/(?:Bearer\s+)[\w.+\/-]+/gi,'[凭据已移除]')
 .replace(/(?:token|password|passwd|secret|authorization|cookie|key|授权码|密码)\s*[:=：]\s*[^\s,;，；]+/gi,'[凭据已移除]')
 .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,'[邮箱已移除]')
 .replace(/\b\d{17}[\dXx]\b/g,'[证件号已移除]')
 .replace(/\b1[3-9]\d{9}\b/g,'[手机号已移除]')
 .replace(/[A-Z]:[\\/][^\r\n，；<>]+/gi,'[本地路径已移除]')
 .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'');
}
function diagnosticBundle(entries,{version,platform}={}){
 return{schema:1,version:/^\d+\.\d+\.\d+$/.test(version||'')?version:'unknown',platform:['win32','darwin','linux'].includes(platform)?platform:'unknown',entries:diagnosticEntries(entries)};
}
module.exports={diagnosticEntries,diagnosticBundle,redactNote};
