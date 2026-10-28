const test=require('node:test'),assert=require('node:assert/strict');
const {BrowserMailbox,parseDisplayDate,readList}=require('../electron/browser-mail.cjs');
const {classifyRecruitingMail}=require('../electron/recruiting.cjs');
function fixture(pages){let n=0,stopped=false;const calls=[];return {calls,get stopped(){return stopped},start:async()=>{},isUp:()=>true,stop(){stopped=true},navigate:async(...args)=>calls.push(['navigate',...args]),sendTool:async(action,args)=>{calls.push([action,args]);if(action==='find_tab')return {data:{tabId:123}};if(action==='cdp')return {data:{}};const step=Number(args.code.match(/\)\((-?\d+)\)$/)?.[1]||0);if(step===1)n=Math.min(n+1,pages.length-1);if(step===-1)n=0;return {data:{type:'string',value:JSON.stringify(pages[n])}};}};}
const page=(mailbox='a@qq.com',id='m1',end=true)=>({status:'ready',mailbox,keys:[id,'normal'],rows:[{id,subject:'腾讯前端面试邀请',from:'腾讯招聘',preview:'参加面试',displayDate:'10/26'}],end});
test('browser mailbox module exists and dates do not invent precision',()=>{
 assert.deepEqual(parseDisplayDate('10/22',new Date('2026-10-26T01:00Z')),{receivedAt:'2026-10-21T16:00:00.000Z',receivedAtPrecision:'day'});
 assert.equal(parseDisplayDate('12/31',new Date('2026-01-01T01:00Z')).receivedAt,'2025-12-30T16:00:00.000Z');
 assert.equal(parseDisplayDate('昨天',new Date('2026-10-26T01:00Z')).receivedAt,'2026-10-24T16:00:00.000Z');
 assert.equal(parseDisplayDate('10:21',new Date('2026-10-26T03:00Z')).receivedAtPrecision,'minute');
 for(const date of ['星期一','2/31','bad'])assert.equal(parseDisplayDate(date).receivedAt,'');
});
test('own tab reuses login; bounded list import; IDs hashed; no credentials',async()=>{
 const client=fixture([page()]);const result=await new BrowserMailbox({client,wait:async()=>{}}).sync({connect:true});
 assert.equal(result.status,'connected');assert.equal(result.scanned,2);assert.equal(result.messages.length,1);assert.equal(result.messages[0].stage,'面试');
 assert.ok(!result.messages[0].id.includes('a@qq.com'));assert.equal(result.partial,false);assert.equal(client.stopped,true);
 assert.ok(!JSON.stringify(client.calls).includes('document.cookie'));assert.ok(!JSON.stringify(client.calls).includes('localStorage'));
});
test('mailbox switch discards read and stops bridge',async()=>{
 const client=fixture([page('b@qq.com')]);await assert.rejects(()=>new BrowserMailbox({client,wait:async()=>{}}).sync({expectedAddress:'a@qq.com'}),/不同/);assert.equal(client.stopped,true);
});
test('virtual list overlap deduplicates, bounded partial scan',async()=>{
 const client=fixture([page('a@qq.com','m1',false),page('a@qq.com','m2',false)]);
 const result=await new BrowserMailbox({client,wait:async()=>{}}).sync({limit:3});assert.equal(result.scanned,3);assert.equal(result.messages.length,2);assert.equal(result.partial,true);
});
test('expired login is not connected and imports nothing',async()=>{
 const client=fixture([{status:'login-required'}]);const result=await new BrowserMailbox({client,wait:async()=>{}}).sync({connect:true});assert.equal(result.status,'login-required');assert.deepEqual(result.messages,[]);
});
test('background sync never creates tab when closed',async()=>{
 const client=fixture([]);client.sendTool=async()=>{throw Error('missing-tab')};const result=await new BrowserMailbox({client,wait:async()=>{}}).sync();assert.equal(result.status,'tab-required');assert.equal(client.calls.length,0);
});
test('survey is not an interview; application confirmation classifies',()=>{
 assert.equal(classifyRecruitingMail('【小红书】面试满意度调研'),'其他');assert.equal(classifyRecruitingMail('阿里巴巴校园招聘投递成功','感谢你关注阿里巴巴'),'流程中');
});
test('adapter is fixed list DOM, excludes OTP and survey before returning content',()=>{
 const vm=require('node:vm');const row=(id,subject)=>({getAttribute:()=>id,querySelector:s=>({textContent:s==='.mail-subject'?subject:s==='.mail-digest'?'链接 https://private.example/token':'招聘'})});
 const all=[row('1','腾讯面试邀请'),row('2','招聘平台验证码'),row('3','面试满意度调研')];
 const scroll={scrollTop:0,clientHeight:500,scrollHeight:500,querySelector:()=>all[0],querySelectorAll:()=>all};
 const result=JSON.parse(vm.runInNewContext(`(${readList.toString()})()`,{location:{origin:'https://wx.mail.qq.com',hash:'#/list/1'},document:{querySelector:()=>({textContent:'a@qq.com'}),querySelectorAll:()=>[scroll]}}));
 assert.equal(result.rows.length,1);assert.ok(!result.rows[0].preview.includes('private.example'));assert.equal(result.keys.length,3);
});

test('unique generic company message can advance, ambiguous company cannot; binding is scoped',()=>{
 const career=require('../electron/career-tracker.cjs');
 const s={activeAccountId:'a',resume:{activeProfileId:'p'},settings:{email:{}}};
 career.upsert(s,{company:'京东',role:'前端',stage:'已投递'},'2026-10-20T01:00Z');
 career.bindMailbox(s,'a@qq.com');
 const message={id:'m',company:'京东',mailbox:'a@qq.com',subject:'京东测评通知',stage:'测评',receivedAt:'2026-10-21T16:00:00Z'};
 career.syncProgress(s,[message]);assert.equal(s.careerApplications[0].stage,'笔试中');
 s.activeAccountId='b';career.bindMailbox(s,'b@qq.com');assert.equal(s.careerApplications[0].mailbox,'a@qq.com');
 s.activeAccountId='a';career.upsert(s,{company:'京东',role:'后端',stage:'已投递'},'2026-10-20T01:00Z');career.bindMailbox(s,'a@qq.com');
 assert.equal(career.syncProgress(s,[{...message,id:'m2',stage:'面试',receivedAt:'2026-10-23T01:00Z'}]).unmatched,1);
});
test('same-day coarse date and unknown date do not override newer manual state',()=>{
 const career=require('../electron/career-tracker.cjs');const s={settings:{email:{address:'a@qq.com'}}};
 career.upsert(s,{company:'京东',role:'前端',stage:'已投递'},'2026-10-26T01:00Z');
 const m={id:'m',company:'京东',mailbox:'a@qq.com',subject:'京东面试邀请',stage:'面试',...parseDisplayDate('10/26',new Date('2026-10-26T03:00Z'))};
 career.syncProgress(s,[m,{...m,id:'unknown',receivedAt:''}]);assert.equal(s.careerApplications[0].stage,'已投递');
});
