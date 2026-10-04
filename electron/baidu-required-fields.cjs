// Read structural completeness only. Never tick consent or invoke validation/save.
function inspectBaiduRequiredFields() {
  const blank={applicable:false,structurallyComplete:false,officialValidationProven:false,requiredRows:[],missing:[],unknown:[]};
  if(location.origin!=='https://talent.baidu.com'||!/^\/jobs\/(?:resume\/create|center)\/?$/.test(location.pathname))return{...blank,reason:'not-baidu-resume'};
  const visible=e=>e&&e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none';
  const rows=[...document.querySelectorAll('.brick-field')].filter(row=>visible(row)&&row.querySelector('.brick-field-label-required-mark'));
  if(!rows.length)return{...blank,reason:'required-structure-missing'};
  const requiredRows=rows.map((row,index)=>{
    const identities=[...row.classList].map(c=>c.match(/^field-\d+-([a-zA-Z]+)(\d*)$/)).filter(Boolean);
    const identity=identities.length===1?identities[0]:null,property=identity?.[1]||'',segment=identity?.[2]||'';
    const group=/^(?:school|edudate|academic|major)$/.test(property)?'education':/^(?:companyName|industryType|workdate|department|positionName|workDesc)$/.test(property)?'experience':/^(?:subjectName|position|subjectDate|subjectDesc)$/.test(property)?'projects':'info';
    const consent=[...row.classList].some(c=>c.startsWith('sign-private-field'));
    const label=consent?'隐私声明':(row.querySelector('.brick-field-label > span:last-child')?.textContent||row.querySelector('.brick-field-label')?.textContent||'未识别必填项').trim();
    const base={key:identity?property+segment:consent?'privacy-consent':'unknown-'+index,sectionId:consent?'consent':group,groupNumber:segment===''?1:Number(segment)+1,label};
    const controls=[...row.querySelectorAll('input,textarea,select')].filter(c=>visible(c)&&c.type!=='hidden');
    let status='unknown',reason='unsupported-control';
    if(identities.length>1)return{...base,status,reason:'ambiguous-field-identity'};
    if(row.querySelector('.ant-select:not(.ant-select-auto-complete)')){
      const selected=[...row.querySelectorAll('.ant-select-selection-item')].filter(visible);
      status=selected.some(e=>e.textContent.trim())?'filled':'empty';reason='selected-model-only';
    }else if(row.querySelector('.brick-select')){
      const selected=[...row.querySelectorAll('.brick-select-selection-selected')].filter(visible);
      if(selected.length===1){status=selected[0].textContent.trim()?'filled':'empty';reason='selected-model-only';}
    }else if(controls.length&&controls.every(c=>c.type==='radio')){
      status=controls.some(c=>c.checked)?'filled':'empty';reason='checked-model';
    }else if(controls.length&&controls.every(c=>c.type==='checkbox')){
      status=controls.every(c=>c.checked)?'filled':'empty';reason=consent?'user-consent-required':'checked-model';
    }else if(controls.length&&controls.every(c=>c.tagName==='TEXTAREA'||['text','search','email','tel','number','date'].includes(c.type))){
      status=controls.every(c=>String(c.value||'').trim())?'filled':'empty';reason='visible-inputs';
    }
    return{...base,status,reason};
  });
  const counts=new Map();for(const row of requiredRows)counts.set(row.key,(counts.get(row.key)||0)+1);
  for(const row of requiredRows)if(counts.get(row.key)>1){row.status='unknown';row.reason='duplicate-field-identity';}
  const missing=requiredRows.filter(r=>r.status==='empty'),unknown=requiredRows.filter(r=>r.status==='unknown');
  return{applicable:true,structurallyComplete:!missing.length&&!unknown.length,officialValidationProven:false,requiredRows,missing,unknown};
}
function buildBaiduRequiredFieldsScript(){return `(${inspectBaiduRequiredFields.toString()})()`;}
module.exports={inspectBaiduRequiredFields,buildBaiduRequiredFieldsScript};
