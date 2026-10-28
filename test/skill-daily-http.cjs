'use strict';
// Real CLI/HTTP/production controller/store, with an explicit network-free SAMPLE runner.
// No recruitment page, browser login, notification or application is contacted.
const fs=require('fs'),path=require('path'),os=require('os'),crypto=require('crypto'),{spawn}=require('child_process');
const {JsonStore}=require('../electron/store.cjs'),{AgentServer}=require('../electron/agent-server.cjs'),{BossBatchController}=require('../electron/boss-control.cjs');
const {unpack,REQUIRED}=require('../skill/yijian-toudi/scripts/package-files.cjs');
const root=path.resolve(__dirname,'..'),version=require('../package.json').version;
const output=path.resolve(process.env.SKILL_HTTP_TEST_OUTPUT||path.join(root,'test-output/skill-daily-http'));
const privateRoot=fs.mkdtempSync(path.join(os.tmpdir(),'skill-http-sample-'));
const archive=process.env.SKILL_HTTP_TEST_ARCHIVE||path.join(root,'release',`yijian-toudi-skill-${version}.tar.gz`);
const checks=[],record=(name,pass,detail)=>checks.push({name,pass:!!pass,detail});
let effectiveRoot=path.join(root,'skill/yijian-toudi'),archiveSHA=null,packageFiles=0;
if(fs.existsSync(archive)){
 const bytes=fs.readFileSync(archive),members=unpack(bytes,version);archiveSHA=crypto.createHash('sha256').update(bytes).digest('hex');packageFiles=members.size;
 effectiveRoot=path.join(privateRoot,'installed/yijian-toudi');
 for(const [name,b]of members){const p=path.resolve(effectiveRoot,name);if(!p.startsWith(effectiveRoot+path.sep))throw Error('SAMPLE extraction outside root');fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,b);if(!b.equals(fs.readFileSync(path.join(root,'skill/yijian-toudi',name))))throw Error('Immutable package/source changed: '+name);}
 record('actual complete Skill archive/source match',REQUIRED.every(name=>members.has(name)),{version,files:members.size,sha256:archiveSHA});
}else if(process.env.SKILL_HTTP_TEST_ARCHIVE)throw Error('Explicit Skill archive missing');
else record('source CLI fallback explicitly not packaged',true,{version,packaged:false});
async function cli(file,env){return new Promise((resolve,reject)=>{let stdout='',stderr='';const child=spawn(process.execPath,[path.join(effectiveRoot,'scripts',file)],{env:{...process.env,...env,YJTD_SKILL_AUTO_UPDATE:'0'},windowsHide:true});child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);child.once('error',reject);const timer=setTimeout(()=>reject(Error('Owned SAMPLE CLI timeout; retain handle PID='+child.pid)),25000);child.once('close',exit=>{clearTimeout(timer);let json;try{json=JSON.parse(stdout.trim())}catch{}resolve({exit,stdout:stdout.trim(),stderr:stderr.trim(),json});});});}
async function withServer(name,fn){
 const dir=path.join(privateRoot,name),store=new JsonStore(path.join(dir,'app'));store.init();store.update(s=>{s.settings.apiToken='SAMPLE-local-token';return s});
 let endReason='completed',alterAck=false,startCalls=0,runnerCalls=0;
 const controller=new BossBatchController({store,getBridge:async()=>({getBoundAccount:()=> 'default'}),runnerFactory:opts=>({applied:[],previewed:[],fails:0,stopReason:endReason,run:async function(){runnerCalls++;if(opts.dryRun)this.previewed=[{company:'SAMPLE only'}];},stop:function(reason){this.stopReason=reason;}})});
 const api=new AgentServer({store,onCommand:async()=>({}),bossControl:{accounts:async()=>({accounts:[{id:'default'}]}),status:async()=>controller.status(),start:async body=>{startCalls++;const r=await controller.start(body);return alterAck&&r.started?{...r,dryRun:!r.dryRun}:r;}}});
 const port=await api.start(0),stateDir=path.join(dir,'skill-state');fs.mkdirSync(stateDir,{recursive:true});
 const env={YJTD_API_TOKEN:'SAMPLE-local-token',YJTD_BASE_URL:`http://127.0.0.1:${port}`,YJTD_STATE_DIR:stateDir,YJTD_ACCOUNT_ID:'default',YJTD_TARGET:'1'};
 try{await fn({store,controller,env,stateDir,calls:()=>({startCalls,runnerCalls}),setReason:r=>{endReason=r},alter:()=>{alterAck=true}});}finally{await controller.done;await api.stop();}
}
(async()=>{
 const env={YJTD_STATE_DIR:path.join(privateRoot,'use-state')},use=await cli('use.cjs',env);
 record('actual use CLI resolves this invocation/root/version',use.exit===0&&use.json?.version===version&&use.json?.root===fs.realpathSync(effectiveRoot),{exit:use.exit,version:use.json?.version,packaged:Boolean(archiveSHA)});
 await withServer('normal',async x=>{
  const dry=await cli('daily-boss.cjs',{...x.env,YJTD_DRY_RUN:'1'});await x.controller.done;
  record('real dryRun CLI/API confirms mode and UUID runId',dry.exit===0&&dry.json?.dryRun===true&&dry.json.result?.dryRun===true&&typeof dry.json.result?.runId==='string',{exit:dry.exit,result:dry.json});
  record('dryRun does not write daily marker or applied ledger',fs.readdirSync(x.stateDir).length===0&&x.store.get().accounts[0].boss.applied.length===0);
  const live=await cli('daily-boss.cjs',x.env);await x.controller.done;
  record('formal SAMPLE request reaches real controller/store once',live.exit===0&&live.json?.result?.dryRun===false&&x.calls().startCalls===2,{exit:live.exit,requested:1,applied:0,externalOperations:0});
  const names=fs.readdirSync(x.stateDir),marker=JSON.parse(fs.readFileSync(path.join(x.stateDir,names[0])));
  record('date marker persists complete real controller receipt',names.length===1&&marker.state==='started'&&marker.result.runId===x.controller.status().runId&&marker.result.dryRun===false);
  const repeat=await cli('daily-boss.cjs',x.env);
  record('same day repeat never emits another start POST',repeat.exit===0&&repeat.json?.skipped==='already-triggered-today'&&x.calls().startCalls===2,{exit:repeat.exit,skipped:repeat.json?.skipped});
 });
 await withServer('restricted',async x=>{
  x.setReason('access-restricted');const first=await cli('daily-boss.cjs',x.env);await x.controller.done;
  record('production controller records restricted SAMPLE stop',first.exit===0&&x.controller.status().requiresReview===true&&x.controller.status().stopReason==='access-restricted');
  const repeat=await cli('daily-boss.cjs',x.env);
  record('real CLI honours controller review gate without another POST',repeat.exit===0&&repeat.json?.skipped==='requires-review'&&x.calls().startCalls===1,{skipped:repeat.json?.skipped,externalOperations:0});
 });
 await withServer('unknown',async x=>{
  x.alter();const first=await cli('daily-boss.cjs',x.env);await x.controller.done;
  record('wrong-mode HTTP receipt never reported as start success',first.exit===1&&first.stderr.includes('confirm')&&!first.json,{exit:first.exit,stderr:first.stderr});
  const file=fs.readdirSync(x.stateDir)[0],original=fs.readFileSync(path.join(x.stateDir,file));
  record('bad receipt persists starting and real backend remains no-review',JSON.parse(original).state==='starting'&&x.controller.status().requiresReview===false);
  // Add an explicitly old-dated owned SAMPLE record: does not alter the host clock.
  fs.writeFileSync(path.join(x.stateDir,'2000-01-01-default.json'),original);
  const repeat=await cli('daily-boss.cjs',x.env);
  record('old-date unknown pauses new day trigger even when API is idle',repeat.exit===0&&repeat.json?.skipped==='unconfirmed-start'&&repeat.json.marker==='2000-01-01-default.json'&&x.calls().startCalls===1,{exit:repeat.exit,result:repeat.json,clockChanged:false});
 });
 const report={at:new Date().toISOString(),version,packaged:Boolean(archiveSHA),archiveSHA,packageFiles,scope:'Actual standalone Skill Node CLI + production AgentServer/BossBatchController/JsonStore; network-free SAMPLE runner; not Electron login/official applications/cloud SSH deployment',externalOperations:0,privateFixturesRetained:true,checks,pass:checks.filter(c=>c.pass).length,total:checks.length};
 fs.mkdirSync(output,{recursive:true});fs.writeFileSync(output+'/report.json',JSON.stringify(report,null,2)+'\n');
 console.log(`SKILL_HTTP ${report.pass}/${report.total}; version=${version}; actualArchive=${report.packaged}; externalOperations=0; officialApplied=0`);
 if(report.pass!==report.total)process.exitCode=1;
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
