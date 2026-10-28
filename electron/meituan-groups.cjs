'use strict';
const {randomUUID}=require('node:crypto');
const specs=[['education','edu_experience_edit','添加教育经历'],['experience','work_experience_edit','添加工作/实习经历'],['projects','project_experience_edit','添加项目经历']];
const factKeys={education:['school','department','major','majorCategory','degreeName','gpaBase','courses','thesisTitle','start','end','gpa','rank','advisor','laboratory','researchDirection'],experience:['company','department','role','level','start','end','description','achievements','leaveReason','reportTo','teamSize'],projects:['name','role','start','end','description','contribution','techStack','outcome','scale','link','client']};
function requestedGroups(resume={}) {
  return specs.map(([key])=>{const rows=resume[key]??[];if(!Array.isArray(rows)||rows.length>10||rows.some(r=>r!==null&&(typeof r!=='object'||Array.isArray(r))))throw Error('group-count-invalid');
    // JsonStore keeps an empty editor placeholder even when the user has no
    // experience. Do not create an official card for that empty UI row. Preserve
    // indexes up to the last meaningful row so sectionHint numbering still fits.
    const count=rows.reduce((last,row,i)=>row&&Object.entries(row).some(([k,v])=>factKeys[key].includes(k)&&((typeof v==='string'&&v.trim()!=='')||(typeof v==='number'&&Number.isFinite(v))))?i+1:last,0);return {key,count};});
}
function buildMeituanGroupsScript(action={op:'read'}) {
  function operate(action,specs) {
    if(location.origin!=='https://zhaopin.meituan.com'||location.pathname!=='/web/personal-center/resume-detail')return {applicable:false,error:'unsupported-origin'};
    const editors=[...document.querySelectorAll('.resume_detail_edit')];
    if(!editors.length)return {applicable:false,skipped:true};
    if(editors.length!==1)return {applicable:true,error:'editor-ambiguous'};
    const editor=editors[0],attribute='data-yjt-group-pending';
    const panels=specs.map(([key,cls,label])=>{const matches=[...editor.children].filter(n=>n.classList.contains(cls));const panel=matches.length===1?matches[0]:null;return {key,label,panel,error:matches.length===1?null:matches.length?'section-ambiguous':'section-missing'};});
    const count=panel=>[...panel.children].filter(n=>n.classList.contains('model_list')).length;
    let pending=null;const raw=editor.getAttribute(attribute);
    if(raw){try{pending=JSON.parse(raw);}catch{return {applicable:true,error:'pending-invalid'};}if(!pending||!specs.some(s=>s[0]===pending.key)||!Number.isSafeInteger(pending.before)||pending.before<0||pending.before>=10||typeof pending.id!=='string'||!/^[a-z0-9-]{1,64}$/i.test(pending.id))return {applicable:true,error:'pending-invalid'};}
    const snapshot=()=>({applicable:true,pending,sections:panels.map(p=>({key:p.key,count:p.panel?count(p.panel):null,error:p.error}))});
    if(action.op==='read')return snapshot();
    const section=panels.find(p=>p.key===action.key);
    if(!section||!section.panel)return {applicable:true,error:section?.error||'section-invalid'};
    if(action.op==='ack'){
      if(!pending||pending.id!==action.id||pending.key!==action.key||count(section.panel)!==pending.before+1)return {applicable:true,error:'ack-mismatch'};
      editor.removeAttribute(attribute);pending=null;return snapshot();
    }
    if(action.op!=='add'||!Number.isSafeInteger(action.before)||action.before<0||action.before>=10||typeof action.id!=='string'||!/^[a-z0-9-]{1,64}$/i.test(action.id))return {applicable:true,error:'action-invalid'};
    if(pending)return {applicable:true,error:'group-add-pending',pending};
    if(count(section.panel)!==action.before)return {applicable:true,error:'group-count-changed'};
    const candidates=[...section.panel.children].filter(n=>n.classList.contains('list_add')&&n.textContent.replace(/\s/g,'')===section.label&&n.getClientRects().length&&!n.disabled&&n.getAttribute('aria-disabled')!=='true');
    if(candidates.length!==1)return {applicable:true,error:'add-action-ambiguous-or-missing'};
    pending={id:action.id,key:action.key,before:action.before};editor.setAttribute(attribute,JSON.stringify(pending));
    try{candidates[0].click();}catch{return {applicable:true,error:'group-add-uncertain',pending};}
    return {applicable:true,issued:true,pending};
  }
  return `(${operate.toString()})(${JSON.stringify(action)},${JSON.stringify(specs)})`;
}
async function ensureMeituanGroups(workspace,resume, {pollMs=100,timeoutMs=2500}={}) {
  const requested=requestedGroups(resume),added=[],excess=[];
  const run=action=>workspace.run(buildMeituanGroupsScript(action));
  let state;
  const result=(error=null)=>({applicable:state?.applicable===true,skipped:state?.skipped===true,complete:!error,requested,added,excess,error,pending:state?.pending||null,sections:state?.sections||[]});
  try{
    state=await run({op:'read'});
    if(!state||typeof state.applicable!=='boolean')return result('inspection-invalid');
    if(!state.applicable)return result(state.skipped===true?null:state.error||'inspection-invalid');
    if(state.error)return result(state.error);
    if(state.pending){const previous=state.pending,row=state.sections?.find(s=>s.key===previous.key);if(row?.count!==previous.before+1)return result('group-add-uncertain');state=await run({op:'ack',key:previous.key,id:previous.id});if(state.error)return result(state.error);}
    for(const item of requested){
      let row=state.sections?.find(s=>s.key===item.key);
      if(row?.error==='section-missing'&&item.count===0)continue;
      if(!row||row.error||!Number.isSafeInteger(row.count))return result(row?.error||'inspection-invalid');
      while(row.count<item.count){
        const before=row.count,id=randomUUID();
        const issued=await run({op:'add',key:item.key,before,id});
        state={...state,pending:issued?.pending||null};
        if(!issued?.issued)return result(issued?.error||'group-add-uncertain');
        const end=Date.now()+timeoutMs;let observed;
        do{observed=await run({op:'read'});state=observed;if(observed?.error||!observed?.applicable||observed?.pending?.id!==id)return result(observed?.error||'group-add-uncertain');row=observed.sections?.find(s=>s.key===item.key);if(row?.count===before+1)break;if(!row||row.error||row.count!==before)return result('group-count-changed');await new Promise(r=>setTimeout(r,pollMs));}while(Date.now()<end);
        if(row.count!==before+1)return result('group-add-uncertain');
        state=await run({op:'ack',key:item.key,id});if(state?.error)return result(state.error);
        added.push({key:item.key,before,after:row.count});row=state.sections?.find(s=>s.key===item.key);
      }
      if(row.count>item.count)excess.push({key:item.key,observed:row.count,requested:item.count,retained:row.count-item.count});
    }
    return result();
  }catch(error){if(error?.code==='RESUME_TARGET_MISMATCH')throw error;return result('group-operation-uncertain');}
}
module.exports={requestedGroups,buildMeituanGroupsScript,ensureMeituanGroups};
