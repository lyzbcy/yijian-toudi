// Observed Brick resume rows. The numeric form prefix changes between loads.
// Keep unsupported controls/manual selections out of generic text matching.
function getBaiduFormContext(control) {
  if(typeof location==='undefined'||location.origin!=='https://talent.baidu.com'||!/^\/jobs\/(?:resume\/create|center)\/?$/.test(location.pathname))return null;
  const row=control.closest('.brick-field');if(!row)return null;
  const identities=[...row.classList].map(c=>c.match(/^field-\d+(?:\.\d*)?-([a-zA-Z]+)(\d*)$/)).filter(Boolean);
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
  const rows=[...document.querySelectorAll('.brick-field')].filter(row=>[...row.classList].some(c=>new RegExp('^field-\\d+(?:\\.\\d*)?-'+suffix+'$').test(c)));
  if(rows.length!==1)return null;
  const controls=[...rows[0].querySelectorAll('input,textarea,select')].filter(c=>c.type!=='hidden'&&c.type!=='file'&&c.getClientRects().length&&getComputedStyle(c).visibility!=='hidden'&&getComputedStyle(c).display!=='none');
  const control=controls[locator.ordinal];
  return control&&!control.disabled&&!control.readOnly&&control.tagName===locator.tag&&control.type===locator.type&&(control.placeholder||'')===locator.placeholder?control:null;
}
function buildEnsureBaiduGroupScript(request) {
  async function ensure({sectionId,count}) {
    if(location.origin!=='https://talent.baidu.com'||!/^\/jobs\/(?:resume\/create|center)\/?$/.test(location.pathname))return {skipped:true};
    const schemas={education:{properties:['school','edudate','academic','major'],label:'添加教育经历'},experience:{properties:['companyName','industryType','workdate','department','positionName','postPay','workIn','workDesc'],label:'添加工作经历'},projects:{properties:['subjectName','position','subjectDate','subjectDesc','positionDesc'],label:'添加项目经验'}};
    const schema=schemas[sectionId],result={sectionId,requested:count,skipped:false};
    if(!schema||!Number.isSafeInteger(count)||count<0||count>10)return {...result,error:'invalid-count'};
    if(count===0)return {...result,done:true,added:false};
    const anchors=[...document.querySelectorAll('.brick-field')].filter(r=>[...r.classList].some(c=>new RegExp('^field-\\d+(?:\\.\\d*)?-'+schema.properties[0]+'0$').test(c)));
    if(anchors.length!==1)return {...result,error:'section-missing-or-ambiguous'};
    const section=anchors[0].closest('[class*="resume-item__"]');
    if(!section)return {...result,error:'section-missing-or-ambiguous'};
    const identities=()=>[...section.querySelectorAll('.brick-field')].map(r=>[...r.classList].map(c=>c.match(/^field-\d+(?:\.\d*)?-([a-zA-Z]+)(\d+)$/)).filter(Boolean)).flat();
    const groupCount=()=>{
      const ids=identities(),anchors=ids.filter(m=>m[1]===schema.properties[0]);
      if(!anchors.length||ids.length!==anchors.length*schema.properties.length)return null;
      for(let i=0;i<anchors.length;i++)for(const p of schema.properties)if(ids.filter(m=>m[1]===p&&Number(m[2])===i).length!==1)return null;
      return anchors.length;
    };
    const before=groupCount();
    if(before===null)return {...result,error:'group-identity-ambiguous'};
    if(before>=count)return {...result,count:before,done:true,added:false,error:null};
    const buttons=[...section.querySelectorAll('[class*="add-one__"]')].filter(b=>b.textContent.trim()===schema.label&&b.getClientRects().length&&getComputedStyle(b).display!=='none'&&getComputedStyle(b).visibility!=='hidden'&&!b.disabled&&b.getAttribute('aria-disabled')!=='true');
    if(buttons.length!==1)return {...result,count:before,error:'add-action-ambiguous-or-missing'};
    buttons[0].click();const until=Date.now()+2500;
    while(groupCount()===before&&Date.now()<until)await new Promise(r=>setTimeout(r,100));
    const after=groupCount();
    return {...result,count:after,done:after>=count,added:after===before+1,error:after===before+1?null:'group-not-added'};
  }
  return `(${ensure.toString()})(${JSON.stringify(request)})`;
}
async function executeBaiduGroups(workspace,resume) {
  const sections=[];
  for(const sectionId of ['education','experience','projects']){
    const count=(resume[sectionId]||[]).length;let result;
    // Each page script performs at most one addition, bounded independently of
    // hidden-view timer throttling. Existing groups are never removed.
    for(let attempt=0;attempt<10;attempt++){
      result=await workspace.run(buildEnsureBaiduGroupScript({sectionId,count}));
      if(result.skipped||result.done||result.error)break;
    }
    sections.push(result);
  }
  return {sections};
}
module.exports={getBaiduFormContext,resolveBaiduFormControl,buildEnsureBaiduGroupScript,executeBaiduGroups};
