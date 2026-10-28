'use strict';
const INTENTION_FIELDS=['referralCode','channel','interviewCity','businessGroup','preferredLocations','acceptAdjustment','acceptCityDeployment'];
const COMPLIANCE_FIELDS=['previouslyInterviewed','previouslyEmployed','hasRelativeAtCompany','relativeDetail'];
const BOOLEAN_FIELDS=new Set(['acceptAdjustment','acceptCityDeployment','previouslyInterviewed','previouslyEmployed','hasRelativeAtCompany']);
function normalizePlatformAnswers(input={}){
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('平台答案必须是对象');
 const out={};
 for(const [company,answer] of Object.entries(input)){
  if(!/^[a-z][a-z0-9-]{0,63}$/.test(company)||['constructor','prototype','__proto__'].includes(company))throw Error('平台标识无效');
  if(!answer||typeof answer!=='object'||Array.isArray(answer))throw Error('平台答案格式无效');
  const row={};for(const field of [...INTENTION_FIELDS,...COMPLIANCE_FIELDS]){
   if(answer[field]===undefined)continue;let value=answer[field];
   if(BOOLEAN_FIELDS.has(field)){if(value===true)value='true';if(value===false)value='false';if(!['','true','false'].includes(value))throw Error('平台问题必须选择未回答/是/否');}
   else if(typeof value!=='string'||value.length>2000)throw Error('平台文本字段无效');
   row[field]=typeof value==='string'?value.trim():value;
  }out[company]=row;
 }return out;
}
function resolveResumeForCompany(resume,companyId){
 if(!/^[a-z][a-z0-9-]{0,63}$/.test(companyId||'')||['constructor','prototype','__proto__'].includes(companyId))throw Error('缺少明确平台');
 const r=structuredClone(resume||{}),answers=normalizePlatformAnswers(r.platformAnswers||{})[companyId]||{};
 r.intention||={};r.compliance||={};
 for(const field of INTENTION_FIELDS)r.intention[field]=answers[field]??'';
 for(const field of COMPLIANCE_FIELDS)r.compliance[field]=answers[field]??'';
 // A form planner must not see another company's scoped answers or profile copies.
 delete r.platformAnswers;delete r.profiles;
 return r;
}
function syncResumeAliases(r){
 const b=r.basic||{};
 if(b.idType==='身份证')b.idCard=b.idNumber||'';
 else if(b.idType)b.idCard='';
 for(const edu of r.education||[]){if(edu.isFullTime==='true'||edu.isFullTime===true)edu.learningMode='全日制';else if(edu.isFullTime==='false'||edu.isFullTime===false)edu.learningMode='非全日制';}
 if(r.skills?.englishLevel&&(!r.skills.languages||/^(英语|CET|TEM|雅思|托福)/.test(r.skills.languages)))r.skills.languages=r.skills.englishLevel+(r.skills.englishScore?'（'+r.skills.englishScore+'分）':'');
 return r;
}
module.exports={INTENTION_FIELDS,COMPLIANCE_FIELDS,normalizePlatformAnswers,resolveResumeForCompany,syncResumeAliases};
