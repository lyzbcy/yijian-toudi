// Self-hostable feedback relay. The WeCom webhook stays server-side only.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{UUID,CATEGORIES}=require('../electron/feedback.cjs'),{diagnosticBundle,redactNote}=require('../electron/diagnostics.cjs'),{postJson,buildWecomPayload}=require('../electron/wecom-notify.cjs');
function createFeedbackServer({dataDir,publicBaseUrl,webhook,notify,allowLocal=false,clock=Date.now,ttlMs=7*86400000,maxPerMinute=10}={}){
 const base=new URL(publicBaseUrl);if(base.username||base.password||base.search||base.hash||base.pathname!=='/'||!(base.protocol==='https:'||(allowLocal&&base.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(base.hostname))))throw Error('public-base-invalid');
 if(!notify){if(!/^https:\/\/qyapi\.weixin\.qq\.com\/cgi-bin\/webhook\/send\?key=[a-f0-9-]+$/i.test(webhook||''))throw Error('webhook-invalid');notify=async text=>{const r=await postJson(webhook,buildWecomPayload(text));return r.status===200&&r.body?.errcode===0?{sent:true}:{sent:false};};}
 const dir=path.resolve(dataDir),recordsDir=path.join(dir,'receipts'),logsDir=path.join(dir,'logs');fs.mkdirSync(recordsDir,{recursive:true});fs.mkdirSync(logsDir,{recursive:true});const rates=new Map();
 const save=(p,x)=>{fs.writeFileSync(p+'.tmp',JSON.stringify(x),{mode:0o600});fs.renameSync(p+'.tmp',p);};
 const reply=(res,status,body)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(body));};
 const receipt=r=>({ok:r.status==='sent',requestId:r.requestId,status:r.status,logUrl:r.status==='sent'&&r.logToken?new URL('/diagnostics/'+r.logToken+'.txt',base).href:null});
 const server=http.createServer(async(req,res)=>{
  try{
   const url=new URL(req.url,'http://localhost'),ip=req.socket.remoteAddress||'unknown',minute=Math.floor(clock()/60000);let rate=rates.get(ip);if(!rate||rate.minute!==minute){rate={minute,count:0};rates.set(ip,rate);}if(++rate.count>maxPerMinute){reply(res,429,{ok:false,status:'failed',code:'rate-limited'});return;}if(rates.size>10000)rates.clear();
   if(req.method==='GET'&&/^\/diagnostics\/[a-f0-9]{64}\.txt$/.test(url.pathname)){
    const file=path.join(logsDir,path.basename(url.pathname));if(!fs.existsSync(file)){reply(res,404,{ok:false});return;}const log=JSON.parse(fs.readFileSync(file,'utf8'));if(clock()-log.createdAt>ttlMs){reply(res,410,{ok:false});return;}
    res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow'});res.end(JSON.stringify(log.bundle,null,2));return;
   }
   const id=url.pathname.replace('/v1/feedback/','');if(req.method==='GET'&&url.pathname.startsWith('/v1/feedback/')&&UUID.test(id)){const p=path.join(recordsDir,id+'.json');if(!fs.existsSync(p)){reply(res,404,{ok:false,status:'failed'});return;}reply(res,200,receipt(JSON.parse(fs.readFileSync(p,'utf8'))));return;}
   if(req.method!=='POST'||url.pathname!=='/v1/feedback'){reply(res,404,{ok:false,status:'failed'});return;}
   if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||'')){reply(res,415,{ok:false,status:'failed'});return;}
   const chunks=[];let bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>32768){reply(res,413,{ok:false,status:'failed'});return;}chunks.push(chunk);}const input=JSON.parse(Buffer.concat(chunks).toString('utf8'));
   if(!UUID.test(input.requestId||'')||!['bug','review'].includes(input.kind)||!CATEGORIES.has(input.category||'')||!/^\d+\.\d+\.\d+$/.test(input.version||'')){reply(res,400,{ok:false,status:'failed'});return;}
   const message=redactNote(input.message).trim();if(!message||message.length>1000){reply(res,400,{ok:false,status:'failed'});return;}
   const logs=input.logs?diagnosticBundle(input.logs.entries,{version:input.version,platform:input.logs.platform}):null;
   const normalized={requestId:input.requestId,kind:input.kind,category:input.category||'',version:input.version,message,logs},fingerprint=crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex'),file=path.join(recordsDir,input.requestId+'.json');
   if(fs.existsSync(file)){const old=JSON.parse(fs.readFileSync(file,'utf8'));if(old.fingerprint!==fingerprint){reply(res,409,{ok:false,status:'failed',code:'id-conflict'});return;}reply(res,old.status==='sent'?200:409,receipt(old));return;}
   const record={requestId:input.requestId,fingerprint,status:'sending',createdAt:clock(),logToken:logs?crypto.randomBytes(32).toString('hex'):null};
   const content=[`【一键投递·${input.kind==='review'?'真实评价':'问题反馈'}】`,`版本：${input.version}`,`分类：${input.category||'未选择'}`,`留言：${message}`,record.logToken?`脱敏日志：${new URL('/diagnostics/'+record.logToken+'.txt',base).href}`:'日志：用户未附加',`回执：${input.requestId}`].join('\n');
   buildWecomPayload(content); // Validate before durable "sending" or any network action.
   save(file,record);
   if(logs)save(path.join(logsDir,record.logToken+'.txt'),{createdAt:clock(),bundle:logs});
   try{const result=await notify(content);record.status=result?.sent===true?'sent':'failed';}catch{record.status='unknown';}save(file,record);reply(res,record.status==='sent'?200:503,receipt(record));
  }catch{if(!res.headersSent)reply(res,400,{ok:false,status:'failed',code:'invalid-request'});else res.end();}
 });
 return server;
}
if(require.main===module){const s=createFeedbackServer({dataDir:process.env.YJT_FEEDBACK_DATA||path.join(__dirname,'data'),publicBaseUrl:process.env.YJT_FEEDBACK_PUBLIC_URL,webhook:process.env.YJT_FEEDBACK_WEBHOOK,allowLocal:process.env.YJT_FEEDBACK_ALLOW_LOCAL==='1'});s.listen(Number(process.env.PORT||8096),'127.0.0.1',()=>console.log('FEEDBACK_RELAY_READY loopback; webhook=server-private'));}
module.exports={createFeedbackServer};
