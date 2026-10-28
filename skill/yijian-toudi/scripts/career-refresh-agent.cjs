'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
async function run({stateFile=path.join(process.env.APPDATA||path.join(os.homedir(),'.config'),'yijian-toudi','state.json'),reconnect=false}={}){
 const s=JSON.parse(fs.readFileSync(stateFile,'utf8').replace(/^\uFEFF/,''));
 if(!Number.isInteger(s.settings?.apiPort)||s.settings.apiPort<1||s.settings.apiPort>65535||!s.settings.apiToken)throw Error('local-agent-api-not-configured');
 const base='http://127.0.0.1:'+s.settings.apiPort,headers={Authorization:'Bearer '+s.settings.apiToken,'Content-Type':'application/json'};
 const status=await fetch(base+'/v1/status',{headers,redirect:'error',signal:AbortSignal.timeout(10000)});if(!status.ok)throw Error('local-agent-auth-failed');
 const v=await status.json();if(v.version!=='0.5.94')throw Error('requires-local-0.5.94');
 const r=await fetch(base+'/v1/career/refresh',{method:'POST',headers,redirect:'error',signal:AbortSignal.timeout(300000),body:JSON.stringify({accountId:s.activeAccountId||'default',profileId:s.resume.activeProfileId||'default',confirmRead:true,reconnect})});
 const result=await r.json();if(!r.ok)throw Error(result.error||'refresh-failed');return result;
}
module.exports={run};
if(require.main===module){const args=process.argv.slice(2);if(args.some(a=>!['--confirm-read','--reconnect'].includes(a))||!args.includes('--confirm-read')){console.error('Usage: node scripts/career-refresh-agent.cjs --confirm-read [--reconnect]');process.exitCode=2;}else run({reconnect:args.includes('--reconnect')}).then(x=>console.log(JSON.stringify(x,null,2))).catch(e=>{console.error(e.message);process.exitCode=1;});}
