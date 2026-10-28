const statuses=new Set(['running','unknown','completed','failed','lost']);
const reasons=new Set(['widget-job-still-running','widget-job-status-unavailable','widget-job-start-unavailable','widget-job-lost','widget-job-failed','widget-job-busy','widget-job-invalid-state','widget-job-changed']);
async function recheckWidgetResults(workspace,requests){
 const {buildMeituanWidgetScript}=require('./meituan-widget-fill.cjs');
 const rows=await workspace.run(buildMeituanWidgetScript(requests.map(r=>({...r,readOnly:true}))));
 if(!Array.isArray(rows)||rows.length!==requests.length)throw Error('widget-recheck-unavailable');
 return rows;
}
function widgetJobMeta(value,records=[]){
 if(!value||typeof value.id!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(value.id)||!statuses.has(value.status))return null;
 records=Array.isArray(records)?records:[];
 const verified=records.filter(r=>r?.written===true&&typeof r.expected==='string'&&r.expected===r.observed).length;
 return {id:value.id,status:value.status,pendingKey:typeof value.pendingKey==='string'&&/^(basic|education|experience|projects)\.[\w.]{1,80}$/.test(value.pendingKey)?value.pendingKey:null,reason:reasons.has(value.reason||value.error)?value.reason||value.error:null,recordCount:records.length,verifiedCount:verified,failedCount:records.length-verified,continuationCompleted:value.continuationCompleted===true};
}
function jobNeedsQuery(job){return !!job&&['running','unknown'].includes(job.status);}
async function retryFailedWidgets(workspace,requests,id,options={}){
 const {readMeituanWidgetJob,executeMeituanWidgetJob}=require('./meituan-widget-job.cjs');
 const state=await readMeituanWidgetJob(workspace,id);
 if(state.status!=='completed')throw Error('widget-retry-not-completed');
 if(new Set(state.records.map(r=>r.key)).size!==state.records.length||new Set(requests.map(r=>r.key)).size!==requests.length)throw Error('widget-retry-invalid-records');
 const current=await recheckWidgetResults(workspace,requests),byKey=new Map(state.records.map(r=>[r.key,r])),observed=new Map(current.map(r=>[r.key,r]));
 if(current.some(r=>!r||!requests.some(q=>q.key===r.key))||observed.size!==requests.length)throw Error('widget-recheck-unavailable');
 const retry=requests.filter(q=>{const old=byKey.get(q.key),now=observed.get(q.key);if(old?.error!=='popup-missing'||old.written!==false)return false;if(old.requested!==q.value)throw Error('widget-retry-facts-changed');return now.error==='control-needs-change'&&now.observed==='';}).map(q=>({...q,retryBlankOnly:true}));
 for(const parent of [...retry]){if(!/^education\.\d+\.department$/.test(parent.key))continue;const key=parent.key.replace(/\.department$/,'.major'),child=requests.find(q=>q.key===key),old=byKey.get(key),now=observed.get(key);if(child&&old?.written===true&&old.requested===child.value&&now?.written===true&&now.expected===now.observed&&!retry.some(q=>q.key===key))retry.push({...child,retryBlankOnly:true,afterWrittenKey:parent.key,afterWrittenLocator:parent.locator});}
 if(!retry.length){Object.defineProperty(current,'widgetJob',{value:{id,status:'completed',pendingKey:null},enumerable:false});return current;}
 return executeMeituanWidgetJob(workspace,retry,{...options,previousJobId:id});
}
module.exports={widgetJobMeta,jobNeedsQuery,recheckWidgetResults,retryFailedWidgets};
