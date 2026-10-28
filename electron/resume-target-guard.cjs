// Navigation acknowledgements are not proof of the execution realm. Bind all
// resume reads/writes to the observed canonical route inside the same evaluate.
function resumeTarget(url){
 const u=new URL(url);if(u.protocol!=='https:'||u.username||u.password)throw Error('invalid-resume-target');
 return {origin:u.origin,path:u.pathname,hashRoute:u.hash?u.hash.split('?')[0]:null,hashType:new URLSearchParams(u.hash.split('?')[1]||'').get('type')||null,track:u.searchParams.get('type')||null};
}
function isResumeTargetCurrent(target){
 if(typeof location==='undefined')return false;
 const hashType=new URLSearchParams(location.hash.split('?')[1]||'').get('type');
 return location.origin===target.origin&&location.pathname===target.path&&(target.hashRoute===null||location.hash.split('?')[0]===target.hashRoute)&&(target.hashType===null||hashType===null||hashType===target.hashType)&&(target.track===null||new URL(location.href).searchParams.get('type')===target.track);
}
function buildGuardedResumeScript(script,url){
 if(typeof script!=='string'||!script.trim())throw Error('invalid-resume-script');
 const target=resumeTarget(url);
 return `(()=>{const target=${JSON.stringify(target)},matches=${isResumeTargetCurrent.toString()};if(!matches(target))return {__yjtResumeTargetMismatch49:true};return (${script});})()`;
}
function unwrapResumeResult(value){if(value?.__yjtResumeTargetMismatch49===true){const error=Error('resume-target-mismatch');error.code='RESUME_TARGET_MISMATCH';throw error;}return value;}
function guardResumeWorkspace(workspace,url){
 resumeTarget(url);return {...workspace,run:async script=>unwrapResumeResult(await workspace.run(buildGuardedResumeScript(script,url))),...(workspace.setInputFiles?{setInputFiles:async file=>{unwrapResumeResult(await workspace.run(buildGuardedResumeScript('true',url)));return unwrapResumeResult(await workspace.setInputFiles(file,{expectedResumeUrl:url}));}}:{})};
}
module.exports={resumeTarget,isResumeTargetCurrent,buildGuardedResumeScript,unwrapResumeResult,guardResumeWorkspace};
