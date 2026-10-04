// Actual Caddy HTTPS -> archived Compose relay, with an isolated local CA.
// Reads only a seeded receipt/log; no new notification or external message.
'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto'),https=require('node:https'),net=require('node:net'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),deploy=path.resolve(process.argv[2]||''),out=path.resolve(process.argv[3]||path.join(root,'.local-data/caddy-runtime.json'));
const name='yjt-caddy-ci-'+crypto.randomBytes(6).toString('hex'),tmp=fs.mkdtempSync(path.join(root,'.local-data/caddy-fixture-'));
const report={version:require('../package.json').version,platform:process.platform,ok:false,caddyRuntime:false,localTrustedTLS:false,realPublicTLS:false,realWecom:false,noNewNotificationSubmitted:true,checks:[]};
const run=(bin,args,options={})=>cp.execFileSync(bin,args,{encoding:'utf8',timeout:30000,...options}).trim();
const compose=(...args)=>run('docker',['compose',...args],{cwd:deploy});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let containerOwned=false,logOwned=false,logFile;
function request(port,{ca,path:route='/healthz',headers={}}={}){
 return new Promise((resolve,reject)=>{const req=https.request({hostname:'localhost',port,path:route,method:'GET',lookup:(_host,_options,callback)=>callback(null,'127.0.0.1',4),ca,rejectUnauthorized:true,timeout:2500,headers},res=>{const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('error',reject);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks).toString('utf8')}));});req.on('error',reject);req.on('timeout',()=>req.destroy(Error('caddy-test-request-timeout')));req.end();});
}
async function waitRelay(){for(let i=0;i<80;i++){try{const r=await fetch('http://127.0.0.1:8096/healthz',{signal:AbortSignal.timeout(1000)});if(r.ok)return;}catch{}await sleep(250);}throw Error('compose-relay-not-ready');}
async function main(){
 assert.equal(process.platform,'linux');assert(deploy.endsWith('/yijian-toudi-feedback-server/support/deploy'));assert(fs.existsSync(path.join(deploy,'feedback.env')));
 const exists=cp.spawnSync('docker',['inspect',name]);assert.notEqual(exists.status,0,'refuse-existing-container');
 const listener=net.createServer();await new Promise(resolve=>listener.listen(0,'127.0.0.1',resolve));const port=listener.address().port;await new Promise(resolve=>listener.close(resolve));
 const template=fs.readFileSync(path.join(deploy,'Caddyfile.example'),'utf8');
 const config='{\n admin off\n auto_https disable_redirects\n}\n'+template.replace('feedback.example.invalid {',`https://localhost:${port} {\n bind 127.0.0.1\n tls internal`);
 const configPath=path.join(tmp,'Caddyfile');fs.writeFileSync(configPath,config);
 run('docker',['run','--detach','--name',name,'--network','host','--mount',`type=bind,source=${configPath},target=/etc/caddy/Caddyfile,readonly`,'caddy:2']);containerOwned=true;
 const caFile=path.join(tmp,'local-ca.crt');let ca;
 for(let i=0;i<80;i++){const copy=cp.spawnSync('docker',['cp',name+':/data/caddy/pki/authorities/local/root.crt',caFile]);if(copy.status===0){ca=fs.readFileSync(caFile);try{const h=await request(port,{ca});if(h.status===200){assert.deepEqual(JSON.parse(h.body),{ok:true,service:'yijian-toudi-feedback',version:report.version});break;}}catch{}}await sleep(250);}
 assert(ca,'isolated-Caddy-CA-not-created');const health=await request(port,{ca});assert.equal(health.status,200);assert.equal(JSON.parse(health.body).version,report.version);
 let certificateRejected=false;try{await request(port);}catch(error){certificateRejected=/CERT|SELF_SIGNED|UNABLE_TO_VERIFY/.test(error.code||'');report.defaultTrustError=error.code;}assert(certificateRejected,'untrusted-local-CA-must-not-be-silently-accepted');
 report.checks.push('Actual Caddy serves HTTPS health to the real archived relay; explicit local CA succeeds and default trust rejects the test CA');
 const logToken=crypto.randomBytes(32).toString('hex');logFile=path.join(deploy,'feedback-data/logs',logToken+'.txt');assert(!fs.existsSync(logFile),'refuse-existing-test-log');
 const bundle={schema:1,version:report.version,platform:'linux',entries:[{type:'deployment-proxy-sample'}]};const fixture=path.join(tmp,'log.txt');fs.writeFileSync(fixture,JSON.stringify({createdAt:Date.now(),bundle}));
 run('sudo',['-n','install','-m','0600','-o','1000','-g','1000',fixture,logFile]);logOwned=true;
 const diagnostic=await request(port,{ca,path:'/diagnostics/'+logToken+'.txt'});assert.equal(diagnostic.status,200);assert.deepEqual(JSON.parse(diagnostic.body),bundle);assert.match(diagnostic.headers['content-type'],/^text\/plain/);assert.equal(diagnostic.headers['x-content-type-options'],'nosniff');assert.match(diagnostic.headers['x-robots-tag'],/noindex/);assert.equal(diagnostic.headers['cache-control'],'no-store');
 report.checks.push('Real HTTPS proxy preserves diagnostic text, nosniff, noindex and no-store headers');
 compose('restart');await waitRelay();
 const id='11111111-1111-4111-8111-111111111111';
 for(let i=0;i<11;i++){const r=await request(port,{ca,path:'/v1/feedback/'+id,headers:{'X-Forwarded-For':'192.0.2.'+(i+1)}});assert.equal(r.status,i<10?200:429,'forwarded-ip-rate-check '+i);if(i<10){const receipt=JSON.parse(r.body);assert.equal(receipt.status,'unknown');assert.equal(receipt.logUrl,null);}}
 report.checks.push('Eleven HTTPS receipt reads with eleven forged forwarding IPs share one actual-peer limit: ten allowed, eleventh rejected');
 report.forwardedClientHeadersOverridden=true;report.rateLimit={allowed:10,rejected:1};report.caddyRuntime=true;report.localTrustedTLS=true;report.ok=true;
}
main().catch(error=>{report.error=error.message;process.exitCode=1;if(containerOwned)try{report.caddyLog=run('docker',['logs','--tail','30',name],{stdio:['ignore','pipe','pipe']});}catch{}}).finally(()=>{
 if(containerOwned)try{run('docker',['rm','-f','-v',name]);}catch{}
 if(logOwned)try{assert(logFile.startsWith(deploy+'/feedback-data/logs/'));run('sudo',['-n','rm','-f','--',logFile]);}catch{}
 fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
});
