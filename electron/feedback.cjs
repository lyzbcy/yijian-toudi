const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),https=require('node:https'),crypto=require('node:crypto'),{diagnosticBundle,redactNote}=require('./diagnostics.cjs');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const CATEGORIES=new Set(['','login','resume','apply','update','ui','other']);
function endpointUrl(value){
 const u=new URL(value);if(u.username||u.password||u.search||u.hash||u.pathname!=='/v1/feedback')throw Error('feedback-endpoint-invalid');
 if(u.protocol!=='https:'&&!(u.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(u.hostname)))throw Error('feedback-endpoint-insecure');return u;
}
function payloadForFeedback(input,{version,platform,entries}={}){
 if(!UUID.test(input?.requestId||''))throw Error('feedback-request-id-invalid');
 const kind=['bug','review'].includes(input.kind)?input.kind:'bug',message=redactNote(input.message).trim();if(!message||message.length>1000)throw Error('feedback-message-required');
 return{requestId:input.requestId,kind,category:CATEGORIES.has(input.category)?input.category:'',message,version:/^\d+\.\d+\.\d+$/.test(version||'')?version:'unknown',logs:input.includeLogs===false?null:diagnosticBundle(entries,{version,platform})};
}
function requestJson(url,payload,{method='POST',timeoutMs=9000}={}){
 return new Promise((resolve,reject)=>{
  const body=payload===undefined?'':JSON.stringify(payload),mod=url.protocol==='https:'?https:http;
  const req=mod.request(url,{method,rejectUnauthorized:true,timeout:timeoutMs,headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}},res=>{
   let data='',size=0;res.on('data',chunk=>{size+=chunk.length;if(size>32768){res.destroy();reject(Error('feedback-response-too-large'));return;}data+=chunk;});res.on('error',reject);res.on('end',()=>{try{resolve({status:res.statusCode,body:JSON.parse(data)});}catch{reject(Error('feedback-response-invalid'));}});
  });req.on('error',reject);req.on('timeout',()=>req.destroy(Error('feedback-request-timeout')));req.end(body);
 });
}
function validateReceipt(response,id,endpoint){
 const body=response.body;if(response.status!==200||body?.ok!==true||body.requestId!==id||body.status!=='sent')return null;
 if(body.logUrl){const url=new URL(body.logUrl);if(url.origin!==endpoint.origin||!/^\/diagnostics\/[a-f0-9]{64}\.txt$/.test(url.pathname)||url.search||url.hash||url.username||url.password)throw Error('feedback-receipt-link-invalid');}
 return{ok:true,requestId:id,status:'sent',logUrl:body.logUrl||null};
}
function createFeedbackClient({file,transport=requestJson}={}){
 let records={},outboxInvalid=false;if(file&&fs.existsSync(file)){try{records=JSON.parse(fs.readFileSync(file,'utf8'));if(!records||Array.isArray(records)||typeof records!=='object'||Object.values(records).some(r=>!r?.payload||!UUID.test(r.payload.requestId||'')))throw Error('invalid');}catch{records={};outboxInvalid=true;}}let busy=false;
 const persist=()=>{if(!file)return;fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file+'.tmp',JSON.stringify(records),{mode:0o600});fs.renameSync(file+'.tmp',file);};
 const pending=()=>Object.values(records).find(r=>r.status==='pending')||null;
 const complete=(record,response,url)=>{const receipt=validateReceipt(response,record.payload.requestId,url);if(receipt){record.status='sent';record.receipt=receipt;persist();return receipt;}if(response.body?.status==='unknown'||response.body?.status==='sending'){persist();return{ok:false,code:'delivery-unknown',requestId:record.payload.requestId};}if(response.status>=400&&response.body?.ok===false&&response.body?.status==='failed'){record.status='failed';persist();return{ok:false,code:'delivery-failed',requestId:record.payload.requestId};}return{ok:false,code:'delivery-unknown',requestId:record.payload.requestId};};
 return{
  pending,
  async send(endpoint,payload){
   if(outboxInvalid)return{ok:false,code:'feedback-outbox-invalid'};
   if(busy)return{ok:false,code:'feedback-busy'};let url;try{url=endpointUrl(endpoint);}catch{return{ok:false,code:'feedback-not-configured'};}
   const fingerprint=crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');let record=records[payload.requestId];
   if(record){if(record.fingerprint!==fingerprint||record.endpoint!==url.href)return{ok:false,code:'feedback-id-conflict'};if(record.receipt)return record.receipt;if(record.status==='pending')return{ok:false,code:'delivery-unknown',requestId:payload.requestId};}
   if(pending())return{ok:false,code:'delivery-unknown',requestId:pending().payload.requestId};
   busy=true;record={payload,fingerprint,endpoint:url.href,status:'pending',createdAt:Date.now()};records[payload.requestId]=record;
   try{persist();}catch{delete records[payload.requestId];busy=false;return{ok:false,code:'feedback-outbox-invalid'};}
   try{return complete(record,await transport(url,payload),url);}catch{return{ok:false,code:'delivery-unknown',requestId:payload.requestId};}finally{busy=false;}
  },
  async check(id){
   const record=records[id];if(!record)return{ok:false,code:'feedback-receipt-missing'};if(record.receipt)return record.receipt;if(busy)return{ok:false,code:'feedback-busy'};busy=true;
   try{const endpoint=endpointUrl(record.endpoint),url=new URL(endpoint);url.pathname+='/'+id;return complete(record,await transport(url,undefined,{method:'GET'}),endpoint);}catch{return{ok:false,code:'delivery-unknown',requestId:id};}finally{busy=false;}
  }
 };
}
module.exports={UUID,CATEGORIES,endpointUrl,payloadForFeedback,requestJson,validateReceipt,createFeedbackClient};
