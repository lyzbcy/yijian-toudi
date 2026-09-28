const fs=require('node:fs');
(async()=>{
const entries=[['tencent','listTencentJobs'],['baidu','listBaiduJobs'],['bytedance','listBytedanceJobs'],['xiaomi','listXiaomiJobs'],['jd','listJdJobs'],['meituan','listMeituanJobs']];
const results=await Promise.all(entries.map(async([name,fn])=>{const start=Date.now();let pages=0;try{const jobs=await require(`../electron/adapters/${name}.cjs`)[fn]({daysBack:30,pageSize:100,recruitType:'social',onProgress:()=>pages++});const unique=new Set(jobs.map(j=>j.id));if(unique.size!==jobs.length)throw Error('duplicate IDs');if(jobs.some(j=>!j.title||!j.url||typeof j.department!=='string'))throw Error('invalid normalized fields');return{company:name,ok:true,jobs:jobs.length,pages,ms:Date.now()-start};}catch(e){return{company:name,ok:false,error:e.message,pages,ms:Date.now()-start};}}));
const report={at:new Date().toISOString(),mode:'anonymous-social-list-read-only',daysBack:30,pageSize:100,results};fs.writeFileSync('test-output/live-jobs-full.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));if(results.some(r=>!r.ok))process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1});
