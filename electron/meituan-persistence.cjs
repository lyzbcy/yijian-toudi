const {randomUUID}=require('node:crypto');
const {planMeituanWidgets,buildMeituanWidgetScript}=require('./meituan-widget-fill.cjs');
const {createUniversalResumePlan}=require('./resume-plan.cjs');
const {planGenericResumeFields}=require('./adapters/generic-resume-fill.cjs');
const {normalizeComparableValue}=require('./field-matching.cjs');
const {meituanMonth}=require('./meituan-date-fill.cjs');
const {INSPECT_FORM_FIELDS}=require('./form-inspection.cjs');
const ORIGIN='https://zhaopin.meituan.com',EDIT='/web/personal-center/resume-detail',GET='/api/official/resume/get';
function validReceipt(r,body){return !!r&&r.method==='POST'&&r.mainFrame===true&&r.httpStatus>=200&&r.httpStatus<300&&!r.cached&&!r.fromServiceWorker&&body?.status===1&&body.data!==null&&typeof body.data==='object'&&!Array.isArray(body.data)&&Object.keys(body.data).length>0;}

// Contract backed by the observed resumeVo response and native editor. Unknown
// local sections are explicitly not applicable; expected fields never disappear
// merely because their DOM control is missing.
const textKey=k=>/^(basic\.(name|email|idCard|idNumber)|education\.\d+\.advisor|experience\.\d+\.(department|role|description)|projects\.\d+\.(name|role|description))$/.test(k);
function normalizedResume(resume){const fields={education:['school','department','major','degree','rank','laboratory','isFullTime','learningMode','advisor','start','end'],experience:['company','department','employmentType','role','description','start','end'],projects:['name','role','description','start','end']};return {...resume,...Object.fromEntries(Object.entries(fields).map(([k,keys])=>[k,(resume[k]||[]).filter(r=>keys.some(f=>r[f]!==null&&r[f]!==undefined&&String(r[f]).trim()!==''))]))};}
function applicablePlan(resume){return createUniversalResumePlan(resume).filter(r=>textKey(r.key)&&!(r.key==='basic.idCard'&&String(resume.basic?.idNumber||'').trim()));}
function verifyServerPayload(data,resume){
 resume=normalizedResume(resume);
 const vo=data?.resumeVo,b=vo?.resumeBaseInfo;
 if(!b||!Array.isArray(vo.resumeEduExpList)||!Array.isArray(vo.resumeWorkExpList)||!Array.isArray(vo.resumeProjectExpList))return {verified:false,reason:'server-schema-unconfirmed'};
 const maps={basic:{name:'name',email:'email',phone:'phone',gender:'genderName',idType:'identificationType',city:'cityName',idCard:'identificationNo',idNumber:'identificationNo'},education:{school:'school',department:'collegeName',major:'major',degree:'degreeName',rank:'scoreRankingName',laboratory:'labLevelName',isFullTime:'fullTimeStatus',learningMode:'fullTimeStatus',advisor:'mentor',start:'startDate',end:'endDate'},experience:{company:'companyName',employmentType:'workTypeName',department:'department',role:'position',description:'workDescription',start:'startDate',end:'endDate'},projects:{name:'projectName',role:'projectPosition',description:'projectDescription',start:'startDate',end:'endDate'}},arrays={education:vo.resumeEduExpList,experience:vo.resumeWorkExpList,projects:vo.resumeProjectExpList};
 const requests=[...planMeituanWidgets(resume),...applicablePlan(resume),{key:'basic.phone',value:resume.basic?.phone}],rows=[];
 for(const r of requests){const parts=r.key.split('.'),section=parts[0],field=parts.at(-1),row=section==='basic'?b:arrays[section]?.[Number(parts[1])],raw=row?.[maps[section]?.[field]];let actual=raw,want=r.value;
  if(field==='start'||field==='end'){actual=raw===253370736000000?'至今':typeof raw==='number'&&Number.isFinite(raw)&&raw>0&&raw<=8640000000000000-8*3600000?new Date(raw+8*3600000).toISOString().slice(0,7):null;want=r.kind==='meituan-present'?'至今':meituanMonth(want);}
  if(field==='isFullTime'||field==='learningMode'){actual=raw===true?'是':raw===false?'否':null;}
  if(r.key==='basic.idType'){actual=raw==='身份证'?'居民身份证':raw;}
  if(r.key==='basic.city'){actual=String(raw||'').replace(/市$/,'');want=String(want||'').replace(/市$/,'');}
  rows.push({key:r.key,verified:actual!==null&&actual!==undefined&&normalizeComparableValue(actual)===normalizeComparableValue(want)});
 }
 const groups=Object.entries(arrays).every(([k,v])=>v.length===(resume[k]?.length||0));
 return {verified:groups&&rows.length>=3&&rows.every(r=>r.verified),reason:groups&&rows.every(r=>r.verified)?null:'server-fields-differ',expected:rows.length,matched:rows.filter(r=>r.verified).length,rows};
}
const sessionGuards=new WeakMap();
function guardRequests(wc,onBlocked){let guards=sessionGuards.get(wc.session);if(!guards){guards=new Map();sessionGuards.set(wc.session,guards);wc.session.webRequest.onBeforeRequest({urls:['<all_urls>']},(details,callback)=>{const check=guards.get(details.webContentsId);if(!check){callback({});return;}let allowed=false;try{const u=new URL(details.url),reads=[GET,'/api/official/resume/isExist','/api/official/getNowTime','/api/category/allData','/api/official/resume/getCommonField','/api/official/user/current/resume/get','/api/official/user/wechat/phone/bind/status','/api/official/user/individualPrivacy/getStatus','/api/official/user/current/get','/api/official/enum/getEnumByCategory','/api/official/enum/getTreeEnumByCategory','/api/official/enum/search/school','/api/official/enum/search/major','/api/official/enum/search/college','/api/official/enum/search/company'];allowed=['GET','HEAD'].includes(details.method)&&!u.pathname.startsWith('/api/')||u.origin===ORIGIN&&['GET','HEAD','POST'].includes(details.method)&&reads.includes(u.pathname);}catch{}callback({cancel:!allowed});if(!allowed){let meta={method:details.method,path:'external-or-non-api',external:false};try{const u=new URL(details.url);meta.external=u.origin!==ORIGIN;if(u.origin===ORIGIN&&/^\/api\/[a-zA-Z/_-]{1,150}$/.test(u.pathname))meta.path=u.pathname;}catch{}check(meta);}});}guards.set(wc.id,onBlocked);return()=>guards.delete(wc.id);}

const guard=`const u=new URL(location.href);if(u.origin!==${JSON.stringify(ORIGIN)}||u.pathname!==${JSON.stringify(EDIT)}||u.searchParams.get('type')!=='campus'||u.searchParams.get('mode')!=='edit')throw Error('persistence-target-mismatch');`;
async function inspectPersistedFields(run,resume){
 resume=normalizedResume(resume);
 const req=planMeituanWidgets(resume),keys=new Set(req.map(r=>r.key));
 const records=await run(`(async()=>{${guard}return await ${buildMeituanWidgetScript(req.map(r=>({...r,readOnly:true})))};})()`);
 const fields=await run(`(()=>{${guard}return ${INSPECT_FORM_FIELDS};})()`);
 const local=applicablePlan(resume),planned=planGenericResumeFields(local.filter(r=>!keys.has(r.key)),fields);
 const widget=records.map(r=>({key:r.key,verified:r.written===true&&r.expected===r.observed,error:r.error||null})),text=planned.writable.map(r=>({key:r.key,verified:normalizeComparableValue(fields.find(f=>f.index===r.fieldIndex)?.value)===normalizeComparableValue(r.value)}));
 const missing=planned.manual.filter(r=>r.key!=='basic.phone').map(r=>({key:r.key,verified:false,error:'expected-field-unmapped'}));
 const phone=String(resume.basic?.phone||'').replace(/\D/g,'');
 const shape=await run(`(()=>{${guard}const roots=[...document.querySelectorAll('.resume_detail_edit')],phones=[...document.querySelectorAll('.base_info_edit input')].filter(e=>e.placeholder==='请输入手机号码');return{editorCount:roots.length,phoneMatchesLocal:phones.length===1&&${JSON.stringify(phone)}!==''&&String(phones[0].value||'').replace(/\\D/g,'')===${JSON.stringify(phone)},groups:['edu_experience_edit','work_experience_edit','project_experience_edit'].map(k=>[...document.querySelectorAll('.'+k+' .model_list')].length),blocked:/安全验证|访问受限|异常行为/.test(document.body?.innerText||'')};})()`);
 const groupExpected=[resume.education?.length||0,resume.experience?.length||0,resume.projects?.length||0],verified=new Set([...widget,...text].filter(r=>r.verified).map(r=>r.key));
 const critical=['basic.name','basic.email',...(String(resume.basic?.idNumber||'').trim()?['basic.idNumber']:String(resume.basic?.idCard||'').trim()?['basic.idCard']:[])].filter(k=>local.some(r=>r.key===k));
 const criticalVerified=critical.length>=2&&critical.every(k=>verified.has(k)),groupCountsMatch=shape.groups.every((n,i)=>n===groupExpected[i]);
 return {expected:widget.length+text.length+missing.length,matched:widget.filter(r=>r.verified).length+text.filter(r=>r.verified).length,widget,text,missing,phoneMatchesLocal:shape.phoneMatchesLocal,groupCountsMatch,criticalVerified,blocked:shape.blocked,verified:shape.editorCount===1&&!shape.blocked&&shape.phoneMatchesLocal&&groupCountsMatch&&criticalVerified&&widget.length+text.length>0&&missing.length===0&&[...widget,...text].every(r=>r.verified),readOnly:true};
}
// Isolated native view, same per-platform login session. No edits/upload/save.
// Soft observation deadlines retain this very job/view; query never navigates.
function createMeituanPersistenceProbe({BrowserWindow,resume,target,onChange=()=>{},parent}={}){
 resume=normalizedResume(resume);
 if(target?.id!=='meituan'||target.resumeRecruitType!=='campus')throw Error('仅支持已核实的美团校招存储核验');
 const win=new BrowserWindow({show:false,width:1100,height:900,parent,webPreferences:{partition:'persist:meituan',contextIsolation:true,sandbox:true,nodeIntegration:false,backgroundThrottling:false}}),wc=win.webContents;
 const state={id:randomUUID(),status:'running',reason:'opening',receiptVerified:false,expected:0,matched:0,readOnly:true},requests=new Map();let frameId=null,ready=false,checking=false,closed=false,receipt=false,startedAt=Date.now(),timer,unguard;
 const snapshot=()=>({...state}),notify=()=>onChange(snapshot());
 const parentClosed=()=>finish('lost','parent-closed');
 function cleanup(){clearTimeout(timer);unguard?.();parent?.removeListener('closed',parentClosed);if(closed)return;closed=true;try{if(wc.debugger.isAttached())wc.debugger.detach();}catch{}if(!win.isDestroyed())win.destroy();}
 function finish(status,reason,extra={}){if(state.status!=='running')return;Object.assign(state,{status,reason,...extra});notify();cleanup();}
 const run=async code=>{if(closed||wc.isDestroyed())throw Error('probe-lost');return wc.executeJavaScript(code);};
 async function check(){if(state.status!=='running'||checking)return snapshot();if(closed||wc.isDestroyed()){finish('lost','probe-lost');return snapshot();}if(!ready||!receipt){state.reason=!ready?'opening':'server-receipt-pending';notify();return snapshot();}checking=true;try{const r=await inspectPersistedFields(run,resume);if(state.status!=='running')return snapshot();Object.assign(state,{expected:r.expected,matched:r.matched,phoneMatchesLocal:r.phoneMatchesLocal,groupCountsMatch:r.groupCountsMatch,criticalVerified:r.criticalVerified});if(r.verified)finish('verified',null,{receiptVerified:true,serverVerified:true});else if(r.blocked)finish('failed','verification-required');else if(Date.now()-startedAt>30000)finish('failed','persisted-fields-differ');else {state.reason='fields-settling';notify();timer=setTimeout(()=>void check(),300);}}catch{if(state.status==='running'){state.reason='page-read-unconfirmed';notify();}}finally{checking=false;}return snapshot();}
 const onMessage=async(_event,method,p)=>{if(closed||state.status!=='running')return;
  if(method==='Page.frameNavigated'&&!p.frame.parentId)frameId=p.frame.id;
  if(method==='Network.requestWillBeSent'){try{const u=new URL(p.request.url);if(u.origin===ORIGIN&&u.pathname===GET)requests.set(p.requestId,{method:p.request.method,mainFrame:p.frameId===frameId,cached:false});}catch{}}
  if(method==='Network.requestServedFromCache'&&requests.has(p.requestId))requests.get(p.requestId).cached=true;
  if(method==='Network.responseReceived'&&requests.has(p.requestId)){let u;try{u=new URL(p.response.url);}catch{finish('failed','server-origin-unconfirmed');return;}if(u.origin!==ORIGIN||u.pathname!==GET){finish('failed','server-origin-changed');return;}const r=requests.get(p.requestId);Object.assign(r,{httpStatus:p.response.status,cached:r.cached||p.response.fromDiskCache===true||p.response.fromPrefetchCache===true,fromServiceWorker:p.response.fromServiceWorker===true});}
  if(method==='Network.loadingFinished'&&requests.has(p.requestId)){try{const r=requests.get(p.requestId),b=await wc.debugger.sendCommand('Network.getResponseBody',{requestId:p.requestId}),j=JSON.parse(b.base64Encoded?Buffer.from(b.body,'base64').toString('utf8'):b.body);if(closed||state.status!=='running')return;if(!validReceipt(r,j)){finish('failed','fresh-server-receipt-invalid');return;}state.httpStatus=r.httpStatus;state.businessStatus=j.status;const server=verifyServerPayload(j.data,resume);state.serverExpected=server.expected||0;state.serverMatched=server.matched||0;if(!server.verified){finish('failed',server.reason);return;}receipt=true;state.receiptVerified=true;state.serverVerified=true;state.reason='checking-fields';void check();}catch{if(!closed&&state.status==='running'){state.reason='server-body-unconfirmed';notify();}}}
 };
 wc.setWindowOpenHandler(()=>({action:'deny'}));
 wc.on('will-navigate',(e,url)=>{try{const u=new URL(url);if(u.origin!==ORIGIN||u.pathname!==EDIT){e.preventDefault();finish('failed','login-or-route-required');}}catch{e.preventDefault();finish('failed','target-mismatch');}});
 wc.on('did-redirect-navigation',(_e,url)=>{try{const u=new URL(url);if(u.origin!==ORIGIN||u.pathname!==EDIT)finish('failed','login-or-route-required');}catch{finish('failed','target-mismatch');}});
 wc.on('render-process-gone',()=>finish('lost','probe-process-lost'));
 win.on('closed',()=>{closed=true;cleanup();if(state.status==='running'){state.status='lost';state.reason='probe-closed';notify();}});
 parent?.once('closed',parentClosed);
 void(async()=>{try{await win.loadURL('about:blank');wc.debugger.attach('1.3');wc.debugger.on('message',onMessage);await wc.debugger.sendCommand('Page.enable');await wc.debugger.sendCommand('Network.enable');await wc.debugger.sendCommand('Network.setCacheDisabled',{cacheDisabled:true});const tree=await wc.debugger.sendCommand('Page.getFrameTree');frameId=tree.frameTree.frame.id;unguard=guardRequests(wc,blockedRequest=>{if(blockedRequest.external){state.blockedExternalRequests=Math.min(10000,(state.blockedExternalRequests||0)+1);notify();}else finish('failed','unexpected-write-request',{blockedRequest});});await win.loadURL(ORIGIN+EDIT+'?type=campus&mode=edit');if(state.status!=='running')return;ready=true;void check();}catch{finish('failed','probe-open-unconfirmed');}})();
 return {snapshot,query:check,dispose:()=>finish('cancelled','cancelled')};
}
module.exports={validReceipt,verifyServerPayload,inspectPersistedFields,createMeituanPersistenceProbe};
