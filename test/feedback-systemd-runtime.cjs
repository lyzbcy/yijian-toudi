// Run only on an isolated Linux CI host with systemd and passwordless sudo.
// Executes the actual archived service main. All POSTs reuse a seeded unknown ID;
// no new notification is created and no real webhook credential is supplied.
'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto'),net=require('node:net'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),archiveRoot=path.resolve(process.argv[2]||''),out=path.resolve(process.argv[3]||path.join(root,'.local-data/systemd-runtime.json'));
const token='yjt-feedback-ci-'+crypto.randomBytes(6).toString('hex'),unit=token+'.service';
const code='/opt/'+token,state='/var/lib/'+token,env='/etc/'+token+'.env',unitFile='/etc/systemd/system/'+unit;
const temporary=fs.mkdtempSync(path.join(root,'.local-data/systemd-fixture-'));
let fixturePathsReserved=false;
const report={version:require('../package.json').version,platform:process.platform,ok:false,method:'actual-archived-service-main-under-systemd',systemdRuntime:false,realPublicTLS:false,realWecom:false,noNewNotificationSubmitted:true,checks:[]};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const run=(bin,args,options={})=>cp.execFileSync(bin,args,{encoding:'utf8',timeout:30000,...options}).trim();
const sudo=(bin,args,options)=>run('sudo',['-n',bin,...args],options);
const control=(...args)=>sudo('systemctl',args);
const properties=()=>Object.fromEntries(control('show',unit,'--property=MainPID,ActiveState,SubState,DynamicUser,StateDirectory,ProtectSystem,ProtectHome,NoNewPrivileges,PrivateTmp,Restart,Result').split('\n').map(s=>[s.slice(0,s.indexOf('=')),s.slice(s.indexOf('=')+1)]));
const record=name=>report.checks.push(name);
async function ready(base,oldPid){
 const deadline=Date.now()+30000;let last='';
 while(Date.now()<deadline){try{const p=properties();if(p.ActiveState==='active'&&Number(p.MainPID)>0&&(!oldPid||p.MainPID!==oldPid)){const r=await fetch(base+'/healthz',{signal:AbortSignal.timeout(1500)});const h=await r.json();assert.equal(r.status,200);assert.deepEqual(h,{ok:true,service:'yijian-toudi-feedback',version:report.version});return p;}}catch(error){last=error.message;}await sleep(250);}
 throw Error('systemd-service-not-ready: '+last);
}
async function main(){
 assert.equal(process.platform,'linux');assert(fs.existsSync('/run/systemd/system'),'systemd PID1 required');
 assert(archiveRoot.endsWith('/yijian-toudi-feedback-server'),'independent-archive-root-required');
 assert.equal(JSON.parse(fs.readFileSync(path.join(archiveRoot,'version.json'))).version,report.version);
 for(const target of [code,state,env,unitFile])assert(!fs.existsSync(target),'refuse-existing-fixture: '+target);
 fixturePathsReserved=true;
 const listener=net.createServer();await new Promise(resolve=>listener.listen(0,'127.0.0.1',resolve));const port=listener.address().port;await new Promise(resolve=>listener.close(resolve));const base='http://127.0.0.1:'+port;
 const payload={requestId:crypto.randomUUID(),kind:'bug',category:'other',version:report.version,message:'隔离systemd部署保留未知收据样本',logs:null};
 const fingerprint=crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
 const unknown={requestId:payload.requestId,fingerprint,status:'unknown',createdAt:0,logToken:null};
 fs.writeFileSync(path.join(temporary,'receipt.json'),JSON.stringify(unknown));
 fs.writeFileSync(path.join(temporary,'expired.txt'),JSON.stringify({createdAt:0,bundle:{schema:1}}));
 sudo('cp',['-a',archiveRoot,code]);sudo('chown',['-R','root:root',code]);sudo('chmod',['-R','a+rX',code]);
 sudo('install',['-d','-m','0700',state,state+'/receipts',state+'/logs']);
 sudo('install',['-m','0600',path.join(temporary,'receipt.json'),state+'/receipts/'+payload.requestId+'.json']);
 const expired=state+'/logs/'+'a'.repeat(64)+'.txt';sudo('install',['-m','0600',path.join(temporary,'expired.txt'),expired]);
 const envText=[`YJT_FEEDBACK_PUBLIC_URL=${base}/`,'YJT_FEEDBACK_WEBHOOK=https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key='+'0'.repeat(32),`YJT_FEEDBACK_DATA=${state}`,'YJT_FEEDBACK_ALLOW_LOCAL=1','YJT_FEEDBACK_TRUST_PROXY=1',`PORT=${port}`].join('\n')+'\n';
 fs.writeFileSync(path.join(temporary,'fixture.env'),envText,{mode:0o600});sudo('install',['-m','0600',path.join(temporary,'fixture.env'),env]);
 const template=fs.readFileSync(path.join(code,'support/deploy/yijian-feedback.service'),'utf8');
 const rendered=template.replace('/opt/yijian-toudi-feedback-server',code).replace('/etc/yijian-feedback.env',env).replaceAll('/var/lib/yijian-feedback',state).replace('StateDirectory=yijian-feedback','StateDirectory='+token).replace('/usr/bin/node',process.execPath);
 fs.writeFileSync(path.join(temporary,unit),rendered);sudo('install',['-m','0644',path.join(temporary,unit),unitFile]);
 run('systemd-analyze',['verify',unitFile]);control('daemon-reload');control('start',unit);
 let p=await ready(base);assert.equal(p.DynamicUser,'yes');assert.equal(p.ProtectSystem,'strict');assert.equal(p.ProtectHome,'yes');assert.equal(p.NoNewPrivileges,'yes');assert.equal(p.PrivateTmp,'yes');assert.equal(p.Restart,'on-failure');
 const initialPid=p.MainPID,procStatus=sudo('cat',['/proc/'+initialPid+'/status']);const uid=Number(/^Uid:\s+(\d+)/m.exec(procStatus)?.[1]);assert(uid>0,'service must run as non-root DynamicUser');
 const writable=cp.spawnSync('sudo',['-n','--user=#'+uid,'test','-w',code+'/support/feedback-server.cjs']);assert.equal(writable.status,1,'dynamic user cannot rewrite root-owned code');
 record('Actual archived service starts, reports exact version and runs as a non-root DynamicUser with original hardening');
 assert.equal(cp.spawnSync('sudo',['-n','test','-e',expired]).status,1);assert.equal(JSON.parse(sudo('cat',[state+'/receipts/'+payload.requestId+'.json'])).status,'unknown');
 record('Real startup writes the protected data directory and removes expired log while preserving unknown receipt');
 const checkReceipt=async()=>{const response=await fetch(base+'/v1/feedback/'+payload.requestId,{signal:AbortSignal.timeout(2000)});assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:false,requestId:payload.requestId,status:'unknown',logUrl:null});};
 await checkReceipt();
 const post=async body=>{const r=await fetch(base+'/v1/feedback',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(2000)});return{status:r.status,body:await r.json()};};
 let reply=await post(payload);assert.equal(reply.status,409);assert.equal(reply.body.status,'unknown');
 reply=await post({...payload,message:'同ID不同内容'});assert.equal(reply.status,409);assert.equal(reply.body.code,'id-conflict');record('Unknown receipt query/retry and ID conflict do not trigger a new notification');
 control('restart',unit);p=await ready(base,initialPid);await checkReceipt();record('Actual systemctl restart creates a new process and preserves unknown receipt');
 const beforeCrash=p.MainPID;sudo('kill',['-KILL',beforeCrash]);p=await ready(base,beforeCrash);await checkReceipt();assert.equal(JSON.parse(sudo('cat',[state+'/receipts/'+payload.requestId+'.json'])).status,'unknown');record('Real SIGKILL is recovered by Restart=on-failure and persistent receipt survives');
 const began=Date.now();control('stop',unit);const stopped=properties();assert.equal(stopped.ActiveState,'inactive');assert.equal(stopped.Result,'success');assert.equal(stopped.MainPID,'0');report.gracefulStopMs=Date.now()-began;assert(report.gracefulStopMs<20000);record('Actual systemctl stop exits successfully inside the configured stop budget');
 report.systemdRuntime=true;report.ok=true;report.propertiesBeforeStop=p;report.serviceUid=uid;report.archivedCodeWasNotWritable=true;
}
main().catch(error=>{report.error=error.message;process.exitCode=1;try{report.systemdStatus=properties();report.journal=sudo('journalctl',['-u',unit,'--no-pager','-n','40']);}catch{}}).finally(()=>{
 if(process.platform==='linux'&&fixturePathsReserved){
  try{control('stop',unit);}catch{}
  // Exact generated absolute targets only, with no preexisting target accepted.
  for(const file of [unitFile,env])try{sudo('rm',['-f','--',file]);}catch{}
  for(const dir of [code,state,'/var/lib/private/'+token])try{if(!/^\/(opt|var\/lib(?:\/private)?)\/yjt-feedback-ci-[a-f0-9]{12}$/.test(dir))throw Error('cleanup-path-invalid');sudo('rm',['-rf','--',dir]);}catch{}
  try{control('daemon-reload');control('reset-failed',unit);}catch{}
 }
 fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
});
