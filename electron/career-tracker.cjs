'use strict';
const {randomUUID}=require('node:crypto');
const STAGES=['待投递','已投递','笔试中','面试中','Offer','已结束','已撤回'];
const ORDER={'待投递':0,'已投递':1,'笔试中':2,'面试中':3,Offer:4,'已结束':5,'已撤回':6};
const norm=v=>String(v||'').trim().toLowerCase();
function scope(s){return {accountId:s.activeAccountId||'default',profileId:s.resume?.activeProfileId||'default'};}
function visible(s,r){const q=scope(s);return r.accountId===q.accountId && r.profileId===q.profileId;}
function field(v,name,max=200){if(typeof v!=='string'||!v.trim()||v.length>max)throw Error(name+'不能为空且不能超长');return v.trim();}
function upsert(s,input={},now=new Date().toISOString()){
 if(!input||typeof input!=='object')throw Error('申请记录格式错误');
 const items=s.careerApplications||[];
 const previous=input.id?items.find(r=>r.id===input.id&&visible(s,r)):null;
 if(input.id&&!previous)throw Error('当前账号/简历中未找到记录');
 if(input.todo!==undefined){
  if(!previous)throw Error('待办必须属于已有申请');
  const task=require('../src/career-board.js').build(s,Date.parse(now)).tasks.find(t=>t.id===previous.id);
  const v=input.todo;if(!v||typeof v!=='object'||!task||v.key!==task.key)throw Error('待办进度已变化，请刷新');
  const todo={...(previous.todo?.key===task.key?previous.todo:{}),key:task.key};
  if(v.status!==undefined){if(!['pending','done','dismissed'].includes(v.status))throw Error('无效待办状态');todo.status=v.status;}
  if(v.dueAt!==undefined){if(typeof v.dueAt!=='string'||v.dueAt&&(!/^20\d\d-\d\d-\d\dT/.test(v.dueAt)||!Number.isFinite(Date.parse(v.dueAt))))throw Error('无效待办时间');if(v.dueAt){const m=v.dueAt.match(/^(20\d\d)-(\d\d)-(\d\d)T(\d\d):(\d\d)(?::(\d\d)(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/);if(!m||+m[2]<1||+m[2]>12||+m[3]<1||new Date(Date.UTC(+m[1],+m[2]-1,+m[3])).getUTCDate()!==+m[3]||+m[4]>23||+m[5]>59||+(m[6]||0)>59)throw Error('无效待办时间');}todo.dueAt=v.dueAt?new Date(v.dueAt).toISOString():'';}
  if(v.title!==undefined)todo.title=field(v.title,'待办标题',200);
  todo.savedAt=now;const record={...previous,todo};s.careerApplications=items.map(r=>r.id===record.id?record:r);return record;
 }

 const stage=input.stage??previous?.stage??'待投递';if(!STAGES.includes(stage))throw Error('无效投递阶段');
 const company=field(input.company??previous?.company,'公司'),role=field(input.role??previous?.role,'岗位');
 if(items.some(r=>visible(s,r)&&r.id!==previous?.id&&norm(r.company)===norm(company)&&norm(r.role)===norm(role)&&!(previous?.agentJobKey&&r.agentJobKey&&previous.agentJobKey!==r.agentJobKey)))throw Error('该公司岗位已在管理列表中');
 if(input.mailbox&&!require('./mail-accounts.cjs').accounts(s).some(a=>a.address===norm(input.mailbox)))throw Error('请选择当前账号已连接邮箱');
 const note=input.note??previous?.note??'';if(typeof note!=='string'||note.length>2000)throw Error('备注最多2000字');
 const record={...previous,id:previous?.id||randomUUID(),...scope(s),company,role,stage,note,
   rolePending:role==='岗位待确认',mailbox:norm(input.mailbox)||previous?.mailbox||norm(s.settings?.email?.address),createdAt:previous?.createdAt||now,updatedAt:now,
   history:[...(previous?.history||[]),{stage,at:now,source:'manual'}]};
 s.careerApplications=previous?items.map(r=>r.id===record.id?record:r):[...items,record];return record;
}
function syncProgress(s,messages){
 let updated=0,unmatched=0;
 const mapping={'面试':'面试中','测评':'笔试中','流程中':'已投递',Offer:'Offer','结束':'已结束'};
 const records=s.careerApplications||[];
 for(const m of [...messages].sort((a,b)=>String(a.receivedAt).localeCompare(String(b.receivedAt)))){
  const stage=mapping[m.stage];if(!stage)continue;
  const subject=norm(m.subject),mailbox=norm(m.mailbox);
  const companyRecords=records.filter(r=>visible(s,r)&&mailbox&&norm(r.mailbox)===mailbox&&(norm(r.company)===norm(m.company)||(r.confirmedMailIds||[]).includes(m.id)));
  const exact=companyRecords.filter(r=>subject.includes(norm(r.role)));
  // Generic recruiting subjects may advance only a uniquely managed company/role.
  const hints=subject.match(/前端|后端|算法|测试|产品|运营|管培/g)||[];
  const conflict=!exact.length&&companyRecords.length===1&&!companyRecords[0].rolePending&&hints.length&&!hints.some(h=>norm(companyRecords[0].role).includes(h));
  const candidates=conflict?[]:exact.length ? exact : companyRecords;
  if(candidates.length!==1){unmatched++;continue;}
  const r=candidates[0],at=Date.parse(m.receivedAt),last=Date.parse(r.updatedAt);
  // An explicitly reviewed receipt-minute message may precede the local observation
  // by <60s because the mail UI only exposes minute precision. Never bypass manual history.
  const reviewedReceiptMinute=(r.confirmedMailIds||[]).includes(m.id)&&r.mailMatchReviews?.[m.id]?.source==='agent-reviewed'&&m.receivedAtPrecision==='minute'&&r.history.at(-1)?.source==='agent-receipt'&&last-at>=0&&last-at<60000;
  if(!Number.isFinite(at)||!Number.isFinite(last)||at<=last&&!reviewedReceiptMinute||r.history.some(h=>h.mailId===m.id)||r.stage==='已撤回'||r.stage==='已结束'||ORDER[stage]<=ORDER[r.stage])continue;
  r.stage=stage;r.updatedAt=new Date(Math.max(at,last)).toISOString();r.history.push({stage,at:r.updatedAt,source:'mail',mailId:m.id});updated++;
 }
 s.careerMailSync={updated,unmatched,at:new Date().toISOString()};return s.careerMailSync;
}
function recordConfirmed(s, previous=[]) {
 const known=new Set(previous.map(r=>r.id));
 for(const job of s.applied||[]) {
  if(known.has(job.id))continue;
  const company=(s.companies||[]).find(c=>c.id===job.companyId)?.name;
  if(!company||!job.title)continue;
  if((s.careerApplications||[]).some(r=>visible(s,r)&&norm(r.company)===norm(company)&&norm(r.role)===norm(job.title)))continue;
  const record=upsert(s,{company,role:job.title,stage:'已投递'});
  record.sourceJobId=job.id;record.history[0].source='confirmed-application';
 }
}
function bindMailbox(s,address){
 const mailbox=norm(address);if(!mailbox)return;
 for(const r of s.careerApplications||[])if(visible(s,r)&&!r.mailbox)r.mailbox=mailbox;
}
// Mail evidence import is independent of website-success receipts.
function reconcile(s,messages,{importMissing=false,now=new Date()}={}){
 const {classifyRecruitingMail}=require('./recruiting.cjs');
 const review=[],records=s.careerApplications||(s.careerApplications=[]);let created=0,corrected=0;
 const mapping={'面试':'面试中','测评':'笔试中','流程中':'已投递',Offer:'Offer','结束':'已结束'};
 const ordered=[...messages].filter(m=>(!m.accountId||m.accountId===scope(s).accountId)&&(!m.profileId||m.profileId===scope(s).profileId)).sort((a,b)=>String(a.receivedAt).localeCompare(String(b.receivedAt)));
 for(const m of ordered){
  const stage=classifyRecruitingMail(m.subject,m.preview||'');if(m.stage!==stage){m.stage=stage;corrected++;}
  const target=mapping[stage];if(!target){if(/更新简历|简历补充|流程变更/.test(m.subject||''))review.push({mailId:m.id,mailbox:m.mailbox,company:m.company,subject:m.subject,stage:'待确认',reason:'邮件未明确笔试或面试阶段，请核对',...scope(s)});continue;}
  const mailbox=norm(m.mailbox),company=String(m.company||'').trim();
  const existing=records.filter(r=>visible(s,r)&&norm(r.mailbox)===mailbox&&(norm(r.company)===norm(company)||(r.confirmedMailIds||[]).includes(m.id)));
  const role=String(m.subject||'').match(/面试邀请函\s*[-—]\s*([^\n]{2,80})/)?.[1]?.trim();
  const knownCompany=(s.companies||[]).some(c=>norm(c.name)===norm(company))||/证券|银行|电力|有限公司|集团/.test(company)||['京东','美团','小米','字节跳动','阿里巴巴','腾讯','华为','途游游戏','小红书'].includes(company);
  let reason='';
  const at=Date.parse(m.receivedAt);
  if(!mailbox||!company||(!knownCompany&&!existing.some(r=>(r.confirmedMailIds||[]).includes(m.id))))reason='公司身份待确认';
  else if(!Number.isFinite(at))reason='邮件日期待确认';
  else if(at>now.getTime()+60000||now.getTime()-at>180*86400000)reason='历史或异常日期，需人工确认';
  else if(existing.length>1&&!existing.some(r=>norm(m.subject).includes(norm(r.role))))reason='同公司多岗位，主题未唯一对应';
  else if(existing.length===1&&!existing[0].rolePending&&(norm(m.subject).match(/前端|后端|算法|测试|产品|运营|管培/g)||[]).length&&!(norm(m.subject).match(/前端|后端|算法|测试|产品|运营|管培/g)||[]).some(h=>norm(existing[0].role).includes(h)))reason='主题岗位与管理岗位不一致';
  else if(!existing.length&&importMissing){
   const other=records.filter(r=>visible(s,r)&&norm(r.company)===norm(company)&&norm(r.mailbox)!==mailbox);
   if(other.length)reason='另一邮箱有同公司记录，需确认是否同一申请';
   else {
    const record={id:randomUUID(),...scope(s),company,role:role||'岗位待确认',rolePending:!role,stage:target,note:'邮件进度记录；不代表官网投递回执。',mailbox,createdAt:m.receivedAt,updatedAt:m.receivedAt,source:'mail-import',history:[{stage:target,at:m.receivedAt,source:'mail',mailId:m.id}],mailSubjects:[m.subject]};records.push(record);created++;
   }
  }else if(!existing.length)reason='尚未加入管理';
  if(reason)review.push({mailId:m.id,mailbox,company,subject:m.subject,stage:target,reason,accountId:scope(s).accountId,profileId:scope(s).profileId});
 }
 const result=syncProgress(s,ordered);
 // Correct old classifier-only progress only when no subsequent/manual action exists.
 for(const r of records.filter(r=>visible(s,r))){
  const last=r.history?.at(-1),m=ordered.find(m=>m.id===last?.mailId);
  if(last?.source==='mail'&&m&&mapping[m.stage]&&mapping[m.stage]!==r.stage&&r.updatedAt===last.at){
   const prior={...last,correctedFrom:r.stage,reason:'主题优先分类纠正'};r.stage=mapping[m.stage];r.history.push({...prior,stage:r.stage,at:last.at,source:'mail-correction'});corrected++;
  }
 }
 s.careerMailReview=[...(s.careerMailReview||[]).filter(r=>!visible(s,r)),...review];
 s.careerMailSync={...result,created,corrected,unmatched:review.length,accountId:scope(s).accountId,profileId:scope(s).profileId};
 return s.careerMailSync;
}

function importAgentReceipts(s){
 let created=0,linked=0;const rows=s.careerApplications||(s.careerApplications=[]);
 for(const item of s.agentApplications?.items||[]){
  if(item.status!=='submitted'||!item.receipt||item.receipt.source!=='agent-reported'||!Number.isFinite(Date.parse(item.receipt.observedAt))||!item.id||!item.company||!item.role||!item.accountId||!item.profileId)continue;
  let applicationRoute,routeAssessment;
  try{
   const routes=require('./application-route.cjs');applicationRoute=routes.normalizeRoute(item.applicationRoute);
   if(item.platform==='zhilian-campus'&&applicationRoute==='unknown')continue;
   if(applicationRoute!=='unknown'){
    const e=item.receipt,at=Date.parse(e.observedAt),started=Date.parse(item.attemptStartedAt),u=new URL(e.url);
    if(e.observed!==true||!item.attemptId||!Number.isFinite(started)||at<started||at>Date.now()+60000||!['https:','http:'].includes(u.protocol)||u.username||u.password||typeof e.reference!=='string'||!e.reference.trim()||e.reference.length>500||typeof e.text!=='string'||!e.text.trim()||e.text.length>500)continue;
    routeAssessment=routes.prepareReceiptRoute(applicationRoute,{outcome:'submitted',observation:e.routeObservation}).assessment;
   }else routeAssessment={applicationRoute:'unknown',applicationSubmitted:false,employerAtsReceived:false,reason:'legacy-unclassified'};
  }catch{continue;}
  if(rows.some(r=>r.accountId===item.accountId&&r.profileId===item.profileId&&(r.agentApplicationIds||[r.agentApplicationId]).includes(item.id)))continue;
  const matches=rows.filter(r=>r.accountId===item.accountId&&r.profileId===item.profileId&&norm(r.company)===norm(item.company)&&norm(r.role)===norm(item.role)&&(!r.agentJobKey||r.agentJobKey===item.jobKey));
  if(matches.length===1){const r=matches[0];r.agentApplicationIds=[...new Set([...(r.agentApplicationIds||[]),item.id])];r.agentJobKey=item.jobKey;r.agentSubmissionRoutes={...(r.agentSubmissionRoutes||{}),[item.id]:{applicationRoute,routeAssessment}};linked++;continue;}
  const at=item.receipt.observedAt,mailbox=(s.settings?.email?.accounts||[]).find(a=>a.accountId===item.accountId&&a.profileId===item.profileId&&a.provider==='qq'&&a.connected)?.address||'';
  const note=applicationRoute==='platform-resume'?'Agent 已登记平台简历送达；不代表企业ATS收件。':applicationRoute==='employer-ats'?'Agent 已登记企业指定ATS提交回执；证据由 Agent 观察。':'Agent 已登记历史/未分类成功回执；申请路径待核对。';
  rows.push({id:randomUUID(),accountId:item.accountId,profileId:item.profileId,company:item.company,role:item.role,rolePending:false,stage:'已投递',mailbox,createdAt:at,updatedAt:at,source:'agent-receipt',agentApplicationIds:[item.id],agentJobKey:item.jobKey,applicationRoute,routeAssessment,note,history:[{stage:'已投递',at,source:'agent-receipt',agentApplicationId:item.id}]});created++;
 }return {created,linked};
}

function confirmMailMatch(s,input){
 const row=(s.careerApplications||[]).find(r=>r.id===input?.id&&visible(s,r));
 const msg=(s.messages||[]).find(m=>m.id===input?.mailId&&visible(s,m));
 const observedAt=Date.parse(input?.observedAt),now=Date.now();
 if(!row||!msg||typeof input.evidence!=='string'||!input.evidence.trim()||input.evidence.length>500||!Number.isFinite(observedAt)||Math.abs(now-observedAt)>300000)throw Object.assign(Error('invalid-reviewed-mail-match'),{status:400});
 if(!msg.mailbox||!require('./mail-accounts.cjs').accounts(s).some(a=>a.address===msg.mailbox)||row.mailbox&&norm(row.mailbox)!==norm(msg.mailbox))throw Object.assign(Error('reviewed-mailbox-mismatch'),{status:409});
 if((s.careerApplications||[]).some(r=>visible(s,r)&&r.id!==row.id&&(r.confirmedMailIds||[]).includes(msg.id)))throw Object.assign(Error('mail-already-matched'),{status:409});
 row.mailbox=msg.mailbox;row.confirmedMailIds=[...new Set([...(row.confirmedMailIds||[]),msg.id])];
 row.mailMatchReviews={...(row.mailMatchReviews||{}),[msg.id]:{observedAt:new Date(observedAt).toISOString(),evidence:input.evidence.trim(),source:'agent-reviewed'}};
 return reconcile(s,s.messages,{importMissing:s.settings.email.importProgress===true});
}

module.exports={confirmMailMatch,importAgentReceipts,STAGES,upsert,syncProgress,reconcile,visible,recordConfirmed,bindMailbox};
