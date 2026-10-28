'use strict';
const {randomUUID}=require('node:crypto');
function inspectByteProjectPage(action){
 try{
  if(location.origin!=='https://jobs.bytedance.com'||location.pathname!=='/campus/resume/edit')throw Error('project-target-changed');
  const slot='__yjtByteProjectReview64',old=window[slot];
  const selector='[class*="apply-form-array-card__"]',label=e=>e.textContent.replace(/[\s*＊:：]/g,''),cards=[...document.querySelectorAll(selector)].filter(c=>[...c.querySelectorAll('.ud-formily-item-label')].some(l=>l.closest(selector)===c&&label(l)==='项目名称'));
  if(cards.length>10)throw Error('project-count-invalid');
  const editors=[...document.querySelectorAll('form')];if(editors.length>1||cards.length&&editors.length!==1)throw Error('project-editor-missing-or-ambiguous');const editor=editors[0]||document.body;
  if(cards.some(c=>c.closest('form')!==editor))throw Error('project-editor-missing-or-ambiguous');
  const panels=[...editor.querySelectorAll('[class*="applyFormModuleWrapper__"]')].filter(p=>{const left=[...p.children].filter(e=>e.classList.contains('applyFormModuleWrapper-left'));return left.length===1&&/^项目经历(?:请填写项目经历)?$/.test(label(left[0]));});const panel=panels.length===1?panels[0]:null;
  if(action.previousId&&(!old||old.id!==action.previousId||old.body!==document.body||old.root!==document.documentElement||old.editor!==editor||old.panel!==panel||old.search!==location.search||old.hash!==location.hash))throw Error('project-target-changed');
  const rowControls=cards.map(c=>[...c.querySelectorAll('input,textarea,select')].filter(e=>e.closest(selector)===c&&!['file','hidden','password','button','submit'].includes(e.type)));
  const rows=cards.map((c,index)=>{const names=[...c.querySelectorAll('.ud-formily-item')].filter(r=>r.closest(selector)===c&&[...r.children].some(e=>e.classList.contains('ud-formily-item-label')&&label(e)==='项目名称')).flatMap(r=>[...r.querySelectorAll('input')].filter(e=>e.closest('.ud-formily-item')===r&&e.type==='text'));if(names.length!==1)throw Error('project-name-missing-or-ambiguous');const fields=rowControls[index].map(e=>({tag:e.tagName,type:e.type,placeholder:e.placeholder||'',value:['checkbox','radio'].includes(e.type)?'':e.value||'',checked:['checkbox','radio'].includes(e.type)?!!e.checked:false,disabled:!!e.disabled,selected:e.tagName==='SELECT'&&String(e.value).trim()?e.selectedOptions[0]?.textContent?.trim()||'':''}));return{name:names[0].value,nameFieldIndex:rowControls[index].indexOf(names[0]),fields,filled:fields.some(f=>f.checked||f.value.trim()||f.selected)};});
  const projectControls=new Set(rowControls.flat()),otherFields=[...editor.querySelectorAll('input,textarea,select')].filter(e=>!projectControls.has(e)).map(e=>({tag:e.tagName,type:e.type,value:['file','password'].includes(e.type)?'':e.value||'',checked:!!e.checked,disabled:!!e.disabled,readOnly:!!e.readOnly,files:e.type==='file'?[...e.files].map(f=>({name:f.name,size:f.size,lastModified:f.lastModified})):[]}));
  const visible=e=>!!e.getClientRects().length&&getComputedStyle(e).display!=='none'&&getComputedStyle(e).visibility!=='hidden';const adds=panel?[...panel.querySelectorAll('button')].filter(e=>e.closest('[class*="applyFormModuleWrapper__"]')===panel&&e.querySelector('svg[data-icon="AddOutlined"]')&&e.textContent.replace(/\s/g,'')==='添加'&&visible(e)):[];
  const deletable=cards.every(c=>[...c.querySelectorAll('button')].filter(e=>e.closest(selector)===c&&e.querySelector('svg[data-icon="DeleteTrashOutlined"]')&&visible(e)&&!e.disabled&&e.getAttribute('aria-disabled')!=='true').length===1);
  const canReplace=!!panel&&cards.every(c=>c.closest('[class*="applyFormModuleWrapper__"]')===panel)&&adds.length===1&&(cards.length===10||!adds[0].disabled&&adds[0].getAttribute('aria-disabled')!=='true')&&deletable;
  if(action.internal===true)return{ok:true,id:action.id,editor,panel,cards,rowControls,rows,otherFields,canReplace};
  // A read-only review handle binds the original document, never sends deletion
  // or addition. Manual alignment is recaptured only by an explicit refresh.
  window[slot]={id:action.id,body:document.body,root:document.documentElement,editor,panel,search:location.search,hash:location.hash};
  return{ok:true,id:action.id,rows,canReplace};
 }catch(e){return{ok:false,error:['project-target-changed','project-count-invalid','project-name-missing-or-ambiguous','project-editor-missing-or-ambiguous'].includes(e.message)?e.message:'project-inspection-uncertain'};}
}
const buildByteProjectInspection=a=>`(${inspectByteProjectPage.toString()})(${JSON.stringify(a)})`;
function desiredByteProjects(resume){const rows=resume.projects??[];if(!Array.isArray(rows)||rows.length>10||rows.some(p=>!p||typeof p!=='object'||Array.isArray(p)))throw Error('project-facts-invalid');const count=require('./meituan-groups.cjs').requestedGroups(resume).find(r=>r.key==='projects').count,active=rows.slice(0,count);if(active.some(p=>typeof p.name!=='string'||!p.name.trim()||p.name.length>200))throw Error('project-facts-invalid');const names=active.map(p=>p.name.trim());if(new Set(names).size!==names.length)throw Error('project-facts-ambiguous');return names;}
async function inspectByteProjectDifference(workspace,resume,{previousId,freshId=false}={}){
 let desired;try{desired=desiredByteProjects(resume);}catch(e){return{ok:false,error:e.message};}
 const id=freshId?randomUUID():previousId||randomUUID(),read=await workspace.run(buildByteProjectInspection({id,previousId}));
 if(!read?.ok||read.id!==id||!Array.isArray(read.rows)||read.rows.length>10||read.rows.some(r=>!r||typeof r.name!=='string'||typeof r.filled!=='boolean'||!Array.isArray(r.fields)||r.fields.some(f=>!f||!['tag','type','placeholder','value','selected'].every(k=>typeof f[k]==='string')||typeof f.checked!=='boolean'||typeof f.disabled!=='boolean')))return{ok:false,error:read?.error||'project-inspection-uncertain'};
 const needsReplacement=!(desired.length===0&&read.rows.length===1&&!read.rows[0].filled)&&(read.rows.length!==desired.length||read.rows.some((r,i)=>r.name.trim()!==desired[i]));
 return{ok:true,id,platform:'bytedance',rows:read.rows,desired,needsReplacement,removed:0,added:0,phase:'ready',canReplace:read.canReplace===true};
}
module.exports={inspectByteProjectPage,buildByteProjectInspection,desiredByteProjects,inspectByteProjectDifference};
