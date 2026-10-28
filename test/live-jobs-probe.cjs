const fs = require('node:fs');
async function probe(name, fn) {
 const start=Date.now();
 try { return {company:name,ok:true,...await fn(),ms:Date.now()-start}; }
 catch(e) {return {company:name,ok:false,error:e.message,ms:Date.now()-start};}
}
(async()=>{
 const results=await Promise.all([
 probe('tencent',async()=>{const p=await require('../electron/adapters/tencent.cjs').fetchJson('https://careers.tencent.com/tencentcareer/api/post/Query?pageIndex=1&pageSize=2&language=zh-cn&area=cn');if(p.Code!==200||!Array.isArray(p.Data?.Posts))throw Error('invalid payload');return{rows:p.Data.Posts.length,total:p.Data.Count};}),
 probe('baidu',async()=>{const a=require('../electron/adapters/baidu.cjs');const p=a.extractInitialData(await a.fetchText('https://talent.baidu.com/jobs/social-list'));if(!Array.isArray(p?.listData?.listDetailData))throw Error('invalid page');return {rows:p.listData.listDetailData.length};}),
 ...[['jd','https://zhaopin.jd.com/web/job/job_list',{pageNo:1,pageSize:2,jobType:3}],['meituan','https://zhaopin.meituan.com/api/official/job/getJobList',{pageNo:1,pageSize:2,cityList:[],categoryList:[]}]].map(([name,url,body])=>probe(name,async()=>{const r=await require(`../electron/adapters/${name}.cjs`).postJson(url,body);const rows=Array.isArray(r.json)?r.json:(r.json?.data?.list||r.json?.data||r.json?.list);if(r.status!==200||!Array.isArray(rows))throw Error(`HTTP ${r.status}; list missing`);return{rows:rows.length};})),
 ...[['bytedance','jobs.bytedance.com'],['xiaomi','xiaomi.jobs.f.mioffice.cn']].map(([name,host])=>probe(name,async()=>{const a=require(`../electron/adapters/${name}.cjs`);const t=await a.request('POST',`https://${host}/api/v1/csrf/token`,{body:{portal_entrance:1}});const r=await a.request('POST',`https://${host}/api/v1/search/job/posts`,{body:{keyword:'',limit:2,offset:0},cookie:t.cookies});if(r.status!==200||!Array.isArray(r.json?.data?.job_post_list))throw Error(`HTTP ${r.status}; list missing`);return{rows:r.json.data.job_post_list.length,total:r.json.data.count};}))
 ]);
 const report={at:new Date().toISOString(),mode:'anonymous-read-only-first-page',results};
 fs.mkdirSync('test-output',{recursive:true});fs.writeFileSync('test-output/live-jobs-probe.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
})().catch(e=>{console.error(e);process.exitCode=1});
