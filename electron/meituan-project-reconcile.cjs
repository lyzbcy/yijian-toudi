'use strict';
const {randomUUID}=require('node:crypto');
function operateProjects(action){
 const slot='__yjtMeituanProjectPlan53';
 const inspect=()=>{
  if(location.origin!=='https://zhaopin.meituan.com'||location.pathname!=='/web/personal-center/resume-detail')throw Error('project-target-changed');
  const es=[...document.querySelectorAll('.resume_detail_edit')];if(es.length!==1)throw Error('project-editor-missing-or-ambiguous');const editor=es[0];
  const ps=[...editor.children].filter(e=>e.classList.contains('project_experience_edit'));if(ps.length!==1)throw Error('project-section-missing-or-ambiguous');const panel=ps[0],cards=[...panel.children].filter(e=>e.classList.contains('model_list'));if(cards.length>10)throw Error('project-count-invalid');
  const rows=cards.map(c=>{const names=[...c.querySelectorAll('input')].filter(e=>e.closest('.model_list')===c&&e.placeholder==='请输入项目名称');if(names.length!==1)throw Error('project-name-missing-or-ambiguous');const fields=[...c.querySelectorAll('input,textarea,select')].filter(e=>e.closest('.model_list')===c&&!['file','hidden','password','button','submit'].includes(e.type)).map(e=>({tag:e.tagName,type:e.type,placeholder:e.placeholder||'',value:e.type==='checkbox'?'':e.value||'',checked:e.type==='checkbox'?!!e.checked:false,disabled:!!e.disabled,selected:e.closest('.mtd-select')?.querySelector('.mtd-select-filter-label:not(.mtd-select-filter-hint)')?.textContent?.trim()||''}));return {name:names[0].value,fields,filled:fields.some(f=>f.checked||f.value.trim()||f.selected)};});
  return {editor,panel,cards,rows};
 };
 try{
  const v=inspect();let s=window[slot];
  const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  if(action.op==='capture'){
   if(action.previousId&&(!s||s.id!==action.previousId||s.body!==document.body||s.root!==document.documentElement||s.editor!==v.editor||s.panel!==v.panel||s.origin!==location.origin||s.path!==location.pathname||s.search!==location.search))throw Error('project-target-changed');
   if(s?.pending)return {ok:false,error:'project-operation-pending'};
   s={id:action.id,origin:location.origin,path:location.pathname,search:location.search,body:document.body,root:document.documentElement,editor:v.editor,panel:v.panel,rows:v.rows,pending:null,receipt:null,seen:[]};window[slot]=s;
   return {ok:true,id:s.id,rows:v.rows};
  }
  if(!s||s.id!==action.id||s.body!==document.body||s.root!==document.documentElement||s.editor!==v.editor||s.panel!==v.panel||s.origin!==location.origin||s.path!==location.pathname||s.search!==location.search)throw Error('project-target-changed');
  if(action.op==='poll'){
   if(!s.pending){if(s.receipt&&s.receipt.opId===action.opId){if(!same(v.rows,s.receipt.rows))throw Error('project-content-changed');return {ok:true,id:s.id,rows:v.rows,pending:false,confirmed:s.receipt.kind,opId:s.receipt.opId};}return {ok:true,id:s.id,rows:v.rows,pending:false};}
   const p=s.pending;
   const confirmed=p.kind==='delete'?same(v.rows,p.before.slice(0,-1)):(v.rows.length===p.before.length+1&&same(v.rows.slice(0,-1),p.before)&&!v.rows.at(-1).filled);
   if(confirmed){s.rows=v.rows;s.receipt={opId:p.opId,kind:p.kind,rows:v.rows};s.pending=null;return {ok:true,id:s.id,rows:v.rows,pending:false,confirmed:p.kind,opId:p.opId};}
   if(!same(v.rows,p.before))throw Error('project-content-changed');
   return {ok:true,id:s.id,rows:v.rows,pending:true,kind:p.kind,opId:p.opId};
  }
  if(!['delete','add'].includes(action.op)||action.confirmed!==true)throw Error('project-confirmation-required');
  if(typeof action.opId!=='string'||!/^[a-z0-9-]{1,64}$/i.test(action.opId)||s.seen.includes(action.opId))throw Error('project-operation-pending');
  if(s.pending)throw Error('project-operation-pending');
  if(!same(v.rows,s.rows)||!same(v.rows,action.before))throw Error('project-content-changed');
  const visible=e=>e.getClientRects().length&&getComputedStyle(e).display!=='none'&&getComputedStyle(e).visibility!=='hidden';let candidates;
  if(action.op==='delete'){
   const card=v.cards.at(-1);if(!card)throw Error('project-count-invalid');
   candidates=[...card.querySelectorAll('.delete-list > div')].filter(e=>e.closest('.model_list')===card&&e.textContent.trim()==='删除这段经历'&&visible(e)&&!e.disabled&&e.getAttribute('aria-disabled')!=='true');
  }else{
   if(v.cards.length>=10)throw Error('project-count-invalid');
   candidates=[...v.panel.children].filter(e=>e.classList.contains('list_add')&&e.textContent.replace(/\s/g,'')==='添加项目经历'&&visible(e)&&!e.disabled&&e.getAttribute('aria-disabled')!=='true');
  }
  if(candidates.length!==1)throw Error('project-action-missing-or-ambiguous');
  s.seen.push(action.opId);s.pending={opId:action.opId,kind:action.op,before:v.rows};candidates[0].click();return {ok:true,id:s.id,pending:true,kind:action.op,opId:action.opId};
 }catch(e){return {ok:false,error:['project-target-changed','project-editor-missing-or-ambiguous','project-section-missing-or-ambiguous','project-name-missing-or-ambiguous','project-count-invalid','project-content-changed','project-confirmation-required','project-operation-pending','project-action-missing-or-ambiguous'].includes(e.message)?e.message:'project-operation-uncertain'};}
}
const buildProjectScript=a=>`(${operateProjects.toString()})(${JSON.stringify(a)})`;
const validRows=rows=>Array.isArray(rows)&&rows.length<=10&&rows.every(r=>r&&typeof r.name==='string'&&typeof r.filled==='boolean'&&Array.isArray(r.fields)&&r.fields.every(f=>f&&['tag','type','placeholder','value','selected'].every(k=>typeof f[k]==='string')&&typeof f.checked==='boolean'&&typeof f.disabled==='boolean'));
function desiredProjects(resume){const rows=resume.projects||[];if(!Array.isArray(rows))throw Error('project-facts-invalid');const count=require('./meituan-groups.cjs').requestedGroups(resume).find(r=>r.key==='projects').count,active=rows.slice(0,count);if(active.some(r=>!r||typeof r.name!=='string'||!r.name.trim()||r.name.length>200))throw Error('project-facts-invalid');return active.map(r=>r.name.trim());}
async function inspectProjectDifference(workspace,resume,{previousId}={}){
 const desired=desiredProjects(resume),id=randomUUID(),read=await workspace.run(buildProjectScript({op:'capture',id,previousId}));
 if(!read?.ok||read.id!==id||!validRows(read.rows))return {ok:false,error:read?.error||'project-inspection-uncertain'};
 const needsReplacement=read.rows.length>desired.length||read.rows.some((r,i)=>r.filled&&(!desired[i]||r.name.trim()!==desired[i]));
 return {ok:true,id,rows:read.rows,desired,needsReplacement,removed:0,added:0,phase:'ready'};
}
function projectReview(plan){return plan?.ok&&(plan.needsReplacement||plan.platform==='bytedance')&&plan.phase!=='complete'?{id:plan.id,existingNames:plan.rows.map(r=>r.name.slice(0,200)),desiredNames:[...plan.desired],state:plan.phase||'ready',removed:plan.removed||0,added:plan.added||0,canRefresh:!plan.inFlight,...(plan.canReplace===false?{canReplace:false}: {})}:null;}
async function queryProjectReplacement(workspace,plan){
 const r=await workspace.run(buildProjectScript({op:'poll',id:plan.id,opId:plan.inFlight?.id||plan.lastConfirmedOpId}));if(!r?.ok||r.id!==plan.id||typeof r.pending!=='boolean'||!validRows(r.rows))throw Error(r?.error||'project-operation-uncertain');
 if(r.pending){if(!plan.inFlight||r.kind!==plan.inFlight.kind||r.opId!==plan.inFlight.id||JSON.stringify(r.rows)!==JSON.stringify(plan.rows))throw Error('project-operation-uncertain');}
 else if(r.confirmed){
  if(!plan.inFlight){if(r.opId!==plan.lastConfirmedOpId||JSON.stringify(r.rows)!==JSON.stringify(plan.rows))throw Error('project-operation-uncertain');return r;}
  if(r.confirmed!==plan.inFlight.kind||r.opId!==plan.inFlight.id||!['delete','add'].includes(r.confirmed))throw Error('project-operation-uncertain');
  const unchanged=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  if(r.confirmed==='delete'?!unchanged(r.rows,plan.rows.slice(0,-1)):!(r.rows.length===plan.rows.length+1&&unchanged(r.rows.slice(0,-1),plan.rows)&&!r.rows.at(-1).filled))throw Error('project-content-changed');
  if(r.confirmed==='delete')plan.removed++;else plan.added++;plan.rows=r.rows;plan.lastConfirmedOpId=plan.inFlight.id;plan.inFlight=null;
 }else if(plan.inFlight)throw Error('project-operation-uncertain');
 if(!r.pending)plan.phase=plan.phase==='unknown'?'ready':plan.phase;
 return r;
}
async function replaceProjects(workspace,plan,{confirmed=false,backup,pollMs=100,timeoutMs=5000}={}){
 if(confirmed!==true)throw Error('project-confirmation-required');if(!plan?.ok||!plan.needsReplacement||plan.phase==='complete')throw Error('project-plan-invalid');
 try{
  const check=await queryProjectReplacement(workspace,plan);if(check.pending)throw Error('project-operation-pending');
  if(JSON.stringify(check.rows)!==JSON.stringify(plan.rows))throw Error('project-content-changed');
  if(!plan.backupDone){if(typeof backup!=='function')throw Error('project-backup-required');await backup({planId:plan.id,rows:structuredClone(plan.rows),desired:[...plan.desired]});plan.backupDone=true;}
  // Remove only the original tail. After uncertainty, confirmed progress is
  // polled first; already acknowledged deletions/additions are never replayed.
  if(plan.initialCount===undefined)plan.initialCount=plan.rows.length;
  while(plan.removed<plan.initialCount||plan.added<plan.desired.length){
   const kind=plan.removed<plan.initialCount?'delete':'add';
   plan.inFlight={kind,id:randomUUID()};
   const issued=await workspace.run(buildProjectScript({op:kind,id:plan.id,opId:plan.inFlight.id,before:plan.rows,confirmed:true}));if(!issued?.ok||issued.id!==plan.id||issued.pending!==true||issued.kind!==kind||issued.opId!==plan.inFlight.id)throw Error(issued?.error||'project-operation-uncertain');
   const until=Date.now()+timeoutMs;let observed;
   do{observed=await queryProjectReplacement(workspace,plan);if(!observed.pending)break;await new Promise(r=>setTimeout(r,pollMs));}while(Date.now()<until);
   if(observed?.pending)throw Error('project-operation-pending');
  }
  if(plan.rows.length!==plan.desired.length||plan.rows.some(r=>r.filled))throw Error('project-content-changed');
  plan.phase='complete';return {complete:true,removed:plan.removed,added:plan.added,backupDone:true};
 }catch(e){plan.phase='unknown';return {complete:false,error:['project-target-changed','project-content-changed','project-operation-pending','project-backup-required','project-action-missing-or-ambiguous','project-count-invalid'].includes(e.message)?e.message:'project-operation-uncertain',removed:plan.removed,added:plan.added,backupDone:!!plan.backupDone};}
}
module.exports={operateProjects,buildProjectScript,desiredProjects,inspectProjectDifference,projectReview,queryProjectReplacement,replaceProjects};
