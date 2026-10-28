'use strict';
function meituanMonth(value){
 const m=String(value??'').trim().match(/^(\d{4})[-/](\d{1,2})(?:[-/](\d{1,2}))?$/);if(!m)return null;
 const y=Number(m[1]),month=Number(m[2]),day=m[3]===undefined?null:Number(m[3]);if(y<1900||y>2100||month<1||month>12||day!==null&&(day<1||day>new Date(Date.UTC(y,month,0)).getUTCDate()))return null;
 return `${y}-${String(month).padStart(2,'0')}`;
}
function planMeituanDates(resume={}){
 const out=[],groups=[['education','教育经历','入学时间','毕业时间'],['experience','实习经历','在职开始时间','在职结束时间'],['projects','项目经历','项目开始时间','项目结束时间']];
 for(const[key,title,startLabel,endLabel]of groups)for(const [i,row]of (Array.isArray(resume[key])?resume[key]:[]).entries())for(const role of ['start','end']){const value=row?.[role];if(value===undefined||value===null||String(value).trim()==='')continue;const current=role==='end'&&['至今','现在','present'].includes(String(value).trim().toLowerCase());out.push({key:`${key}.${i}.${role}`,kind:current?'meituan-present':'meituan-month',value:current?'至今':String(value).trim(),locator:{section:title+'-'+(i+1),label:role==='start'?startLabel:endLabel,dateRole:role},precision:'month'});}
 return out;
}
function resolveMeituanDate(locator){
 if(location.origin!=='https://zhaopin.meituan.com'||location.pathname!=='/web/personal-center/resume-detail')throw Error('unsupported-origin');
 const m=locator?.section?.match(/^(教育经历|实习经历|项目经历)-(\d+)$/),role=locator?.dateRole;if(!m||!['start','end'].includes(role)||Number(m[2])<1||Number(m[2])>10)throw Error('date-context-invalid');
 const editors=[...document.querySelectorAll('.resume_detail_edit')];if(editors.length!==1)throw Error('date-context-ambiguous');const editor=editors[0],cls={教育经历:'edu_experience_edit',实习经历:'work_experience_edit',项目经历:'project_experience_edit'}[m[1]],panels=[...editor.children].filter(e=>e.classList.contains(cls));if(panels.length!==1)throw Error('date-context-ambiguous');
 const cards=[...panels[0].children].filter(e=>e.classList.contains('model_list')),card=cards[Number(m[2])-1];if(!card)throw Error('date-control-missing');
 const placeholder=role==='end'?(m[1]==='教育经历'?'毕业时间':'结束时间'):(m[1]==='教育经历'?'入学时间':m[1]==='实习经历'?'在开始时间':'开始时间');
 const controls=[...card.querySelectorAll('.mtd-date-picker input')].filter(e=>e.placeholder===placeholder&&e.closest('.model_list')===card);if(controls.length!==1)throw Error('date-control-ambiguous-or-missing');
 const input=controls[0],picker=input.closest('.mtd-date-picker'),labels=[...card.querySelectorAll('.mtd-checkbox')].filter(e=>e.closest('.model_list')===card&&e.textContent.replace(/\s/g,'')==='至今'),currents=labels.map(e=>e.querySelector('input[type="checkbox"]')).filter(Boolean);if(currents.length>1)throw Error('date-current-ambiguous');return {editor,card,input,picker,current:currents[0]||null,currentLabel:labels[0]||null,role};
}
async function executeMeituanDate(item,assertTarget=()=>{}){
 const record={key:item.key,kind:item.kind,locator:item.locator,requested:item.value,expected:item.kind==='meituan-present'?'至今':meituanMonth(item.value)||item.value,observed:'',written:false,precision:'month'};
 const visible=e=>!!e?.getClientRects().length&&getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none';
 const pause=ms=>new Promise(r=>setTimeout(r,ms)),disabled=e=>!!e?.disabled||e?.getAttribute?.('aria-disabled')==='true'||[e,e?.parentElement].some(n=>/(?:^|\s)[\w-]*disabled(?:\s|$)/.test(n?.className||''));
 const close=()=>{if(document.body)for(const name of ['mousedown','mouseup','click'])document.body.dispatchEvent(new MouseEvent(name,{bubbles:true}));};
 let state,search,watch,displaced=false,ownedPopup=null;
 try{
  if(!['meituan-month','meituan-present'].includes(item.kind)||item.kind==='meituan-month'&&!meituanMonth(item.value)||item.kind==='meituan-present'&&item.locator?.dateRole!=='end')throw Error('date-value-invalid');
  state=resolveMeituanDate(item.locator);assertTarget();search=location.search;
  const alive=()=>{const fresh=resolveMeituanDate(item.locator);if(location.search!==search||fresh.editor!==state.editor||fresh.card!==state.card||fresh.input!==state.input||!fresh.input.isConnected)throw Error('date-control-changed');if(displaced)throw Error('date-control-changed');assertTarget();return fresh;};
  const read=()=>{const s=alive();return s.role==='end'&&s.current?.checked?'至今':meituanMonth(s.input.value)||'';};
  record.observed=read();if(record.expected===record.observed){record.written=true;record.unchanged=true;return record;}if(item.readOnly===true)throw Error('control-needs-change');
  if(!visible(state.picker))throw Error('date-control-disabled');
  if(item.kind==='meituan-present'){
   if(!state.current||!state.currentLabel||disabled(state.current)||!visible(state.currentLabel))throw Error('date-current-missing-or-disabled');alive();state.currentLabel.click();await pause(500);record.observed=read();record.written=record.observed==='至今';if(!record.written)throw Error('date-not-retained');return record;
  }
  if(state.role==='end'&&state.current?.checked){if(disabled(state.current)||!visible(state.currentLabel))throw Error('date-current-missing-or-disabled');alive();state.currentLabel.click();await pause(300);if(alive().current.checked)throw Error('date-current-not-cleared');}
  if(disabled(alive().input)||!state.input.readOnly)throw Error('date-control-disabled');
  close();watch=event=>{if(event.target?.closest?.('.mtd-date-picker')&&event.target!==state.input)displaced=true;};document.addEventListener?.('focusin',watch);alive().input.focus?.();await pause(50);alive();const already=[...document.querySelectorAll('.mtd-datepicker-pop-wrapper')].filter(visible);if(!already.length)alive().input.click();
  const popup=async()=>{for(let n=0;n<12;n++){alive();const ps=[...document.querySelectorAll('.mtd-datepicker-pop-wrapper')].filter(visible);if(ps.length>1)throw Error('date-popup-ambiguous');if(ps.length===1){if(ownedPopup&&ownedPopup!==ps[0])throw Error('date-control-changed');ownedPopup=ps[0];if(!ps[0].querySelector('.mtd-month-calendar'))throw Error('date-month-picker-required');return ps[0];}await pause(100);}throw Error('date-popup-missing');};
  const one=(p,selector,text)=>{const all=[...p.querySelectorAll(selector)].filter(e=>visible(e)&&!disabled(e)&&(text===undefined||e.textContent.trim()===text));if(all.length!==1)throw Error('date-option-ambiguous-or-missing');return all[0];};
  const click=(p,selector,text)=>{alive();one(p,selector,text).click();};
  const [year,month]=record.expected.split('-').map(Number);let p=await popup(),header=one(p,'.mtd-month-calendar-year-btn');
  if(header.textContent.trim()!==year+'年'){
   click(p,'.mtd-month-calendar-year-btn');await pause(100);let found=false;
   for(let step=0;step<=20;step++){
    p=await popup();const candidates=[...p.querySelectorAll('.mtd-year-panel-list-data')].filter(e=>visible(e)&&!disabled(e)&&e.textContent.trim()===String(year));if(candidates.length>1)throw Error('date-option-ambiguous-or-missing');if(candidates.length===1){alive();candidates[0].click();found=true;break;}
    if(step===20)break;const range=one(p,'.mtd-month-calendar-year-header-range').textContent.trim().match(/^(\d{4})-(\d{4})$/);if(!range||year>=Number(range[1])&&year<=Number(range[2]))throw Error('date-option-ambiguous-or-missing');const before=range[0];click(p,'.mtd-month-calendar-year-header .'+(year<Number(range[1])?'left-switcher':'right-switcher'));await pause(150);p=await popup();if(one(p,'.mtd-month-calendar-year-header-range').textContent.trim()===before)throw Error('date-year-not-changed');
   }
   if(!found)throw Error('date-year-range-exhausted');await pause(150);p=await popup();header=one(p,'.mtd-month-calendar-year-btn');if(header.textContent.trim()!==year+'年')throw Error('date-year-not-retained');
  }
  click(p,'.mtd-month-panel-list-data',month+'月');
  for(let n=0;n<12;n++){await pause(100);record.observed=read();if(record.observed===record.expected)break;}
  await pause(300);record.observed=read();record.written=record.observed===record.expected;if(!record.written)throw Error('date-not-retained');
 }catch(error){record.written=false;record.error=['widget-target-changed','unsupported-origin','date-context-invalid','date-context-ambiguous','date-control-missing','date-control-ambiguous-or-missing','date-current-ambiguous','date-value-invalid','date-control-changed','control-needs-change','date-control-disabled','date-current-missing-or-disabled','date-not-retained','date-current-not-cleared','date-popup-ambiguous','date-month-picker-required','date-popup-missing','date-option-ambiguous-or-missing','date-year-not-changed','date-year-range-exhausted','date-year-not-retained'].includes(error.message)?error.message:'date-inspection-failed';if(item.readOnly!==true&&!['widget-target-changed','unsupported-origin','date-control-changed'].includes(record.error)&&location.origin==='https://zhaopin.meituan.com'&&location.pathname==='/web/personal-center/resume-detail')close();}finally{if(watch)document.removeEventListener?.('focusin',watch);}
 return record;
}
module.exports={meituanMonth,planMeituanDates,resolveMeituanDate,executeMeituanDate};

