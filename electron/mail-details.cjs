/* Only structured scheduling facts persist; raw mail text is transient. */
'use strict';
function timestamp(y,m,d,h,n){const p=[+y,+m,+d,+h,+n];if(p[1]<1||p[1]>12||p[2]<1||p[3]>23||p[4]>59)return '';const ms=Date.UTC(p[0],p[1]-1,p[2],p[3]-8,p[4]),a=new Date(ms+28800000);return [a.getUTCFullYear(),a.getUTCMonth()+1,a.getUTCDate(),a.getUTCHours(),a.getUTCMinutes()].some((v,i)=>v!==p[i])?'':new Date(ms).toISOString();}
function receivedTime(header){const m=String(header||'').match(/(20\d{2})[年\/-](\d{1,2})[月\/-](\d{1,2})日?\s*(?:[（(][^）)]*[）)])?\s*(凌晨|早上|上午|中午|下午|晚上)?\s*(\d{1,2})[:：](\d{2})/);if(!m)return '';let h=+m[5];if(/下午|晚上/.test(m[4]||'')&&h<12)h+=12;if(m[4]==='凌晨'&&h===12)h=0;return timestamp(m[1],m[2],m[3],h,m[6]);}
function extract(input={},stage='测评'){
 const body=String(input.body||'').slice(0,80000).replace(/\u00a0/g,' '),receivedAt=receivedTime(input.header),hits=[];
 const dates=/(20\d{2})[年.\/-](\d{1,2})[月.\/-](\d{1,2})日?\s*(?:[（(][^）)]*[）)])?\s*(上午|下午|晚上)?\s*(\d{1,2})[:：](\d{2})/g;
 for(const m of body.matchAll(dates)){const context=body.slice(Math.max(0,m.index-65),Math.min(body.length,m.index+m[0].length+22));const pre=body.slice(Math.max(0,m.index-65),m.index);let h=+m[5];if(/下午|晚上/.test(m[4]||'')&&h<12)h+=12;const at=timestamp(m[1],m[2],m[3],h,m[6]);if(!at)continue;let kind='';if(/截止|结束时间|有效期|失效|完成时间|作答时间/.test(pre)||/前.{0,5}(完成|作答|提交)/.test(context.slice(-25)))kind='截止时间';else if(/面试时间|面试安排|开始时间|笔试时间|测评时间|会议时间/.test(pre))kind=stage==='面试'?'面试时间':'开始时间';if(kind)hits.push({at,kind,evidence:context.replace(/https?:\/\/\S+/g,'[链接]').slice(0,160)});}
 const preferred=hits.filter(h=>stage==='面试'?h.kind==='面试时间':h.kind==='截止时间'),use=preferred.length?preferred:hits,unique=[...new Map(use.map(x=>[x.at,x])).values()];let dueAt='',kind='',evidence='',conflict=unique.length>1;
 if(unique.length===1)({at:dueAt,kind,evidence}=unique[0]);
 if(!dueAt&&!conflict&&receivedAt){const rel=[...body.matchAll(/(?:收到(?:本|此)?(?:通知|邮件|链接)?(?:后(?:的)?|的)|收信后|建议您在|请您在|请在|请于)\s*(\d{1,3})\s*(?:个)?\s*(小时|天|日)(?:之)?(?:内|后失效)(?:完成|参加|作答)?/g)];const hours=[...new Set(rel.map(x=>+x[1]*(x[2]==='小时'?1:24)))];if(hours.length===1&&hours[0]>0&&hours[0]<=720){dueAt=new Date(Date.parse(receivedAt)+hours[0]*3600000).toISOString();kind=/建议/.test(rel[0][0])?'建议完成时间':'收信后时限';evidence=rel[0][0];}else if(hours.length>1)conflict=true;}
 if(!dueAt&&!conflict&&receivedAt){
  const inclusive=[...body.matchAll(/收到(?:本|此)?邮件(?:之日)?起\s*(\d{1,2})\s*天\s*[（(]\s*含当\s*天\s*[）)]/g)];
  const days=[...new Set(inclusive.map(m=>Number(m[1])))];
  if(days.length===1&&days[0]>0&&days[0]<=30){const localDay=new Date(Date.parse(receivedAt)+28800000).toISOString().slice(0,10);dueAt=new Date(Date.parse(localDay+'T00:00:00+08:00')+days[0]*86400000-1).toISOString();kind='含当天的自然日截止';evidence=inclusive[0][0]+'；按北京时间自然日末换算';}
  else if(days.length>1)conflict=true;
 }
 const candidates=[...(input.links||[])];for(const m of body.matchAll(/https?:\/\/[^\s<>\"'，。；）)]+/g))candidates.push({text:'招聘相关链接',url:m[0],context:body.slice(Math.max(0,m.index-80),m.index+80)});const links=[];for(const link of candidates){if(links.length>=8)break;try{const u=new URL(link.url);if(!['https:','http:'].includes(u.protocol)||u.username||u.password||u.href.length>4096)continue;const label=String(link.text||'').trim(),context=String(link.context||'');if(!/测评|笔试|面试|会议|作答|开始|参加|进入|点击|地址|3\.cn|zoom|teams|meeting/i.test(label+' '+context))continue;if(/退订|取消订阅|unsubscribe|隐私|privacy/i.test(label))continue;if(links.some(x=>x.url===u.href))continue;links.push({label:label.slice(0,120)||'相关招聘链接',url:u.href});}catch{}}
 return {status:'ready',dueAt,kind,evidence,conflict,receivedAt,links,checkedAt:new Date().toISOString()};
}
module.exports={extract,receivedTime,timestamp};
