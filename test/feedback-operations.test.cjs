const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {createFeedbackServer,cleanupExpiredLogs}=require('../support/feedback-server.cjs');
const payload=()=>({requestId:crypto.randomUUID(),version:require('../package.json').version,kind:'bug',category:'',message:'部署运行验收样本',logs:null});
async function relay(t,options={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'yjt-feedback-operations-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const server=createFeedbackServer({dataDir:dir,publicBaseUrl:'http://127.0.0.1:8096/',allowLocal:true,notify:async()=>({sent:true}),...options});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 return{dir,server,url:`http://127.0.0.1:${server.address().port}`};
}
test('health checks expose only service/version and do not exhaust client send limits',async t=>{
 let notified=0;const f=await relay(t,{maxPerMinute:1,notify:async()=>{notified++;return{sent:true};}});
 for(let i=0;i<3;i++){const response=await fetch(f.url+'/healthz');assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true,service:'yijian-toudi-feedback',version:require('../package.json').version});}
 const response=await fetch(f.url+'/v1/feedback',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload())});assert.equal(response.status,200);assert.equal(notified,1);
});
test('forwarded client IP is ignored by default and isolates limits only for explicitly trusted loopback proxy',async t=>{
 for(const trustProxy of [false,true]){
  const f=await relay(t,{trustProxy,maxPerMinute:1});
  const send=ip=>fetch(f.url+'/v1/feedback',{method:'POST',headers:{'Content-Type':'application/json','X-Forwarded-For':ip},body:JSON.stringify(payload())});
  assert.equal((await send('192.0.2.1')).status,200);
  assert.equal((await send('192.0.2.2')).status,trustProxy?200:429);
  if(trustProxy){assert.equal((await send('forged, 192.0.2.1')).status,429);assert.equal((await send('invalid')).status,200);assert.equal((await send('another-invalid')).status,429);}
 }
});
test('expired structural logs are deleted while fresh/malformed/unrelated files and every receipt remain',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'yjt-feedback-cleanup-')),logs=path.join(dir,'logs'),receipts=path.join(dir,'receipts');
 try{
  fs.mkdirSync(logs);fs.mkdirSync(receipts);
  const expired=path.join(logs,'a'.repeat(64)+'.txt'),fresh=path.join(logs,'b'.repeat(64)+'.txt'),broken=path.join(logs,'c'.repeat(64)+'.txt');
  fs.writeFileSync(expired,JSON.stringify({createdAt:0,bundle:{schema:1}}));fs.writeFileSync(fresh,JSON.stringify({createdAt:90,bundle:{schema:1}}));fs.writeFileSync(broken,'broken');fs.writeFileSync(path.join(logs,'unrelated.txt'),'keep');
  const unknown=path.join(receipts,crypto.randomUUID()+'.json');fs.writeFileSync(unknown,JSON.stringify({status:'unknown',createdAt:0}));
  assert.deepEqual(cleanupExpiredLogs(logs,{clock:()=>100,ttlMs:50}),{removed:1,skipped:1});
  assert.equal(fs.existsSync(expired),false);assert.equal(fs.existsSync(fresh),true);assert.equal(fs.readFileSync(broken,'utf8'),'broken');assert.equal(fs.readFileSync(path.join(logs,'unrelated.txt'),'utf8'),'keep');assert.equal(JSON.parse(fs.readFileSync(unknown)).status,'unknown');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('real relay restart retains unknown-send receipt and never sends a second notification',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'yjt-feedback-restart-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 let notified=0;const p=payload();
 const start=async()=>{const server=createFeedbackServer({dataDir:dir,publicBaseUrl:'http://127.0.0.1:8096/',allowLocal:true,notify:async()=>{notified++;throw Error('unknown-test-result');}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return{server,url:`http://127.0.0.1:${server.address().port}`};};
 const first=await start();
 try{const response=await fetch(first.url+'/v1/feedback',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(p)});assert.equal((await response.json()).status,'unknown');}finally{await new Promise(resolve=>first.server.close(resolve));}
 const next=await start();
 try{const receipt=await fetch(next.url+'/v1/feedback/'+p.requestId);assert.equal((await receipt.json()).status,'unknown');const response=await fetch(next.url+'/v1/feedback',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(p)});assert.equal(response.status,409);assert.equal((await response.json()).status,'unknown');assert.equal(notified,1);}finally{await new Promise(resolve=>next.server.close(resolve));}
});
