'use strict';
const {createHash}=require('node:crypto');
const HOME='https://xiaoyuan.zhaopin.com/';
const {KimiDaemonClient}=require('./kimi-daemon-client.cjs');
function fail(s,status=400){throw Object.assign(Error(s),{status});}
function txt(v,n=300){if(typeof v!=='string'||!v.trim()||v.length>n)fail('invalid-campus-text');return v.trim();}
function pageUrl(v){let u;try{u=new URL(v);}catch{fail('invalid-campus-url');}if(u.origin!=='https://xiaoyuan.zhaopin.com'||u.username||u.password)fail('invalid-campus-url');u.search='';u.hash='';return u.href;}
const digest=s=>createHash('sha256').update(s).digest('hex').slice(0,24);
// Fixed observed selectors; no Cookie/storage/account/resume/credential reads.
function readCampusPage(){
 if(location.origin!=='https://xiaoyuan.zhaopin.com')return JSON.stringify({status:'wrong-page',rows:[]});
 const dialogs=[...document.querySelectorAll('[role=dialog]')].filter(e=>e.getBoundingClientRect().width>0);
 if(dialogs.some(e=>/隐私政策|隐私策略|用户协议/.test(e.innerText)&&/同意/.test(e.innerText)))return JSON.stringify({status:'waiting-consent',rows:[]});
 if(dialogs.some(e=>/验证码|滑块|验证/.test(e.innerText)))return JSON.stringify({status:'waiting-verification',rows:[]});
 const detailId=location.pathname.match(/^\/job\/(CCL?\d{4,20}J\d{4,20})\/?$/)?.[1];
 if(detailId&&document.querySelector('.job-banner__name'))return JSON.stringify({status:'job-detail',sourceUrl:location.origin+location.pathname,capturedAt:new Date().toISOString(),job:{id:detailId,title:(document.querySelector('.job-banner__name h1')||document.querySelector('.job-banner__name')).textContent.trim().slice(0,300),company:document.querySelector('.company-info__name')?.textContent.trim()||'',description:document.querySelector('.job-info__desc')?.innerText.slice(0,16000)||'',buttons:[...document.querySelectorAll('.job-apply')].filter(e=>e.getBoundingClientRect().width).map(e=>e.textContent.trim())},submittedByInspection:false,rows:[]});
 const rows=[...document.querySelectorAll('.position-card')].slice(0,100).map(e=>{let id='';try{id=JSON.parse(e.getAttribute('data-sensors-exposure-option')||'{}').properties?.jdno||'';}catch{}return {id,title:e.querySelector('.position-card__job-name')?.textContent.trim()||'',company:e.querySelector('.position-card__company__name')?.textContent.trim()||'',city:e.querySelector('.position-card__company__work-city')?.textContent.trim()||'',tags:[...e.querySelectorAll('.position-card__tags__item')].map(x=>x.textContent.trim()),companyTags:[...e.querySelectorAll('.position-card__company__tabs-item')].map(x=>x.textContent.trim()),salary:e.querySelector('.position-card__salary')?.textContent.trim()||''};}).filter(r=>r.id&&r.title&&r.company);
 return JSON.stringify({status:rows.length?'ready':'page-not-supported',sourceUrl:location.origin+location.pathname,capturedAt:new Date().toISOString(),rows,complete:false});
}
function normalizeCampus(body){
 if(!body||typeof body!=='object'||Array.isArray(body))fail('invalid-campus-body');const sourceUrl=pageUrl(body.sourceUrl),time=Date.parse(body.capturedAt);
 if(!Number.isFinite(time)||time>Date.now()+60000||Date.now()-time>7*86400000)fail('invalid-campus-time');
 if(body.status!=='ready'||!Array.isArray(body.rows)||!body.rows.length||body.rows.length>100)fail('campus-observed-rows-required');
 const rows=body.rows.map(r=>{if(!r||!/^CCL?\d{4,20}J\d{4,20}$/.test(r.id))fail('invalid-campus-job-id');const companyName=txt(r.company),title=txt(r.title),city=typeof r.city==='string'&&r.city.length<200?r.city.trim():'';
 if(!Array.isArray(r.tags)||!Array.isArray(r.companyTags)||[...r.tags,...r.companyTags].some(x=>typeof x!=='string'||x.length>120)||r.tags.length>12||r.companyTags.length>12)fail('invalid-campus-tags');
 return {id:'zhilian-campus-'+r.id,sourceId:'zhilian-campus',sourceJobId:r.id,companyId:'zhilian-company-'+digest(companyName.normalize('NFKC').replace(/\s+/g,'')),companyName,title,city:city||'待核验',education:r.tags.find(x=>/本科|硕士|博士|大专|学历/.test(x))||'待核验',experience:r.tags.find(x=>/应届|在校|经验/.test(x))||'待核验',salary:typeof r.salary==='string'?r.salary.slice(0,120):'',postedAt:'',department:'待核验',jobType:'校招',type:'校招',source:'智联校园 · 可见页',sourceUrl,url:HOME+'job/'+encodeURIComponent(r.id),applicationUrl:'',recordKind:'observed-job',capturedAt:new Date(time).toISOString(),tags:['智联校园','入口待核验',...r.tags],companyTags:r.companyTags,applicationRoute:'unknown',requiresReview:true,reviewFlags:['核对企业完整主体、具体网申入口与资格','平台岗位不自动认定企业官网ATS'],summary:[title,...r.tags,...r.companyTags].join(' · '),favorite:false,match:0};});
 if(new Set(rows.map(r=>r.id)).size!==rows.length)fail('duplicate-campus-row');return {sourceUrl,capturedAt:new Date(time).toISOString(),rows};
}
function importCampus(state,body){
 const batch=normalizeCampus(body);const jobs=structuredClone(state.jobs||[]),companies=structuredClone(state.companies||[]);let added=0,updated=0,stale=0,preservedEdits=0;
 for(const incoming of batch.rows){const sourceSnapshot=Object.fromEntries(['title','city','education','experience','salary','summary','url'].map(k=>[k,incoming[k]]));const old=jobs.find(j=>j.id===incoming.id);if(old){if(Date.parse(old.capturedAt)>=Date.parse(incoming.capturedAt)){stale++;continue;}const snapshot=old.sourceSnapshot||{};for(const k of ['title','city','education','experience','salary','summary','url'])if(Object.hasOwn(snapshot,k)&&old[k]!==snapshot[k]){incoming[k]=old[k];preservedEdits++;}const favorite=old.favorite;Object.assign(old,incoming,{favorite,sourceSnapshot});updated++;}else{jobs.push({...incoming,sourceSnapshot});added++;}
 if(!companies.some(c=>c.id===incoming.companyId))companies.push({id:incoming.companyId,name:incoming.companyName,short:incoming.companyName.slice(0,2),portal:HOME,url:HOME,tags:['智联校园','来源主体待核验'],color:'#426eff',sourceId:'zhilian-campus',adapterStatus:'source-only',capabilities:{jobs:'manual',login:'manual',resume:'unsupported',apply:'manual',status:'unsupported',batchApply:false},enabled:false});}
 state.jobs=jobs;state.companies=companies;state.jobSources||={};state.jobSources['zhilian-campus']={sourceUrl:batch.sourceUrl,capturedAt:batch.capturedAt,observedCount:batch.rows.length,complete:false,mode:'browser-agent-assisted'};
 return {source:'zhilian-campus',added,updated,stale,preservedEdits,count:batch.rows.length,complete:false,websiteSubmissions:0};
}
function inspectCampus(o){
 if(!o||typeof o!=='object'||Array.isArray(o)||typeof o.text!=='string'||o.text.length>80000||!Array.isArray(o.buttons)||o.buttons.length>200||o.buttons.some(x=>typeof x!=='string'||x.length>200))fail('invalid-campus-observation');
 const url=pageUrl(o.url),b=o.buttons.map(x=>x.replace(/\s/g,''));let status='unknown';
 if(/隐私政策|用户协议/.test(o.text)&&b.includes('同意'))status='waiting-consent';
 else if(/验证码|滑块|拼图/.test(o.text))status='waiting-verification';
 else if(b.includes('登录')||/\/login/i.test(new URL(url).pathname))status='waiting-login';
 else if(b.some(x=>/确认提交|提交申请|提交网申/.test(x)))status='confirmation';
 else if(/申请表|网申|志愿/.test(o.text)&&b.some(x=>/保存|下一步|提交/.test(x)))status='application-form';
 else if(b.some(x=>/已投递|已申请/.test(x)))status='already-applied';
 else if(b.some(x=>/立即投递|申请职位/.test(x)))status='job-detail';
 return {platform:'zhilian-campus',status,applicationRoute:'unknown',submittedByInspection:false,evidenceSource:'agent-reported',next:'核对企业指定入口与具体岗位，沿用ready/授权/attempt/typed receipt；观察接口不点击或提交，不把已申请当本轮新增成功'};
}
class CampusBrowser{
 constructor({client=new KimiDaemonClient({session:'yijian-toudi-zhilian-campus',pollMs:0})}={}){this.client=client;this.running=false;}
 async read({open=false,tabId}={}){if(this.running)fail('campus-read-running',409);this.running=true;try{await this.client.start();if(!this.client.isUp())fail('请先连接浏览器扩展',409);let found=false;
 if(tabId!==undefined){if(!Number.isInteger(tabId)||tabId<1)fail('invalid-campus-tab');const inventory=await this.client.sendTool('list_browser_tabs',{});const tab=(inventory.data?.tabs||[]).find(t=>t.tabId===tabId);if(!tab)fail('campus-tab-not-found',404);pageUrl(tab.url);await this.client.sendTool('attach_tab',{tabId});found=true;}
 if(!found)try{const r=await this.client.sendTool('find_tab',{url:HOME});found=!!r.data?.tabId;}catch{}
 if(!found&&open){const r=await this.client.sendTool('list_browser_tabs',{});const tabs=(r.data?.tabs||[]).filter(t=>{try{return new URL(t.url).origin===new URL(HOME).origin;}catch{return false;}});if(tabs.length===1){await this.client.sendTool('attach_tab',{tabId:tabs[0].tabId});found=true;}}
 if(!found&&!open)return {status:'tab-required',rows:[]};if(!found)await this.client.navigate(HOME,{newTab:true,group_title:'一键投递 · 智联校园网申'});
 const r=await this.client.sendTool('evaluate',{code:`(${readCampusPage.toString()})()`});if(r.data?.type!=='string')fail('campus-page-invalid',409);return JSON.parse(r.data.value);
 }finally{this.client.stop();this.running=false;}}
}
const campusBrowser=new CampusBrowser();
module.exports={HOME,readCampusPage,normalizeCampus,importCampus,inspectCampus,CampusBrowser,campusBrowser};
