#!/usr/bin/env node
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{publicEndpoint,readPublicDefaults}=require('../electron/public-defaults.cjs');
function run(args,{root=path.resolve(__dirname,'..')}={}){
 const file=path.join(root,'electron/public-defaults.json'),[mode,value,...extra]=args;
 if(extra.length)throw Error('feedback-config-arguments');
 if(mode==='--check-public'||mode==='--check-candidate'){
  if(value!==undefined)throw Error('feedback-config-arguments');
  const data=readPublicDefaults(file,{requireConfigured:mode==='--check-public'});return{ok:true,configured:!!data.feedbackEndpoint,scope:'bundled-public-address-only; no live DNS/TLS/delivery probe'};
 }
 if(!['--set','--clear-candidate'].includes(mode)||mode==='--clear-candidate'&&value!==undefined)throw Error('feedback-config-arguments');
 const endpoint=mode==='--set'?publicEndpoint(value):'',body=JSON.stringify({schema:1,feedbackEndpoint:endpoint},null,2)+'\n';
 const temp=file+'.tmp-'+crypto.randomUUID();try{fs.writeFileSync(temp,body,{flag:'wx'});readPublicDefaults(temp);fs.renameSync(temp,file);}finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}
 return{ok:true,configured:!!endpoint,scope:'public-address-written; no private webhook and no network'};
}
if(require.main===module){try{const r=run(process.argv.slice(2));console.log('PUBLIC_FEEDBACK_CONFIG '+JSON.stringify(r));}catch(e){console.error('PUBLIC_FEEDBACK_CONFIG '+e.message);process.exitCode=1;}}
module.exports={run};
