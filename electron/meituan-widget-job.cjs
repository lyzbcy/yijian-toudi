const {randomUUID}=require('node:crypto');
const {buildMeituanWidgetScript}=require('./meituan-widget-fill.cjs');
function buildReadMeituanWidgetJobScript(id){
 if(typeof id!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(id))throw Error('invalid-widget-job-id');
 return `(()=>{const job=window.__yjtMeituanWidgetJob47;if(location.origin!=='https://zhaopin.meituan.com'||location.pathname!=='/web/personal-center/resume-detail')return {id:${JSON.stringify(id)},status:'lost',error:'widget-job-lost'};if(!job||job.id!==${JSON.stringify(id)})return {id:${JSON.stringify(id)},status:'lost',error:'widget-job-lost'};return {id:job.id,status:job.status,pendingKey:job.pendingKey,records:job.records,error:job.error||null};})()`;
}
function jobError(reason,id,records=[],pendingKey=null,status='unknown'){const e=Error(reason);e.widgetJob={id,status,reason,pendingKey};e.partialResults=records;return e;}
async function readMeituanWidgetJob(workspace,id){
 const state=await workspace.run(buildReadMeituanWidgetJobScript(id));
 if(!state||state.id!==id||!['running','completed','failed','lost'].includes(state.status)||!['lost'].includes(state.status)&&!Array.isArray(state.records))throw Error('widget-job-invalid-state');
 return state;
}
async function executeMeituanWidgetJob(workspace,requests,{timeoutMs=180000,pollMs=250,previousJobId}={}){
 if(!requests.length)return [];
 const id=randomUUID();let records=[],pendingKey=null,start;
 try{start=await workspace.run(buildMeituanWidgetScript(requests,{jobId:id,previousJobId}));}catch{throw jobError('widget-job-start-unavailable',id);}
 if(start?.started!==true||start.id!==id){const reason=['widget-job-busy','widget-job-already-started','unsupported-origin','widget-job-changed'].includes(start?.error)?start.error:'widget-job-start-invalid';throw jobError(reason,start?.id||id,[],null,start?.status||'unknown');}
 const deadline=Date.now()+Math.max(1,Math.min(Number(timeoutMs)||180000,600000));
 for(;;){let state;try{state=await readMeituanWidgetJob(workspace,id);}catch{throw jobError('widget-job-status-unavailable',id,records,pendingKey);}
  if(state.records){records=state.records;pendingKey=state.pendingKey;}
  if(state.status==='completed'){Object.defineProperty(records,'widgetJob',{value:{id,status:'completed',pendingKey:null},enumerable:false});return records;}
  if(state.status==='failed'||state.status==='lost')throw jobError(state.status==='lost'?'widget-job-lost':'widget-job-failed',id,records,pendingKey,state.status);
  if(Date.now()>=deadline)throw jobError('widget-job-still-running',id,records,pendingKey,'running');
  await new Promise(r=>setTimeout(r,Math.max(1,Math.min(Number(pollMs)||250,5000))));
 }
}
module.exports={buildReadMeituanWidgetJobScript,readMeituanWidgetJob,executeMeituanWidgetJob};
