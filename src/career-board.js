/* Shared deterministic career-board model: renderer + main process validation. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.CareerBoard=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const stages=['待投递','已投递','笔试中','面试中','Offer','已结束','已撤回'];
 const labels={'待投递':'准备并完成投递','已投递':'跟进投递进度','笔试中':'确认并完成笔试','面试中':'确认面试安排','Offer':'核对录用与回复时间'};
 function visible(s,r){return r.accountId===(s.activeAccountId||'default')&&r.profileId===(s.resume?.activeProfileId||'default');}
 function explicitTime(text){
  // Only an explicitly labelled full calendar date and clock. Never use receivedAt as deadline.
  const hits=[...String(text||'').matchAll(/(?:截止(?:时间)?|开始(?:时间)?|面试时间|笔试时间|测评时间|请于)\s*[:：为]?\s*(20\d{2})[年\/-](\d{1,2})[月\/-](\d{1,2})日?\s*(?:[（(][^）)]*[）)])?\s*(\d{1,2})[:：](\d{2})/g)];
  if(hits.length!==1)return '';
  const [,y,m,d,h,n]=hits[0],parts=[+y,+m,+d,+h,+n];if(+h>23||+n>59||+m<1||+m>12||+d<1||+d>31)return '';
  const iso=`${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}T${h.padStart(2,'0')}:${n}:00+08:00`,dt=new Date(iso),shift=new Date(dt.getTime()+28800000);
  if(!Number.isFinite(dt.getTime())||[shift.getUTCFullYear(),shift.getUTCMonth()+1,shift.getUTCDate(),shift.getUTCHours(),shift.getUTCMinutes()].some((v,i)=>v!==parts[i]))return '';return dt.toISOString();
 }
 function validLinks(links){return (Array.isArray(links)?links:[]).filter(l=>{try{const u=new URL(l.url);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password&&u.href.length<=4096&&typeof l.label==='string';}catch{return false;}}).slice(0,8);}
 function build(s,now=Date.now()){
  now=Number(now);const records=(s.careerApplications||[]).filter(r=>visible(s,r)),counts=Object.fromEntries(stages.map(k=>[k,records.filter(r=>r.stage===k).length]));
  const tasks=records.filter(r=>labels[r.stage]).map(r=>{
   const history=r.history||[],hist=history.slice(history.findLastIndex(h=>h.stage!==r.stage)+1),ids=hist.map(h=>h.mailId).filter(Boolean);
   const mail=(s.messages||[]).filter(m=>ids.includes(m.id)&&visible(s,m)&&String(m.mailbox||'').toLowerCase()===String(r.mailbox||'').toLowerCase()).sort((a,b)=>String(b.receivedAt).localeCompare(String(a.receivedAt)))[0];
   const key=r.stage+':'+(mail?.id||hist[0]?.at||r.createdAt||r.id),todo=r.todo?.key===key?r.todo:{};
   const isStale=mail&&(!Number.isFinite(Date.parse(mail.receivedAt))||now-Date.parse(mail.receivedAt)>180*86400000);
   const facts=mail?.details?.status==='ready'?mail.details:null;
   const inferred=!isStale&&mail?(facts?.dueAt||(!facts?.conflict?explicitTime(mail.subject+' '+(mail.preview||'')):'')):'';
   const dueAt=todo.dueAt!==undefined?todo.dueAt:inferred,at=Date.parse(dueAt),known=Number.isFinite(at),delta=at-now;
   const day=v=>Math.floor((v+28800000)/86400000),today=known&&day(at)===day(now);
   let urgency=known?(delta<0?'逾期待核对':today?'今天到期':delta<=86400000?'24小时内':'即将到来'):'时间待确认';
   if(known&&delta<0&&todo.dueAt===undefined&&facts?.kind==='建议完成时间')urgency='建议时间已过';
   return {id:r.id,key,company:r.company,role:r.role,stage:r.stage,title:todo.title||labels[r.stage],dueAt:known?new Date(at).toISOString():'',status:todo.status||'pending',urgency,tone:known?(delta<0||today?'urgent':delta<=172800000?'soon':'scheduled'):'unknown',source:todo.dueAt!==undefined?'手动确认':inferred?(facts?.dueAt?'邮件正文 · '+facts.kind:'邮件明确时间'):'待补充时间',links:validLinks(facts?.links),timeConflict:!!facts?.conflict,historicalDueAt:isStale?facts?.dueAt||'':'',evidence:facts?.evidence||'',stale:!!isStale,mailId:mail?.id||''};
  });
  tasks.sort((a,b)=>(a.status==='pending'?0:1)-(b.status==='pending'?0:1)||(Date.parse(a.dueAt)||Infinity)-(Date.parse(b.dueAt)||Infinity)||a.company.localeCompare(b.company,'zh-CN')||a.id.localeCompare(b.id));
  return {records,counts,tasks};
 }
 return {stages,visible,explicitTime,build};
});
