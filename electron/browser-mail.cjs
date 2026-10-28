'use strict';
const {createHash}=require('node:crypto');
const {KimiDaemonClient,startInstalledDaemon}=require('./kimi-daemon-client.cjs');
const {classifyRecruitingMail}=require('./recruiting.cjs');
const {inferCompany}=require('./mail.cjs');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const hash=s=>createHash('sha256').update(s).digest('hex').slice(0,24);

// Fixed QQ list-only DOM adapter: no Cookie, storage, body, link or credential reads.
function readList(step=0) {
 if(location.origin!=='https://wx.mail.qq.com'||location.hash!=='#/list/1')return JSON.stringify({status:'login-required'});
 const mailbox=document.querySelector('.profile-user-info .user-email')?.textContent.trim().toLowerCase();
 if(!/^[^\s@]+@qq\.com$/.test(mailbox||''))return JSON.stringify({status:'login-required'});
 const scroll=[...document.querySelectorAll('.ui-float-scroll-body')].find(x=>x.querySelector('.mail-list-page-item[data-mailid]'));
 if(!scroll)return JSON.stringify({status:'list-unavailable',mailbox});
 if(step!==0){scroll.scrollTop=step<0?0:scroll.scrollTop+Math.max(200,scroll.clientHeight*.75);scroll.dispatchEvent(new Event('scroll',{bubbles:true}));return JSON.stringify({status:'scrolled',mailbox});}
 const all=[...scroll.querySelectorAll('.mail-list-page-item[data-mailid]')];
 const rows=all.map(el=>({id:el.getAttribute('data-mailid'),subject:el.querySelector('.mail-subject')?.textContent.trim()||'',from:el.querySelector('.cmp-account-nick')?.textContent.trim()||'',displayDate:el.querySelector('.mail-time')?.textContent.trim()||'',preview:el.querySelector('.mail-digest')?.textContent.trim()||''}))
  .filter(m=>!/验证码|一次性密码|verification code|one.time.password|password reset|满意度|问卷|调研|survey|feedback/i.test(m.subject)
    &&/招聘|校招|社招|面试|offer|career|talent|jobs|recruit|猎头|测评|笔试|投递成功/i.test(m.subject+' '+m.from))
  .map(m=>({...m,preview:m.preview.replace(/https?:\/\/\S+|\b[a-z0-9.-]+\.[a-z]{2,}\/\S+/gi,'[链接已省略]').slice(0,160)}));
 return JSON.stringify({status:'ready',mailbox,keys:all.map(x=>x.getAttribute('data-mailid')),rows,end:scroll.scrollTop+scroll.clientHeight>=scroll.scrollHeight-2});
}
// Jiangnan's Tencent Enterprise webmail: same-origin mainFrame list only.
function readSchoolList(step=0) {
 if(location.origin!=='https://mail.jiangnan.edu.cn')return JSON.stringify({status:'login-required'});
 const mailbox=document.querySelector('#useraddr')?.textContent.trim().toLowerCase();
 if(!/^[^\s@]+@(?:stu\.)?jiangnan\.edu\.cn$/.test(mailbox||''))return JSON.stringify({status:'login-required'});
 const frame=document.querySelector('#mainFrame'),d=frame?.contentDocument,link=document.querySelector('#folder_1');
 if(!d||!link)return JSON.stringify({status:'list-unavailable',mailbox});
 if(step===-1||frame.contentWindow.location.pathname!=='/cgi-bin/mail_list'){
  frame.src=link.href;return JSON.stringify({status:'loading',mailbox});
 }
 const next=[...d.querySelectorAll('a')].find(a=>a.textContent.trim()==='下一页');
 if(step===1){if(next){frame.src=next.href;return JSON.stringify({status:'loading',mailbox});}return JSON.stringify({status:'end',mailbox});}
 if(new URL(frame.contentWindow.location.href).searchParams.get('folderid')!=='1')return JSON.stringify({status:'list-unavailable',mailbox});
 const all=[...d.querySelectorAll('input[type=checkbox][name=mailid]')];
 if(d.readyState!=='complete'||(!all.length&&!/共\s*0\s*封/.test(d.body?.innerText||'')))return JSON.stringify({status:'loading',mailbox});
 const rows=all.map(c=>{const row=c.closest('tr');return {id:c.value,subject:row?.querySelector('td.gt u')?.textContent.trim()||'',from:row?.querySelector('td.tl')?.textContent.trim()||'',displayDate:row?.querySelector('td.dt')?.textContent.trim()||'',preview:row?.querySelector('td.gt b.no')?.textContent.replace(/^\s*-\s*/,'').trim()||''};})
 .filter(m=>!/验证码|一次性密码|verification code|password reset|满意度|问卷|调研|survey|feedback/i.test(m.subject)&&/招聘|校招|社招|面试|offer|career|talent|jobs|recruit|猎头|测评|笔试|投递|简历/i.test(m.subject+' '+m.from))
 .map(m=>({...m,preview:m.preview.replace(/https?:\/\/\S+|\b[a-z0-9.-]+\.[a-z]{2,}\/\S+/gi,'[链接已省略]').slice(0,160)}));
 return JSON.stringify({status:'ready',mailbox,keys:all.map(c=>c.value),rows,end:!next,visibleTotal:Number((d.body.innerText.match(/共\s*(\d+)\s*封/)||[])[1])||0});
}

function parseDisplayDate(value,now=new Date()) {
 const today=new Date(now.getTime()+8*3600000).toISOString().slice(0,10);
 value=String(value||'').trim();
 const relative=value.match(/^(\d+)分钟前$/);if(relative)return {receivedAt:new Date(now.getTime()-Number(relative[1])*60000).toISOString(),receivedAtPrecision:'minute'};
 value=value.replace(/^(今天|昨天) (\d{1,2}:\d{2})$/,(all,when,t)=>when==='今天'?t:when).replace(/^(\d{4})年(\d{1,2})月(\d{1,2})日$/,'$1/$2/$3').replace(/^(\d{1,2})月(\d{1,2})日$/,'$1/$2');
 let day,precision='day',time='00:00';
 if(/^\d{1,2}:\d{2}$/.test(value)){day=today;time=value.padStart(5,'0');precision='minute';}
 else if(/^(今天|昨天|前天)$/.test(value)){const ago={'今天':0,'昨天':1,'前天':2}[value];day=new Date(Date.parse(today+'T00:00:00+08:00')-ago*86400000+8*3600000).toISOString().slice(0,10);}
 else if(/^\d{4}[/-]\d{1,2}[/-]\d{1,2}$/.test(value)){day=value.replaceAll('/','-').split('-').map((v,i)=>i?v.padStart(2,'0'):v).join('-');}
 else if(/^\d{1,2}[/-]\d{1,2}$/.test(value)){const md=value.replace('/','-').split('-').map(v=>v.padStart(2,'0')).join('-');let year=Number(today.slice(0,4));day=year+'-'+md;if(Date.parse(day+'T00:00:00+08:00')>now.getTime()+86400000)day=(year-1)+'-'+md;}
 if(!day)return {receivedAt:'',receivedAtPrecision:'unknown'};
 const parsed=new Date(day+'T'+time+':00+08:00');
 if(!Number.isFinite(parsed.getTime())||new Date(parsed.getTime()+8*3600000).toISOString().slice(0,10)!==day)return {receivedAt:'',receivedAtPrecision:'unknown'};
 return {receivedAt:parsed.toISOString(),receivedAtPrecision:precision};
}
// DOM adapter observed against both real webmail readers. No endpoints or session tokens are constructed.
function readMessageDetail(provider,action,id,subject,address){
 const school=provider==='jiangnan';if(location.origin!==(school?'https://mail.jiangnan.edu.cn':'https://wx.mail.qq.com'))return JSON.stringify({status:'identity-changed'});
 const mailbox=(school?document.querySelector('#useraddr'):document.querySelector('.profile-user-info .user-email'))?.textContent.trim().toLowerCase();if(mailbox!==address)return JSON.stringify({status:'identity-changed'});
 const d=school?document.querySelector('#mainFrame')?.contentDocument:document;if(!d)return JSON.stringify({status:'loading'});
 if(action==='open'){
  const row=school?[...d.querySelectorAll('input[type=checkbox][name=mailid]')].find(x=>x.value===id)?.closest('tr'):[...d.querySelectorAll('.mail-list-page-item[data-mailid]')].find(x=>x.dataset.mailid===id);
  const target=row?.querySelector(school?'td.gt u':'.mail-subject');if(!target||target.textContent.trim()!==subject.trim())return JSON.stringify({status:'not-found'});if(school)window.__yjtMailReturn=document.querySelector('#mainFrame').contentWindow.location.href;target.click();return JSON.stringify({status:'opening'});
 }
 if(action==='returned')return JSON.stringify({status:school?(document.querySelector('#mainFrame').contentWindow.location.pathname==='/cgi-bin/mail_list'&&d.readyState==='complete'?'ready':'loading'):(!d.querySelector('.mail-detail-content')?'ready':'loading')});
 if(action==='back'){
  if(school&&window.__yjtMailReturn){const url=window.__yjtMailReturn;delete window.__yjtMailReturn;document.querySelector('#mainFrame').src=url;return JSON.stringify({status:'returning'});}
  const back=school?[...d.querySelectorAll('a')].find(e=>/返回$/.test(e.textContent.trim())):[...d.querySelectorAll('.ui-btn-text')].find(e=>e.textContent.trim()==='返回');if(back)back.click();return JSON.stringify({status:back?'returning':'list'});
 }
 const title=d.querySelector(school?'#subject':'.mail-detail-subject')?.textContent.trim();
 if(title!==subject.trim())return JSON.stringify({status:'loading'});
 const body=d.querySelector(school?'#contentDiv':'.mail-detail-content');if(!body||!body.innerText.trim())return JSON.stringify({status:'loading'});
 const header=school?d.body.innerText.slice(0,Math.max(0,d.body.innerText.indexOf(body.innerText))):d.querySelector('.mail-detail-basic')?.innerText||'';
 return JSON.stringify({status:'ready',mailbox,subject:title,body:body.innerText.slice(0,80000),header:header.slice(0,4000),links:[...body.querySelectorAll('a[href]')].slice(0,80).map(a=>({text:a.textContent.slice(0,120),url:a.href,context:a.parentElement?.textContent.slice(0,200)||''}))});
}
class BrowserMailbox {
 constructor({client=new KimiDaemonClient({session:'yijian-toudi-webmail',pollMs:0}),wait=sleep,startDaemon=startInstalledDaemon}={}){Object.assign(this,{client,wait,startDaemon});}
 async evaluate(step=0){const reader=this.provider==='jiangnan'?readSchoolList:readList;const r=await this.client.sendTool('evaluate',{code:`(${reader.toString()})(${step})`});if(r.data?.type!=='string')throw Error('邮箱页面返回格式异常');return JSON.parse(r.data.value);}
 async messageDetail(provider,action,row,address){const r=await this.client.sendTool('evaluate',{code:`(${readMessageDetail.toString()})(${JSON.stringify(provider)},${JSON.stringify(action)},${JSON.stringify(row.id)},${JSON.stringify(row.subject)},${JSON.stringify(address)})`});if(r.data?.type!=='string')throw Error('邮件正文页面返回异常');const value=JSON.parse(r.data.value);if(value.status==='identity-changed')throw Error('正文读取期间邮箱身份变化');return value;}
 async readDetails(provider,row,address){
  const opened=await this.messageDetail(provider,'open',row,address);if(opened.status!=='opening')return null;
  try{for(let i=0;i<20;i++){await this.wait(250);const v=await this.messageDetail(provider,'read',row,address);if(v.status==='ready')return require('./mail-details.cjs').extract(v,classifyRecruitingMail(row.subject,row.preview));}return null;}
  finally{await this.messageDetail(provider,'back',row,address);for(let i=0;i<12;i++){await this.wait(250);const v=await this.messageDetail(provider,'returned',row,address);if(v.status==='ready')break;}}
 }
 async sync({connect=false,expectedAddress='',provider='qq',limit=80,now=new Date(),detailIds=[],readRecruitingBodies=false,knownMessageIds=[]}={}){
  if(!['qq','jiangnan'].includes(provider))throw Error('尚未支持此邮箱网页');this.provider=provider;
  limit=Math.max(1,Math.min(200,Number(limit)||80));
  let focus=false;
  try {
   await this.client.start();
   if(!this.client.isUp()&&this.client.reason==='daemon-unavailable'&&connect){await this.startDaemon();await this.wait(700);await this.client.refresh();}
   if(!this.client.isUp())throw Error('请先在「连接 AI Agent」完成浏览器扩展连接，再连接邮箱');
   let found=false;
   for(const url of (provider==='jiangnan'?['https://mail.jiangnan.edu.cn/']:['https://wx.mail.qq.com/','https://mail.qq.com/'])){try {const r=await this.client.sendTool('find_tab',{url});found=!!r.data?.tabId;if(found)break;}catch{}}
   if(!found&&connect&&provider==='jiangnan'){const inventory=await this.client.sendTool('list_browser_tabs',{});const tab=(inventory.data?.tabs||[]).find(t=>{try{return new URL(t.url).origin==='https://mail.jiangnan.edu.cn'}catch{return false}});if(tab){await this.client.sendTool('attach_tab',{tabId:tab.tabId});found=true;}}
   if(!found&&!connect)return {status:'tab-required',messages:[]};
   // Only navigate this adapter's own group, never borrow the user's settings tab.
   if(provider==='qq'||!found)await this.client.navigate(provider==='jiangnan'?'https://mail.jiangnan.edu.cn/':'https://mail.qq.com/',{newTab:!found,group_title:'一键投递 · 邮箱同步'});
   await this.client.sendTool('cdp',{method:'Emulation.setFocusEmulationEnabled',params:{enabled:true}});focus=true;
   let page;
   for(let i=0;i<10;i++){page=await this.evaluate();if(page.status==='ready')break;await this.wait(400);}
   if(page.status!=='ready')return {status:page.status,messages:[]};
   const address=page.mailbox;
   if(expectedAddress&&expectedAddress.trim().toLowerCase()!==address)throw Error('浏览器当前邮箱与已绑定邮箱不同，请核对后重新连接');
   await this.evaluate(-1);await this.wait(provider==='jiangnan'?650:180);
   const seen=new Set(),messages=new Map();let end=false,stalled=0,visibleTotal=0,lastPageKeys='',duplicateRows=0;
   for(let i=0;i<24&&seen.size<limit;i++){
    for(let poll=0;poll<12;poll++){page=await this.evaluate();if(page.status!=='loading'&&(provider!=='jiangnan'||!lastPageKeys||JSON.stringify(page.keys)!==lastPageKeys))break;await this.wait(300);}
    if(page.status!=='ready'||page.mailbox!==address)throw Error('同步期间邮箱登录发生变化，本轮数据未导入');
    visibleTotal=Math.max(visibleTotal,page.visibleTotal||0);
    if(provider==='jiangnan'&&lastPageKeys&&JSON.stringify(page.keys)===lastPageKeys)throw Error('邮箱分页未完成，本轮未导入');
    const before=seen.size,accepted=new Set();
    for(const key of page.keys||[]){if(seen.has(key)){duplicateRows++;accepted.add(key);continue;}if(seen.size>=limit)break;seen.add(key);accepted.add(key);}
    for(const row of page.rows||[]){if(!accepted.has(row.id))continue;const id=`${provider==='qq'?'qq':'jiangnan'}-web-${hash(address)}-${hash(row.id)}`;
     let details=messages.get(id)?.details;if(!details&&(detailIds.includes(id)||(readRecruitingBodies&&!knownMessageIds.includes(id)&&['测评','面试'].includes(classifyRecruitingMail(row.subject,row.preview))&&Number.isFinite(Date.parse(parseDisplayDate(row.displayDate,now).receivedAt))&&now.getTime()-Date.parse(parseDisplayDate(row.displayDate,now).receivedAt)<180*86400000))){try{details=await this.readDetails(provider,row,address);}catch(error){if(/身份变化/.test(error.message))throw error;}}
     messages.set(id,{...row,id,...(details?{details}:{}),mailbox:address,company:inferCompany(row.subject,row.from),stage:classifyRecruitingMail(row.subject,row.preview),...parseDisplayDate(row.displayDate,now),source:provider==='jiangnan'?'江南大学网页邮箱':'QQ 网页邮箱'});}
    end=page.end===true&&seen.size===new Set([...seen,...(page.keys||[])]).size;
    if(end)break;
    stalled=seen.size===before?stalled+1:0;if(stalled>=3)break;
    if(seen.size<limit){if(provider==='jiangnan')lastPageKeys=JSON.stringify(page.keys);await this.evaluate(1);await this.wait(provider==='jiangnan'?650:180);}
   }
   const final=await this.evaluate();if(final.status!=='ready'||final.mailbox!==address)throw Error('同步结束时邮箱登录发生变化，本轮数据未导入');
   if(provider==='qq')await this.evaluate(-1);
   return {status:'connected',address,messages:[...messages.values()],scanned:seen.size,partial:!end||(visibleTotal>seen.size),coverageGap:Math.max(0,visibleTotal-seen.size),visibleTotal,duplicateRows,limit};
  } finally {if(focus)try{await this.client.sendTool('cdp',{method:'Emulation.setFocusEmulationEnabled',params:{enabled:false}});}catch{}this.client.stop();}
 }
}
module.exports={readMessageDetail,BrowserMailbox,readList,readSchoolList,parseDisplayDate};
