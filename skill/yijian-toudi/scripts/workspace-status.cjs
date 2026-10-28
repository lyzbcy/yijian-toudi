#!/usr/bin/env node
'use strict';
const http=require('node:http');
async function readWorkspaceStatus(env=process.env){
 const u=new URL(env.YJTD_BASE_URL||'http://127.0.0.1:53147'),token=env.YJTD_API_TOKEN;
 if(u.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(u.hostname)||u.username||u.password||u.search||u.hash||!['','/'].includes(u.pathname))throw Error('loopback-base-required');
 if(typeof token!=='string'||!token||/[\r\n]/.test(token))throw Error('private-token-required');
 const get=p=>new Promise((resolve,reject)=>{const q=http.get(new URL(p,u),{headers:{Authorization:'Bearer '+token}},r=>{let s='';r.setEncoding('utf8');r.on('data',c=>{s+=c;if(s.length>128*1024)q.destroy(Error('diagnostics-too-large'));});r.on('end',()=>{try{resolve({http:r.statusCode,data:JSON.parse(s)})}catch{reject(Error('invalid-diagnostics'))}});r.on('error',()=>reject(Error('diagnostics-interrupted')))});q.setTimeout(5000,()=>q.destroy(Error('local-api-timeout')));q.on('error',()=>reject(Error('local-api-unreachable')));});
 const status=await get('/v1/status');if(status.http!==200)return{ok:false,http:status.http,reason:'runtime-token-rejected'};
 const expected=require('../version.json').version;if(status.data.version!==expected)return{ok:false,reason:'version-mismatch',appVersion:status.data.version,skillVersion:expected};
 const r=await get('/v1/diagnostics/workspaces');if(r.http!==200)return{ok:false,http:r.http,reason:'workspace-diagnostics-unavailable'};
 return{ok:r.data.ok===true,version:expected,diagnostics:r.data.diagnostics};
}
if(require.main===module)readWorkspaceStatus().then(r=>{console.log(JSON.stringify(r));process.exitCode=r.ok?0:1}).catch(()=>{console.error('WORKSPACE_STATUS_FAILED; check loopback URL and private Token');process.exitCode=1});
module.exports={readWorkspaceStatus};
