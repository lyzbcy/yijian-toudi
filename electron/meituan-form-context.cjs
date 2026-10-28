// The observed Meituan resume editor uses unnumbered model_list cards and deep
// mtd fields. Resolve exact row labels and card ownership, never global indexes.
function getMeituanFormContext(control) {
  if(typeof location==='undefined'||location.origin!=='https://zhaopin.meituan.com'||location.pathname!=='/web/personal-center/resume-detail')return null;
  const row=control?.closest?.('.mtd-form-item'),editor=control?.closest?.('.resume_detail_edit');
  if(!row||!editor)return null;
  const form=control.closest('.mtd-form'),model=control.closest('.model_edit'),list=control.closest('.model_list');
  let section='basic';
  if(model){
    const aliases={project_experience_edit:'项目经历',edu_experience_edit:'教育经历',work_experience_edit:'实习经历'};
    const kind=Object.keys(aliases).find(k=>model.classList.contains(k));
    if(!kind||!list)return null;
    const lists=[...model.querySelectorAll('.model_list')].filter(x=>x.closest('.model_edit')===model);
    const index=lists.indexOf(list);if(index<0)return null;section=aliases[kind]+'-'+(index+1);
  }else if(!form?.classList.contains('base_info_form')||!control.closest('.base_info_edit'))return null;
  const labelNode=row.querySelector('.mtd-form-item-body > .label');
  let label=(labelNode?.textContent||'').replace(/[\s*：:]+/g,'').trim();
  // The ID/phone text fields are sibling rows of their selector, not descendants
  // of its label. Use only the two observed exact placeholders for these rows.
  if(!label&&section==='basic')label=({'请输入证件号码':'证件号码','请输入手机号码':'手机号码'})[control.placeholder]||'';
  if(!label)return null;
  const controls=[...row.querySelectorAll('input,textarea,select')].filter(x=>x.closest('.mtd-form-item')===row&&x.type!=='hidden'&&x.type!=='file');
  const ordinal=controls.indexOf(control);if(ordinal<0)return null;
  const writable=['text','email','tel','textarea'].includes(control.type)&&!control.disabled&&!control.readOnly&&!control.closest('.mtd-select,.mtd-date-picker')&&control.getClientRects().length>0;
  return{section,label,ordinal,tag:control.tagName,type:control.type,placeholder:control.placeholder||'',writable};
}
function resolveMeituanFormControl(locator) {
  const keys=['section','label','ordinal','tag','type','placeholder'];
  const matches=[...document.querySelectorAll('input,textarea,select')].filter(c=>{const v=getMeituanFormContext(c);return v?.writable&&keys.every(k=>v[k]===locator[k]);});
  return matches.length===1?matches[0]:null;
}
module.exports={getMeituanFormContext,resolveMeituanFormControl};
