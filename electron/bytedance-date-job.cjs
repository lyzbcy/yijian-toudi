const {randomUUID}=require('node:crypto');
const {buildByteDateJobScript,buildReadByteDateJobScript,buildByteDateScript,byteMonth}=require('./bytedance-date-fill.cjs');
function validRecords(rows,requests){
 if(!Array.isArray(rows))return false;
 const byKey=requests?new Map(requests.map(r=>[r.key,r])):null;
 return new Set(rows.map(r=>r?.key)).size===rows.length&&rows.every(r=>{
  if(!r||!/^((education|experience|projects)\.\d+\.(start|end))$/.test(r.key)||typeof r.written!=='boolean'||byKey&&!byKey.has(r.key))return false;
  if(r.expected!==undefined&&typeof r.expected!=='string'||r.observed!==undefined&&typeof r.observed!=='string')return false;
  if(!r.written)return true;
  if(typeof r.expected!=='string'||typeof r.observed!=='string'||!r.expected||r.expected!==r.observed)return false;
  if(r.expected==='至今'?!r.key.endsWith('.end'):byteMonth(r.expected)!==r.expected)return false;
  const request=byKey?.get(r.key);return !request||r.expected===(request.kind==='byte-present'?'至今':byteMonth(request.value));
 });
}
function jobError(reason,id,records=[],pendingKey=null,status='unknown'){const e=Error(reason);e.widgetJob={id,status,reason,pendingKey};e.partialResults=records;return e;}
async function readByteDateJob(workspace,id,requests){
 const state=await workspace.run(buildReadByteDateJobScript(id));
 if(!state||state.id!==id||!['running','completed','failed','lost'].includes(state.status)||state.status!=='lost'&&!validRecords(state.records,requests)||state.status==='completed'&&requests&&state.records.length!==requests.length)throw Error('widget-job-invalid-state');
 return state;
}
async function executeByteDateJob(workspace,requests,{timeoutMs=180000,pollMs=250,previousJobId}={}){
 if(!requests.length)return [];
 if(new Set(requests.map(r=>r.key)).size!==requests.length)throw Error('widget-job-invalid-plan');
 const id=randomUUID();let records=[],pendingKey=null,start;
 try{start=await workspace.run(buildByteDateJobScript(requests,{jobId:id,previousJobId}));}catch{throw jobError('widget-job-start-unavailable',id);}
 if(start?.started!==true||start.id!==id){const reason=['widget-job-busy','widget-job-already-started','unsupported-origin','widget-job-changed'].includes(start?.error)?start.error:'widget-job-start-invalid';throw jobError(reason,start?.id||id,[],null,start?.status||'unknown');}
 const keys=new Set(requests.map(r=>r.key)),deadline=Date.now()+Math.max(1,Math.min(Number(timeoutMs)||180000,600000));
 for(;;){let state;try{state=await readByteDateJob(workspace,id,requests);}catch(error){throw jobError(error?.message==='widget-job-invalid-state'?'widget-job-invalid-state':'widget-job-status-unavailable',id,records,pendingKey);}
  if(state.records){if(state.records.some(r=>!keys.has(r.key)))throw jobError('widget-job-invalid-state',id,records,pendingKey);records=state.records;pendingKey=state.pendingKey;}
  if(state.status==='completed'){if(records.length!==requests.length)throw jobError('widget-job-invalid-state',id,records,pendingKey);Object.defineProperty(records,'widgetJob',{value:{id,status:'completed',pendingKey:null},enumerable:false});return records;}
  if(state.status==='failed'||state.status==='lost')throw jobError(state.status==='lost'?'widget-job-lost':'widget-job-failed',id,records,pendingKey,state.status);
  if(Date.now()>=deadline)throw jobError('widget-job-still-running',id,records,pendingKey,'running');
  await new Promise(r=>setTimeout(r,Math.max(1,Math.min(Number(pollMs)||250,5000))));
 }
}
async function recheckByteDates(workspace,requests){
 const rows=await workspace.run(buildByteDateScript(requests.map(r=>({...r,readOnly:true}))));
 if(!validRecords(rows,requests)||rows.length!==requests.length||rows.some((r,i)=>r?.key!==requests[i].key))throw Error('widget-recheck-unavailable');
 return rows;
}
module.exports={readByteDateJob,executeByteDateJob,recheckByteDates};
