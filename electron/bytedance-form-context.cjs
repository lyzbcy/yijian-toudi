// Observed ByteDance campus Formily DOM. Functions run inside the live page.
function getByteDanceFormContext(control) {
  if(typeof location==='undefined'||location.origin!=='https://jobs.bytedance.com'||location.pathname!=='/campus/resume/edit')return null;
  const row=control.closest('.ud-formily-item');
  const labelOf=r=>(r&&[...r.children].find(e=>String(e.className).split(/\s+/).includes('ud-formily-item-label'))?.textContent||'').replace(/[\s*＊:：]/g,'');
  const label=labelOf(row);if(!row||!label)return null;
  const cardSelector='[class*="apply-form-array-card__"]',card=row.closest(cardSelector);
  const kindOf=c=>{const labels=[...c.querySelectorAll('.ud-formily-item')].filter(r=>r.closest(cardSelector)===c).map(labelOf);return labels.includes('学校名称')?'教育经历':labels.includes('公司名称')&&labels.includes('职位名称')?'实习经历':labels.includes('项目名称')?'项目经历':'';};
  let section='basic';
  if(card){const kind=kindOf(card);if(!kind)return null;const cards=[...document.querySelectorAll(cardSelector)].filter(c=>kindOf(c)===kind);const n=cards.indexOf(card)+1;if(n<1)return null;section=kind+'-'+n;}
  const controls=[...row.querySelectorAll('input,textarea,select')].filter(c=>c.closest('.ud-formily-item')===row&&c.type!=='hidden'&&c.type!=='file');
  const ordinal=controls.indexOf(control);if(ordinal<0)return null;
  const matchLabel=label==='描述'?(section.startsWith('项目经历-')?'项目描述':section.startsWith('实习经历-')?'工作描述':label):label;
  let projectName;
  if(section.startsWith('项目经历-')){const names=[...card.querySelectorAll('.ud-formily-item')].filter(r=>r.closest(cardSelector)===card&&labelOf(r)==='项目名称').flatMap(r=>[...r.querySelectorAll('input')].filter(e=>e.closest('.ud-formily-item')===r&&e.type==='text'));projectName=names.length===1?names[0].value.trim():null;}
  return{section,label,matchLabel,ordinal,tag:control.tagName,type:control.type,placeholder:control.placeholder||'',...(section.startsWith('项目经历-')?{projectName}: {})};
}
function resolveByteDanceFormControl(locator) {
  const matches=[...document.querySelectorAll('input,textarea,select')].filter(c=>{const v=getByteDanceFormContext(c);return v&&['section','label','matchLabel','ordinal','tag','type','placeholder'].every(k=>v[k]===locator[k])&&(locator.projectName===undefined||v.projectName===locator.projectName);});
  const c=matches.length===1?matches[0]:null;
  if(c&&locator.projectName!==undefined){if(typeof locator.projectName!=='string'||!locator.projectName.trim()||!locator.section.startsWith('项目经历-'))return null;const names=[...document.querySelectorAll('input')].filter(e=>{const x=getByteDanceFormContext(e);return x&&x.section===locator.section&&x.label==='项目名称'});if(names.length!==1||names[0].value.trim()!==locator.projectName)return null;}
  return c&&!c.disabled&&!c.readOnly&&['text','email','tel','textarea'].includes(c.type)?c:null;
}
module.exports={getByteDanceFormContext,resolveByteDanceFormControl};
