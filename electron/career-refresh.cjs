'use strict';
const career=require('./career-tracker.cjs'),mail=require('./mail-accounts.cjs');
const {KimiDaemonClient}=require('./kimi-daemon-client.cjs');
const LEAD='https://leadchina.zhiye.com/personal/deliveryRecord';
const ELECTRIC='https://wecruit.hotjob.cn/SU60de8350bef57c519874bd36/pb/account.html#/myDeliver';
function target(row,items){
 const item=items.find(i=>(row.agentApplicationIds||[]).includes(i.id)&&i.status==='submitted'&&i.applicationRoute==='employer-ats');
 if(!item)return null;let u;try{u=new URL(item.receipt?.url);}catch{return null;}
 if(u.origin==='https://leadchina.zhiye.com'&&row.company==='无锡先导智能装备股份有限公司'&&row.role.includes('J17815'))return {url:LEAD,kind:'lead',role:row.role};
 if(u.origin==='https://wecruit.hotjob.cn'&&u.pathname.startsWith('/SU60de8350bef57c519874bd36/')&&row.company==='上海电气集团数字科技有限公司'&&row.role==='AI应用开发工程师')return {url:ELECTRIC,kind:'electric',role:'AI应用开发工程师(27届校招)'};
 return null;
}
// Fixed observed one-record receipt pages only. Never clicks apply, edit or assessment links.
function readOfficial(kind,role){
 const url=location.origin+location.pathname+location.hash;
 if((kind==='lead'&&(location.origin!=='https://leadchina.zhiye.com'||location.pathname!=='/personal/deliveryRecord'))||(kind==='electric'&&(location.origin!=='https://wecruit.hotjob.cn'||location.pathname!=='/SU60de8350bef57c519874bd36/pb/account.html'||location.hash!=='#/myDeliver')))return JSON.stringify({status:'wrong-page'});
 const text=document.body.innerText;
 if(/验证码|拖动滑块|安全验证/.test(text))return JSON.stringify({status:'verification-required'});
 const one=kind==='lead'?/已完成的投递\s*[（(]\s*1\s*[）)]/.test(text):/已投递过的职位数：\s*1\b/.test(text);
 if(!one||!text.includes(role))return JSON.stringify({status:/登录|扫码|手机号/.test(text)?'login-required':'review-required'});
 if(kind==='electric'&&(!text.includes('投递成功')||!text.includes('上海电气集团数字科技有限公司')))return JSON.stringify({status:'review-required'});
 const rawStatus=kind==='lead'?text.match(/当前进度[：:]\s*([^\n]{1,80})/)?.[1]:text.match(/最近投递进度[：:]\s*([^\n]{1,80})/)?.[1];
 if(!rawStatus)return JSON.stringify({status:'review-required'});
 return JSON.stringify({status:'checked',rawStatus:rawStatus.trim(),url,observedAt:new Date().toISOString(),evidenceSource:'browser-visible-record',stageConfirmed:false});
}
class OfficialStatusReader{
 constructor({client=new KimiDaemonClient({session:'yijian-toudi-career-status',pollMs:0}),wait=ms=>new Promise(r=>setTimeout(r,ms))}={}){Object.assign(this,{client,wait});}
 async read(t){try{
  await this.client.start();if(!this.client.isUp())return {status:'browser-unavailable'};
  const inv=await this.client.sendTool('list_browser_tabs',{});
  const tabs=(inv.data?.tabs||[]).filter(x=>{try{const a=new URL(x.url),b=new URL(t.url);return a.origin===b.origin&&a.pathname===b.pathname&&a.hash===b.hash;}catch{return false;}});
  if(tabs.length!==1)return {status:tabs.length?'review-required':'tab-required'};
  await this.client.sendTool('attach_tab',{tabId:tabs[0].tabId});
  await this.client.navigate(t.url,{newTab:false});
  for(let n=0;n<10;n++){
   const r=await this.client.sendTool('evaluate',{code:`(${readOfficial.toString()})(${JSON.stringify(t.kind)},${JSON.stringify(t.role)})`});
   const value=r.data?.type==='string'?JSON.parse(r.data.value):{status:'review-required'};
   if(value.status==='checked'||value.status==='verification-required')return value;
   if(n===9)return value;await this.wait(300);
  }
 }catch{return {status:'read-failed'};}finally{this.client.stop();}}
}
function createRefresh({store,syncMailbox,readOfficialStatus,broadcast=()=>{}}){
 let running=false;
 return async function refresh(input={}){
  if(running)throw Object.assign(Error('career-refresh-running'),{status:409});
  const origin=mail.scope(store.get());
  if(input.confirmRead!==true||input.accountId!==origin.accountId||input.profileId!==origin.profileId)throw Object.assign(Error('career-refresh-confirmation-or-scope-required'),{status:409});
  running=true;const guard=()=>{if(JSON.stringify(origin)!==JSON.stringify(mail.scope(store.get())))throw Error('career-refresh-scope-changed');};
  try{
   const before=structuredClone(store.get().careerApplications||[]),mailboxes=[];
   const accounts=structuredClone(mail.accounts(store.get()).filter(a=>a.enabled!==false&&a.address));
   for(const a of accounts){
    guard();try{await syncMailbox({mailboxId:a.id,connect:input.reconnect===true,details:true});guard();const current=mail.accounts(store.get()).find(x=>x.id===a.id);mailboxes.push({provider:a.provider,status:current?.status||'unknown',scanned:current?.scanned||0,partial:current?.partial===true});}
    catch(e){guard();mailboxes.push({provider:a.provider,status:'sync-failed',scanned:0});}
   }
   guard();store.update(s=>{career.importAgentReceipts(s);return s;});
   const rows=structuredClone((store.get().careerApplications||[]).filter(r=>career.visible(store.get(),r))),items=store.get().agentApplications?.items||[],official=[];
   for(const row of rows){const t=target(row,items);if(!t)continue;guard();const observation=await readOfficialStatus(t);guard();official.push({id:row.id,company:row.company,...observation});}
   guard();const checked=official.filter(o=>o.status==='checked');
   store.update(s=>{for(const o of checked){const row=s.careerApplications.find(r=>r.id===o.id&&career.visible(s,r));if(row)row.officialStatus={rawStatus:o.rawStatus,url:o.url,observedAt:o.observedAt,evidenceSource:o.evidenceSource,stageConfirmed:false};}return s;});
   const after=store.get().careerApplications||[],changed=rows.filter(r=>{const b=before.find(x=>x.id===r.id),a=after.find(x=>x.id===r.id);return b&&a&&b.stage!==a.stage;}).length;
   const report={at:new Date().toISOString(),total:rows.length,created:rows.filter(r=>!before.some(b=>b.id===r.id)).length,stageChanges:changed,mailboxes,official,officialChecked:checked.length,officialPending:rows.length-checked.length,mailReview:(store.get().careerMailReview||[]).filter(r=>career.visible(store.get(),r)).length};
   report.summary=`邮箱 ${mailboxes.filter(a=>a.status==='connected').length}/${mailboxes.length} 已同步；官网核对 ${report.officialChecked}/${report.total}，待核对 ${report.officialPending}；阶段变化 ${changed}，新增 ${report.created}。`;
   report.summary+=' '+mailboxes.map(a=>(a.provider==='qq'?'QQ':'学校邮箱')+'：'+({'connected':a.partial?'最近列表已同步':'已同步','login-required':'待登录','tab-required':'同步页已关闭','loading':'页面加载未完成','sync-failed':'读取失败'}[a.status]||a.status)).join('；');
   store.update(s=>{s.careerRefresh={...origin,...report};return s;});broadcast();return {ok:true,report};
  }finally{running=false;}
 };
}
module.exports={createRefresh,OfficialStatusReader,readOfficial,target};
