const { createUniversalResumePlan } = require('../resume-plan.cjs');
const { resolvePlatformUrl } = require('../platform-manifests.cjs');
const { LOGIN_AND_FORM_PROBE } = require('../form-inspection.cjs');
const { normalizeComparableValue } = require('../field-matching.cjs');
const {buildAlibabaCardScript,buildAlibabaInspectScript,buildAlibabaAddScript,buildAlibabaWriteScript,buildAlibabaReadbackScript}=require('../alibaba-form-context.cjs');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const CARDS=['个人信息','教育情况','实习/项目经历','其他信息'];
const PROJECT_LABELS={name:'项目名称',client:'客户/服务客户',description:'项目背景',contribution:'个人贡献',techStack:'技术栈',outcome:'项目成果',link:'项目链接'};

function planAlibabaCard(plan,inspection,card){
  const writes=[],represented=new Set(),mappings=[];
  const write=(item,candidates,keys,representation='direct')=>{
    if(!item?.value||candidates.length!==1||candidates[0].readOnly)return;
    keys=keys||[item.key];writes.push({key:item.key,value:String(item.value),locator:candidates[0].locator});keys.forEach(key=>represented.add(key));mappings.push({controlKey:item.key,sourceKeys:keys,representation});
  };
  const fields=inspection.fields||[],exact=name=>fields.filter(f=>f.name===name),caption=label=>fields.filter(f=>f.label===label&&!f.readOnly),item=key=>plan.find(i=>i.key===key);
  if(card==='个人信息'){
    for(const [key,label] of [['basic.name','姓名'],['basic.phone','手机'],['basic.email','邮箱']])write(item(key),caption(label));
    const ids=[item('basic.idCard'),/^(身份证|居民身份证)$/.test(item('basic.idType')?.value||'')?item('basic.idNumber'):null].filter(Boolean);
    if(ids.length&&ids.every(i=>i.value===ids[0].value))write(ids[0],caption('身份证号'),ids.map(i=>i.key));
  }
  if(card==='教育情况'){
    const group=inspection.groups?.find(g=>g.kind==='education'&&g.recognized);
    (group?.rows||[]).forEach((row,index)=>{
      for(const [local,remote] of [['department','academy'],['advisor','tutor']])write(item(`education.${index}.${local}`),exact(`${row}.${remote}`));
      const score=item(`education.${index}.gpa`),base=item(`education.${index}.gpaBase`);
      if(score&&base)write({...score,value:score.value+'/'+base.value},exact(`${row}.gpaScore`),[score.key,base.key],'score/full-score');
    });
    write(item('basic.github'),exact('github'));
  }
  if(card==='实习/项目经历'){
    for(const kind of ['experience','projects']){
      const group=inspection.groups?.find(g=>g.kind===kind&&g.recognized);
      (group?.rows||[]).forEach((row,index)=>{
        write(item(`${kind}.${index}.role`),exact(`${row}.responsibility`));
        if(kind==='experience'){
          write(item(`${kind}.${index}.company`),exact(`${row}.name`));write(item(`${kind}.${index}.description`),exact(`${row}.description`));
        }else{
          const facts=Object.entries(PROJECT_LABELS).map(([field,label])=>({item:item(`projects.${index}.${field}`),label})).filter(f=>f.item);
          if(facts.length)write({key:`projects.${index}.description`,value:facts.map(f=>`${f.label}：${f.item.value}`).join('\n')},exact(`${row}.description`),facts.map(f=>f.item.key),'labeled-project-description');
          // .name means organization. Project title/client are different facts.
        }
      });
    }
    write(item('extras.awards'),exact('reward'));
  }
  if(card==='其他信息')write(item('extras.summary'),fields.filter(f=>f.type==='textarea'&&f.locator.widget==='text'));
  return {writes,represented,mappings};
}
async function ensureRows(workspace,card,plan,step){
  let inspection=await workspace.run(buildAlibabaInspectScript(card));
  for(const kind of ['education','experience','projects']){
    const desired=Math.max(0,...plan.filter(i=>i.key.startsWith(kind+'.')).map(i=>Number(i.key.split('.')[1])+1));
    if(!desired)continue;
    for(let attempts=0;attempts<Math.min(desired,20);attempts++){
      const group=inspection.groups?.find(g=>g.kind===kind&&g.recognized);if(!group||group.rows.length>=desired)break;
      if(!await workspace.run(buildAlibabaAddScript(card,group.add,group.rows.length)))break;
      let next;for(let polls=0;polls<8;polls++){await pause(150);next=await workspace.run(buildAlibabaInspectScript(card));if((next.groups?.find(g=>g.kind===kind)?.rows.length||0)>group.rows.length)break;}
      if((next?.groups?.find(g=>g.kind===kind)?.rows.length||0)!==group.rows.length+1)break;
      inspection=next;step('row-added',`${card}：已暂存一段${kind==='projects'?'项目':kind==='education'?'教育':'实习'}经历`);
    }
  }
  return inspection;
}
async function fillAlibabaResume(resume,{workspace,company,recruitType='campus',syncTargetId,taskId,onStep,attachmentPath}={}){
  if(!workspace?.openWorkspace||!workspace?.run)throw Error('浏览器工作区未就绪');
  const step=(name,message)=>onStep?.({step:name,message}),track=['campus','summer-intern','daily-intern'].includes(recruitType)?'campus':'social';
  const openArgs={company,url:resolvePlatformUrl('alibaba',track,'resume'),mode:'resume-review',title:'核对阿里巴巴简历',context:{action:'fill-resume',companyId:'alibaba',syncTargetId:syncTargetId||'alibaba',taskId:taskId||null,recruitType:track}};
  step('loading','正在打开阿里巴巴简历页…');
  try{await workspace.openWorkspace(openArgs);}catch(error){if(!/ERR_ABORTED/.test(String(error.message)))throw error;await pause(2500);await workspace.openWorkspace(openArgs);}
  const probe=await workspace.run(LOGIN_AND_FORM_PROBE);
  if(probe.isNotFound||probe.loginRequired)return {ok:false,status:'login-required',message:'请先在当前阿里巴巴页面完成登录，然后重新更新'};
  let attachment=null;
  if(attachmentPath&&workspace.setInputFiles){
    step('attachment','正在选择你的简历附件…');
    try{attachment=await workspace.setInputFiles(attachmentPath);}catch{attachment={uploaded:false,reason:'附件选择未完成，请手动核对'};}
    if(attachment?.refresh&&attachment.refresh.phase!=='ready')return {ok:false,status:'review-required',message:'附件已选择；刷新确认或解析尚未完成，请在当前页面核对后继续',report:{attachment}};
  }
  const plan=createUniversalResumePlan(resume).filter(i=>i.value),sections=[],execution=[],mappings=[];
  // A view-state attachment input can precede the SPA's cards. Wait for structure,
  // not a field-count threshold, before declaring the first card unsupported.
  for(let polls=0;polls<20;polls++){
    const ready=await workspace.run(buildAlibabaInspectScript(CARDS[0]));
    if(ready.ok)break;
    await pause(200);
  }
  for(const card of CARDS){
    const opened=await workspace.run(buildAlibabaCardScript(card));
    if(!opened?.ok){sections.push({card,reason:opened?.reason||'card-unrecognized',wrote:0,verified:0,keys:[]});continue;}
    let inspection;for(let polls=0;polls<10;polls++){await pause(150);inspection=await workspace.run(buildAlibabaInspectScript(card));if(inspection.ok&&inspection.editing&&inspection.fields.length)break;}
    if(!inspection?.ok||!inspection.editing){sections.push({card,reason:'edit-not-ready',wrote:0,verified:0,keys:[]});continue;}
    inspection=await ensureRows(workspace,card,plan,step);
    const planned=planAlibabaCard(plan,inspection,card);mappings.push(...planned.mappings);
    const immediate=planned.writes.length?await workspace.run(buildAlibabaWriteScript(planned.writes)):[];
    execution.push(...immediate);sections.push({card,wrote:immediate.filter(i=>i.written).length,verified:0,keys:[],editing:true});
    step('section-filled',`${card}：已填写 ${immediate.filter(i=>i.written).length} 个控件，等待所有分区完成后回读`);
  }
  await pause(500);
  const final=execution.length?await workspace.run(buildAlibabaReadbackScript(execution)):[];
  const verified=final.filter(i=>i.written&&i.retained&&normalizeComparableValue(i.expected)===normalizeComparableValue(i.observed));
  const verifiedControls=new Set(verified.map(i=>i.key)),represented=new Set(mappings.filter(m=>verifiedControls.has(m.controlKey)).flatMap(m=>m.sourceKeys));
  for(const section of sections){section.keys=verified.filter(i=>i.locator.card===section.card).map(i=>i.key);section.verified=section.keys.length;}
  const manual=plan.filter(i=>!represented.has(i.key)).map(i=>({key:i.key,reason:/\.(start|end)$/.test(i.key)?'date-widget-manual':i.key.startsWith('experience.')?'work-group-or-field-unavailable':'unverified-or-unsupported-field'}));
  const wrote=sections.reduce((sum,s)=>sum+s.wrote,0),message=`已暂存 ${wrote} 个控件、回读核验 ${verified.length} 个；另有 ${manual.length} 项需人工核对。请逐区核对并点击保存；尚未保存到官网`;
  step('review-required',message);
  return {ok:verified.length>0,status:'review-required',message,report:{sections,attachment,manual,mappings,verified:verified.map(i=>i.key),mismatched:final.filter(i=>i.written&&!verifiedControls.has(i.key)).map(i=>i.key),saved:false,compliance:'untouched'}};
}
module.exports={fillAlibabaResume,planAlibabaCard};
