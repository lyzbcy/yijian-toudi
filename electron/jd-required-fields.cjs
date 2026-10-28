// Read-only structural inspection. No personal values, clicks, consent, or saves.
function inspectJdRequiredFields() {
  const empty={applicable:false,structurallyComplete:false,officialValidationProven:false,requiredRows:[],missing:[],unknown:[]};
  if(location.origin!=='https://campus.jd.com'||!/^#\/resume(?:$|[/?])/.test(location.hash))return {...empty,reason:'not-jd-campus-resume'};
  const visible=e=>Boolean(e?.getClientRects().length)&&getComputedStyle(e).display!=='none'&&getComputedStyle(e).visibility!=='hidden'&&!e.closest('[hidden]');
  const sections=[...document.querySelectorAll('[class*="gridContainer___"][id]')];
  const result={...empty,applicable:true,reason:null};
  const knownIds=new Set(['source','info','edu','experience','program','language','certificate','other','family']);
  for(const section of sections){
    const groups=[...section.querySelectorAll('[class*="formGroupItem___"]')].filter(g=>g.closest('[class*="gridContainer___"][id]')===section);
    const rows=[...section.querySelectorAll('[class*="fieldItem___"]')].filter(r=>r.closest('[class*="gridContainer___"][id]')===section&&visible(r));
    for(const row of rows){
      const labels=[...row.children].filter(e=>String(e.className).includes('filedName___'));
      if(labels.length!==1||!/[＊*]/.test(labels[0].textContent||''))continue;
      const label=(labels[0].textContent||'').replace(/[\s*＊:：]/g,'');
      const group=row.closest('[class*="formGroupItem___"]'),groupNumber=groups.indexOf(group)+1;
      const base={sectionId:section.id,groupNumber,label,kind:'unknown',status:'unknown',reason:null};
      const controls=[...row.querySelectorAll('input,textarea,select')].filter(c=>c.type!=='hidden'&&c.type!=='button'&&c.type!=='submit'&&visible(c)&&!c.matches('.ant-select-search__field'));
      if(!label||groupNumber<1||sections.filter(s=>s.id===section.id).length!==1||!knownIds.has(section.id))base.reason='row-context-unverified';
      else if(rows.filter(r=>r.closest('[class*="formGroupItem___"]')===group&&[...r.children].some(e=>String(e.className).includes('filedName___')&&(e.textContent||'').replace(/[\s*＊:：]/g,'')===label)).length!==1)base.reason='row-context-ambiguous';
      else {
        const selects=[...row.querySelectorAll('.ant-select')].filter(visible);
        const radios=controls.filter(c=>c.type==='radio'),checks=controls.filter(c=>c.type==='checkbox');
        const cascaders=[...row.querySelectorAll('.ant-cascader-picker')].filter(visible);
        if(cascaders.length){
          base.kind='cascader';
          const input=cascaders.length===1?cascaders[0].querySelector('.ant-cascader-input'):null;
          if(!input||controls.length!==1)base.reason='cascader-control-ambiguous';
          else if(input.disabled||cascaders[0].classList.contains('ant-cascader-picker-disabled'))base.reason='control-disabled';
          else base.status=input.value.trim()?'filled':'missing';
        }else if(selects.length){
          base.kind='select';
          if(selects.some(s=>s.classList.contains('ant-select-disabled')))base.reason='control-disabled';
          else {base.status=selects.every(s=>Boolean(s.querySelector('.ant-select-selection-selected-value')?.textContent.trim()))?'filled':'missing';}
        } else if(radios.length){
          base.kind='radio';
          if(radios.every(c=>c.disabled))base.reason='control-disabled';
          else base.status=radios.some(c=>c.checked)?'filled':'missing';
        } else if(checks.length){
          base.kind='checkbox';
          if(checks.every(c=>c.disabled))base.reason='control-disabled';
          else base.status=checks.every(c=>c.checked)?'filled':'missing';
        } else if(controls.length){
          base.kind=controls.some(c=>c.type==='file')?'attachment':controls.some(c=>c.matches('.ant-calendar-picker-input')||c.type==='date')?'date':'text';
          if(controls.some(c=>c.disabled))base.reason='control-disabled';
          else base.status=controls.every(c=>c.type==='file'?c.files?.length>0:c.tagName==='SELECT'?Boolean(c.value.trim())&&!c.selectedOptions[0]?.disabled:Boolean(c.value.trim()))?'filled':'missing';
        } else base.reason='control-unrecognized';
      }
      result.requiredRows.push(base);
    }
  }
  result.missing=result.requiredRows.filter(r=>r.status==='missing');
  result.unknown=result.requiredRows.filter(r=>r.status==='unknown');
  if(!result.requiredRows.length)result.reason='required-structure-not-found';
  result.structurallyComplete=result.requiredRows.length>0&&!result.missing.length&&!result.unknown.length;
  return result;
}
const buildJdRequiredFieldsScript=()=>`(${inspectJdRequiredFields.toString()})()`;
module.exports={inspectJdRequiredFields,buildJdRequiredFieldsScript};
