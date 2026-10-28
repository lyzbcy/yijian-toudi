'use strict';
const {randomUUID}=require('node:crypto');
const {inspectByteProjectPage}=require('./bytedance-project-review.cjs');
function operateByteProjects(action,inspect){
 const slot='__yjtByteProjectReplace65',same=(a,b)=>JSON.stringify(a)===JSON.stringify(b),allowed=new Set(['project-target-changed','project-content-changed','project-operation-pending','project-action-missing-or-ambiguous','project-confirmation-required','project-count-invalid','project-dialog-uncertain','project-identity-not-retained']);
 let dispatched=false;try{
  const v=inspect({id:action.id,previousId:action.id,internal:true});if(!v.ok)throw Error(v.error);let s=window[slot];
  const visible=e=>!!e?.getClientRects().length&&getComputedStyle(e).display!=='none'&&getComputedStyle(e).visibility!=='hidden',enabled=e=>e&&!e.disabled&&e.getAttribute('aria-disabled')!=='true';
  const dialogs=()=>[...document.querySelectorAll('[role="dialog"],.ud__modal-dialog')].filter(visible).filter((e,i,a)=>!a.some(n=>n!==e&&n.contains(e)));
  // A generic "经历" match can confirm education or a bulk deletion. Only the
  // single-project wording is eligible; unknown wording stays unconfirmed.
  const singleProjectDialog=e=>/^(?:确认|确定|是否|确认要|确定要)?删除(?:此|该|当前|这条|本条)(?:项目经历|项目)(?:吗)?[?？]?$/.test(String(e.textContent).replace(/\s/g,'').replace(/(?:取消|确定|确认|删除)+$/,''));
  if(action.op==='begin'){
   if(s&&s.id===action.id){if(!same(v.otherFields,s.otherFields))throw Error('project-content-changed');return{ok:true,id:s.id,rows:v.rows,otherFields:v.otherFields,pending:!!s.pending};}
   if(s?.pending)throw Error('project-operation-pending');if(!v.canReplace||dialogs().length||!same(v.rows,action.before))throw Error('project-content-changed');
   s={id:action.id,body:document.body,root:document.documentElement,editor:v.editor,panel:v.panel,rows:v.rows,otherFields:v.otherFields,pending:null,receipt:null,seen:[],origin:location.origin,path:location.pathname,search:location.search,hash:location.hash};window[slot]=s;return{ok:true,id:s.id,rows:v.rows,otherFields:v.otherFields,pending:false};
  }
  const bound=()=>{if(window[slot]!==s||!s||s.id!==action.id||s.body!==document.body||s.root!==document.documentElement||s.editor!==v.editor||s.panel!==v.panel||s.origin!==location.origin||s.path!==location.pathname||s.search!==location.search||s.hash!==location.hash)throw Error('project-target-changed');if(!same(v.otherFields,s.otherFields))throw Error('project-content-changed');};bound();
  if(action.op==='poll'){
   if(!s.pending){if(dialogs().length)throw Error('project-dialog-uncertain');if(!same(v.rows,s.rows))throw Error('project-content-changed');return{ok:true,id:s.id,rows:v.rows,pending:false,...(s.receipt&&s.receipt.opId===action.opId?{confirmed:s.receipt.kind,opId:s.receipt.opId,purpose:s.receipt.purpose}: {})};}
   const p=s.pending;if(action.opId!==p.opId)throw Error('project-operation-pending');let expected;
   if(p.kind==='delete')expected=p.before.filter((_,i)=>i!==p.index);
   if(p.kind==='add')expected=null;
   if(p.kind==='name'){expected=JSON.parse(JSON.stringify(p.before));expected[p.index].name=p.value;expected[p.index].fields[expected[p.index].nameFieldIndex].value=p.value;expected[p.index].filled=true;}
   const blankFinal=p.kind==='delete'&&p.purpose==='clear-all'&&p.before.length===1&&v.rows.length===1&&!v.rows[0].filled;
   const done=blankFinal||(p.kind==='add'?v.rows.length===p.before.length+1&&same(v.rows.slice(0,-1),p.before)&&!v.rows.at(-1).filled:same(v.rows,expected));
   const ds=dialogs();if(ds.length){if(p.kind!=='delete'||ds.length!==1||!singleProjectDialog(ds[0])||p.modal&&p.modal!==ds[0]||p.modalText&&p.modalText!==ds[0].textContent)throw Error('project-dialog-uncertain');p.modal=ds[0];p.modalText=ds[0].textContent;if(done){if(!p.confirmationSent)throw Error('project-dialog-uncertain');return{ok:true,id:s.id,rows:v.rows,pending:true,kind:p.kind,opId:p.opId,purpose:p.purpose,stage:'settling'};}}
   if(done){s.rows=v.rows;s.pending=null;s.receipt={kind:p.kind,opId:p.opId,purpose:p.purpose};return{ok:true,id:s.id,rows:v.rows,pending:false,confirmed:p.kind,opId:p.opId,purpose:p.purpose};}
   if(!same(v.rows,p.before))throw Error('project-content-changed');
   let stage='pending';if(ds.length)stage=p.confirmationSent?'pending':'dialog';
   return{ok:true,id:s.id,rows:v.rows,pending:true,kind:p.kind,opId:p.opId,purpose:p.purpose,stage};
  }
  if(action.confirmed!==true)throw Error('project-confirmation-required');
  if(action.op==='confirm-delete'){
   const p=s.pending,ds=dialogs();if(!p||p.opId!==action.opId||p.kind!=='delete'||p.confirmationSent||ds.length!==1||!singleProjectDialog(ds[0])||ds[0]!==p.modal||ds[0].textContent!==p.modalText||!same(v.rows,p.before))throw Error('project-dialog-uncertain');const buttons=[...p.modal.querySelectorAll('button')].filter(e=>visible(e)&&enabled(e)&&/^(确定|确认|删除)$/.test(e.textContent.trim()));if(buttons.length!==1)throw Error('project-dialog-uncertain');p.confirmationSent=true;dispatched=true;buttons[0].click();return{ok:true,id:s.id,pending:true,kind:p.kind,opId:p.opId,purpose:p.purpose};
  }
  if(!['add','delete','name'].includes(action.op)||typeof action.opId!=='string'||!/^[a-z0-9-]{1,64}$/i.test(action.opId)||s.seen.includes(action.opId)||s.pending)throw Error('project-operation-pending');
  if(dialogs().length||!same(v.rows,s.rows)||!same(v.rows,action.before))throw Error('project-content-changed');
  let node;const selector='[class*="apply-form-array-card__"]';
  if(action.op==='add'){if(v.rows.length>=10)throw Error('project-count-invalid');const nodes=[...v.panel.querySelectorAll('button')].filter(e=>e.closest('[class*="applyFormModuleWrapper__"]')===v.panel&&e.querySelector('svg[data-icon="AddOutlined"]')&&e.textContent.replace(/\s/g,'')==='添加'&&visible(e)&&enabled(e));if(nodes.length!==1)throw Error('project-action-missing-or-ambiguous');node=nodes[0];}
  else{if(!Number.isSafeInteger(action.index)||action.index<0||action.index>=v.rows.length)throw Error('project-count-invalid');const card=v.cards[action.index];if(action.op==='delete'){const nodes=[...card.querySelectorAll('button')].filter(e=>e.closest(selector)===card&&e.querySelector('svg[data-icon="DeleteTrashOutlined"]')&&visible(e)&&enabled(e));if(nodes.length!==1)throw Error('project-action-missing-or-ambiguous');node=nodes[0];}else{if(v.rows[action.index].filled||typeof action.value!=='string'||!action.value.trim()||action.value.length>200)throw Error('project-content-changed');node=v.rowControls[action.index][v.rows[action.index].nameFieldIndex];if(!node||node.tagName!=='INPUT'||node.type!=='text'||!enabled(node)||node.readOnly||!visible(node))throw Error('project-action-missing-or-ambiguous');}}
  s.seen.push(action.opId);s.pending={opId:action.opId,kind:action.op,before:v.rows,index:action.index,value:action.value,purpose:action.purpose,confirmationSent:false};
  dispatched=true;if(action.op==='name'){let valueSent=false;const expected=JSON.parse(JSON.stringify(v.rows));expected[action.index].name=action.value;expected[action.index].fields[expected[action.index].nameFieldIndex].value=action.value;expected[action.index].filled=true;const current=()=>{const now=inspect({id:action.id,previousId:action.id,internal:true});if(!now.ok||now.editor!==s.editor||now.panel!==s.panel||!same(now.otherFields,s.otherFields)||!same(now.rows,valueSent?expected:v.rows)||now.rowControls[action.index][now.rows[action.index].nameFieldIndex]!==node||!enabled(node)||node.readOnly)throw Error('project-target-changed');};current();node.focus();current();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(node,action.value);valueSent=true;for(const type of ['input','change']){current();node.dispatchEvent(new Event(type,{bubbles:true}));}}
  else node.click();return{ok:true,id:s.id,pending:true,kind:action.op,opId:action.opId,purpose:action.purpose};
 }catch(e){return{ok:false,error:allowed.has(e.message)?e.message:'project-operation-uncertain',dispatched};}
}
const buildByteProjectOperation=a=>`(${operateByteProjects.toString()})(${JSON.stringify(a)},${inspectByteProjectPage.toString()})`;
function validRows(rows){return Array.isArray(rows)&&rows.length<=10&&rows.every(r=>r&&typeof r.name==='string'&&typeof r.filled==='boolean'&&Number.isSafeInteger(r.nameFieldIndex)&&r.nameFieldIndex>=0&&Array.isArray(r.fields)&&r.nameFieldIndex<r.fields.length&&r.fields[r.nameFieldIndex]?.tag==='INPUT'&&r.fields[r.nameFieldIndex]?.type==='text'&&r.fields[r.nameFieldIndex]?.value===r.name&&r.fields.every(f=>f&&['tag','type','placeholder','value','selected'].every(k=>typeof f[k]==='string')&&typeof f.checked==='boolean'&&typeof f.disabled==='boolean'));}
async function queryByteProjectReplacement(workspace,plan){
 const r=await workspace.run(buildByteProjectOperation({op:'poll',id:plan.id,opId:plan.inFlight?.id||plan.lastConfirmedOpId}));if(!r?.ok||r.id!==plan.id||typeof r.pending!=='boolean'||!validRows(r.rows))throw Error(r?.error||'project-operation-uncertain');
 if(r.pending){const op=plan.inFlight,settling=op?.kind==='delete'&&r.stage==='settling'&&(JSON.stringify(r.rows)===JSON.stringify(plan.rows.filter((_,i)=>i!==op.index))||op.purpose==='clear-all'&&plan.rows.length===1&&r.rows.length===1&&!r.rows[0].filled);if(!op||r.opId!==op.id||r.kind!==op.kind||r.purpose!==op.purpose||!settling&&JSON.stringify(r.rows)!==JSON.stringify(plan.rows))throw Error('project-operation-uncertain');if(r.stage==='dialog')plan.phase='ready';return r;}
 if(r.confirmed){const op=plan.inFlight;if(!op){if(r.opId!==plan.lastConfirmedOpId||JSON.stringify(r.rows)!==JSON.stringify(plan.rows))throw Error('project-operation-uncertain');return r;}
  if(r.opId!==op.id||r.confirmed!==op.kind||r.purpose!==op.purpose)throw Error('project-operation-uncertain');let correct;
  if(op.kind==='delete')correct=JSON.stringify(r.rows)===JSON.stringify(plan.rows.filter((_,i)=>i!==op.index))||op.purpose==='clear-all'&&plan.rows.length===1&&r.rows.length===1&&!r.rows[0].filled;
  else if(op.kind==='add')correct=r.rows.length===plan.rows.length+1&&JSON.stringify(r.rows.slice(0,-1))===JSON.stringify(plan.rows)&&!r.rows.at(-1).filled;
  else{const wanted=structuredClone(plan.rows);wanted[op.index].name=op.value;wanted[op.index].fields[wanted[op.index].nameFieldIndex].value=op.value;wanted[op.index].filled=true;correct=JSON.stringify(wanted)===JSON.stringify(r.rows);}
  if(!correct)throw Error('project-content-changed');
  if(op.kind==='delete')plan.removed++;if(op.kind==='add'){plan.added++;if(op.purpose==='scaffold')plan.scaffoldCreated=true;}if(op.kind==='name')plan.named=(plan.named||0)+1;plan.rows=r.rows;plan.lastConfirmedOpId=op.id;plan.inFlight=null;
 }else if(plan.inFlight)throw Error('project-operation-uncertain');
 if(!r.pending)plan.phase='ready';return r;
}
async function replaceByteProjects(workspace,plan,{confirmed=false,backup,pollMs=100,timeoutMs=5000}={}){
 if(confirmed!==true)throw Error('project-confirmation-required');if(!plan?.ok||plan.platform!=='bytedance'||!plan.needsReplacement||plan.canReplace!==true||plan.phase==='complete')throw Error('project-plan-invalid');
 try{
  if(!plan.startedReplacement){const r=await workspace.run(buildByteProjectOperation({op:'begin',id:plan.id,before:plan.rows}));if(!r?.ok||r.id!==plan.id||r.pending||!validRows(r.rows)||JSON.stringify(r.rows)!==JSON.stringify(plan.rows)||!Array.isArray(r.otherFields)||r.otherFields.some(f=>!f||!['tag','type','value'].every(k=>typeof f[k]==='string')||!['checked','disabled','readOnly'].every(k=>typeof f[k]==='boolean')||!Array.isArray(f.files)))throw Error(r?.error||'project-operation-uncertain');if(typeof backup!=='function')throw Error('project-backup-required');await backup({planId:plan.id,platform:'bytedance',rows:structuredClone(plan.rows),desired:[...plan.desired],otherFields:r.otherFields});plan.backupDone=true;plan.startedReplacement=true;plan.initialCount=plan.rows.length;plan.named=0;}
  const finishPending=async()=>{const end=Date.now()+timeoutMs;let r;do{r=await queryByteProjectReplacement(workspace,plan);if(!r.pending)return r;if(r.stage==='dialog'){const issued=await workspace.run(buildByteProjectOperation({op:'confirm-delete',id:plan.id,opId:plan.inFlight.id,confirmed:true}));if(!issued?.ok||issued.opId!==plan.inFlight.id)throw Error(issued?.error||'project-dialog-uncertain');}await new Promise(resolve=>setTimeout(resolve,pollMs));}while(Date.now()<end);throw Error('project-operation-pending');};
  if(plan.inFlight)await finishPending();else await queryByteProjectReplacement(workspace,plan);
  for(let i=0;i<40;i++){
   const remaining=plan.initialCount-plan.removed;let op;
   if(!plan.desired.length){if(remaining>0)op={kind:'delete',index:remaining-1,purpose:'clear-all'};}
   else if(!plan.scaffoldCreated){op=plan.rows.length>=10?{kind:'delete',index:remaining-1,purpose:'make-space'}:{kind:'add',purpose:'scaffold'};}
   else if(remaining>0)op={kind:'delete',index:remaining-1,purpose:'remove-original'};
   else if(plan.added<plan.desired.length)op={kind:'add',purpose:'add-target'};
   else if(plan.named<plan.desired.length)op={kind:'name',index:plan.named,value:plan.desired[plan.named],purpose:'name-target'};
   if(!op)break;plan.inFlight={...op,id:randomUUID()};const r=await workspace.run(buildByteProjectOperation({op:op.kind,id:plan.id,opId:plan.inFlight.id,before:plan.rows,index:op.index,value:op.value,purpose:op.purpose,confirmed:true}));if(!r?.ok||r.id!==plan.id||r.opId!==plan.inFlight.id||r.pending!==true||r.kind!==op.kind||r.purpose!==op.purpose){if(r?.ok===false&&r.dispatched===false)plan.inFlight=null;throw Error(r?.error||'project-operation-uncertain');}await finishPending();
  }
  const emptyPlaceholder=!plan.desired.length&&plan.rows.length===1&&!plan.rows[0].filled;if(plan.inFlight||!emptyPlaceholder&&(plan.rows.length!==plan.desired.length||plan.rows.some((r,i)=>r.name!==plan.desired[i])))throw Error('project-content-changed');plan.phase='complete';return{complete:true,removed:plan.removed,added:plan.added,backupDone:true};
 }catch(e){plan.phase='unknown';return{complete:false,error:e.message,removed:plan.removed,added:plan.added,backupDone:!!plan.backupDone};}
}
module.exports={operateByteProjects,buildByteProjectOperation,validRows,queryByteProjectReplacement,replaceByteProjects};
