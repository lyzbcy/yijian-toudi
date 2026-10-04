// Observed Brick resume rows. The numeric form prefix changes between loads.
// Keep unsupported controls/manual selections out of generic text matching.
function getBaiduFormContext(control) {
  if(typeof location==='undefined'||location.origin!=='https://talent.baidu.com'||!/^\/jobs\/(?:resume\/create|center)\/?$/.test(location.pathname))return null;
  const row=control.closest('.brick-field');if(!row)return null;
  const identities=[...row.classList].map(c=>c.match(/^field-\d+-([a-zA-Z]+)(\d*)$/)).filter(Boolean);
  if(identities.length!==1)return null;
  const [,property,segment]=identities[0];
  const controls=[...row.querySelectorAll('input,textarea,select')].filter(c=>c.type!=='hidden'&&c.type!=='file'&&c.getClientRects().length&&getComputedStyle(c).visibility!=='hidden'&&getComputedStyle(c).display!=='none');
  const ordinal=controls.indexOf(control);
  const globalKeys={name:'basic.name',mobile:'basic.phone',email:'basic.email'};
  const groups={school:['education','school'],major:['education','major'],academic:['education','degree'],edudate:['education','date'],companyName:['experience','company'],department:['experience','department'],positionName:['experience','role'],workdate:['experience','date'],workDesc:['experience','description'],subjectName:['projects','name'],position:['projects','role'],subjectDate:['projects','date'],subjectDesc:['projects','description'],positionDesc:['projects','contribution']};
  const group=groups[property];
  const validGroup=group&&segment!==''&&Number.isSafeInteger(Number(segment));
  const date=validGroup&&group[1]==='date';
  const key=validGroup?`${group[0]}.${Number(segment)}.${date?(ordinal===0?'start':ordinal===1?'end':'unsupported'):group[1]}`:segment===''?globalKeys[property]||null:null;
  const customSelect=Boolean(control.closest('.ant-select, .brick-select'));
  const kind=date?'month':customSelect?'select':'text';
  const label=(row.querySelector('.brick-field-label-wrap')?.textContent||'').replace(/^[\s*＊]+|[\s*＊:：]+$/g,'');
  return {property,segmentIndex:segment===''?null:Number(segment),ordinal,key,label,widgetKind:kind,hidden:ordinal<0,section:validGroup?({education:'教育经历',experience:'工作经历',projects:'项目经历'}[group[0]]+'-'+(Number(segment)+1)):'',tag:control.tagName,type:control.type,placeholder:control.placeholder||''};
}

function resolveBaiduFormControl(locator) {
  if(typeof location==='undefined'||location.origin!=='https://talent.baidu.com'||!/^\/jobs\/(?:resume\/create|center)\/?$/.test(location.pathname))return null;
  if(!/^[a-zA-Z]+$/.test(locator.property)||!(locator.segmentIndex===null||Number.isSafeInteger(locator.segmentIndex)&&locator.segmentIndex>=0)||!Number.isSafeInteger(locator.ordinal)||locator.ordinal<0)return null;
  const suffix=locator.property+(locator.segmentIndex===null?'':locator.segmentIndex);
  const rows=[...document.querySelectorAll('.brick-field')].filter(row=>[...row.classList].some(c=>new RegExp('^field-\\d+-'+suffix+'$').test(c)));
  if(rows.length!==1)return null;
  const controls=[...rows[0].querySelectorAll('input,textarea,select')].filter(c=>c.type!=='hidden'&&c.type!=='file'&&c.getClientRects().length&&getComputedStyle(c).visibility!=='hidden'&&getComputedStyle(c).display!=='none');
  const control=controls[locator.ordinal];
  return control&&!control.disabled&&!control.readOnly&&control.tagName===locator.tag&&control.type===locator.type&&(control.placeholder||'')===locator.placeholder?control:null;
}
module.exports={getBaiduFormContext,resolveBaiduFormControl};
